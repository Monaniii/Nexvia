import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './docs/openapi';
import { env, corsOrigins, isProd } from './config/env';
import { logger } from './lib/logger';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { signMediaUrl } from './lib/media';
import { storage } from './storage';

import authRoutes from './routes/auth.routes';
import catalogRoutes from './routes/catalog.routes';
import learningRoutes from './routes/learning.routes';
import mediaRoutes from './routes/media.routes';
import quizRoutes from './routes/quiz.routes';
import liveRoutes from './routes/live.routes';
import certificateRoutes from './routes/certificate.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import systemRoutes from './routes/system.routes';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Vite dev server and HLS playback need inline styles/scripts during development.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:', 'data:'],
          connectSrc: ["'self'", ...corsOrigins, 'ws:', 'wss:', 'https://*.livekit.cloud'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        // No origin = same-origin tools (curl, server-to-server).
        if (!origin) return cb(null, true);
        if (corsOrigins.includes(origin) || corsOrigins.includes('*')) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(apiLimiter);

  const base = env.API_BASE_PATH;

  // OpenAPI / Swagger UI
  const openapi = buildOpenApiDocument();
  app.use(`${base}/docs`, swaggerUi.serve, swaggerUi.setup(openapi, { explorer: false }));
  app.get(`${base}/openapi.json`, (_req: Request, res: Response) => {
    res.json(openapi);
  });

  app.use(base, authRoutes);
  app.use(base, systemRoutes);
  app.use(base, catalogRoutes);
  app.use(base, learningRoutes);
  app.use(base, mediaRoutes);
  app.use(base, quizRoutes);
  app.use(base, liveRoutes);
  app.use(base, certificateRoutes);
  app.use(base, paymentRoutes);
  app.use(base, adminRoutes);

  // Development helper: prints a signed URL for a stored media key so the
  // player can be exercised without the app UI.
  if (!isProd) {
    app.get(`${base}/media/dev-sign`, (req: Request, res: Response) => {
      const key = String(req.query.key ?? '');
      const uid = String(req.query.u ?? 'dev');
      if (!key) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'key required' } });
        return;
      }
      res.json({ success: true, data: { url: signMediaUrl(key, uid, 3600) } });
    });
  }

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'skillora-api',
      version: '1.0.0',
      docs: `${base}/docs`,
      health: `${base}/health`,
      environment: env.NODE_ENV,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  void storage; // driver is instantiated lazily on first media operation
  return app;
}