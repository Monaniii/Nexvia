import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { isEligibleForCertificate } from '@skillora/shared';
import { env } from '../config/env';
import { Course, Enrollment, Lesson, LessonProgress } from '../models/course';
import { Certificate } from '../models/learning';
import { InstructorProfile, User, createNotification, writeAudit } from '../models/identity';
import { errors } from '../lib/errors';
import { hmacId, randomCertificateNumber } from '../lib/crypto';
import { storage, keys } from '../storage';
import { getQuizCompletionForCourse } from './quiz.service';
import { logger } from '../lib/logger';

export interface CertificateRenderInput {
  certificateNumber: string;
  studentName: string;
  courseTitle: string;
  instructorName: string;
  platformName: string;
  issuedAt: Date;
  scorePercent?: number | null;
  verificationUrl: string;
}

const NAVY = '#0f1e3d';
const INDIGO = '#4f46e5';
const TEAL = '#0d9488';
const MUTED = '#64748b';

/**
 * Renders the completion certificate as a printable A4-landscape PDF.
 * Branding lives in the color/type system rather than images so the PDF works
 * without any external assets.
 */
export function renderCertificatePdf(input: CertificateRenderInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;

      // Outer frame
      doc.rect(28, 28, W - 56, H - 56).lineWidth(2).stroke(NAVY);
      doc.rect(36, 36, W - 72, H - 72).lineWidth(0.5).stroke(INDIGO);

      // Header band
      doc.rect(36, 36, W - 72, 96).fill(NAVY);
      doc.fill('#ffffff').font('Helvetica-Bold').fontSize(30).text(input.platformName, 60, 66, {
        align: 'left',
      });
      doc.font('Helvetica').fontSize(11).fill('#cbd5e1').text('Certificate of Completion', 60, 104);

      // Accent line
      doc.rect(60, 150, 120, 4).fill(TEAL);

      // Body
      doc.fill(MUTED).font('Helvetica').fontSize(13).text('This certifies that', 60, 180);
      doc.fill(NAVY).font('Helvetica-Bold').fontSize(40).text(input.studentName, 60, 204, {
        width: W - 120,
      });

      doc.fill(MUTED).font('Helvetica').fontSize(13).text('has successfully completed the course', 60, 268);
      doc.fill(INDIGO).font('Helvetica-Bold').fontSize(24).text(input.courseTitle, 60, 292, {
        width: W - 120,
      });

      doc.fill(MUTED).font('Helvetica').fontSize(12).text(`Instructor: ${input.instructorName}`, 60, 344);

      const issued = input.issuedAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      doc.fill(MUTED).text(`Issued on ${issued}`, 60, 366);
      if (input.scorePercent !== undefined && input.scorePercent !== null) {
        doc.fill(MUTED).text(`Final score: ${input.scorePercent}%`, 60, 388);
      }

      // Footer: certificate number + verification
      const footerY = H - 130;
      doc.moveTo(60, footerY - 16).lineTo(W - 60, footerY - 16).lineWidth(0.5).stroke('#cbd5e1');

      doc.fill(NAVY).font('Helvetica-Bold').fontSize(11).text(`Certificate No. ${input.certificateNumber}`, 60, footerY);
      doc.fill(MUTED).font('Helvetica').fontSize(10).text(`Verify at ${input.verificationUrl}`, 60, footerY + 18, {
        width: W - 300,
        link: input.verificationUrl,
        underline: true,
      });

      // Signature block
      doc.fill(MUTED).fontSize(10).text('Authorized signature', W - 260, footerY + 4, { width: 200, align: 'center' });
      doc.moveTo(W - 250, footerY + 2).lineTo(W - 50, footerY + 2).lineWidth(1).stroke(NAVY);
      doc.fill(NAVY).font('Helvetica-Bold').fontSize(11).text(input.instructorName, W - 260, footerY + 6, {
        width: 200,
        align: 'center',
      });

      // QR code (small, generated from the verification URL) when a renderer is available
      // (kept optional: pdfkit has no built-in QR; the URL is printed in text form).

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function certificateVerificationUrl(verificationId: string): string {
  const base = env.APP_URL.replace(/\/$/, '');
  // The public verification page lives on the web app.
  const webBase = env.WEB_ORIGIN.replace(/\/$/, '');
  void base;
  return `${webBase}/verify/${verificationId}`;
}

/* ------------------------------------------------------------------ *
 * Issuance
 * ------------------------------------------------------------------ */

/**
 * Issues the course certificate when the learner satisfies the course's
 * completion rules. Idempotent: a second call for an already-issued
 * certificate is a no-op (protected by the unique user+course index).
 */
export async function maybeIssueCertificate(userId: string, courseId: string): Promise<any | null> {
  const course = await Course.findById(courseId).lean();
  if (!course || course.status !== 'published') return null;

  const existing = await Certificate.findOne({
    user: new Types.ObjectId(userId),
    course: new Types.ObjectId(courseId),
    status: 'issued',
  }).lean();
  if (existing) return existing;

  const enrollment = await Enrollment.findOne({
    user: new Types.ObjectId(userId),
    course: new Types.ObjectId(courseId),
  }).lean();
  if (!enrollment) return null;

  const lessons = await Lesson.find({ course: new Types.ObjectId(courseId), isPublished: true })
    .select('_id')
    .lean();
  const completedCount = await LessonProgress.countDocuments({
    user: new Types.ObjectId(userId),
    lesson: { $in: lessons.map((l) => l._id) },
    completed: true,
  });

  const quizStats = await getQuizCompletionForCourse(userId, courseId);
  const rules = (course as any).certificateRule ?? {};

  const eligibility = isEligibleForCertificate({
    totalLessons: lessons.length,
    completedLessons: completedCount,
    requiredLessonCount: lessons.length,
    requiredQuizCount: quizStats.requiredQuizCount,
    passedRequiredQuizzes: quizStats.passedRequiredQuizzes,
    averageScorePercent: quizStats.averageScorePercent,
    minOverallScorePercent: rules.minOverallScorePercent ?? undefined,
    requireAllLessons: rules.requireAllLessons !== false,
    requireAllQuizzes: rules.requireAllQuizzes !== false,
  });

  if (!eligibility.ok) return null;

  const user = await User.findById(userId).select('name').lean();
  const instructor = await User.findById(course.instructor).select('name').lean();
  if (!user) return null;

  const certificateNumber = randomCertificateNumber();
  const verificationId = hmacId(certificateNumber);

  const certificate = await Certificate.create({
    certificateNumber,
    verificationId,
    course: new Types.ObjectId(courseId),
    user: new Types.ObjectId(userId),
    studentName: user.name,
    courseTitle: course.title,
    instructorName: instructor?.name ?? 'Skillora Instructor',
    scorePercent: quizStats.requiredQuizCount > 0 ? quizStats.averageScorePercent : null,
    issuedAt: new Date(),
    status: 'issued',
  });

  // Render the PDF asynchronously; failure is retryable via the regenerate endpoint.
  try {
    const pdf = await renderCertificatePdf({
      certificateNumber,
      studentName: user.name,
      courseTitle: course.title,
      instructorName: instructor?.name ?? 'Skillora Instructor',
      platformName: env.PLATFORM_NAME,
      issuedAt: new Date(),
      scorePercent: quizStats.requiredQuizCount > 0 ? quizStats.averageScorePercent : null,
      verificationUrl: certificateVerificationUrl(verificationId),
    });
    await storage().put(keys.certificate(certificateNumber), pdf, {
      contentType: 'application/pdf',
    });
    certificate.pdfKey = keys.certificate(certificateNumber);
    await certificate.save();
  } catch (err) {
    logger.error({ err, certificateNumber }, 'Certificate PDF render failed');
  }

  await createNotification({
    user: userId,
    type: 'certificate_issued',
    title: 'Certificate earned',
    body: `Congratulations! You earned a certificate for "${course.title}".`,
    link: '/certificates',
  });
  await writeAudit({
    actor: userId,
    action: 'certificate.issued',
    entityType: 'certificate',
    entityId: String(certificate._id),
    metadata: { certificateNumber, courseId },
  });

  return certificate;
}

export async function listMyCertificates(userId: string) {
  const rows = await Certificate.find({ user: new Types.ObjectId(userId) })
    .sort({ issuedAt: -1 })
    .lean();
  return rows.map(toCertificateDto);
}

function toCertificateDto(row: any) {
  return {
    id: String(row._id),
    certificateNumber: row.certificateNumber,
    courseId: String(row.course),
    courseTitle: row.courseTitle,
    studentName: row.studentName,
    instructorName: row.instructorName,
    issuedAt: new Date(row.issuedAt).toISOString(),
    status: row.status,
    verificationUrl: certificateVerificationUrl(row.verificationId),
    downloadUrl: `${env.API_BASE_PATH}/certificates/${row.certificateNumber}/pdf`,
    scorePercent: row.scorePercent ?? null,
  };
}

/**
 * Public verification: confirms existence + validity only. No email address,
 * no internal ids, no progress data is disclosed.
 */
export async function verifyCertificate(lookup: string) {
  const cert = await Certificate.findOne({
    $or: [{ verificationId: lookup }, { certificateNumber: lookup.toUpperCase() }],
  })
    .select('certificateNumber courseTitle studentName issuedAt status verificationId')
    .lean();

  if (!cert) {
    return {
      valid: false,
      certificateNumber: lookup,
      reason: 'No certificate matches this verification id',
    };
  }

  if (cert.status === 'revoked') {
    return {
      valid: false,
      certificateNumber: cert.certificateNumber,
      status: 'revoked',
      reason: 'This certificate has been revoked',
    };
  }

  return {
    valid: true,
    certificateNumber: cert.certificateNumber,
    courseTitle: cert.courseTitle,
    studentName: cert.studentName,
    issuedAt: new Date(cert.issuedAt).toISOString(),
    status: cert.status,
  };
}

export async function downloadCertificatePdf(certificateNumber: string): Promise<Buffer> {
  const cert = await Certificate.findOne({ certificateNumber: certificateNumber.toUpperCase() }).lean();
  if (!cert) throw errors.notFound('Certificate not found');
  if (cert.status === 'revoked') throw errors.forbidden('This certificate has been revoked');

  if (cert.pdfKey && (await storage().exists(cert.pdfKey))) {
    return storage().get(cert.pdfKey);
  }

  // Regenerate on demand (e.g. first download or storage wipe).
  const pdf = await renderCertificatePdf({
    certificateNumber: cert.certificateNumber,
    studentName: cert.studentName,
    courseTitle: cert.courseTitle,
    instructorName: cert.instructorName,
    platformName: env.PLATFORM_NAME,
    issuedAt: new Date(cert.issuedAt),
    scorePercent: cert.scorePercent ?? null,
    verificationUrl: certificateVerificationUrl(cert.verificationId),
  });
  await storage().put(keys.certificate(cert.certificateNumber), pdf, {
    contentType: 'application/pdf',
  });
  await Certificate.updateOne({ _id: cert._id }, { $set: { pdfKey: keys.certificate(cert.certificateNumber) } });
  return pdf;
}

export async function revokeCertificate(certificateId: string, adminId: string, reason?: string) {
  const cert = await Certificate.findById(certificateId);
  if (!cert) throw errors.notFound('Certificate not found');
  if (cert.status === 'revoked') return cert;
  cert.status = 'revoked';
  cert.revokedAt = new Date();
  cert.revokedBy = new Types.ObjectId(adminId);
  cert.revokeReason = reason ?? null;
  await cert.save();
  await writeAudit({
    actor: adminId,
    actorRole: 'admin',
    action: 'certificate.revoked',
    entityType: 'certificate',
    entityId: String(cert._id),
    metadata: { certificateNumber: cert.certificateNumber, reason: reason ?? null },
  });
  return cert;
}

/** Instructor/admin view for a single course. */
export async function listCourseCertificates(courseId: string) {
  const rows = await Certificate.find({ course: new Types.ObjectId(courseId) })
    .sort({ issuedAt: -1 })
    .lean();
  return rows.map(toCertificateDto);
}

export async function getInstructorNameForCourse(courseId: string): Promise<string> {
  const course = await Course.findById(courseId).select('instructor').lean();
  if (!course) return 'Skillora Instructor';
  const profile = await InstructorProfile.findOne({ user: course.instructor }).lean();
  return profile?.displayName ?? 'Skillora Instructor';
}
