import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { ok } from '../lib/http';
import { authenticate, authorize } from '../middleware/auth';
import { errors } from '../lib/errors';
import * as certificateService from '../services/certificate.service';

const router = Router();

router.get(
  '/certificates',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await certificateService.listMyCertificates(req.auth!.id));
  }),
);

/** Attempts issuance if eligible; idempotent either way. */
router.post(
  '/certificates/check/:courseId',
  authenticate,
  asyncHandler(async (req, res) => {
    const certificate = await certificateService.maybeIssueCertificate(
      req.auth!.id,
      String(req.params.courseId),
    );
    ok(res, {
      issued: Boolean(certificate),
      certificate: certificate ? { id: String(certificate._id), number: certificate.certificateNumber } : null,
    });
  }),
);

router.get(
  '/certificates/:certificateNumber/pdf',
  asyncHandler(async (req, res) => {
    const pdf = await certificateService.downloadCertificatePdf(String(req.params.certificateNumber));
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `inline; filename="${String(req.params.certificateNumber)}.pdf"`,
        'Cache-Control': 'private, max-age=60',
      })
      .send(pdf);
  }),
);

/**
 * Public certificate verification — no authentication required, and it never
 * discloses email addresses or internal identifiers.
 */
router.get(
  '/verify/:lookup',
  asyncHandler(async (req, res) => {
    const lookup = String(req.params.lookup ?? '').trim();
    if (!lookup || lookup.length < 6 || lookup.length > 80) {
      throw errors.validation('Invalid verification id');
    }
    const result = await certificateService.verifyCertificate(lookup);
    res.status(result.valid ? 200 : 404).json({ success: result.valid, data: result });
  }),
);

router.post(
  '/admin/certificates/:id/revoke',
  authenticate,
  authorize('admin'),
  validate(z.object({ reason: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const cert = await certificateService.revokeCertificate(
      String(req.params.id),
      req.auth!.id,
      req.body.reason,
    );
    ok(res, { id: String(cert._id), status: cert.status });
  }),
);

router.get(
  '/admin/courses/:courseId/certificates',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    ok(res, await certificateService.listCourseCertificates(String(req.params.courseId)));
  }),
);

export default router;