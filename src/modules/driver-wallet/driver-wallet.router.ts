import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import * as DriverWalletController from './driver-wallet.controller';

export const driverWalletRouter = Router();

// All routes require authentication
driverWalletRouter.use(authenticate);

// ── Driver routes (DRIVER role only) ────────────────────────────────────────
driverWalletRouter.get('/',                        requireRole(UserRole.DRIVER), DriverWalletController.getWallet);
driverWalletRouter.get('/transactions',            requireRole(UserRole.DRIVER), DriverWalletController.getTransactions);
driverWalletRouter.post('/pay-commission',         requireRole(UserRole.DRIVER), DriverWalletController.createCommissionOrder);
driverWalletRouter.post('/pay-commission/verify',  requireRole(UserRole.DRIVER), DriverWalletController.verifyCommissionPayment);
driverWalletRouter.post('/withdraw',               requireRole(UserRole.DRIVER), DriverWalletController.requestWithdrawal);
