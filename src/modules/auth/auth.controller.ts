import { Request, Response, NextFunction } from 'express';
import * as AuthService from './auth.service';
import { sendSuccess } from '@shared/utils/response';

export async function sendOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await AuthService.sendOtp(req.body);
    sendSuccess(res, result, 'OTP sent');
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await AuthService.verifyOtp(req.body);
    sendSuccess(res, result, 'Authenticated successfully');
  } catch (err) {
    next(err);
  }
}

export async function refreshTokens(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await AuthService.refreshTokens(req.body);
    sendSuccess(res, result, 'Tokens refreshed');
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await AuthService.logout(req.body.refreshToken);
    sendSuccess(res, result, 'Logged out');
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    // req.user is set by the auth middleware
    const result = await AuthService.getMe(req.user!.id);
    sendSuccess(res, result, 'User fetched successfully');
  } catch (err) {
    next(err);
  }
}