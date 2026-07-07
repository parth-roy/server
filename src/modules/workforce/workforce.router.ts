import { Router } from 'express';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import { UserRole } from '@prisma/client';
import * as ctrl from './workforce.controller';
import {
  SendOtpSchema,
  VerifyOtpSchema,
  UpdateStatusSchema,
  UpdateLocationSchema,
  UpdatePreferencesSchema,
  UploadDocumentsSchema,
  AvailableJobsQuerySchema,
  DeclineJobSchema,
  CompleteJobSchema,
  JobRadarQuerySchema,
  WithdrawSchema,
  HistoryQuerySchema,
  EarningsChartQuerySchema,
  SosSchema,
} from './workforce.schema';

export const workforceRouter = Router();

// ─────────────────────────────────────────────
// AUTH — Public (no JWT needed)
// ─────────────────────────────────────────────
workforceRouter.post('/auth/send-otp',   validate(SendOtpSchema),   ctrl.sendOtp);
workforceRouter.post('/auth/verify-otp', validate(VerifyOtpSchema), ctrl.verifyOtp);

// ─────────────────────────────────────────────
// All routes below require WORKER role JWT
// ─────────────────────────────────────────────
workforceRouter.use(authenticate);
workforceRouter.use(requireRole(UserRole.WORKER));

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
workforceRouter.get('/dashboard/stats', ctrl.getDashboardStats);

// ─────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────
workforceRouter.get('/jobs/active',       ctrl.getActiveJob);
workforceRouter.get('/jobs/available',    validate(AvailableJobsQuerySchema, 'query'),  ctrl.getAvailableJobs);
workforceRouter.get('/jobs/nearby-pins',  validate(JobRadarQuerySchema, 'query'),       ctrl.getNearbyPins);
workforceRouter.get('/jobs/history',      validate(HistoryQuerySchema, 'query'),        ctrl.getJobHistory);

workforceRouter.post('/jobs/:id/accept',       ctrl.acceptJob);
workforceRouter.post('/jobs/:id/decline',      validate(DeclineJobSchema), ctrl.declineJob);
workforceRouter.post('/jobs/:id/arrive',       ctrl.markArrived);
workforceRouter.post('/jobs/:id/start',        ctrl.startJob);
workforceRouter.post('/jobs/:id/request-otp', ctrl.requestCompletionOtp);
workforceRouter.post('/jobs/:id/complete',     validate(CompleteJobSchema), ctrl.completeJob);

// ─────────────────────────────────────────────
// WALLET & EARNINGS
// ─────────────────────────────────────────────
workforceRouter.get('/wallet/balance',          ctrl.getWalletBalance);
workforceRouter.get('/wallet/transactions',     ctrl.getWalletTransactions);
workforceRouter.get('/wallet/earnings-chart',   validate(EarningsChartQuerySchema, 'query'), ctrl.getEarningsChart);
workforceRouter.post('/wallet/withdraw',        validate(WithdrawSchema), ctrl.withdrawWallet);

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────
workforceRouter.get('/profile/me',                                                        ctrl.getMe);
workforceRouter.patch('/profile/status',      validate(UpdateStatusSchema),               ctrl.updateStatus);
workforceRouter.patch('/profile/location',    validate(UpdateLocationSchema),             ctrl.updateLocation);
workforceRouter.put('/profile/preferences',   validate(UpdatePreferencesSchema),          ctrl.updatePreferences);
workforceRouter.post('/profile/documents',    validate(UploadDocumentsSchema),            ctrl.uploadDocuments);

// ─────────────────────────────────────────────
// PERFORMANCE
// ─────────────────────────────────────────────
workforceRouter.get('/performance/metrics', ctrl.getPerformanceMetrics);

// ─────────────────────────────────────────────
// SAFETY
// ─────────────────────────────────────────────
workforceRouter.get('/safety/alerts',  ctrl.getSafetyAlerts);
workforceRouter.post('/safety/sos',    validate(SosSchema), ctrl.triggerSos);

// ─────────────────────────────────────────────
// BADGES
// ─────────────────────────────────────────────
workforceRouter.get('/badges', ctrl.getBadges);

// ─────────────────────────────────────────────
// TRAINING
// ─────────────────────────────────────────────
workforceRouter.get('/training/courses', ctrl.getTrainingCourses);

// ─────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────
workforceRouter.get('/announcements', ctrl.getAnnouncements);
