import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { attachUser } from './middleware/auth.js';
import { csrfToken, requireCsrf } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import webhookRoutes from './routes/webhook.routes.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // API only; the SPA is served separately by Vite/Render.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const allowedOrigins = new Set([config.clientUrl, ...config.extraOrigins].filter(Boolean));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests have no Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
        logger.warn({ origin }, 'Blocked CORS origin');
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'X-CSRF-Token'],
      maxAge: 86400,
    }),
  );

  app.use(requestLogger);

  // Webhooks first: they need the raw body for signature verification.
  app.use('/api/github', webhookRoutes);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    session({
      name: config.session.name,
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        mongoUrl: config.mongo.uri,
        collectionName: 'sessions',
        ttl: config.session.ttlDays * 24 * 60 * 60,
        touchAfter: 12 * 3600,
        crypto: { secret: config.session.secret.slice(0, 32) },
      }),
      cookie: {
        httpOnly: true,
        secure: config.isProd,
        sameSite: config.isProd ? 'none' : 'lax',
        maxAge: config.session.ttlDays * 24 * 60 * 60 * 1000,
        path: '/',
      },
    }),
  );

  app.use(csrfToken);
  app.use(attachUser);
  app.use('/api', apiLimiter, requireCsrf, apiRoutes);

  app.get('/', (_req, res) => res.json({ success: true, data: { name: 'CodeWeave API', version: '1.0.0', docs: '/api/health' } }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
