import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';
import { ROLES, NOTIFICATION_TYPES, type Role } from '@skillora/shared';

export const toJSONOptions = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    delete ret.passwordHash;
    delete ret.tokenHash;
    return ret;
  },
};

/* ------------------------------------------------------------------ *
 * User
 * ------------------------------------------------------------------ */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student', index: true },
    avatarUrl: { type: String, default: null },
    headline: { type: String, default: null, maxlength: 160 },
    bio: { type: String, default: null, maxlength: 4000 },
    website: { type: String, default: null },
    expertise: { type: [String], default: [] },
    socialLinks: {
      type: [{ _id: false, label: String, url: String }],
      default: [],
    },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>> & { role: Role };
export const User = model('User', userSchema);

/* ------------------------------------------------------------------ *
 * Refresh tokens (server-side session records, rotated on use)
 * ------------------------------------------------------------------ */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, select: false },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByJti: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
// Auto-purge expired sessions.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);

/* ------------------------------------------------------------------ *
 * Single-use, expiring tokens for email verification and password reset
 * ------------------------------------------------------------------ */
const authTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['verify_email', 'reset_password'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = model('AuthToken', authTokenSchema);

/* ------------------------------------------------------------------ *
 * Instructor profile
 * ------------------------------------------------------------------ */
const instructorProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true },
    headline: { type: String, default: null, maxlength: 160 },
    bio: { type: String, default: null, maxlength: 5000 },
    expertise: { type: [String], default: [] },
    website: { type: String, default: null },
    socialLinks: { type: [{ _id: false, label: String, url: String }], default: [] },
    approved: { type: Boolean, default: false, index: true },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    courseCount: { type: Number, default: 0, min: 0 },
    studentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const InstructorProfile = model('InstructorProfile', instructorProfileSchema);

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 1000 },
    link: { type: String, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
notificationSchema.index({ user: 1, createdAt: -1 });

export const Notification = model('Notification', notificationSchema);

/* ------------------------------------------------------------------ *
 * Audit log (security-sensitive administrative actions)
 * ------------------------------------------------------------------ */
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: 'system' },
    actorRole: { type: String, enum: [...ROLES, 'system'], default: 'system' },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, toJSON: toJSONOptions },
);
auditLogSchema.index({ entityType: 1, createdAt: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);

export type AuditEntry = {
  actor?: string | null;
  actorName?: string;
  actorRole?: Role | 'system';
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
};

/** Fire-and-forget audit writer — failures are logged, never thrown to the caller. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      actor: entry.actor ? new Types.ObjectId(entry.actor) : null,
      actorName: entry.actorName ?? 'system',
      actorRole: entry.actorRole ?? 'system',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      createdAt: new Date(),
    });
  } catch {
    /* audit failures must not break the main transaction */
  }
}

export async function createNotification(input: {
  user: string;
  type: (typeof NOTIFICATION_TYPES)[number];
  title: string;
  body: string;
  link?: string | null;
}): Promise<void> {
  try {
    await Notification.create({ ...input, link: input.link ?? null });
  } catch {
    /* non-critical */
  }
}