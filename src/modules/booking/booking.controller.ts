import { Request, Response, NextFunction } from 'express';
import * as BookingService from './booking.service';
import { sendSuccess, sendCreated } from '@shared/utils/response';

// ─── Customer ──────────────────────────────────────────────────────────────

export async function createBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.createBooking(req.user!.id, req.body);
        sendCreated(res, booking, 'Booking created');
    } catch (err) {
        next(err);
    }
}

export async function listBookings(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await BookingService.listBookings(req.user!.id, req.user!.role, req.query as any);
        sendSuccess(res, result.bookings, 'Bookings fetched', 200, result.meta);
    } catch (err) {
        next(err);
    }
}

export async function getBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.getBooking(
            req.params.id as string,
            req.user!.id,
            req.user!.role
        );
        sendSuccess(res, booking);
    } catch (err) {
        next(err);
    }
}

export async function confirmBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.confirmBooking(req.params.id as string, req.user!.id);
        sendSuccess(res, booking, 'Booking confirmed — finding a driver');
    } catch (err) {
        next(err);
    }
}

export async function cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.cancelBooking(
            req.params.id as string,
            req.user!.id,
            req.user!.role,
            req.body
        );
        sendSuccess(res, booking, 'Booking cancelled');
    } catch (err) {
        next(err);
    }
}

export async function rateBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await BookingService.rateBooking(
            req.params.id as string,
            req.user!.id,
            req.body
        );
        sendSuccess(res, result, 'Rating submitted — thank you');
    } catch (err) {
        next(err);
    }
}

// ─── Driver ────────────────────────────────────────────────────────────────

export async function getDriverActiveBooking(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const booking = await BookingService.getDriverActiveBooking(req.user!.id);
        sendSuccess(res, booking);
    } catch (err) {
        next(err);
    }
}

export async function markDriverArriving(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const booking = await BookingService.markDriverArriving(req.params.id as string, req.user!.id);
        sendSuccess(res, booking, 'Status updated: arriving at pickup');
    } catch (err) {
        next(err);
    }
}

export async function markPickedUp(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.markPickedUp(req.params.id as string, req.user!.id);
        sendSuccess(res, booking, 'Status updated: goods picked up');
    } catch (err) {
        next(err);
    }
}

export async function requestPodOtp(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const result = await BookingService.requestPodOtp(
            req.params.id as string,
            req.params.stopId as string,
            req.user!.id
        );
        sendSuccess(res, result, 'POD OTP sent to customer');
    } catch (err) {
        next(err);
    }
}

export async function verifyPod(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { otp, photoUrl } = req.body;
        const booking = await BookingService.verifyPodAndDeliverStop(
            req.params.id as string,
            req.params.stopId as string,
            req.user!.id,
            otp,
            photoUrl
        );
        sendSuccess(res, booking, 'Stop delivered and verified');
    } catch (err) {
        next(err);
    }
}

export async function completeBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.completeBooking(req.params.id as string, req.user!.id);
        sendSuccess(res, booking, 'Booking completed');
    } catch (err) {
        next(err);
    }
}

// ─── Enterprise Live Bidding ────────────────────────────────────────────────

export async function createBid(req: Request, res: Response, next: NextFunction) {
    try {
        const bid = await BookingService.createBid(req.params.id as string, req.user!.id, req.body);
        sendSuccess(res, bid, 'Bid placed successfully', 201);
    } catch (err) {
        next(err);
    }
}

export async function getBids(req: Request, res: Response, next: NextFunction) {
    try {
        const bids = await BookingService.getBids(req.params.id as string, req.user!.id, req.user!.role);
        sendSuccess(res, bids, 'Bids fetched');
    } catch (err) {
        next(err);
    }
}

export async function acceptBid(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await BookingService.acceptBid(req.params.id as string, req.user!.id, req.body.bidId);
        sendSuccess(res, result, 'Bid accepted and driver assigned');
    } catch (err) {
        next(err);
    }
}
// --- Invoice ---
export async function getInvoice(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.getBooking(req.params['id'] as string, req.user!.id, req.user!.role);
        if (!booking.totalFare) {
            res.status(422).json({ success: false, message: 'Invoice not ready — fare not yet calculated', code: 'INVOICE_NOT_READY' });
            return;
        }

        // Fare components (stored on booking from server-side calculation)
        const baseFare      = booking.baseFare      ?? 0;
        const distanceFare  = booking.distanceFare  ?? 0;
        const timeFare      = (booking as any).timeFare      ?? 0;
        const fuelSurcharge = (booking as any).fuelSurcharge ?? 0;
        const surgeMultiplier = booking.surgeMultiplier      ?? 1.0;
        const loadingCharge = booking.loadingCharge ?? 0;
        const insuranceCharge = (booking as any).insuranceAmount ?? 0;
        const waitingCharge = (booking as any).waitingCharge ?? 0;
        const tollCharge    = (booking as any).tollCharge    ?? 0;
        const coinsRedeemed = booking.coinsRedeemed ?? 0;
        const discountAmount = booking.discountAmount ?? 0;

        // GST breakdown
        const freightBase   = booking.totalFare - loadingCharge - insuranceCharge;
        const freightGst    = parseFloat((freightBase * 0.05).toFixed(2));
        const loadingGst    = parseFloat((loadingCharge * 0.18).toFixed(2));
        const insuranceGst  = parseFloat((insuranceCharge * 0.18).toFixed(2));
        const waitingGst    = 0; // Waiting charges are not subject to GST (compensation to driver)
        const totalGst      = parseFloat((freightGst + loadingGst + insuranceGst).toFixed(2));
        const grandTotal    = parseFloat((booking.totalFare + totalGst + waitingCharge + tollCharge).toFixed(2));

        const invoice = {
            invoiceNumber:   'INV-' + booking.bookingNumber,
            bookingNumber:   booking.bookingNumber,
            bookingId:       booking.id,
            date:            booking.actualDeliveryTime ?? (booking as any).updatedAt,
            status:          booking.status,
            paymentStatus:   booking.paymentStatus,
            paymentMethod:   booking.paymentMethod,
            gstin:           booking.gstin,
            gstBusinessName: booking.gstBusinessName,

            pickup: {
                address: booking.pickupAddress,
                lat:     booking.pickupLat,
                lng:     booking.pickupLng,
            },
            stops: booking.stops,
            vehicleType: booking.vehicleType,

            driver: booking.driver ? {
                name:    booking.driver.user.name,
                phone:   booking.driver.user.phone,
                rating:  booking.driver.rating,
                vehicle: booking.driver.vehicle,
            } : null,

            fareBreakdown: {
                baseFare,
                distanceFare,
                timeFare,
                fuelSurcharge,
                surgeMultiplier,
                loadingCharge,
                insuranceCharge,
                waitingCharge,
                tollCharge,
                coinsRedeemed,
                discountAmount,
                subtotal: booking.totalFare,
            },

            gstBreakdown: {
                freightGst,
                loadingGst,
                insuranceGst,
                totalGst,
                note: 'Freight: 5% GST (HSN 9965) | Loading: 18% (HSN 8428) | Insurance: 18% (HSN 9971)',
            },

            grandTotal,

            timings: {
                createdAt:          booking.createdAt,
                actualPickupTime:   booking.actualPickupTime,
                actualDeliveryTime: booking.actualDeliveryTime,
            },
        };

        sendSuccess(res, invoice, 'Invoice fetched');
    } catch (err) { next(err); }
}

// ─── Driver Accept / Decline ────────────────────────────────────────────────

export async function driverAcceptBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.driverAcceptBooking(req.params.id as string, req.user!.id);
        sendSuccess(res, booking, 'Booking accepted — on your way!');
    } catch (err) { next(err); }
}

export async function driverDeclineBooking(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await BookingService.driverDeclineBooking(req.params.id as string, req.user!.id);
        sendSuccess(res, result, 'Booking declined');
    } catch (err) { next(err); }
}

export async function verifyPickupOtp(req: Request, res: Response, next: NextFunction) {
    try {
        const booking = await BookingService.verifyPickupOtp(
            req.params.id as string,
            req.user!.id,
            req.body.otp as string
        );
        sendSuccess(res, booking, 'Pickup OTP verified — trip started!');
    } catch (err) { next(err); }
}

