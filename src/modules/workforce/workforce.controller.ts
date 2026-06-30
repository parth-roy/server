import { Request, Response, NextFunction } from 'express';
import * as service from './workforce.service';
import { sendSuccess } from '@shared/utils/response';

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

export async function sendOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.sendOtp(req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.verifyOtp(req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getDashboardStats(req.user!.id);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────

export async function getAvailableJobs(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getAvailableJobs(req.user!.id, req.query as any);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getActiveJob(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getActiveJob(req.user!.id);
    sendSuccess(res, result ?? null);
  } catch (err) { next(err); }
}

export async function getNearbyPins(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getNearbyPins(req.user!.id, req.query as any);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function acceptJob(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.acceptJob(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function declineJob(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.declineJob(req.user!.id, String(req.params.id), req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function markArrived(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.markArrived(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function startJob(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.startJob(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function requestCompletionOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.requestCompletionOtp(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function completeJob(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.completeJob(req.user!.id, String(req.params.id), req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────

export async function getWalletBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getWalletBalance(req.user!.id);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getWalletTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(String(req.query.page ?? '1'));
    const limit = parseInt(String(req.query.limit ?? '20'));
    const result = await service.getWalletTransactions(req.user!.id, page, limit);
    sendSuccess(res, result.transactions, 'Success', 200, result.meta);
  } catch (err) { next(err); }
}

export async function withdrawWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.withdrawWallet(req.user!.id, req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getMe(req.user!.id);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.updateStatus(req.user!.id, req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    await service.updateLocation(req.user!.id, req.body);
    sendSuccess(res, { updated: true });
  } catch (err) { next(err); }
}

export async function updatePreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.updatePreferences(req.user!.id, req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function uploadDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.uploadDocuments(req.user!.id, req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────

export async function getJobHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getJobHistory(req.user!.id, req.query as any);
    sendSuccess(res, result.assignments, 'Success', 200, result.meta);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// EARNINGS CHART
// ─────────────────────────────────────────────

export async function getEarningsChart(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getEarningsChart(req.user!.id, req.query as any);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// PERFORMANCE
// ─────────────────────────────────────────────

export async function getPerformanceMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getPerformanceMetrics(req.user!.id);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// SAFETY
// ─────────────────────────────────────────────

export async function triggerSos(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.triggerSos(req.user!.id, req.body);
    sendSuccess(res, result, 'SOS alert triggered. Help is on the way.', 201);
  } catch (err) { next(err); }
}

export async function getSafetyAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getSafetyAlerts();
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// BADGES
// ─────────────────────────────────────────────

export async function getBadges(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getBadges(req.user!.id);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────
// TRAINING
// ─────────────────────────────────────────────

export async function getTrainingCourses(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getTrainingCourses();
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

