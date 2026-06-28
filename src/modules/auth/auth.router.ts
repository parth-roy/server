import { Router } from 'express';
import { validate } from '@shared/middleware/validate';
import { authenticate } from '@shared/middleware/auth.middleware';
import * as AuthController from './auth.controller';
import {
  sendOtpSchema,
  verifyOtpSchema,
  refreshSchema,
  logoutSchema,
} from './auth.schema';

export const authRouter = Router();

// GET /api/v1/auth/me
authRouter.get(
  '/me',
  authenticate,
  AuthController.getMe
);

// POST /api/v1/auth/send-otp
authRouter.post(
  '/send-otp',
  validate(sendOtpSchema),
  AuthController.sendOtp
);

// POST /api/v1/auth/verify-otp
authRouter.post(
  '/verify-otp',
  validate(verifyOtpSchema),
  AuthController.verifyOtp
);

// POST /api/v1/auth/refresh
authRouter.post(
  '/refresh',
  validate(refreshSchema),
  AuthController.refreshTokens
);

// POST /api/v1/auth/logout
authRouter.post(
  '/logout',
  validate(logoutSchema),
  AuthController.logout
);