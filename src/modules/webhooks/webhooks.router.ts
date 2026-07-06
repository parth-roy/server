import { Router } from 'express';
import express from 'express';
import { handleRazorpayWebhook, handleRazorpayXWebhook } from './webhooks.controller';

export const webhooksRouter = Router();

// CRITICAL: These routes use express.raw() to access the raw body for HMAC verification.
// They must be registered BEFORE any express.json() middleware in app.ts.
webhooksRouter.post(
  '/razorpay',
  express.raw({ type: 'application/json' }),
  handleRazorpayWebhook
);

webhooksRouter.post(
  '/razorpayx',
  express.raw({ type: 'application/json' }),
  handleRazorpayXWebhook
);
