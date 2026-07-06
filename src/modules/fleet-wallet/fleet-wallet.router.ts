import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import * as FleetWalletController from './fleet-wallet.controller';

export const fleetWalletRouter = Router();

// All routes require authentication as FLEET_OWNER
fleetWalletRouter.use(authenticate);
fleetWalletRouter.use(requireRole(UserRole.FLEET_OWNER));

fleetWalletRouter.get('/',                 FleetWalletController.getWallet);
fleetWalletRouter.get('/transactions',     FleetWalletController.getTransactions);
fleetWalletRouter.post('/withdraw',        FleetWalletController.requestWithdrawal);
fleetWalletRouter.post('/transfer',        FleetWalletController.transferToDriver);
fleetWalletRouter.post('/offline-salary',  FleetWalletController.recordOfflineSalary);
