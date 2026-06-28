import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import * as PaymentController from './payment.controller';

export const paymentRouter = Router();

// Webhook must be public and use express.json or raw body for signature verification
// Typically handled in main app.ts, but assuming express.json is applied globally
paymentRouter.post('/webhook', PaymentController.razorpayWebhook);

paymentRouter.use(authenticate);

paymentRouter.post('/create-order', PaymentController.createOrder);
paymentRouter.post('/verify', PaymentController.verifyPayment);
paymentRouter.post('/mock-success', PaymentController.mockPaymentSuccess);