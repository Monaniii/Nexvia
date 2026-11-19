import type { Job } from 'bullmq';
import {
  LiveClass,
  User,
  Enrollment,
  createNotification,
  logger,
} from '../data';

export interface ReminderJobData {
  liveClassId: string;
}

/**
 * Runs ~15 minutes before a class starts (delay set by the API when the class
 * is created or rescheduled). Notifies enrolled students and the instructor;
 * re-checks that the class is still scheduled so cancelled classes stay silent.
 */
export async function processReminder(job: Job<ReminderJobData>): Promise<void> {
  const { liveClassId } = job.data;

  const liveClass = await LiveClass.findById(liveClassId)
    .select('title startsAt status course instructor')
    .lean();
  if (!liveClass) {
    logger.info({ liveClassId }, 'Reminder target no longer exists, skipping');
    return;
  }
  if (liveClass.status !== 'scheduled') {
    logger.info({ liveClassId, status: liveClass.status }, 'Class no longer scheduled, skipping reminder');
    return;
  }

  const startsAt = new Date(liveClass.startsAt as unknown as string);
  if (Number.isFinite(startsAt.getTime()) && startsAt.getTime() < Date.now() - 60_000) {
    logger.info({ liveClassId }, 'Class already started before reminder fired, skipping');
    return;
  }

  const when = startsAt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const recipients = new Set<string>();
  recipients.add(String(liveClass.instructor));
  const enrollments = await Enrollment.find({ course: liveClass.course })
    .select('user')
    .limit(5000)
    .lean();
  for (const e of enrollments) recipients.add(String(e.user));

  let sent = 0;
  for (const userId of recipients) {
    const user = await User.findById(userId).select('_id').lean();
    if (!user) continue;
    await createNotification({
      user: userId,
      type: 'live_class_reminder',
      title: `Starting soon: ${liveClass.title}`,
      body: `Your live class starts at ${when}.`,
      link: `/live/${liveClassId}`,
    });
    sent += 1;
  }

  logger.info({ liveClassId, sent }, 'Live class reminders delivered');
}
