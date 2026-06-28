import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as WalletController from './wallet.controller';
import { addMoneySchema } from './wallet.schema';

export const walletRouter = Router();

walletRouter.use(authenticate);

// Balance & history
walletRouter.get('/', WalletController.getWallet);
walletRouter.get('/transactions', WalletController.getTransactions);

// Direct credit (legacy / admin use)
walletRouter.post('/add', validate(addMoneySchema), WalletController.addMoney);

// Wallet payment for booking
walletRouter.post('/pay', WalletController.payForBooking);

// Razorpay-powered wallet top-up
walletRouter.post('/topup/create-order', WalletController.createTopUpOrder);
walletRouter.post('/topup/verify', WalletController.verifyTopUp);
