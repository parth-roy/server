import { Request, Response, NextFunction } from 'express';
import * as WalletService from './wallet.service';
import { sendSuccess } from '@shared/utils/response';
import { AppError } from '@shared/errors/AppError';

// ─────────────────────────────────────────────
// GET WALLET
// ─────────────────────────────────────────────

export async function getWallet(req: Request, res: Response, next: NextFunction) {
    try {
        const wallet = await WalletService.getWallet(req.user!.id);
        sendSuccess(res, wallet);
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// GET TRANSACTION HISTORY (paginated)
// ─────────────────────────────────────────────

export async function getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

        const result = await WalletService.getTransactionHistory(req.user!.id, page, limit);
        sendSuccess(res, result.transactions, 'Transactions fetched', 200, result.meta);
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// ADD MONEY (legacy/admin — direct credit)
// ─────────────────────────────────────────────

export async function addMoney(req: Request, res: Response, next: NextFunction) {
    try {
        const { amount, referenceId } = req.body;
        const result = await WalletService.addMoney(req.user!.id, amount, referenceId);
        sendSuccess(res, result, 'Money added to wallet successfully');
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// PAY FOR BOOKING VIA WALLET
// ─────────────────────────────────────────────

export async function payForBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const { bookingId } = req.body;

        if (!bookingId || typeof bookingId !== 'string') {
            throw AppError.badRequest('bookingId is required');
        }

        const booking = await WalletService.payForBooking(req.user!.id, bookingId);
        sendSuccess(res, booking, 'Booking paid via wallet successfully');
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// TOP-UP: CREATE RAZORPAY ORDER
// ─────────────────────────────────────────────

export async function createTopUpOrder(req: Request, res: Response, next: NextFunction) {
    try {
        const { amount } = req.body;

        if (!amount || typeof amount !== 'number' || amount <= 0) {
            throw AppError.badRequest('amount must be a positive number (in rupees)');
        }

        const order = await WalletService.createTopUpOrder(req.user!.id, amount);
        sendSuccess(res, order, 'Top-up order created');
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// TOP-UP: VERIFY RAZORPAY PAYMENT & CREDIT
// ─────────────────────────────────────────────

export async function verifyTopUp(req: Request, res: Response, next: NextFunction) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            throw AppError.badRequest('razorpay_order_id, razorpay_payment_id, and razorpay_signature are required');
        }

        const result = await WalletService.verifyTopUp(
            req.user!.id,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        );

        sendSuccess(res, result, result.message || 'Wallet topped up successfully');
    } catch (err) {
        next(err);
    }
}
