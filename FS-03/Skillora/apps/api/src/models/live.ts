import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LIVE_CLASS_STATUSES, ROLES } from '@skillora/shared';
import { toJSONOptions } from './identity';

/* ------------------------------------------------------------------ *
 * Live class
 * ------------------------------------------------------------------ */
const liveClassSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    instructor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 140 },
    description: { type: String, default: null, maxlength: 3000 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: LIVE_CLASS_STATUSES, default: 'scheduled', index: true },
    roomName: { type: String, required: true, unique: true, index: true },
    maxParticipants: { type: Number, default: 100, min: 2, max: 500 },
    allowStudentRecording: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    reminderSentAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
liveClassSchema.index({ course: 1, startsAt: -1 });
liveClassSchema.index({ status: 1, startsAt: 1 });

export type LiveClassDoc = HydratedDocument<InferSchemaType<typeof liveClassSchema>>;
export const LiveClass = model('LiveClass', liveClassSchema);

/* ------------------------------------------------------------------ *
 * Participant / attendance
 * ------------------------------------------------------------------ */
const liveClassParticipantSchema = new Schema(
  {
    liveClass: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    attendanceSeconds: { type: Number, default: 0, min: 0 },
    connectionCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
liveClassParticipantSchema.index({ liveClass: 1, user: 1 }, { unique: true });

export const LiveClassParticipant = model('LiveClassParticipant', liveClassParticipantSchema);

/* ------------------------------------------------------------------ *
 * Chat message (persisted for history; realtime fan-out via Socket.IO)
 * ------------------------------------------------------------------ */
const liveChatMessageSchema = new Schema(
  {
    liveClass: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderName: { type: String, required: true, maxlength: 120 },
    senderRole: { type: String, enum: ROLES, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
liveChatMessageSchema.index({ liveClass: 1, createdAt: -1 });

export const LiveChatMessage = model('LiveChatMessage', liveChatMessageSchema);
