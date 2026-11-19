import { Types } from 'mongoose';
import { REMINDER_JOB_NAME, REMINDER_LEAD_MINUTES, type LiveClassCreateInput, type Role } from '@skillora/shared';
import { env, integrationStatus } from '../config/env';
import { enqueue, reminderQueue } from '../config/queues';
import { Course, Enrollment } from '../models/course';
import { LiveClass, LiveChatMessage, LiveClassParticipant } from '../models/live';
import { User, createNotification, writeAudit } from '../models/identity';
import { errors } from '../lib/errors';
import { resolveCourseAccess } from './enrollment.service';

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

const ROOM_PREFIX = 'skillora';

function roomNameFor(courseId: string, liveClassId: string): string {
  return `${ROOM_PREFIX}_${courseId}_${liveClassId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

/* ------------------------------------------------------------------ *
 * Scheduling (instructor only, scoped to their own courses)
 * ------------------------------------------------------------------ */
export async function createLiveClass(
  instructorId: string,
  input: LiveClassCreateInput,
): Promise<any> {
  const course = await Course.findById(input.courseId).lean();
  if (!course) throw errors.notFound('Course not found');
  if (String(course.instructor) !== instructorId) {
    throw errors.forbidden('You can only schedule classes for your own courses');
  }
  if (course.status === 'archived') throw errors.precondition('Archived courses cannot host live classes');

  const liveClass = await LiveClass.create({
    course: course._id,
    instructor: oid(instructorId),
    title: input.title,
    description: input.description ?? null,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    status: 'scheduled',
    roomName: 'pending',
    maxParticipants: input.maxParticipants,
    allowStudentRecording: input.allowStudentRecording,
  });

  liveClass.roomName = roomNameFor(String(course._id), String(liveClass._id));
  await liveClass.save();
  await syncReminderJob(String(liveClass._id), liveClass.status, liveClass.startsAt);

  // Notify enrolled students.
  const enrollments = await Enrollment.find({ course: course._id }).select('user').limit(5000).lean();
  for (const e of enrollments) {
    await createNotification({
      user: String(e.user),
      type: 'live_class_reminder',
      title: `New live class: ${input.title}`,
      body: `A live session for "${course.title}" is scheduled for ${new Date(input.startsAt).toLocaleString()}.`,
      link: `/live/${String(liveClass._id)}`,
    });
  }
  await writeAudit({
    actor: instructorId,
    actorRole: 'instructor',
    action: 'live_class.created',
    entityType: 'liveClass',
    entityId: String(liveClass._id),
    metadata: { courseId: String(course._id), startsAt: input.startsAt },
  });

  return liveClass;
}

export async function updateLiveClass(
  liveClassId: string,
  patch: { title?: string; description?: string; startsAt?: string; endsAt?: string; status?: 'scheduled' | 'completed' | 'cancelled'; maxParticipants?: number },
  actor: { id: string; role: Role },
) {
  const liveClass = await LiveClass.findById(liveClassId);
  if (!liveClass) throw errors.notFound('Live class not found');
  assertCanManage(liveClass, actor);

  if (patch.startsAt) liveClass.startsAt = new Date(patch.startsAt);
  if (patch.endsAt) liveClass.endsAt = new Date(patch.endsAt);
  if (patch.title) liveClass.title = patch.title;
  if (patch.description !== undefined) liveClass.description = patch.description;
  if (patch.maxParticipants) liveClass.maxParticipants = patch.maxParticipants;
  if (patch.status) {
    liveClass.status = patch.status;
    if (patch.status === 'cancelled') {
      liveClass.cancelledAt = new Date();
      liveClass.status = 'cancelled';
    }
    if (patch.status === 'completed') liveClass.endedAt = new Date();
  }
  if (liveClass.endsAt.getTime() <= liveClass.startsAt.getTime()) {
    throw errors.validation('endsAt must be after startsAt');
  }
  await liveClass.save();
  await syncReminderJob(String(liveClass._id), liveClass.status, liveClass.startsAt);
  return liveClass;
}

/**
 * Keeps the delayed BullMQ reminder job in sync with the class schedule.
 * The job id is stable per class, so rescheduling replaces the old delay and
 * cancelling removes any pending reminder entirely.
 */
export async function syncReminderJob(
  liveClassId: string,
  status: string,
  startsAt: Date,
): Promise<void> {
  const jobId = `${REMINDER_JOB_NAME}:${liveClassId}`;
  try {
    await reminderQueue().remove(jobId);
  } catch {
    /* queue unreachable — API still works, reminders are best-effort */
  }
  if (status !== 'scheduled') return;

  const leadMs = REMINDER_LEAD_MINUTES * 60_000;
  const delay = Math.max(0, startsAt.getTime() - leadMs - Date.now());
  if (startsAt.getTime() <= Date.now()) return; // already started: nothing to remind
  await enqueue(
    reminderQueue(),
    REMINDER_JOB_NAME,
    { liveClassId },
    { jobId, delay },
  );
}

function assertCanManage(liveClass: any, actor: { id: string; role: Role }): void {
  if (actor.role === 'admin') return;
  if (String(liveClass.instructor) !== actor.id) {
    throw errors.forbidden('You can only manage your own live classes');
  }
}

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */
export async function listForCourse(
  courseId: string,
  viewer: { id: string; role: Role } | null,
) {
  const rows = await LiveClass.find({ course: oid(courseId) })
    .sort({ startsAt: -1 })
    .populate('instructor', 'name avatarUrl')
    .lean();

  let isEnrolled = false;
  if (viewer) {
    isEnrolled = Boolean(
      await Enrollment.exists({ user: oid(viewer.id), course: oid(courseId) }),
    );
  }

  return rows.map((row) => mapDto(row, viewer, isEnrolled));
}

export async function listUpcomingForStudent(studentId: string) {
  const enrollments = await Enrollment.find({ user: oid(studentId) }).select('course').lean();
  const courseIds = enrollments.map((e) => e.course);
  const rows = await LiveClass.find({
    course: { $in: courseIds },
    startsAt: { $gte: new Date(Date.now() - 3600_000) },
    status: { $in: ['scheduled', 'live'] },
  })
    .sort({ startsAt: 1 })
    .limit(20)
    .populate('course', 'title slug thumbnailUrl')
    .populate('instructor', 'name avatarUrl')
    .lean();
  return rows.map((r) => mapDto(r, { id: studentId, role: 'student' }, true));
}

export async function listForInstructor(instructorId: string) {
  const rows = await LiveClass.find({ instructor: oid(instructorId) })
    .sort({ startsAt: -1 })
    .limit(100)
    .populate('course', 'title slug thumbnailUrl')
    .lean();
  return rows.map((r) => mapDto(r, { id: instructorId, role: 'instructor' }, false));
}

function mapDto(row: any, viewer: { id: string; role: Role } | null, isEnrolled: boolean) {
  const now = Date.now();
  const start = new Date(row.startsAt).getTime();
  const end = new Date(row.endsAt).getTime();
  const isOwner = viewer?.id === String(row.instructor);
  const isAdmin = viewer?.role === 'admin';
  const withinWindow = now >= start - 15 * 60_000 && now <= end + 30 * 60_000;

  return {
    id: String(row._id),
    courseId: String(row.course?._id ?? row.course),
    courseTitle: row.course?.title ?? 'Course',
    courseSlug: row.course?.slug ?? null,
    thumbnailUrl: row.course?.thumbnailUrl ?? null,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    durationMinutes: Math.max(1, Math.round((end - start) / 60_000)),
    roomName: row.roomName,
    maxParticipants: row.maxParticipants ?? 100,
    attendanceCount: row.attendanceCount ?? 0,
    instructorName: row.instructor?.name ?? null,
    isEnrolled,
    canJoin: Boolean(row.status !== 'cancelled' && (isOwner || isAdmin || isEnrolled) && withinWindow),
    isOwner: Boolean(isOwner || isAdmin),
    startsAtEpochMs: start,
    endsAtEpochMs: end,
  };
}

/* ------------------------------------------------------------------ *
 * Room access — secure token generation on the backend
 * ------------------------------------------------------------------ */
export interface RoomTokenResult {
  liveClassId: string;
  roomName: string;
  token: string | null;
  role: 'host' | 'participant';
  wsUrl: string | null;
  livekitEnabled: boolean;
  reason?: string;
}

/**
 * Issues a LiveKit room token.
 *
 * - Instructors get publish + admin (host) permissions.
 * - Students get subscribe-only participant permissions and can never control
 *   the room.
 * - When LiveKit is not configured the call fails loudly with a reason instead
 *   of pretending a room is working.
 */
export async function issueRoomToken(
  liveClassId: string,
  viewer: { id: string; role: Role; name: string },
): Promise<RoomTokenResult> {
  const liveClass = await LiveClass.findById(liveClassId)
    .populate('course', 'title instructor')
    .lean();
  if (!liveClass) throw errors.notFound('Live class not found');

  const isOwner = String(liveClass.instructor) === viewer.id;
  const isAdmin = viewer.role === 'admin';

  if (!isOwner && !isAdmin) {
    // Students must be enrolled in the linked course.
    const access = await resolveCourseAccess(viewer.id, String(liveClass.course?._id ?? liveClass.course), viewer.role);
    if (!access.enrollment) {
      throw errors.forbidden('You must be enrolled in this course to join the live class');
    }
  }

  if (liveClass.status === 'cancelled') throw errors.precondition('This live class was cancelled');

  const now = Date.now();
  const start = new Date(liveClass.startsAt).getTime();
  const end = new Date(liveClass.endsAt).getTime();
  if (now < start - 15 * 60_000) throw errors.precondition('This live class has not started yet');
  if (now > end + 60 * 60_000) throw errors.precondition('This live class has already ended');

  const role: 'host' | 'participant' = isOwner || isAdmin ? 'host' : 'participant';

  if (!integrationStatus.livekit) {
    return {
      liveClassId: String(liveClass._id),
      roomName: liveClass.roomName,
      token: null,
      role,
      wsUrl: null,
      livekitEnabled: false,
      reason: 'livekit_not_configured',
    };
  }

  const { AccessToken } = await import('livekit-server-sdk');
  const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
    identity: `${role === 'host' ? 'host' : 'user'}_${viewer.id}`.slice(0, 40),
    name: viewer.name.slice(0, 60),
    ttl: 2 * 3600,
  });

  if (role === 'host') {
    token.addGrant({
      room: liveClass.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: true,
      roomCreate: true,
    });
  } else {
    token.addGrant({
      room: liveClass.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      roomAdmin: false,
      roomCreate: false,
    });
  }

  const jwt = await token.toJwt();

  // Record attendance intent.
  await LiveClassParticipant.updateOne(
    { liveClass: liveClass._id, user: oid(viewer.id) },
    {
      $set: { role: viewer.role, joinedAt: new Date() },
      $setOnInsert: { liveClass: liveClass._id, user: oid(viewer.id) },
    },
    { upsert: true },
  );

  if (liveClass.status === 'scheduled' && now >= start - 5 * 60_000) {
    await LiveClass.updateOne({ _id: liveClass._id }, { $set: { status: 'live' } });
  }

  return {
    liveClassId: String(liveClass._id),
    roomName: liveClass.roomName,
    token: jwt,
    role,
    wsUrl: env.LIVEKIT_URL ?? null,
    livekitEnabled: true,
  };
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */
export async function getChatHistory(liveClassId: string, viewer: { id: string; role: Role }, limit = 200) {
  await assertCanJoinChat(liveClassId, viewer);
  const rows = await LiveChatMessage.find({ liveClass: oid(liveClassId) })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  return rows.map((m) => ({
    id: String(m._id),
    liveClassId,
    senderName: m.senderName,
    senderRole: m.senderRole,
    message: m.message,
    createdAt: new Date(m.createdAt as never).toISOString(),
  }));
}

export async function saveChatMessage(
  liveClassId: string,
  viewer: { id: string; role: Role; name: string },
  message: string,
) {
  await assertCanJoinChat(liveClassId, viewer);
  const doc = await LiveChatMessage.create({
    liveClass: oid(liveClassId),
    sender: oid(viewer.id),
    senderName: viewer.name,
    senderRole: viewer.role,
    message: message.slice(0, 1000),
  });
  return {
    id: String(doc._id),
    liveClassId,
    senderName: doc.senderName,
    senderRole: doc.senderRole,
    message: doc.message,
    createdAt: new Date(doc.createdAt as never).toISOString(),
  };
}

async function assertCanJoinChat(liveClassId: string, viewer: { id: string; role: Role }): Promise<void> {
  const liveClass = await LiveClass.findById(liveClassId).select('instructor course status').lean();
  if (!liveClass) throw errors.notFound('Live class not found');
  if (viewer.role === 'admin' || String(liveClass.instructor) === viewer.id) return;
  const enrolled = await Enrollment.exists({ user: oid(viewer.id), course: liveClass.course });
  if (!enrolled) throw errors.forbidden('You must be enrolled to participate in this class');
}

/* ------------------------------------------------------------------ *
 * Attendance bookkeeping
 * ------------------------------------------------------------------ */
export async function heartbeat(liveClassId: string, userId: string): Promise<void> {
  const participant = await LiveClassParticipant.findOne({
    liveClass: oid(liveClassId),
    user: oid(userId),
  });
  if (!participant) return;
  const now = new Date();
  if (participant.joinedAt && !participant.leftAt) {
    // accumulate in coarse 30s buckets from the last heartbeat
    const last = participant.updatedAt ? new Date(participant.updatedAt).getTime() : now.getTime();
    const delta = Math.min(60, Math.max(0, Math.round((now.getTime() - last) / 1000)));
    participant.attendanceSeconds += delta;
  }
  participant.leftAt = null;
  await participant.save();
}

export async function leaveRoom(liveClassId: string, userId: string): Promise<void> {
  await LiveClassParticipant.updateOne(
    { liveClass: oid(liveClassId), user: oid(userId), joinedAt: { $ne: null } },
    { $set: { leftAt: new Date() } },
  );
}

export async function getParticipants(liveClassId: string, viewer: { id: string; role: Role }) {
  await assertCanJoinChat(liveClassId, viewer);
  const rows = await LiveClassParticipant.find({ liveClass: oid(liveClassId) })
    .populate('user', 'name avatarUrl')
    .lean();
  return rows.map((p: any) => ({
    id: String(p._id),
    userId: String(p.user?._id ?? p.user),
    userName: p.user?.name ?? 'Learner',
    avatarUrl: p.user?.avatarUrl ?? null,
    role: p.role,
    joinedAt: p.joinedAt ? new Date(p.joinedAt).toISOString() : null,
    leftAt: p.leftAt ? new Date(p.leftAt).toISOString() : null,
    attendanceSeconds: p.attendanceSeconds ?? 0,
    online: !p.leftAt && p.joinedAt !== null,
  }));
}

/** Admin monitoring view across all sessions. */
export async function monitorAll(page = 1, limit = 20) {
  const [rows, total] = await Promise.all([
    LiveClass.find({})
      .sort({ startsAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('course', 'title')
      .populate('instructor', 'name email')
      .lean(),
    LiveClass.countDocuments({}),
  ]);
  return {
    items: rows.map((r: any) => ({
      id: String(r._id),
      title: r.title,
      courseTitle: r.course?.title ?? '—',
      instructorName: r.instructor?.name ?? '—',
      status: r.status,
      startsAt: new Date(r.startsAt).toISOString(),
      endsAt: new Date(r.endsAt).toISOString(),
      roomName: r.roomName,
      participants: r.attendanceCount ?? 0,
    })),
    total,
  };
}

export async function getLiveClassForUser(id: string, viewer: { id: string; role: Role } | null) {
  const row = await LiveClass.findById(id)
    .populate('course', 'title slug thumbnailUrl instructor')
    .populate('instructor', 'name avatarUrl')
    .lean();
  if (!row) throw errors.notFound('Live class not found');
  const isEnrolled = viewer
    ? Boolean(await Enrollment.exists({ user: oid(viewer.id), course: row.course?._id ?? row.course }))
    : false;
  return mapDto(row, viewer, isEnrolled);
}

export { User as UserModel };