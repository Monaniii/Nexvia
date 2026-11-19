import { Router } from 'express';
import { chatMessageSchema, liveClassCreateSchema, liveClassUpdateSchema, paginationSchema } from '@skillora/shared';
import { validate, getValidatedQuery } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok, paginate } from '../lib/http';
import { authenticate, authorize, maybeAuthenticate } from '../middleware/auth';
import * as liveService from '../services/live.service';

const router = Router();

router.get(
  '/live/upcoming',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await liveService.listUpcomingForStudent(req.auth!.id));
  }),
);

router.get(
  '/live/instructor',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    ok(res, await liveService.listForInstructor(req.auth!.id));
  }),
);

router.get(
  '/courses/:courseId/live-classes',
  maybeAuthenticate,
  asyncHandler(async (req, res) => {
    ok(res, await liveService.listForCourse(String(req.params.courseId), req.auth ?? null));
  }),
);

router.post(
  '/instructor/live-classes',
  authenticate,
  authorize('instructor', 'admin'),
  validate(liveClassCreateSchema),
  asyncHandler(async (req, res) => {
    const liveClass = await liveService.createLiveClass(req.auth!.id, req.body);
    created(res, { id: String(liveClass._id), roomName: liveClass.roomName });
  }),
);

router.get(
  '/live/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await liveService.getLiveClassForUser(String(req.params.id), req.auth ?? null));
  }),
);

router.patch(
  '/instructor/live-classes/:id',
  authenticate,
  authorize('instructor', 'admin'),
  validate(liveClassUpdateSchema),
  asyncHandler(async (req, res) => {
    const updated = await liveService.updateLiveClass(String(req.params.id), req.body, req.auth!);
    ok(res, updated);
  }),
);

/**
 * Room token: issued server-side after authorization. Students receive
 * participant grants only; instructors receive host grants.
 */
router.post(
  '/live/:id/join',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await liveService.issueRoomToken(String(req.params.id), req.auth!);
    ok(res, result);
  }),
);

router.get(
  '/live/:id/chat',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await liveService.getChatHistory(String(req.params.id), req.auth!));
  }),
);

router.post(
  '/live/:id/chat',
  authenticate,
  validate(chatMessageSchema),
  asyncHandler(async (req, res) => {
    const message = await liveService.saveChatMessage(
      String(req.params.id),
      req.auth!,
      req.body.message,
    );
    created(res, message);
  }),
);

router.get(
  '/live/:id/participants',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await liveService.getParticipants(String(req.params.id), req.auth!));
  }),
);

router.post(
  '/live/:id/heartbeat',
  authenticate,
  asyncHandler(async (req, res) => {
    await liveService.heartbeat(String(req.params.id), req.auth!.id);
    ok(res, { ok: true });
  }),
);

router.post(
  '/live/:id/leave',
  authenticate,
  asyncHandler(async (req, res) => {
    await liveService.leaveRoom(String(req.params.id), req.auth!.id);
    ok(res, { ok: true });
  }),
);

router.get(
  '/admin/live-classes',
  authenticate,
  authorize('admin'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = getValidatedQuery<{ page: number; limit: number }>(req);
    const { items, total } = await liveService.monitorAll(page, limit);
    ok(res, paginate(items, total, page, limit));
  }),
);

export default router;