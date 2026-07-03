import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as BookingController from './booking.controller';
import {
  createBookingSchema,
  cancelBookingSchema,
  rateBookingSchema,
  listBookingsQuerySchema,
  createBidSchema,
  acceptBidSchema,
} from './booking.schema';

export const bookingRouter = Router();

// All booking routes require a valid JWT
bookingRouter.use(authenticate);

// ─── Driver: active booking ─────────────────────────────────────────────────
// MUST come before /:id — otherwise Express matches 'driver' as an id param
bookingRouter.get(
  '/driver/active',
  requireRole(UserRole.DRIVER),
  BookingController.getDriverActiveBooking
);

// ─── Customer: create & list ────────────────────────────────────────────────
bookingRouter.post(
  '/',
  requireRole(UserRole.CUSTOMER),
  validate(createBookingSchema),
  BookingController.createBooking
);

bookingRouter.get(
  '/',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER),
  validate(listBookingsQuerySchema, 'query'),
  BookingController.listBookings
);

// ─── Shared: get single booking ─────────────────────────────────────────────
bookingRouter.get('/:id', BookingController.getBooking);

// ─── Customer: state transitions ────────────────────────────────────────────
bookingRouter.patch(
  '/:id/confirm',
  requireRole(UserRole.CUSTOMER),
  BookingController.confirmBooking
);

bookingRouter.patch(
  '/:id/cancel',
  validate(cancelBookingSchema),
  BookingController.cancelBooking
);

bookingRouter.post(
  '/:id/rate',
  requireRole(UserRole.CUSTOMER),
  validate(rateBookingSchema),
  BookingController.rateBooking
);

// ─── Driver: state transitions ──────────────────────────────────────────────
bookingRouter.patch(
  '/:id/arrive',
  requireRole(UserRole.DRIVER),
  BookingController.markDriverArriving
);

bookingRouter.patch(
  '/:id/pickup',
  requireRole(UserRole.DRIVER),
  BookingController.markPickedUp
);

bookingRouter.post(
  '/:id/stops/:stopId/request-pod-otp',
  requireRole(UserRole.DRIVER),
  BookingController.requestPodOtp
);

bookingRouter.post(
  '/:id/stops/:stopId/pod',
  requireRole(UserRole.DRIVER),
  BookingController.verifyPod
);

bookingRouter.patch(
  '/:id/complete',
  requireRole(UserRole.DRIVER),
  BookingController.completeBooking
);

bookingRouter.patch(
  '/:id/accept',
  requireRole(UserRole.DRIVER),
  BookingController.driverAcceptBooking
);

bookingRouter.patch(
  '/:id/decline',
  requireRole(UserRole.DRIVER),
  BookingController.driverDeclineBooking
);

// ─── Driver: Pickup OTP verification ────────────────────────────────────────
// Driver enters OTP told by customer → booking transitions DRIVER_ARRIVING → PICKED_UP
bookingRouter.post(
  '/:id/verify-pickup-otp',
  requireRole(UserRole.DRIVER),
  BookingController.verifyPickupOtp
);

// ─── Enterprise Live Bidding ─────────────────────────────────────────────────
bookingRouter.post(
  '/:id/bids',
  requireRole(UserRole.DRIVER),
  validate(createBidSchema),
  BookingController.createBid
);

bookingRouter.get(
  '/:id/bids',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER),
  BookingController.getBids
);

bookingRouter.post(
  '/:id/bids/accept',
  requireRole(UserRole.CUSTOMER),
  validate(acceptBidSchema),
  BookingController.acceptBid
);
// --- Invoice ---
bookingRouter.get('/:id/invoice', requireRole(UserRole.CUSTOMER), BookingController.getInvoice);
