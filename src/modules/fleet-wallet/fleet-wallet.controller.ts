import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated } from '@shared/utils/response';
import * as FleetWalletService from './fleet-wallet.service';

async function getFleetOwnerFromUser(userId: string) {
  const { prisma } = await import('@shared/db/prisma');
  const fo = await prisma.fleetOwner.findUnique({ where: { userId } });
  if (!fo) {
    const { AppError } = await import('@shared/errors/AppError');
    throw new AppError('Fleet owner profile not found', 404, 'FLEET_OWNER_NOT_FOUND');
  }
  return fo;
}

// GET /fleet/wallet
export async function getWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const fo     = await getFleetOwnerFromUser(req.user!.id);
    const wallet = await FleetWalletService.getFleetWallet(fo.id);
    sendSuccess(res, wallet, 'Fleet wallet fetched');
  } catch (err) { next(err); }
}

// GET /fleet/wallet/transactions?page=1&limit=20
export async function getTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const fo    = await getFleetOwnerFromUser(req.user!.id);
    const page  = Number(req.query.page  ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const result = await FleetWalletService.getFleetTransactionHistory(fo.id, page, limit);
    sendSuccess(res, result, 'Transaction history fetched');
  } catch (err) { next(err); }
}

// POST /fleet/wallet/withdraw
export async function requestWithdrawal(req: Request, res: Response, next: NextFunction) {
  try {
    const fo     = await getFleetOwnerFromUser(req.user!.id);
    const amount = Number(req.body.amount);
    const result = await FleetWalletService.requestFleetWithdrawal(fo.id, amount);
    sendCreated(res, result, 'Withdrawal request created. Auto-payout in progress.');
  } catch (err) { next(err); }
}

// POST /fleet/wallet/transfer  — Body: { driverId, amount, note? }
export async function transferToDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const fo                         = await getFleetOwnerFromUser(req.user!.id);
    const { driverId, amount, note } = req.body;
    const result = await FleetWalletService.transferToDriver(
      fo.id,
      driverId as string,
      Number(amount),
      note as string | undefined
    );
    sendSuccess(res, result, `Transfer to driver successful`);
  } catch (err) { next(err); }
}

// POST /fleet/wallet/offline-salary  — Body: { driverId, amount, note? }
export async function recordOfflineSalary(req: Request, res: Response, next: NextFunction) {
  try {
    const fo                         = await getFleetOwnerFromUser(req.user!.id);
    const { driverId, amount, note } = req.body;
    const result = await FleetWalletService.recordOfflineDriverSalary(
      fo.id,
      driverId as string,
      Number(amount),
      note as string | undefined
    );
    sendCreated(res, result, 'Offline salary recorded successfully');
  } catch (err) { next(err); }
}
