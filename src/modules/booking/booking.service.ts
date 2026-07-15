import { prisma } from '@shared/db/prisma';
import { generateScratchCard } from '@modules/rewards/rewards.service';
import { createNotification } from '@modules/notifications/inapp.notification.service';
import { NotificationType } from '@prisma/client';
import {
    BidAwardStatus,
    BidWindowStatus,
    BookingMode,
    BookingStatus,
    DriverStatus,
    MarketplaceBidStatus,
    PaymentMethod,
    Prisma,
    UserRole,
    WorkerJobStatus,
    WorkerStatus,
} from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { AppError } from '@shared/errors/AppError';
import { eventBus } from '@shared/eventbus';
import { logger } from '@shared/logger';
import { getRedis } from '@config/redis';
import { notificationService } from '@modules/notifications/notification.service';
import { pricingService } from '@modules/pricing/pricing.service';
import type { FareEstimateResponse } from '@modules/pricing/pricing.types';
import { handleDriverDecline } from '@modules/dispatch/dispatch.service';
import { checkServiceability } from '@modules/maps/serviceability.service';
import { settleTripEarnings } from '@modules/driver-wallet/driver-wallet.service';
import { refundToWallet } from '@modules/wallet/wallet.service';
import type {
    CreateBookingInput,
    CancelBookingInput,
    RateBookingInput,
    ListBookingsQuery,
} from './booking.schema';
import { env } from '@config/env';
import * as MarketplaceService from '@modules/marketplace/marketplace.service';
import { assertTransition } from './booking.transition';
export { assertTransition } from './booking.transition';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateBookingNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const random = randomInt(100000, 999999);
    return `BK${dateStr}${random}`;
}

// Reusable select shape â€” used for every response that returns a full booking
const bookingDetailSelect = {
    id: true,
    bookingNumber: true,
    customerId: true,
    driverId: true,
    status: true,
    bookingMode: true,
    bidWindowMinutes: true,
    marketplaceVersion: true,
    awardedFleetOwnerId: true,
    bidWindow: true,
    vehicleType: true,
    declineCount: true,
    hasLoadingService: true,
    goodsType: true,
    goodsDescription: true,
    goodsWeightKg: true,
    goodsQuantity: true,
    goodsLengthCm: true,
    goodsWidthCm: true,
    goodsHeightCm: true,
    declaredGoodsValue: true,
    handlingInstructions: true,
    containsRestrictedGoods: true,
    goodsImageUrls: true,
    laborRequired: true,
    laborersCount: true,
    laborType: true,
    laborCharge: true,
    pickupLat: true,
    pickupLng: true,
    pickupAddress: true,
    stops: {
        orderBy: { sequence: 'asc' as const },
    },
    receiverName: true,
    receiverPhone: true,
    gstin: true,
    gstBusinessName: true,
    estimatedDistance: true,
    estimatedDuration: true,
    arrivalTime: true,
    baseFare: true,
    distanceFare: true,
    timeFare: true,
    fuelSurcharge: true,
    loadingCharge: true,
    surgeMultiplier: true,
    coinsRedeemed: true,
    discountAmount: true,
    taxAmount: true,
    gstAmount: true,
    waitingCharge: true,
    tollCharge: true,
    totalFare: true,
    grandTotal: true,
    paymentStatus: true,
    paymentMethod: true,
    customerRating: true,
    driverRating: true,
    customerNote: true,
    cancellationReason: true,
    cancelledBy: true,
    cancellationTime: true,
    actualPickupTime: true,
    actualDeliveryTime: true,
    insuranceOpted: true,
    insuranceProvider: true,
    insuranceAmount: true,
    createdAt: true,
    updatedAt: true,
    driver: {
        select: {
            id: true,
            rating: true,
            user: {
                select: {
                    name: true,
                    phone: true,
                    profileImageUrl: true,
                },
            },
            vehicle: {
                select: {
                    type: true,
                    make: true,
                    model: true,
                    registrationNo: true,
                    color: true,
                },
            },
        },
    },
    customer: {
        select: {
            name: true,
            phone: true,
            profileImageUrl: true,
        },
    },
    pickupOtp: true,
} as const;

// Internal helper â€” verifies the calling driver owns the booking
async function getDriverBooking(bookingId: string, userId: string) {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw AppError.notFound('Driver profile not found');

    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, driverId: driver.id },
    });
    if (!booking) {
        throw AppError.notFound('Booking not found or not assigned to you');
    }

    return { booking, driver };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CUSTOMER â€” CREATE BOOKING
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function createBooking(customerId: string, data: CreateBookingInput) {
    const { stops, estimatedFare, estimatedDistanceKm, dropLat, dropLng, dropAddress, ...bookingData } = data as any;

    if (data.containsRestrictedGoods) {
        throw AppError.badRequest(
            'Restricted or hazardous goods cannot be booked through the standard flow. Contact support for compliance review.',
            'RESTRICTED_GOODS_NOT_SUPPORTED'
        );
    }

    // â”€â”€ SAME LOCATION CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (stops.length > 0) {
        const dLat = Math.abs(stops[0].latitude - data.pickupLat);
        const dLng = Math.abs(stops[0].longitude - data.pickupLng);
        if (dLat < 0.0005 && dLng < 0.0005) { // ~50m threshold
            throw AppError.badRequest(
                'Pickup and delivery location cannot be the same',
                'SAME_LOCATION'
            );
        }
    }

    // â”€â”€ SERVICE AREA CHECK (Mapbox reverse geocode â†’ country = India) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Primary: Mapbox reverse geocode. Fallback: bounding box (if Mapbox down).
    // Both pickup AND first stop must be in serviceable area.
    const [pickupServiceability, dropServiceability] = await Promise.all([
        checkServiceability(data.pickupLat, data.pickupLng),
        checkServiceability(stops[0].latitude, stops[0].longitude),
    ]);

    if (!pickupServiceability.allowed) {
        throw AppError.badRequest(
            pickupServiceability.reason ?? 'Pickup location is outside our service area',
            'OUT_OF_SERVICE_AREA'
        );
    }
    if (!dropServiceability.allowed) {
        throw AppError.badRequest(
            dropServiceability.reason ?? 'Delivery location is outside our service area',
            'OUT_OF_SERVICE_AREA'
        );
    }

    // â”€â”€ FIX HIGH-8: Driver availability check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const availableDriverCount = await prisma.driver.count({
        where: {
            status: 'AVAILABLE',
            isDocVerified: true,
            isActive: true,
            vehicle: { type: data.vehicleType as any, isActive: true },
        },
    });
    // TEMPORARY BYPASS FOR TESTING UI
    // if (availableDriverCount === 0) {
    //     throw AppError.badRequest(
    //         'No drivers available for this vehicle type right now. Please try again later.',
    //         'NO_DRIVERS_AVAILABLE'
    //     );
    // }

    // â”€â”€ FIX CRITICAL-1: Server-side fare recalculation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let serverFare: FareEstimateResponse;
    try {
        serverFare = await pricingService.estimateFare({
            pickupLat: data.pickupLat,
            pickupLng: data.pickupLng,
            dropLat: stops[0].latitude,
            dropLng: stops[0].longitude,
            vehicleType: data.vehicleType,
            hasLoadingService: data.laborRequired || data.hasLoadingService,
            helperCount: data.laborRequired ? data.laborersCount : undefined,
            insuranceOpted: data.insuranceOpted,
        });
    } catch (err) {
        logger.error('Server-side fare calculation failed:', err);
        throw AppError.internal('Unable to calculate fare. Please try again.');
    }

    // â”€â”€ Maximum distance validation removed for all-India service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    if (
        data.goodsWeightKg !== undefined &&
        Number(serverFare.vehicle.capacityKg) > 0 &&
        data.goodsWeightKg > Number(serverFare.vehicle.capacityKg)
    ) {
        throw AppError.badRequest(
            `Declared goods weight exceeds this vehicle's ${serverFare.vehicle.capacityKg} kg capacity.`,
            'VEHICLE_CAPACITY_EXCEEDED'
        );
    }

    // Validate client-supplied fare is within 10% of server-calculated fare
    if (estimatedFare !== undefined) {
        const deviation = Math.abs(estimatedFare - serverFare.totalFare) / serverFare.totalFare;
        if (deviation > 0.10) {
            throw AppError.badRequest(
                `Fare has changed. Server fare: â‚¹${serverFare.totalFare}. Please refresh and try again.`,
                'FARE_MISMATCH'
            );
        }
    }

    // â”€â”€ FIX MEDIUM-7: Booking number collision retry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let booking = null;
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            booking = await prisma.booking.create({
                data: {
                    ...bookingData,
                    hasLoadingService: data.laborRequired || data.hasLoadingService,
                    laborRequired: data.laborRequired,
                    laborersCount: data.laborRequired ? data.laborersCount : null,
                    laborType: data.laborRequired ? data.laborType : null,
                    laborCharge: data.laborRequired ? serverFare.fareBreakdown.loadingCharge : null,
                    customerId,
                    bookingNumber: generateBookingNumber(),
                    status: BookingStatus.DRAFT,
                    totalFare: serverFare.totalFare,
                    baseFare: serverFare.fareBreakdown.baseFare,
                    distanceFare: serverFare.fareBreakdown.distanceFare,
                    timeFare: serverFare.fareBreakdown?.timeFare ?? 0,
                    fuelSurcharge: serverFare.fareBreakdown?.fuelSurcharge ?? 0,
                    surgeMultiplier: serverFare.fareBreakdown?.surgeMultiplier ?? 1.0,
                    loadingCharge: serverFare.fareBreakdown.loadingCharge,
                    gstAmount: serverFare.gstBreakdown?.totalGst ?? 0,
                    taxAmount: serverFare.gstBreakdown?.totalGst ?? 0,
                    grandTotal: serverFare.grandTotal,
                    estimatedDistance: serverFare.estimatedDistanceKm,
                    estimatedDuration: serverFare.estimatedDurationMinutes,
                    stops: {
                        create: stops.map((stop: any, index: number) => ({
                            ...stop,
                            sequence: index + 1,
                        })),
                    },
                },
                select: bookingDetailSelect,
            });
            break;
        } catch (err: any) {
            lastError = err;
            if (err.code === 'P2002' && attempt < 3) {
                logger.warn(`Booking number collision on attempt ${attempt}, retrying...`);
                continue;
            }
            throw err;
        }
    }

    if (!booking) throw AppError.internal('Failed to generate unique booking number');

    if (serverFare.auditLogId) {
        try {
            await prisma.pricingAuditLog.update({
                where: { id: serverFare.auditLogId },
                data: { bookingId: booking.id }
            });
        } catch (e) {
            logger.error(`Failed to link PricingAuditLog to booking ${booking.id}: ${e}`);
        }
    }

    logger.info(`Booking created: ${booking.bookingNumber} by customer ${customerId} (fare: ₹${serverFare.totalFare})`);
    return booking;
}
// ——————————————————————————————————————————————
// CUSTOMER — LIST MY BOOKINGS
// ——————————————————————————————————————————————

export async function listBookings(userId: string, role: string, query: ListBookingsQuery) {
    const { page, limit, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {
        ...(status && {
            status: typeof status === 'string' && status.includes(',')
                ? { in: status.split(',') }
                : status
        }),
    };

    if (role === UserRole.CUSTOMER) {
        where.customerId = userId;
    } else if (role === UserRole.DRIVER) {
        const driver = await prisma.driver.findUnique({ where: { userId } });
        if (!driver) throw AppError.notFound('Driver profile not found');
        where.driverId = driver.id;
    }

    const [bookings, total] = await prisma.$transaction([
        prisma.booking.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: bookingDetailSelect,
        }),
        prisma.booking.count({ where }),
    ]);

    return {
        bookings,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET ONE BOOKING
// Customers see their own. Drivers see assigned ones. Admin sees all.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getBooking(bookingId: string, userId: string, role: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: bookingDetailSelect,
    });

    if (!booking) throw AppError.notFound('Booking not found');

    if (role === UserRole.CUSTOMER && booking.customerId !== userId) {
        throw AppError.forbidden('You do not have access to this booking');
    }

    if (role === UserRole.DRIVER) {
        const driver = await prisma.driver.findUnique({ where: { userId } });
        if (!driver) {
            throw AppError.forbidden('Driver profile not found');
        }
        const canReadInstantOpportunity =
            booking.bookingMode === BookingMode.INSTANT &&
            booking.status === BookingStatus.CONFIRMED &&
            booking.driverId === null;
        if (booking.driverId !== driver.id && !canReadInstantOpportunity) {
            throw AppError.forbidden('You do not have access to this booking');
        }
    } else if (role === UserRole.FLEET_OWNER) {
        const fleetOwner = await prisma.fleetOwner.findUnique({
            where: { userId },
            select: { id: true },
        });
        if (!fleetOwner) throw AppError.forbidden('Fleet owner profile not found');
        const canReadInstantOpportunity =
            booking.bookingMode === BookingMode.INSTANT &&
            booking.status === BookingStatus.CONFIRMED &&
            booking.driverId === null;
        if (booking.awardedFleetOwnerId !== fleetOwner.id && !canReadInstantOpportunity) {
            throw AppError.forbidden('You do not have access to this booking');
        }
    } else if (role !== UserRole.CUSTOMER && role !== UserRole.ADMIN) {
        throw AppError.forbidden('You do not have access to this booking');
    }

    return booking;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CUSTOMER â€” CONFIRM BOOKING (DRAFT â†’ CONFIRMED)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function confirmBooking(bookingId: string, customerId: string) {
    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, customerId },
    });

    if (!booking) throw AppError.notFound('Booking not found');
    assertTransition(booking.status, BookingStatus.CONFIRMED);

    const updated = await prisma.$transaction(async (tx) => {
        const confirmed = await tx.booking.update({
            where: { id: bookingId },
            data: { status: BookingStatus.CONFIRMED },
            select: bookingDetailSelect,
        });

        if (confirmed.bookingMode === 'PRIVATE_BID') {
            const closesAt = new Date(Date.now() + confirmed.bidWindowMinutes * 60_000);
            await tx.bidWindow.create({
                data: {
                    bookingId,
                    closesAt,
                    maxRevisionsPerBid: env.BID_MAX_REVISIONS,
                },
            });
            return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: bookingDetailSelect });
        }
        return confirmed;
    });

    // Phase 7 (Dispatch Engine) will listen for this event and assign a driver
    eventBus.emit('booking.confirmed', {
        bookingId: updated.id,
        customerId,
        vehicleType: updated.vehicleType,
    });

    logger.info(`Booking confirmed: ${updated.bookingNumber}`);
    return updated;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CANCEL BOOKING
// Both customers and drivers can cancel â€” with different state rules
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function cancelBooking(
    bookingId: string,
    userId: string,
    role: string,
    data: CancelBookingInput
) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw AppError.notFound('Booking not found');

    let actorDriverId: string | null = null;
    if (role === UserRole.CUSTOMER && booking.customerId !== userId) {
        throw AppError.forbidden('You do not have access to this booking');
    }
    if (role === UserRole.DRIVER) {
        const driver = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });
        if (!driver || booking.driverId !== driver.id) {
            throw AppError.forbidden('Only the assigned driver can cancel this booking');
        }
        actorDriverId = driver.id;
    } else if (role !== UserRole.CUSTOMER && role !== UserRole.ADMIN) {
        throw AppError.forbidden('You do not have access to cancel this booking');
    }

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.booking.findUnique({ where: { id: bookingId } });
        if (!current) throw AppError.notFound('Booking not found');
        if (role === UserRole.CUSTOMER && current.customerId !== userId) {
            throw AppError.forbidden('You do not have access to this booking');
        }
        if (role === UserRole.DRIVER && current.driverId !== actorDriverId) {
            throw AppError.forbidden('Only the assigned driver can cancel this booking');
        }
        assertTransition(current.status, BookingStatus.CANCELLED);

        if (current.bookingMode === BookingMode.PRIVATE_BID) {
            const unsettledAward = await tx.bidAward.findFirst({
                where: {
                    bookingId,
                    activeKey: bookingId,
                    status: {
                        in: [
                            BidAwardStatus.PAYMENT_PENDING,
                            BidAwardStatus.PAYMENT_RECONCILING,
                        ],
                    },
                },
                select: { id: true },
            });
            if (unsettledAward) {
                throw AppError.conflict(
                    'This selected bid is being paid or reconciled. Wait for settlement before cancelling.',
                    'BID_PAYMENT_IN_PROGRESS',
                );
            }
        }

        const cancelled = await tx.booking.updateMany({
            where: {
                id: bookingId,
                status: current.status,
                marketplaceVersion: current.marketplaceVersion,
            },
            data: {
                status: BookingStatus.CANCELLED,
                cancellationReason: data.reason,
                cancelledBy: userId,
                cancellationTime: new Date(),
                marketplaceVersion: { increment: 1 },
            },
        });
        if (cancelled.count !== 1) {
            throw AppError.conflict('Booking changed before cancellation', 'BOOKING_STATE_CONFLICT');
        }

        if (current.bookingMode === BookingMode.PRIVATE_BID) {
            await tx.bidWindow.updateMany({
                where: { bookingId, status: BidWindowStatus.OPEN },
                data: {
                    status: BidWindowStatus.WITHDRAWN,
                    closedAt: new Date(),
                    version: { increment: 1 },
                },
            });
            await tx.marketplaceBid.updateMany({
                where: { bookingId, status: MarketplaceBidStatus.OPEN },
                data: { status: MarketplaceBidStatus.EXPIRED, closedAt: new Date() },
            });
        }

        if (
            current.driverId &&
            (current.status === BookingStatus.DRIVER_ASSIGNED ||
                current.status === BookingStatus.DRIVER_ARRIVING)
        ) {
            await tx.driver.updateMany({
                where: { id: current.driverId, status: DriverStatus.ON_TRIP },
                data: { status: DriverStatus.AVAILABLE },
            });
        }

        const activeWorkerAssignments = await tx.jobAssignment.findMany({
            where: {
                bookingId,
                status: {
                    in: [
                        WorkerJobStatus.ACCEPTED,
                        WorkerJobStatus.ARRIVED,
                        WorkerJobStatus.IN_PROGRESS,
                    ],
                },
            },
            select: { workerId: true },
        });
        if (activeWorkerAssignments.length > 0) {
            await tx.jobAssignment.updateMany({
                where: {
                    bookingId,
                    status: {
                        in: [
                            WorkerJobStatus.ACCEPTED,
                            WorkerJobStatus.ARRIVED,
                            WorkerJobStatus.IN_PROGRESS,
                        ],
                    },
                },
                data: { status: WorkerJobStatus.CANCELLED },
            });
            await tx.worker.updateMany({
                where: {
                    id: { in: activeWorkerAssignments.map((assignment) => assignment.workerId) },
                    status: WorkerStatus.ON_JOB,
                },
                data: { status: WorkerStatus.AVAILABLE },
            });
        }

        return tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            select: bookingDetailSelect,
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Phase 11 (Notifications) will listen to alert the other party
    eventBus.emit('booking.cancelled', {
        bookingId: updated.id,
        customerId: updated.customerId,
        reason: data.reason,
    });

    if (updated.bookingMode === BookingMode.PRIVATE_BID) {
        MarketplaceService.notifyMarketplaceBookingCancelled(updated.id).catch((err) => {
            logger.error(`[Marketplace] Cancellation notification failed for ${updated.id}:`, err);
        });
    }

    // â”€â”€ AUTO REFUND: if customer paid via wallet, refund instantly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Uses fire-and-forget to not block the cancellation response.
    const fullBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { paymentStatus: true, paymentMethod: true, grandTotal: true, totalFare: true, customerId: true },
    });
    if (
        fullBooking?.paymentStatus === 'PAID' &&
        fullBooking?.paymentMethod === PaymentMethod.WALLET
    ) {
        const refundAmount = fullBooking.grandTotal ?? fullBooking.totalFare ?? 0;
        if (refundAmount > 0) {
            refundToWallet(fullBooking.customerId, bookingId, refundAmount).catch((err) => {
                logger.error(`[Refund] Wallet refund failed for booking ${bookingId}:`, err);
            });
        }
    }

    logger.info(`Booking cancelled: ${updated.bookingNumber} by ${userId}`);
    return updated;
}

export async function cancelBookingBySystem(bookingId: string, reason: string, cancelledBy: string = 'SYSTEM') {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
    if (!booking) return;
    return cancelBooking(bookingId, cancelledBy, UserRole.ADMIN, { reason });
}

// ─────────────────────────────────────────────────────────────────
// CUSTOMER — RATE BOOKING
// Only allowed after COMPLETED status
// ─────────────────────────────────────────────────────────────────

export async function rateBooking(
    bookingId: string,
    customerId: string,
    data: RateBookingInput
) {
    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, customerId },
    });

    if (!booking) throw AppError.notFound('Booking not found');

    if (booking.status !== BookingStatus.COMPLETED) {
        throw AppError.badRequest(
            'You can only rate a completed booking',
            'BOOKING_NOT_COMPLETED'
        );
    }

    if (booking.customerRating !== null) {
        throw AppError.conflict('You have already rated this booking', 'ALREADY_RATED');
    }

    return prisma.booking.update({
        where: { id: bookingId },
        data: {
            customerRating: data.driverRating,
            customerNote: data.customerNote,
        },
        select: {
            id: true,
            bookingNumber: true,
            customerRating: true,
            customerNote: true,
        },
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” GET ACTIVE BOOKING
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getDriverActiveBooking(userId: string) {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw AppError.notFound('Driver profile not found');

    const activeStatuses: BookingStatus[] = [
        BookingStatus.DRIVER_ASSIGNED,
        BookingStatus.DRIVER_ARRIVING,
        BookingStatus.PICKED_UP,
        BookingStatus.IN_TRANSIT,
    ];

    const booking = await prisma.booking.findFirst({
        where: {
            driverId: driver.id,
            status: { in: activeStatuses },
        },
        select: bookingDetailSelect,
    });

    return booking ?? null;
}

// ─────────────────────────────────────────────
// DRIVER — MARK ARRIVING (DRIVER_ASSIGNED → DRIVER_ARRIVING)
// ─────────────────────────────────────────────

export async function markDriverArriving(bookingId: string, userId: string) {
    const { booking } = await getDriverBooking(bookingId, userId);
    
    const updateData: any = {
        status: BookingStatus.DRIVER_ARRIVING,
        arrivalTime: new Date(),
    };
    
    // If OTP is missing (e.g. bypassed /accept via bidding), generate it now
    if (!(booking as any).pickupOtp) {
        updateData.pickupOtp = String(randomInt(1000, 9999));
    }

    if (booking.status !== BookingStatus.DRIVER_ARRIVING) {
        assertTransition(booking.status, BookingStatus.DRIVER_ARRIVING);
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: updateData,
        select: bookingDetailSelect,
    });

    // Notify customer — driver is arriving
    const customer = await prisma.user.findUnique({ where: { id: updated.customerId }, select: { fcmToken: true } });
    if (customer?.fcmToken) {
        await notificationService.sendToDevice(customer.fcmToken, {
            title: '🏃 Driver is Almost There!',
            body: `Your driver is ${Math.ceil(Math.random() * 5 + 2)} mins away. Keep your goods ready to load! 📦`,
            data: { type: 'DRIVER_ARRIVING', bookingId },
        });
    }
    
    const finalOtp = updateData.pickupOtp || (booking as any).pickupOtp;
    await createNotification(
        updated.customerId,
        'DRIVER_ARRIVING',
        `Your driver is on the way. Your pickup OTP is ${finalOtp}.`,
        NotificationType.BOOKING_STATUS,
        bookingId
    );
    const { emitToBookingRoom } = await import('@shared/socket/socket.instance');
    emitToBookingRoom(bookingId, 'booking_update', { type: 'DRIVER_ARRIVING', pickupOtp: finalOtp });

    return updated;
}

// ─────────────────────────────────────────────
// DRIVER — VERIFY PICKUP OTP (DRIVER_ARRIVING → PICKED_UP)
// ─────────────────────────────────────────────

export async function markPickedUp(bookingId: string, userId: string) {
    const { booking, driver } = await getDriverBooking(bookingId, userId);
    assertTransition(booking.status, BookingStatus.PICKED_UP);

    const pickedUpAt = new Date();
    const arrivalTime = booking.arrivalTime ?? pickedUpAt;
    
    // Calculate waiting charge (10 mins free)
    let waitingCharge = 0;
    const diffMins = Math.floor((pickedUpAt.getTime() - arrivalTime.getTime()) / 60000);
    if (diffMins > 10) {
        waitingCharge = (diffMins - 10) * 5; // e.g. 5 rupees per min
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.PICKED_UP,
            actualPickupTime: pickedUpAt,
            ...(waitingCharge > 0 && { waitingCharge }),
            pickupOtp: null, // Clear OTP after use for security
        },
        select: bookingDetailSelect,
    });

    eventBus.emit('booking.goods_loaded', { bookingId, customerId: updated.customerId });
    return updated;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” REQUEST POD OTP
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function requestPodOtp(
    bookingId: string,
    stopId: string,
    userId: string
) {
    const { booking } = await getDriverBooking(bookingId, userId);

    if (
        booking.status !== BookingStatus.PICKED_UP &&
        booking.status !== BookingStatus.IN_TRANSIT
    ) {
        throw AppError.badRequest(
            'Booking must be in PICKED_UP or IN_TRANSIT status to deliver a stop',
            'INVALID_BOOKING_STATUS'
        );
    }

    const stop = await prisma.bookingStop.findFirst({
        where: { id: stopId, bookingId },
    });
    if (!stop) throw AppError.notFound('Stop not found in this booking');
    if (stop.isCompleted) {
        throw AppError.conflict('This stop is already marked as delivered', 'STOP_ALREADY_DELIVERED');
    }

    // Generate 4 digit OTP
    const otp = randomInt(1000, 9999).toString();
    const redisClient = getRedis();
    await redisClient.setex(`POD_OTP:${bookingId}:${stopId}`, 900, otp); // 15 mins expiry

    // Send to customer
    const customer = await prisma.user.findUnique({ where: { id: booking.customerId } });
    if (customer?.fcmToken) {
        await notificationService.sendToDevice(customer.fcmToken, {
            title: 'Delivery Verification',
            body: `Your delivery OTP is ${otp}. Please share this with the driver.`,
        });
    }

    // Emit over socket so Customer App can show it in UI immediately
    const { emitToBookingRoom } = await import('@shared/socket/socket.instance');
    emitToBookingRoom(bookingId, 'delivery_otp_requested', {
        bookingId,
        stopId,
        otp
    });

    return { success: true, message: 'OTP sent to customer' };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” DELIVER A STOP WITH POD
// When all stops done â†’ booking moves to DELIVERED automatically
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function verifyPodAndDeliverStop(
    bookingId: string,
    stopId: string,
    userId: string,
    otp: string,
    photoUrl: string
) {
    const { booking } = await getDriverBooking(bookingId, userId);

    if (
        booking.status !== BookingStatus.PICKED_UP &&
        booking.status !== BookingStatus.IN_TRANSIT
    ) {
        throw AppError.badRequest(
            'Booking must be in PICKED_UP or IN_TRANSIT status to deliver a stop',
            'INVALID_BOOKING_STATUS'
        );
    }

    // Verify the stop belongs to this booking
    const stop = await prisma.bookingStop.findFirst({
        where: { id: stopId, bookingId },
    });
    if (!stop) throw AppError.notFound('Stop not found in this booking');
    if (stop.isCompleted) {
        throw AppError.conflict('This stop is already marked as delivered', 'STOP_ALREADY_DELIVERED');
    }

    // Verify OTP
    const redisClient = getRedis();
    const redisKey = `POD_OTP:${bookingId}:${stopId}`;
    const storedOtp = await redisClient.get(redisKey);

    if (!storedOtp || storedOtp !== otp) {
        throw AppError.badRequest('Invalid or expired OTP', 'INVALID_OTP');
    }

    // Mark this stop as completed with POD details
    await prisma.bookingStop.update({
        where: { id: stopId },
        data: { 
            isCompleted: true,
            podPhotoUrl: photoUrl,
            podVerifiedAt: new Date()
        },
    });

    // Cleanup Redis
    await redisClient.del(redisKey);

    // Check if any stops still remain
    const remainingCount = await prisma.bookingStop.count({
        where: { bookingId, isCompleted: false },
    });

    // Determine next status
    const newStatus =
        remainingCount === 0 ? BookingStatus.DELIVERED : BookingStatus.IN_TRANSIT;

    const updateData: { status: BookingStatus; actualDeliveryTime?: Date } = {
        status: newStatus,
    };
    if (newStatus === BookingStatus.DELIVERED) {
        updateData.actualDeliveryTime = new Date();
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: updateData,
        select: bookingDetailSelect,
    });

    if (newStatus === BookingStatus.DELIVERED) {
        eventBus.emit('booking.delivered', {
            bookingId: updated.id,
            customerId: updated.customerId,
            totalFare: updated.totalFare ?? 0,
        });
        logger.info(`Booking delivered: ${updated.bookingNumber}`);
    }

    return updated;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” COMPLETE BOOKING (DELIVERED â†’ COMPLETED)
// Called after payment is confirmed (Phase 9 will call this internally too)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function completeBooking(bookingId: string, userId: string) {
    const { booking, driver } = await getDriverBooking(bookingId, userId);
    assertTransition(booking.status, BookingStatus.COMPLETED);

    const updated = await prisma.$transaction(async (tx) => {
        const completed = await tx.booking.update({
            where: { id: bookingId },
            data: { status: BookingStatus.COMPLETED },
            select: bookingDetailSelect,
        });
        await tx.driver.updateMany({
            where: { id: driver.id, status: DriverStatus.ON_TRIP },
            data: { status: DriverStatus.AVAILABLE },
        });
        return completed;
    });

    logger.info(`Booking completed: ${updated.bookingNumber}`);

    // Generate a scratch card reward for the customer
    await generateScratchCard(updated.customerId, updated.id, updated.grandTotal ?? updated.totalFare ?? 0);

    // â”€â”€ PHASE 9: Commission Settlement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Settle earnings and commissions asynchronously after status update.
    // We use fire-and-forget here so that a settlement error never blocks the
    // driver from marking the trip complete. Any error is logged + monitored.
    const grandTotal = booking.grandTotal ?? booking.totalFare ?? 0;
    const paymentMethod = booking.paymentMethod ?? PaymentMethod.CASH;

    if (paymentMethod === PaymentMethod.CASH) {
        await prisma.booking.update({
            where: { id: bookingId },
            data: {
                paymentStatus: 'PAID',
                paymentRef: `CASH_COLLECTED_${Date.now()}`,
            },
        });
    }

    if (grandTotal > 0 && driver) {
        // Find if this is a fleet booking
        const fleetMembership = await prisma.fleetDriver.findFirst({
            where: { driverId: driver.id, isActive: true },
            select: { fleetOwnerId: true },
        });

        settleTripEarnings({
            bookingId,
            driverId:    driver.id,
            grossAmount: grandTotal,
            paymentMethod,
            fleetOwnerId: fleetMembership?.fleetOwnerId,
        }).catch((err) => {
            logger.error(`[Settlement] Failed for booking ${bookingId}:`, err);
            // TODO: Push to a dead-letter queue for manual reconciliation
        });
    } else {
        logger.warn(`[Settlement] Skipped for booking ${bookingId} â€” no fare amount or driver`);
    }

    return updated;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” ACCEPT BOOKING (confirms DRIVER_ASSIGNED state, starts trip)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function driverAcceptBooking(bookingId: string, userId: string) {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw AppError.notFound('Driver profile not found');

    const marketplaceReservation = await prisma.bidAward.findFirst({
        where: {
            activeKey: { not: null },
            status: {
                in: [
                    BidAwardStatus.PAYMENT_PENDING,
                    BidAwardStatus.PAYMENT_RECONCILING,
                    BidAwardStatus.CONFIRMED,
                ],
            },
            bid: { driverId: driver.id },
            booking: {
                status: {
                    in: [
                        BookingStatus.CONFIRMED,
                        BookingStatus.DRIVER_ASSIGNED,
                        BookingStatus.DRIVER_ARRIVING,
                        BookingStatus.PICKED_UP,
                        BookingStatus.IN_TRANSIT,
                    ],
                },
            },
        },
        select: { bookingId: true },
    });
    if (marketplaceReservation) {
        throw AppError.conflict(
            marketplaceReservation.bookingId === bookingId
                ? 'This marketplace load is already assigned. Open it and start the trip.'
                : 'You already have a selected marketplace load',
            'MARKETPLACE_LOAD_RESERVED',
        );
    }

    // Guard: reject if driver is already on another trip
    if (driver.status === 'ON_TRIP') {
        throw AppError.conflict(
            'You are already on an active trip. Complete or cancel it before accepting a new booking.',
            'DRIVER_ALREADY_ON_TRIP'
        );
    }

    // Generate 4-digit pickup OTP
    const pickupOtp = String(randomInt(1000, 9999));

    // Two valid accept scenarios handled atomically:
    //
    // Flow A â€” Direct dispatch: dispatch notified multiple drivers via FCM.
    //   Booking is CONFIRMED with driverId=null.
    //   First driver to accept claims it by setting driverId + transitioning to DRIVER_ARRIVING.
    //
    // Flow B â€” Fleet assignment: fleet owner pre-assigned this driver.
    //   Booking is DRIVER_ASSIGNED with driverId=this driver. Driver confirms.

    assertTransition(BookingStatus.CONFIRMED, BookingStatus.DRIVER_ARRIVING);
    let acceptResult = await prisma.booking.updateMany({
        where: {
            id: bookingId,
            bookingMode: BookingMode.INSTANT,
            driverId: null,
            status: BookingStatus.CONFIRMED,
        },
        data: { driverId: driver.id, status: BookingStatus.DRIVER_ARRIVING, pickupOtp },
    });

    if (acceptResult.count === 0) {
        // Try fleet assignment flow
        assertTransition(BookingStatus.DRIVER_ASSIGNED, BookingStatus.DRIVER_ARRIVING);
        acceptResult = await prisma.booking.updateMany({
            where: { id: bookingId, driverId: driver.id, status: BookingStatus.DRIVER_ASSIGNED },
            data: { status: BookingStatus.DRIVER_ARRIVING, pickupOtp },
        });
    }

    if (acceptResult.count === 0) {
        throw AppError.conflict(
            'Booking has already been claimed by another driver or is no longer available',
            'BOOKING_NOT_AVAILABLE'
        );
    }

    // Driver is now on trip
    await prisma.driver.update({
        where: { id: driver.id },
        data: { status: 'ON_TRIP' },
    });

    // Fetch booking to get customerId for notification
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });

    // Notify customer via push + in-app (include OTP in push so customer sees it on lock screen)
    if (booking?.customerId) {
        const customer = await prisma.user.findUnique({ where: { id: booking.customerId } });
        if (customer?.fcmToken) {
            await notificationService.sendToDevice(customer.fcmToken, {
                title: 'ðŸš› Your Driver is On The Way!',
                body: `Locked & loaded! Your driver accepted the booking. OTP: ${pickupOtp} â€” share when they arrive. ðŸ”‘`,
                data: { type: 'DRIVER_ARRIVING', bookingId, pickupOtp },
            });
        }
        await createNotification(
            booking.customerId,
            'ðŸš› Driver Accepted!',
            `Your driver is on the way. Your pickup OTP is ${pickupOtp}.`,
            NotificationType.BOOKING_STATUS,
            bookingId,
        );
    }

    logger.info(`Driver ${driver.id} accepted booking ${bookingId} â€” OTP: ${pickupOtp}`);
    return prisma.booking.findUnique({ where: { id: bookingId }, select: bookingDetailSelect });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” VERIFY PICKUP OTP (DRIVER_ARRIVING â†’ PICKED_UP)
// Driver enters the OTP shown to the customer. On success, trip starts.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function verifyPickupOtp(bookingId: string, userId: string, otp: string) {
    const { booking, driver } = await getDriverBooking(bookingId, userId);

    if (booking.status !== BookingStatus.DRIVER_ARRIVING) {
        throw AppError.badRequest(
            'Booking must be in DRIVER_ARRIVING status to verify pickup OTP',
            'INVALID_BOOKING_STATUS'
        );
    }

    const storedOtp = (booking as any).pickupOtp as string | null;
    if (!storedOtp) {
        throw AppError.internal('Pickup OTP not found for this booking');
    }
    if (storedOtp !== otp.trim()) {
        throw AppError.badRequest('Invalid OTP. Please ask the customer for the correct code.', 'INVALID_OTP');
    }

    const pickedUpAt = new Date();

    // Compute waiting charge if arrivalTime was recorded
    let waitingCharge = 0;
    if ((booking as any).arrivalTime) {
        try {
            const vehicle = await prisma.vehicleTypePricing.findUnique({
                where: { vehicleType: booking.vehicleType as any },
            });
            if (vehicle) {
                const { pricingService } = await import('@modules/pricing/pricing.service');
                const waitingResult = pricingService.calculateWaitingCharge(
                    (booking as any).arrivalTime,
                    pickedUpAt,
                    vehicle,
                );
                waitingCharge = waitingResult.waitingCharge;
            }
        } catch (err) {
            logger.error('[Booking] Failed to compute waiting charge on OTP verify:', err);
        }
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.PICKED_UP,
            actualPickupTime: pickedUpAt,
            pickupOtp: null, // Clear OTP after use for security
            ...(waitingCharge > 0 && { waitingCharge }),
        },
        select: bookingDetailSelect,
    });

    // Emit socket event so customer UI transitions immediately
    const { emitToBookingRoom } = await import('@shared/socket/socket.instance');
    try {
        emitToBookingRoom(bookingId, 'pickup_otp_verified', {
            bookingId,
            status: 'PICKED_UP',
        });
    } catch (_) { /* socket may not be available in test env */ }

    // Notify customer
    const customer = await prisma.user.findUnique({
        where: { id: booking.customerId },
        select: { fcmToken: true },
    });
    if (customer?.fcmToken) {
        await notificationService.sendToDevice(customer.fcmToken, {
            title: 'ðŸ“¦ Goods Loaded â€” Rolling!',
            body: 'Your goods are loaded and the truck is heading to the destination. Sit back! ðŸ›£ï¸�',
            data: { type: 'GOODS_LOADED', bookingId },
        });
    }
    await createNotification(
        booking.customerId,
        'ðŸ“¦ Goods Loaded â€” Rolling!',
        'Your goods are loaded. The driver is heading to the destination.',
        NotificationType.BOOKING_STATUS,
        bookingId,
    );

    logger.info(`Driver ${driver.id} verified pickup OTP for booking ${bookingId}`);
    return updated;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” SAVE LOCATION HISTORY (called from Socket.IO location event)
// Saves a GPS breadcrumb for admin/fleet panel tracking history.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function saveLocationHistory(params: {
    bookingId: string;
    driverId: string;
    lat: number;
    lng: number;
    speedKmh?: number;
    headingDeg?: number;
    accuracyM?: number;
    tripPhase?: string;
}) {
    try {
        await prisma.bookingLocationHistory.create({
            data: {
                bookingId: params.bookingId,
                driverId: params.driverId,
                latitude: params.lat,
                longitude: params.lng,
                speedKmh: params.speedKmh,
                headingDeg: params.headingDeg,
                accuracyM: params.accuracyM,
                tripPhase: params.tripPhase,
            },
        });
    } catch (err) {
        logger.error('[LocationHistory] Failed to save:', err);
        // Non-fatal â€” never block the GPS update
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER â€” DECLINE BOOKING (unassigns driver, reverts to CONFIRMED for re-dispatch)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function driverDeclineBooking(bookingId: string, userId: string) {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw AppError.notFound('Driver profile not found');

    const bookingMode = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { bookingMode: true },
    });
    if (bookingMode?.bookingMode === BookingMode.PRIVATE_BID) {
        throw AppError.conflict(
            'A secured marketplace award cannot be declined through broadcast dispatch',
            'MARKETPLACE_AWARD_CANCELLATION_REQUIRED',
        );
    }

    const booking = await prisma.booking.findFirst({
        where: { 
            id: bookingId,
            // A driver can decline if it's explicitly assigned to them OR if it's broadcasted (CONFIRMED & driverId null)
            OR: [
                { driverId: driver.id, status: BookingStatus.DRIVER_ASSIGNED },
                { driverId: null, status: BookingStatus.CONFIRMED }
            ]
        },
    });
    if (!booking) throw AppError.notFound('Booking not found or already accepted/declined');
    if (booking.status === BookingStatus.DRIVER_ASSIGNED) {
        assertTransition(booking.status, BookingStatus.CONFIRMED);
    }

    // Unassign driver, revert to CONFIRMED, increment declineCount
    await prisma.booking.update({
        where: { id: bookingId },
        data: {
            driverId: null,
            status: BookingStatus.CONFIRMED,
            declineCount: { increment: 1 },
        },
    });

    // Driver back to AVAILABLE
    await prisma.driver.update({
        where: { id: driver.id },
        data: { status: 'AVAILABLE' },
    });

    // Notify customer that we are finding another driver
    const customer = await prisma.user.findUnique({ where: { id: booking.customerId } });
    if (customer?.fcmToken) {
        await notificationService.sendToDevice(customer.fcmToken, {
            title: 'Finding Another Driver',
            body: 'Your previous driver is unavailable. We are finding you another driver now.',
            data: { type: 'DRIVER_DECLINED', bookingId },
        });
    }
    await createNotification(
        booking.customerId,
        'Finding Another Driver',
        'Your previous driver is unavailable. We are finding you another driver now.',
        NotificationType.BOOKING_STATUS,
        bookingId,
    );

    // Trigger re-dispatch asynchronously (non-blocking â€” runs after response is sent)
    handleDriverDecline(bookingId).catch(err =>
        logger.error(`[Booking] Re-dispatch trigger failed for ${bookingId}:`, err)
    );

    logger.info(`Driver ${driver.id} declined booking ${bookingId} â€” re-dispatching`);
    return { success: true, message: 'Booking declined â€” finding next driver' };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ENTERPRISE LIVE BIDDING
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function createBid(bookingId: string, driverUserId: string, data: any) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw AppError.notFound('Booking not found');
    const pickupCommitmentAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return MarketplaceService.submitBid(
        bookingId,
        { userId: driverUserId, role: UserRole.DRIVER },
        {
            idempotencyKey: randomUUID(),
            amount: data.amount,
            pickupCommitmentAt,
            transitMinutes: booking.estimatedDuration ?? 60,
            validForMinutes: Math.min(10, booking.bidWindowMinutes),
            inclusions: [],
            exclusions: [],
            note: data.note,
        },
    );
}

export async function getBids(bookingId: string, userId: string, role: string) {
    const result = await MarketplaceService.listBookingBids(bookingId, { userId, role });
    return result.bids;
}

export async function acceptBid(bookingId: string, customerId: string, bidId: string) {
    const bid = await MarketplaceService.getBidThread(bidId, { userId: customerId, role: UserRole.CUSTOMER });
    if (bid.bookingId !== bookingId) throw AppError.notFound('Bid not found for this booking');
    if (!bid.latestRevisionId) throw AppError.conflict('Bid has no active revision');
    return MarketplaceService.acceptExactRevision(
        bidId,
        bid.latestRevisionId,
        { userId: customerId, role: UserRole.CUSTOMER },
    );
}