import { Request, Response, NextFunction } from 'express';
import * as RewardsService from './rewards.service';
import { sendSuccess } from '@shared/utils/response';
import { AppError } from '@shared/errors/AppError';

export async function getCoinBalance(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await RewardsService.getCoinBalance(req.user!.id);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}

export async function getCoinHistory(req: Request, res: Response, next: NextFunction) {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

        const result = await RewardsService.getCoinHistory(req.user!.id, page, limit);
        sendSuccess(res, result.transactions, 'Coin history fetched', 200, result.meta);
    } catch (err) {
        next(err);
    }
}

export async function redeemCoins(req: Request, res: Response, next: NextFunction) {
    try {
        const { coins } = req.body;

        if (!coins || typeof coins !== 'number') {
            throw AppError.badRequest('coins must be a positive number');
        }

        const result = await RewardsService.redeemCoins(req.user!.id, coins);
        sendSuccess(res, result, `${result.coinsRedeemed} coins redeemed for ₹${result.rupeesCredited.toFixed(2)}`);
    } catch (err) {
        next(err);
    }
}
