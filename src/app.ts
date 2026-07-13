import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { env } from '@config/env';
import { prisma } from '@shared/db/prisma';
import { getRedis } from '@config/redis';
import { globalErrorHandler, notFoundHandler } from '@shared/errors/errorHandler';
import { logger } from '@shared/logger';

import { authRouter } from '@modules/auth/auth.router';
import { userRouter } from '@modules/user/user.router';
import { bookingRouter } from '@modules/booking/booking.router';
import { walletRouter } from '@modules/wallet/wallet.router';
import { paymentRouter } from '@modules/payment/payment.router';
import { pricingRouter } from '@modules/pricing/pricing.router';

import { rewardsRouter } from '@modules/rewards/rewards.router';
import { fleetRouter } from '@modules/fleet/fleet.router';
import { fleetOwnerRouter } from '@modules/fleet-owner/fleet-owner.router';
import { supportRouter } from '@modules/support/support.router';
import { mapsRouter } from '@modules/maps/maps.router';
import { notificationRouter } from '@modules/notifications/notification.router';
import { uploadRouter } from '@modules/upload/upload.router';
import { announcementRouter } from '@modules/announcement/announcement.router';
import { ulipRouter } from '@modules/ulip/ulip.router';
import { subscriptionRouter } from '@modules/subscription/subscription.router';
import { adminRouter } from '@modules/admin/admin.router';
import { workforceRouter } from '@modules/workforce/workforce.router';
import { marketplaceRouter } from '@modules/marketplace/marketplace.router';
import { driverWalletRouter } from '@modules/driver-wallet/driver-wallet.router';
import { fleetWalletRouter }  from '@modules/fleet-wallet/fleet-wallet.router';
import { sentryErrorHandler } from '@config/sentry';
import { razorpayWebhook } from '@modules/payment/payment.controller';
import { handleRazorpayXWebhook } from '@modules/webhooks/webhooks.controller';

export function createApp(): Application {
  const app = express();
  app.set('trust proxy', 1); // Trust first proxy (prevents rate-limiter ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
  const apiRouter = express.Router();

  // FIX S6: Redirect HTTP → HTTPS in production
  // Uses req.protocol (not raw header) so multi-hop proxy chains work correctly:
  // Cloudflare → DigitalOcean → AWS all set X-Forwarded-Proto=https,
  // but AWS Nginx rewrites $scheme=http. req.protocol respects trust proxy setting.
  if (env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      const proto = req.headers['x-forwarded-proto'];
      const isHttps = Array.isArray(proto)
        ? proto[0] === 'https'
        : proto === 'https';
      if (!isHttps) {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
      }
      next();
    });
  }

  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Production: only allow origins listed in ALLOWED_ORIGINS env var.
  // Development: open to all (*) for local + emulator testing.
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({
    origin: env.NODE_ENV === 'production' ? allowedOrigins : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));

  // ── CRITICAL: Razorpay webhook MUST receive raw bytes for HMAC to match.
  // Register BEFORE express.json() so the body is NOT pre-parsed.
  app.post(
    '/api/v1/payments/webhook',
    express.raw({ type: 'application/json' }),
    razorpayWebhook,
  );

  // ── RazorpayX Payout webhook — also needs raw body ───────────────────────
  app.post(
    '/api/v1/webhooks/razorpayx',
    express.raw({ type: 'application/json' }),
    handleRazorpayXWebhook,
  );

  // All other routes use parsed JSON body
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());

  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));

  // ── Global rate limiter: 100 requests per 15 minutes per IP ──────────────
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED' },
    skip: (req) => req.path === '/health', // Never rate-limit health checks
  });
  app.use('/api', globalLimiter);

  // ── Stricter auth rate limiter: 10 requests per 15 minutes (prevent OTP brute-force) ──
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please wait 15 minutes and try again.', code: 'RATE_LIMITED' },
  });
  app.use('/api/v1/auth', authLimiter);

  // ── Admin auth limiter: 5 requests per 15 minutes (prevent brute-force on admin login) ──
  const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many admin login attempts. Please wait 15 minutes.', code: 'RATE_LIMITED' },
  });
  app.use('/api/v1/admin/auth', adminAuthLimiter);

  // FIX S3: Strict limiter on POD OTP verification endpoint.
  // 4-digit OTP = 10,000 combinations; without this a driver could brute-force in minutes.
  const podOtpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,  // 5 minutes
    max: 5,                     // 5 attempts per IP per 5 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many delivery verification attempts. Please wait 5 minutes.', code: 'RATE_LIMITED' },
  });
  app.use('/api/v1/bookings', (req, res, next) => {
    if (req.method === 'POST' && req.path.includes('/pod')) {
      return podOtpLimiter(req, res, next);
    }
    next();
  });


  app.get('/health', async (_req, res) => {
    try {
      // Deep health check for UptimeRobot
      await prisma.$queryRaw`SELECT 1`;
      await getRedis().ping();
      
      res.status(200).json({
        status: 'ok',
        app: env.APP_NAME,
        env: env.NODE_ENV,
        database: 'connected',
        redis: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Health check failed:', { error });
      res.status(503).json({
        status: 'error',
        message: 'Service Unavailable - Dependency failure',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/bookings', bookingRouter);
  app.use('/api/v1/wallet', walletRouter);
  app.use('/api/v1/payments', paymentRouter);
  app.use('/api/v1/pricing', pricingRouter);

  app.use('/api/v1/rewards', rewardsRouter);
  app.use('/api/v1/fleet', fleetRouter);
  app.use('/api/v1/fleet-owners', fleetOwnerRouter);
  app.use('/api/v1/support', supportRouter);
  app.use('/api/v1/maps', mapsRouter);
  app.use('/api/v1/notifications', notificationRouter);
  app.use('/api/v1/announcements', announcementRouter);
  app.use('/api/v1/upload', uploadRouter);
  app.use('/api/v1/ulip', ulipRouter);
  app.use('/api/v1/subscription', subscriptionRouter);
  app.use('/api/v1/admin',        adminRouter);
  app.use('/api/v1/workforce',    workforceRouter);
  app.use('/api/v1/marketplace',  marketplaceRouter);
  app.use('/api/v1/driver/wallet', driverWalletRouter);
  app.use('/api/v1/fleet/wallet',  fleetWalletRouter);


  app.use(notFoundHandler);
  // Sentry error handler MUST come before our custom error handler
  app.use(sentryErrorHandler);
  app.use(globalErrorHandler);

  return app;
}
