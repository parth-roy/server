/**
 * sentry.ts — Sentry crash monitoring for the backend.
 *
 * Must be imported BEFORE any other module at the top of server.ts.
 * If SENTRY_DSN is not set in .env, Sentry is disabled (no-op).
 *
 * Setup:
 *   1. Create a project at https://sentry.io
 *   2. Add SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz to your .env
 *   3. Errors are automatically captured and sent to Sentry.
 */
import * as Sentry from '@sentry/node';
import { env } from './env';
import type { ErrorRequestHandler } from 'express';

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    // DSN not configured — Sentry disabled. This is fine for development.
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // 100% trace sampling in dev, 10% in production to manage quota
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Release tagging — useful for linking errors to deploys
    // release: process.env.npm_package_version,
    integrations: [
      // Automatic HTTP breadcrumbs + performance tracing
      Sentry.httpIntegration(),
      // Capture unhandled promise rejections
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
  });
}

/**
 * Sentry error handler Express middleware.
 * Must be registered AFTER all routes, BEFORE your own error handler.
 * Captures all express errors and sends them to Sentry.
 */
export const sentryErrorHandler: ErrorRequestHandler = Sentry.expressErrorHandler() as unknown as ErrorRequestHandler;

/**
 * Manually capture an exception (use in catch blocks).
 */
export const captureException = Sentry.captureException;
