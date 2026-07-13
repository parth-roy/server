import { randomUUID } from 'crypto';
import {
  BidAwardStatus,
  BidPartyType,
  BidRevisionAuthorSide,
  BidWindowStatus,
  BookingMode,
  BookingStatus,
  DriverStatus,
  MarketplaceBidStatus,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { env } from '@config/env';
import { assertTransition } from '@modules/booking/booking.transition';
import { inspectRazorpayOrder } from '@modules/payment/razorpay.client';
import { secureCapturedBookingPayment } from '@modules/payment/booking-payment.service';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { notificationService } from '@modules/notifications/notification.service';
import { createNotification } from '@modules/notifications/inapp.notification.service';
import {
  emitToMarketplaceBid,
  emitToMarketplaceCustomer,
  emitToMarketplaceUser,
} from '@shared/socket/socket.instance';
import type {
  CreateRevisionInput,
  OpportunitiesQuery,
  SendBidMessageInput,
  SubmitBidInput,
} from './marketplace.schema';

type Actor = { userId: string; role: UserRole | string };

type ParticipantIdentity =
  | {
      partyType: typeof BidPartyType.DRIVER;
      participantKey: string;
      userId: string;
      driverId: string;
      fleetOwnerId: null;
      driver: any;
      fleetOwner: null;
    }
  | {
      partyType: typeof BidPartyType.FLEET_OWNER;
      participantKey: string;
      userId: string;
      driverId: null;
      fleetOwnerId: string;
      driver: null;
      fleetOwner: any;
    };

const activeAwardStatuses: BidAwardStatus[] = [
  BidAwardStatus.PAYMENT_PENDING,
  BidAwardStatus.PAYMENT_RECONCILING,
  BidAwardStatus.CONFIRMED,
];

const bidThreadInclude = {
  booking: {
    select: {
      id: true,
      bookingNumber: true,
      customerId: true,
      status: true,
      bookingMode: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      vehicleType: true,
      goodsType: true,
      goodsDescription: true,
      goodsWeightKg: true,
      goodsQuantity: true,
      goodsLengthCm: true,
      goodsWidthCm: true,
      goodsHeightCm: true,
      declaredGoodsValue: true,
      handlingInstructions: true,
      goodsImageUrls: true,
      laborRequired: true,
      laborersCount: true,
      laborType: true,
      estimatedDistance: true,
      estimatedDuration: true,
      totalFare: true,
      gstAmount: true,
      grandTotal: true,
      paymentStatus: true,
      paymentMethod: true,
      razorpayOrderId: true,
      marketplaceVersion: true,
      stops: { orderBy: { sequence: 'asc' as const } },
    },
  },
  window: true,
  driver: {
    select: {
      id: true,
      rating: true,
      totalTrips: true,
      isDocVerified: true,
      user: { select: { id: true, name: true, profileImageUrl: true } },
      vehicle: {
        select: {
          id: true,
          type: true,
          make: true,
          model: true,
          registrationNo: true,
          capacityKg: true,
          rcVerifStatus: true,
        },
      },
    },
  },
  fleetOwner: {
    select: {
      id: true,
      userId: true,
      companyName: true,
      isVerified: true,
      trucks: {
        where: { isActive: true },
        select: {
          id: true,
          type: true,
          make: true,
          model: true,
          registrationNo: true,
          capacityKg: true,
        },
      },
    },
  },
  revisions: {
    orderBy: { revisionNumber: 'asc' as const },
    include: { author: { select: { id: true, name: true, role: true } } },
  },
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { sender: { select: { id: true, name: true, role: true } } },
  },
  awards: {
    where: { status: { in: activeAwardStatuses } },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function commercialAmounts(quotedAmount: number) {
  const quoted = roundMoney(quotedAmount);
  const gst = roundMoney(quoted * env.BID_GST_RATE);
  return { quoted, gst, customerTotal: roundMoney(quoted + gst) };
}

function decimalNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function serializeRevision(revision: any) {
  return {
    ...revision,
    quotedAmount: decimalNumber(revision.quotedAmount),
    gstAmount: decimalNumber(revision.gstAmount),
    customerTotal: decimalNumber(revision.customerTotal),
  };
}

function providerSummary(bid: any) {
  if (bid.partyType === BidPartyType.DRIVER) {
    return {
      partyType: bid.partyType,
      displayName: bid.driver?.user?.name ?? 'Verified owner-driver',
      profileImageUrl: bid.driver?.user?.profileImageUrl ?? null,
      verified: bid.driver?.isDocVerified ?? false,
      rating: bid.driver?.rating ?? null,
      completedTrips: bid.driver?.totalTrips ?? 0,
      vehicle: bid.driver?.vehicle ?? null,
    };
  }
  return {
    partyType: bid.partyType,
    displayName: bid.fleetOwner?.companyName ?? 'Verified fleet provider',
    profileImageUrl: null,
    verified: bid.fleetOwner?.isVerified ?? false,
    rating: null,
    completedTrips: null,
    vehicles: bid.fleetOwner?.trucks ?? [],
  };
}

function serializeBidThread(bid: any) {
  const booking = { ...bid.booking };
  delete booking.razorpayOrderId;
  return {
    id: bid.id,
    bookingId: bid.bookingId,
    partyType: bid.partyType,
    status: bid.status,
    latestRevisionId: bid.latestRevisionId,
    latestRevisionNumber: bid.latestRevisionNumber,
    submittedAt: bid.submittedAt,
    provider: providerSummary(bid),
    booking,
    window: bid.window,
    revisions: (bid.revisions ?? []).map(serializeRevision),
    messages: bid.messages ?? [],
    activeAward: bid.awards?.[0]
      ? {
          ...bid.awards[0],
          quotedAmount: decimalNumber(bid.awards[0].quotedAmount),
          gstAmount: decimalNumber(bid.awards[0].gstAmount),
          customerTotal: decimalNumber(bid.awards[0].customerTotal),
        }
      : null,
  };
}

function ensureWindowOpen(booking: any): void {
  if (booking.bookingMode !== BookingMode.PRIVATE_BID) {
    throw AppError.badRequest('This booking is not open for private bidding', 'NOT_BIDDING_BOOKING');
  }
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw AppError.conflict('This booking is no longer open for bidding', 'BID_WINDOW_NOT_OPEN');
  }
  if (!booking.bidWindow || booking.bidWindow.status !== BidWindowStatus.OPEN) {
    throw AppError.conflict('The bid window is not open', 'BID_WINDOW_NOT_OPEN');
  }
  if (booking.bidWindow.closesAt.getTime() <= Date.now()) {
    throw AppError.conflict('The bid window has expired', 'BID_WINDOW_EXPIRED');
  }
}

function validateAmount(booking: { totalFare: number | null }, amount: number): void {
  const guide = booking.totalFare ?? 0;
  if (guide <= 0) throw AppError.badRequest('Booking has no valid guide price', 'INVALID_GUIDE_PRICE');
  const min = roundMoney(guide * env.BID_MIN_FARE_MULTIPLIER);
  const max = roundMoney(guide * env.BID_MAX_FARE_MULTIPLIER);
  if (amount < min || amount > max) {
    throw AppError.badRequest(
      `Offer must be between ₹${min.toFixed(2)} and ₹${max.toFixed(2)} for this load`,
      'BID_AMOUNT_OUT_OF_RANGE',
    );
  }
}

function validatePickupCommitment(value: Date): void {
  const now = Date.now();
  if (value.getTime() <= now) {
    throw AppError.badRequest('Pickup commitment must be in the future', 'INVALID_PICKUP_COMMITMENT');
  }
  if (value.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
    throw AppError.badRequest('Pickup commitment is too far in the future', 'INVALID_PICKUP_COMMITMENT');
  }
}

async function resolveParticipantIdentity(actor: Actor): Promise<ParticipantIdentity> {
  if (actor.role === UserRole.DRIVER) {
    const driver = await prisma.driver.findUnique({
      where: { userId: actor.userId },
      include: {
        user: { select: { id: true, name: true, fcmToken: true } },
        vehicle: true,
        fleetMemberships: { where: { isActive: true }, select: { id: true, fleetOwnerId: true } },
      },
    });
    if (!driver) throw AppError.notFound('Driver profile not found');
    return {
      partyType: BidPartyType.DRIVER,
      participantKey: `DRIVER:${driver.id}`,
      userId: actor.userId,
      driverId: driver.id,
      fleetOwnerId: null,
      driver,
      fleetOwner: null,
    };
  }

  if (actor.role === UserRole.FLEET_OWNER) {
    const fleetOwner = await prisma.fleetOwner.findUnique({
      where: { userId: actor.userId },
      include: {
        user: { select: { id: true, name: true, fcmToken: true } },
        trucks: { where: { isActive: true } },
      },
    });
    if (!fleetOwner) throw AppError.notFound('Fleet owner profile not found');
    return {
      partyType: BidPartyType.FLEET_OWNER,
      participantKey: `FLEET_OWNER:${fleetOwner.id}`,
      userId: actor.userId,
      driverId: null,
      fleetOwnerId: fleetOwner.id,
      driver: null,
      fleetOwner,
    };
  }

  throw AppError.forbidden('Only independent drivers and fleet owners can bid');
}

function validateParticipantEligibility(
  participant: ParticipantIdentity,
  booking: { vehicleType: string; goodsWeightKg?: number | null },
  requestedVehicleId?: string,
  requireExplicitFleetVehicle = false,
) {
  if (participant.partyType === BidPartyType.DRIVER) {
    const driver = participant.driver;
    if (!driver.isActive || !driver.isDocVerified) {
      throw AppError.forbidden('Driver verification is required before bidding');
    }
    if (driver.status !== 'AVAILABLE') {
      throw AppError.conflict('You must be available before bidding', 'DRIVER_NOT_AVAILABLE');
    }
    if (driver.fleetMemberships.length > 0) {
      throw AppError.forbidden('Fleet-attached drivers cannot bid commercially; the fleet owner must bid');
    }
    if (!driver.vehicle || !driver.vehicle.isActive || driver.vehicle.type !== booking.vehicleType) {
      throw AppError.badRequest('Your active vehicle does not match this load', 'VEHICLE_MISMATCH');
    }
    if (
      booking.goodsWeightKg != null &&
      driver.vehicle.capacityKg != null &&
      booking.goodsWeightKg > Number(driver.vehicle.capacityKg)
    ) {
      throw AppError.badRequest('Declared load weight exceeds your vehicle capacity', 'VEHICLE_CAPACITY_EXCEEDED');
    }
    return {
      vehicleId: driver.vehicle.id,
      vehicleType: driver.vehicle.type,
      vehicleSnapshot: {
        id: driver.vehicle.id,
        type: driver.vehicle.type,
        make: driver.vehicle.make,
        model: driver.vehicle.model,
        registrationNo: driver.vehicle.registrationNo,
        capacityKg: driver.vehicle.capacityKg,
      },
    };
  }

  const fleet = participant.fleetOwner;
  if (!fleet.isActive || !fleet.isVerified) {
    throw AppError.forbidden('Fleet verification is required before bidding');
  }
  if (requireExplicitFleetVehicle && !requestedVehicleId) {
    throw AppError.badRequest('Select the fleet truck committed to this offer', 'VEHICLE_REQUIRED');
  }
  const truck = requestedVehicleId
    ? fleet.trucks.find((item: any) => item.id === requestedVehicleId)
    : fleet.trucks.find((item: any) => item.type === booking.vehicleType);
  if (!truck || truck.type !== booking.vehicleType || !truck.isActive) {
    throw AppError.badRequest('Select an active matching fleet truck for this offer', 'VEHICLE_MISMATCH');
  }
  if (
    booking.goodsWeightKg != null &&
    truck.capacityKg != null &&
    booking.goodsWeightKg > Number(truck.capacityKg)
  ) {
    throw AppError.badRequest('Declared load weight exceeds the selected truck capacity', 'VEHICLE_CAPACITY_EXCEEDED');
  }
  return {
    vehicleId: truck.id,
    vehicleType: truck.type,
    vehicleSnapshot: {
      id: truck.id,
      type: truck.type,
      make: truck.make,
      model: truck.model,
      registrationNo: truck.registrationNo,
      capacityKg: truck.capacityKg,
    },
  };
}

async function ensureParticipantOperationalAvailability(
  participant: ParticipantIdentity,
  vehicleId: string,
  currentBidId?: string,
) {
  const activeTripStatuses = [
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.PICKED_UP,
    BookingStatus.IN_TRANSIT,
  ];
  const reservedAwardStatuses = [
    BidAwardStatus.PAYMENT_PENDING,
    BidAwardStatus.PAYMENT_RECONCILING,
    BidAwardStatus.CONFIRMED,
  ];
  const reservedBookingStatuses = [BookingStatus.CONFIRMED, ...activeTripStatuses];

  if (participant.partyType === BidPartyType.DRIVER) {
    const [activeBooking, otherAward] = await Promise.all([
      prisma.booking.findFirst({
        where: { driverId: participant.driverId, status: { in: activeTripStatuses } },
        select: { id: true },
      }),
      prisma.bidAward.findFirst({
        where: {
          activeKey: { not: null },
          status: { in: reservedAwardStatuses },
          ...(currentBidId ? { bidId: { not: currentBidId } } : {}),
          bid: { driverId: participant.driverId },
          booking: { status: { in: reservedBookingStatuses } },
        },
        select: { id: true },
      }),
    ]);
    if (activeBooking || otherAward) {
      throw AppError.conflict('You already have an active or reserved load', 'DRIVER_NOT_AVAILABLE');
    }
    return;
  }

  const [activeTruckTrip, otherAward] = await Promise.all([
    prisma.truckAssignment.findFirst({
      where: { truckId: vehicleId, booking: { status: { in: activeTripStatuses } } },
      select: { id: true },
    }),
    prisma.bidAward.findFirst({
      where: {
        activeKey: { not: null },
        status: { in: reservedAwardStatuses },
        ...(currentBidId ? { bidId: { not: currentBidId } } : {}),
        revision: { vehicleId },
        booking: { status: BookingStatus.CONFIRMED },
      },
      select: { id: true },
    }),
  ]);
  if (activeTruckTrip || otherAward) {
    throw AppError.conflict('The committed fleet truck is already active or reserved', 'TRUCK_ALREADY_ON_TRIP');
  }
}

async function notifyUser(userId: string, title: string, body: string, data: Record<string, string>) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
  if (user?.fcmToken) {
    await notificationService.sendToDevice(user.fcmToken, { title, body, data }).catch((error) => {
      logger.error('[Marketplace] FCM delivery failed', { userId, error });
    });
  }
  await createNotification(userId, title, body, NotificationType.BOOKING_STATUS, data.bookingId).catch((error) => {
    logger.error('[Marketplace] In-app notification failed', { userId, error });
  });
}

async function getBidForAccess(bidId: string, actor: Actor) {
  const bid = await prisma.marketplaceBid.findUnique({ where: { id: bidId }, include: bidThreadInclude });
  if (!bid) throw AppError.notFound('Bid thread not found');

  if (actor.role === UserRole.CUSTOMER) {
    if (bid.booking.customerId !== actor.userId) throw AppError.forbidden('Access denied');
    return bid;
  }

  const participant = await resolveParticipantIdentity(actor);
  if (participant.participantKey !== bid.participantKey) throw AppError.forbidden('Access denied');
  return bid;
}

function buildRevisionValues(
  input: SubmitBidInput | CreateRevisionInput,
  booking: any,
  window: any,
  vehicle: { vehicleId: string; vehicleType: any; vehicleSnapshot: object },
  previous?: any,
) {
  const amount = input.amount ?? Number(previous?.quotedAmount);
  validateAmount(booking, amount);
  const amounts = commercialAmounts(amount);
  const pickupCommitmentAt = new Date(input.pickupCommitmentAt ?? previous?.pickupCommitmentAt);
  validatePickupCommitment(pickupCommitmentAt);
  const transitMinutes = input.transitMinutes ?? previous?.transitMinutes;
  const validForMinutes = input.validForMinutes ?? Math.max(
    1,
    Math.ceil((new Date(previous?.expiresAt).getTime() - Date.now()) / 60_000),
  );
  const requestedExpiry = new Date(Date.now() + validForMinutes * 60_000);
  const expiresAt = requestedExpiry < window.closesAt ? requestedExpiry : window.closesAt;
  if (expiresAt.getTime() <= Date.now()) {
    throw AppError.conflict('The bid window has expired', 'BID_WINDOW_EXPIRED');
  }

  const inclusions = input.inclusions ?? previous?.inclusions ?? [];
  const exclusions = input.exclusions ?? previous?.exclusions ?? [];
  const note = input.note !== undefined ? input.note : previous?.note;
  const termsSnapshot = {
    quotedAmount: amounts.quoted,
    gstAmount: amounts.gst,
    customerTotal: amounts.customerTotal,
    pickupCommitmentAt: pickupCommitmentAt.toISOString(),
    transitMinutes,
    expiresAt: expiresAt.toISOString(),
    vehicle: vehicle.vehicleSnapshot,
    inclusions,
    exclusions,
    note: note ?? null,
    bookingMarketplaceVersion: booking.marketplaceVersion,
  };

  return {
    quotedAmount: new Prisma.Decimal(amounts.quoted),
    gstAmount: new Prisma.Decimal(amounts.gst),
    customerTotal: new Prisma.Decimal(amounts.customerTotal),
    pickupCommitmentAt,
    transitMinutes,
    expiresAt,
    vehicleType: vehicle.vehicleType,
    vehicleId: vehicle.vehicleId,
    inclusions,
    exclusions,
    note: note || null,
    termsSnapshot: termsSnapshot as Prisma.InputJsonValue,
  };
}

export async function listOpportunities(actor: Actor, query: OpportunitiesQuery) {
  const participant = await resolveParticipantIdentity(actor);
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  let vehicleTypes: any[] = [];
  if (participant.partyType === BidPartyType.DRIVER) {
    const driver = participant.driver;
    if (!driver.isActive || !driver.isDocVerified || driver.status !== 'AVAILABLE' || driver.fleetMemberships.length > 0) {
      return { opportunities: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }
    if (driver.vehicle?.isActive) {
      try {
        await ensureParticipantOperationalAvailability(participant, driver.vehicle.id);
      } catch {
        return { opportunities: [], meta: { page, limit, total: 0, totalPages: 0 } };
      }
      vehicleTypes = [driver.vehicle.type];
    }
  } else {
    if (!participant.fleetOwner.isActive || !participant.fleetOwner.isVerified) {
      return { opportunities: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }
    vehicleTypes = [...new Set(participant.fleetOwner.trucks.map((truck: any) => truck.type))];
  }
  if (vehicleTypes.length === 0) return { opportunities: [], meta: { page, limit, total: 0, totalPages: 0 } };

  const where: Prisma.BookingWhereInput = {
    bookingMode: BookingMode.PRIVATE_BID,
    status: BookingStatus.CONFIRMED,
    driverId: null,
    vehicleType: { in: vehicleTypes },
    bidWindow: { is: { status: BidWindowStatus.OPEN, closesAt: { gt: new Date() } } },
  };

  const [rows, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        bookingNumber: true,
        pickupAddress: true,
        pickupLat: true,
        pickupLng: true,
        stops: { orderBy: { sequence: 'asc' }, select: { address: true, latitude: true, longitude: true } },
        vehicleType: true,
        goodsType: true,
        goodsDescription: true,
        goodsWeightKg: true,
        goodsQuantity: true,
        goodsLengthCm: true,
        goodsWidthCm: true,
        goodsHeightCm: true,
        declaredGoodsValue: true,
        handlingInstructions: true,
        goodsImageUrls: true,
        laborRequired: true,
        laborersCount: true,
        laborType: true,
        estimatedDistance: true,
        estimatedDuration: true,
        totalFare: true,
        gstAmount: true,
        grandTotal: true,
        createdAt: true,
        bidWindow: true,
        marketplaceBids: {
          where: { participantKey: participant.participantKey },
          select: { id: true, status: true, latestRevisionId: true, latestRevisionNumber: true },
          take: 1,
        },
        _count: { select: { marketplaceBids: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return {
    opportunities: rows.map((row) => ({
      ...row,
      bidCount: row._count.marketplaceBids,
      myBid: row.marketplaceBids[0] ?? null,
      _count: undefined,
      marketplaceBids: undefined,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getOpportunity(bookingId: string, actor: Actor) {
  const participant = await resolveParticipantIdentity(actor);
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      bidWindow: true,
      stops: { orderBy: { sequence: 'asc' } },
      marketplaceBids: {
        where: { participantKey: participant.participantKey },
        select: { id: true, status: true, latestRevisionId: true, latestRevisionNumber: true },
        take: 1,
      },
      _count: { select: { marketplaceBids: true } },
    },
  });
  if (!booking) throw AppError.notFound('Bid opportunity not found');
  ensureWindowOpen(booking);
  const vehicle = validateParticipantEligibility(participant, booking);
  await ensureParticipantOperationalAvailability(participant, vehicle.vehicleId);
  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    pickupAddress: booking.pickupAddress,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    stops: booking.stops,
    vehicleType: booking.vehicleType,
    goodsType: booking.goodsType,
    goodsDescription: booking.goodsDescription,
    goodsWeightKg: booking.goodsWeightKg,
    goodsQuantity: booking.goodsQuantity,
    goodsLengthCm: booking.goodsLengthCm,
    goodsWidthCm: booking.goodsWidthCm,
    goodsHeightCm: booking.goodsHeightCm,
    declaredGoodsValue: booking.declaredGoodsValue,
    handlingInstructions: booking.handlingInstructions,
    goodsImageUrls: booking.goodsImageUrls,
    laborRequired: booking.laborRequired,
    laborersCount: booking.laborersCount,
    laborType: booking.laborType,
    estimatedDistance: booking.estimatedDistance,
    estimatedDuration: booking.estimatedDuration,
    totalFare: booking.totalFare,
    gstAmount: booking.gstAmount,
    grandTotal: booking.grandTotal,
    createdAt: booking.createdAt,
    bidWindow: booking.bidWindow,
    bidCount: booking._count.marketplaceBids,
    myBid: booking.marketplaceBids[0] ?? null,
  };
}

export async function listBookingBids(bookingId: string, actor: Actor) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, customerId: true, bookingMode: true, bidWindow: true },
  });
  if (!booking) throw AppError.notFound('Booking not found');
  if (booking.bookingMode !== BookingMode.PRIVATE_BID) throw AppError.badRequest('Not a bidding booking');

  let where: Prisma.MarketplaceBidWhereInput = { bookingId };
  if (actor.role === UserRole.CUSTOMER) {
    if (booking.customerId !== actor.userId) throw AppError.forbidden('Access denied');
  } else {
    const participant = await resolveParticipantIdentity(actor);
    where = { bookingId, participantKey: participant.participantKey };
  }

  const bids = await prisma.marketplaceBid.findMany({
    where,
    orderBy: { submittedAt: 'asc' },
    include: bidThreadInclude,
  });
  return { window: booking.bidWindow, bids: bids.map(serializeBidThread) };
}

export async function getBidThread(bidId: string, actor: Actor) {
  const bid = await getBidForAccess(bidId, actor);
  return serializeBidThread(bid);
}

export async function submitBid(bookingId: string, actor: Actor, input: SubmitBidInput) {
  const retry = await prisma.bidRevision.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { bid: true },
  });
  if (retry) {
    if (retry.authorUserId !== actor.userId || retry.bid.bookingId !== bookingId) {
      throw AppError.conflict('Idempotency key already used', 'IDEMPOTENCY_KEY_REUSED');
    }
    return getBidThread(retry.bidId, actor);
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { bidWindow: true },
  });
  if (!booking) throw AppError.notFound('Booking not found');
  ensureWindowOpen(booking);

  const participant = await resolveParticipantIdentity(actor);
  const vehicle = validateParticipantEligibility(participant, booking, input.vehicleId, true);
  await ensureParticipantOperationalAvailability(participant, vehicle.vehicleId);
  const revisionValues = buildRevisionValues(input, booking, booking.bidWindow, vehicle);
  const bidId = randomUUID();
  const revisionId = randomUUID();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.marketplaceBid.create({
        data: {
          id: bidId,
          bookingId,
          windowId: booking.bidWindow!.id,
          participantKey: participant.participantKey,
          partyType: participant.partyType,
          driverId: participant.driverId,
          fleetOwnerId: participant.fleetOwnerId,
          createdByUserId: actor.userId,
          latestRevisionId: revisionId,
          latestRevisionNumber: 1,
        },
      });
      await tx.bidRevision.create({
        data: {
          id: revisionId,
          bidId,
          revisionNumber: 1,
          authorUserId: actor.userId,
          authorSide: BidRevisionAuthorSide.PROVIDER,
          idempotencyKey: input.idempotencyKey,
          ...revisionValues,
        },
      });
      await tx.bidMessage.create({
        data: {
          bidId,
          senderUserId: actor.userId,
          clientMessageId: randomUUID(),
          type: 'SYSTEM',
          message: 'Official offer submitted',
          revisionId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: any) {
    const idempotentRetry = await prisma.bidRevision.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { bid: { select: { bookingId: true } } },
    });
    if (
      idempotentRetry?.authorUserId === actor.userId &&
      idempotentRetry.bid.bookingId === bookingId
    ) {
      return getBidThread(idempotentRetry.bidId, actor);
    }
    if (error?.code === 'P2002') {
      throw AppError.conflict('You already have a bid on this booking', 'BID_ALREADY_EXISTS');
    }
    throw error;
  }

  const event = { bookingId, bidId, revisionId, revisionNumber: 1 };
  emitToMarketplaceCustomer(bookingId, 'bid_created', event);
  emitToMarketplaceBid(bidId, 'bid_revision_created', event);
  await notifyUser(
    booking.customerId,
    'New private bid received',
    'A verified provider submitted an offer for your load.',
    { type: 'BID_RECEIVED', bookingId, bidId },
  );
  logger.info('[Marketplace] Bid submitted', event);
  return getBidThread(bidId, actor);
}

export async function createRevision(bidId: string, actor: Actor, input: CreateRevisionInput) {
  const retry = await prisma.bidRevision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (retry) {
    if (retry.authorUserId !== actor.userId || retry.bidId !== bidId) {
      throw AppError.conflict('Idempotency key already used', 'IDEMPOTENCY_KEY_REUSED');
    }
    return getBidThread(bidId, actor);
  }

  const bid = await getBidForAccess(bidId, actor);
  if (bid.status !== MarketplaceBidStatus.OPEN) {
    throw AppError.conflict('This bid is no longer open for revision', 'BID_NOT_OPEN');
  }
  ensureWindowOpen({ ...bid.booking, bidWindow: bid.window });
  if (bid.latestRevisionId !== input.expectedLatestRevisionId) {
    throw AppError.conflict('A newer offer revision already exists. Refresh before countering.', 'STALE_BID_REVISION');
  }
  if (bid.latestRevisionNumber >= bid.window.maxRevisionsPerBid) {
    throw AppError.tooManyRequests('Maximum revisions reached for this bid');
  }

  const previous = bid.revisions[bid.revisions.length - 1];
  if (!previous || previous.id !== bid.latestRevisionId) {
    throw AppError.conflict('Latest bid revision could not be resolved', 'STALE_BID_REVISION');
  }

  let authorSide: BidRevisionAuthorSide;
  let vehicle: { vehicleId: string; vehicleType: any; vehicleSnapshot: object };
  if (actor.role === UserRole.CUSTOMER) {
    authorSide = BidRevisionAuthorSide.CUSTOMER;
    const snapshot = (previous.termsSnapshot as any)?.vehicle ?? { id: previous.vehicleId, type: previous.vehicleType };
    vehicle = { vehicleId: previous.vehicleId!, vehicleType: previous.vehicleType, vehicleSnapshot: snapshot };
  } else {
    authorSide = BidRevisionAuthorSide.PROVIDER;
    const participant = await resolveParticipantIdentity(actor);
    vehicle = validateParticipantEligibility(
      participant,
      bid.booking,
      input.vehicleId ?? previous.vehicleId ?? undefined,
    );
    await ensureParticipantOperationalAvailability(participant, vehicle.vehicleId, bid.id);
  }

  const revisionValues = buildRevisionValues(input, bid.booking, bid.window, vehicle, previous);
  const revisionId = randomUUID();
  const revisionNumber = bid.latestRevisionNumber + 1;

  try {
    await prisma.$transaction(async (tx) => {
      const update = await tx.marketplaceBid.updateMany({
        where: {
          id: bidId,
          status: MarketplaceBidStatus.OPEN,
          latestRevisionId: input.expectedLatestRevisionId,
          latestRevisionNumber: bid.latestRevisionNumber,
        },
        data: { latestRevisionId: revisionId, latestRevisionNumber: revisionNumber },
      });
      if (update.count !== 1) {
        throw AppError.conflict('A newer offer revision already exists. Refresh before countering.', 'STALE_BID_REVISION');
      }
      await tx.bidRevision.create({
        data: {
          id: revisionId,
          bidId,
          revisionNumber,
          previousRevisionId: input.expectedLatestRevisionId,
          authorUserId: actor.userId,
          authorSide,
          idempotencyKey: input.idempotencyKey,
          ...revisionValues,
        },
      });
      await tx.bidMessage.create({
        data: {
          bidId,
          senderUserId: actor.userId,
          clientMessageId: randomUUID(),
          type: 'SYSTEM',
          message: authorSide === BidRevisionAuthorSide.CUSTOMER
            ? 'Customer sent an official counteroffer'
            : 'Provider revised the official offer',
          revisionId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const idempotentRetry = await prisma.bidRevision.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (
      idempotentRetry?.authorUserId === actor.userId &&
      idempotentRetry.bidId === bidId
    ) {
      return getBidThread(bidId, actor);
    }
    throw error;
  }

  const event = { bookingId: bid.bookingId, bidId, revisionId, revisionNumber, authorSide };
  emitToMarketplaceBid(bidId, 'bid_revision_created', event);
  emitToMarketplaceCustomer(bid.bookingId, 'bid_revision_created', event);
  const recipientId = authorSide === BidRevisionAuthorSide.CUSTOMER
    ? bid.createdByUserId
    : bid.booking.customerId;
  await notifyUser(
    recipientId,
    authorSide === BidRevisionAuthorSide.CUSTOMER ? 'Customer sent a counteroffer' : 'Provider revised the bid',
    'Open the private negotiation to review the latest official terms.',
    { type: 'BID_COUNTERED', bookingId: bid.bookingId, bidId },
  );
  return getBidThread(bidId, actor);
}

export async function sendMessage(bidId: string, actor: Actor, input: SendBidMessageInput) {
  const existing = await prisma.bidMessage.findUnique({
    where: { clientMessageId: input.clientMessageId },
    include: { sender: { select: { id: true, name: true, role: true } } },
  });
  if (existing) {
    if (existing.senderUserId !== actor.userId || existing.bidId !== bidId) {
      throw AppError.conflict('Message id already used', 'IDEMPOTENCY_KEY_REUSED');
    }
    return existing;
  }

  const bid = await getBidForAccess(bidId, actor);
  if (bid.status !== MarketplaceBidStatus.OPEN) throw AppError.conflict('This negotiation is closed', 'BID_NOT_OPEN');
  ensureWindowOpen({ ...bid.booking, bidWindow: bid.window });

  let message;
  try {
    message = await prisma.bidMessage.create({
      data: {
        bidId,
        senderUserId: actor.userId,
        clientMessageId: input.clientMessageId,
        type: 'TEXT',
        message: input.message,
      },
      include: { sender: { select: { id: true, name: true, role: true } } },
    });
  } catch (error) {
    const idempotentRetry = await prisma.bidMessage.findUnique({
      where: { clientMessageId: input.clientMessageId },
      include: { sender: { select: { id: true, name: true, role: true } } },
    });
    if (
      idempotentRetry?.senderUserId === actor.userId &&
      idempotentRetry.bidId === bidId
    ) {
      return idempotentRetry;
    }
    throw error;
  }

  emitToMarketplaceBid(bidId, 'bid_message_created', {
    bookingId: bid.bookingId,
    bidId,
    message,
  });
  const recipientId = actor.role === UserRole.CUSTOMER ? bid.createdByUserId : bid.booking.customerId;
  await notifyUser(recipientId, 'New bid message', 'You received a private negotiation message.', {
    type: 'BID_MESSAGE', bookingId: bid.bookingId, bidId,
  });
  return message;
}

export async function withdrawBid(bidId: string, actor: Actor) {
  if (actor.role !== UserRole.DRIVER && actor.role !== UserRole.FLEET_OWNER) {
    throw AppError.forbidden('Only the provider can withdraw a bid');
  }
  const bid = await getBidForAccess(bidId, actor);
  if (bid.status !== MarketplaceBidStatus.OPEN) {
    throw AppError.conflict('This bid can no longer be withdrawn', 'BID_NOT_OPEN');
  }
  ensureWindowOpen({ ...bid.booking, bidWindow: bid.window });
  const updated = await prisma.marketplaceBid.update({
    where: { id: bidId },
    data: { status: MarketplaceBidStatus.WITHDRAWN, withdrawnAt: new Date(), closedAt: new Date() },
  });
  const event = { bookingId: bid.bookingId, bidId, status: updated.status };
  emitToMarketplaceBid(bidId, 'bid_status_changed', event);
  emitToMarketplaceCustomer(bid.bookingId, 'bid_status_changed', event);
  await notifyUser(bid.booking.customerId, 'Bid withdrawn', 'A provider withdrew their offer.', {
    type: 'BID_WITHDRAWN', bookingId: bid.bookingId, bidId,
  });
  return updated;
}

export async function rejectBid(bidId: string, actor: Actor) {
  if (actor.role !== UserRole.CUSTOMER) throw AppError.forbidden('Only the customer can reject a bid');
  const bid = await getBidForAccess(bidId, actor);
  if (bid.status !== MarketplaceBidStatus.OPEN) {
    throw AppError.conflict('This bid can no longer be rejected', 'BID_NOT_OPEN');
  }
  ensureWindowOpen({ ...bid.booking, bidWindow: bid.window });
  const updated = await prisma.marketplaceBid.update({
    where: { id: bidId },
    data: { status: MarketplaceBidStatus.REJECTED, rejectedAt: new Date(), closedAt: new Date() },
  });
  const event = { bookingId: bid.bookingId, bidId, status: updated.status };
  emitToMarketplaceBid(bidId, 'bid_status_changed', event);
  emitToMarketplaceCustomer(bid.bookingId, 'bid_status_changed', event);
  await notifyUser(bid.createdByUserId, 'Bid not selected', 'The customer closed this negotiation.', {
    type: 'BID_REJECTED', bookingId: bid.bookingId, bidId,
  });
  return updated;
}

async function revalidateWinningProvider(bid: any, revision: any) {
  const actor: Actor = { userId: bid.createdByUserId, role: bid.partyType === BidPartyType.DRIVER ? UserRole.DRIVER : UserRole.FLEET_OWNER };
  const participant = await resolveParticipantIdentity(actor);
  const vehicle = validateParticipantEligibility(participant, bid.booking, revision.vehicleId ?? undefined);
  await ensureParticipantOperationalAvailability(participant, vehicle.vehicleId, bid.id);
}

export async function acceptExactRevision(bidId: string, revisionId: string, actor: Actor) {
  if (actor.role !== UserRole.CUSTOMER) throw AppError.forbidden('Only the customer can accept a bid');
  const bid = await getBidForAccess(bidId, actor);
  const existingAward = bid.awards?.[0];
  if (
    existingAward &&
    existingAward.revisionId === revisionId &&
    existingAward.customerId === actor.userId
  ) {
    return getAward(bid.bookingId, actor);
  }
  ensureWindowOpen({ ...bid.booking, bidWindow: bid.window });
  if (bid.status !== MarketplaceBidStatus.OPEN) throw AppError.conflict('This bid is not open', 'BID_NOT_OPEN');
  if (bid.latestRevisionId !== revisionId) {
    throw AppError.conflict('Only the exact latest revision can be accepted', 'STALE_BID_REVISION');
  }
  const revision = bid.revisions.find((item: any) => item.id === revisionId);
  if (!revision) throw AppError.notFound('Bid revision not found');
  if (revision.authorSide !== BidRevisionAuthorSide.PROVIDER) {
    throw AppError.conflict('The provider must confirm the latest customer counteroffer before it can be accepted', 'PROVIDER_CONFIRMATION_REQUIRED');
  }
  if (revision.expiresAt.getTime() <= Date.now()) {
    throw AppError.conflict('This offer revision has expired', 'BID_REVISION_EXPIRED');
  }
  await revalidateWinningProvider(bid, revision);

  const awardId = randomUUID();
  const now = new Date();
  const paymentDeadline = new Date(now.getTime() + env.BID_PAYMENT_DEADLINE_MINUTES * 60_000);
  const previousPricingSnapshot = {
    totalFare: bid.booking.totalFare,
    gstAmount: bid.booking.gstAmount,
    grandTotal: bid.booking.grandTotal,
    paymentStatus: bid.booking.paymentStatus,
    paymentMethod: bid.booking.paymentMethod,
    razorpayOrderId: bid.booking.razorpayOrderId,
  };

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.bidWindow.updateMany({
        where: { id: bid.window.id, status: BidWindowStatus.OPEN, version: bid.window.version, closesAt: { gt: now } },
        data: { status: BidWindowStatus.LOCKED, lockedAt: now, version: { increment: 1 } },
      });
      if (locked.count !== 1) throw AppError.conflict('Another acceptance already changed this bid window', 'BID_ACCEPTANCE_CONFLICT');

      const selected = await tx.marketplaceBid.updateMany({
        where: { id: bidId, status: MarketplaceBidStatus.OPEN, latestRevisionId: revisionId },
        data: { status: MarketplaceBidStatus.ACCEPTED },
      });
      if (selected.count !== 1) throw AppError.conflict('This bid changed before acceptance', 'BID_ACCEPTANCE_CONFLICT');

      await tx.bidAward.create({
        data: {
          id: awardId,
          bookingId: bid.bookingId,
          bidId,
          revisionId,
          customerId: actor.userId,
          status: BidAwardStatus.PAYMENT_PENDING,
          activeKey: bid.bookingId,
          quotedAmount: revision.quotedAmount,
          gstAmount: revision.gstAmount,
          customerTotal: revision.customerTotal,
          previousPricingSnapshot: previousPricingSnapshot as Prisma.InputJsonValue,
          paymentDeadline,
        },
      });

      const bookingChanged = await tx.booking.updateMany({
        where: {
          id: bid.bookingId,
          customerId: actor.userId,
          bookingMode: BookingMode.PRIVATE_BID,
          status: BookingStatus.CONFIRMED,
          marketplaceVersion: bid.booking.marketplaceVersion,
        },
        data: {
          totalFare: Number(revision.quotedAmount),
          gstAmount: Number(revision.gstAmount),
          taxAmount: Number(revision.gstAmount),
          grandTotal: Number(revision.customerTotal),
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: null,
          paymentRef: null,
          razorpayOrderId: null,
          marketplaceVersion: { increment: 1 },
        },
      });
      if (bookingChanged.count !== 1) throw AppError.conflict('Booking changed before acceptance', 'BID_ACCEPTANCE_CONFLICT');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw AppError.conflict('Another bid has already won this booking', 'BID_ACCEPTANCE_CONFLICT');
    }
    throw error;
  }

  const event = { bookingId: bid.bookingId, bidId, revisionId, awardId, paymentDeadline };
  emitToMarketplaceCustomer(bid.bookingId, 'bid_award_pending', event);
  emitToMarketplaceBid(bidId, 'bid_award_pending', event);
  await notifyUser(bid.createdByUserId, 'Your bid was selected', 'The customer selected your offer. Payment confirmation is pending.', {
    type: 'BID_AWARD_PENDING', bookingId: bid.bookingId, bidId,
  });
  return getAward(bid.bookingId, actor);
}

export async function getAward(bookingId: string, actor: Actor) {
  const award = await prisma.bidAward.findFirst({
    where: { bookingId, status: { in: activeAwardStatuses } },
    orderBy: { createdAt: 'desc' },
    include: {
      bid: { include: { driver: { include: { user: true, vehicle: true } }, fleetOwner: true } },
      revision: true,
      booking: { select: { id: true, bookingNumber: true, customerId: true, paymentStatus: true, paymentMethod: true, status: true, awardedFleetOwnerId: true } },
    },
  });
  if (!award) return null;

  if (actor.role === UserRole.CUSTOMER) {
    if (award.customerId !== actor.userId) throw AppError.forbidden('Access denied');
  } else {
    const participant = await resolveParticipantIdentity(actor);
    if (participant.participantKey !== award.bid.participantKey) throw AppError.forbidden('Access denied');
  }
  return {
    ...award,
    quotedAmount: Number(award.quotedAmount),
    gstAmount: Number(award.gstAmount),
    customerTotal: Number(award.customerTotal),
    provider: providerSummary(award.bid),
  };
}

export async function secureCashAward(bookingId: string, actor: Actor) {
  if (actor.role !== UserRole.CUSTOMER) throw AppError.forbidden('Only the customer can secure payment');
  if (!env.BID_ALLOW_CASH) throw AppError.badRequest('Cash is not enabled for bidding bookings', 'CASH_NOT_ALLOWED');
  await prisma.$transaction(async (tx) => {
    const award = await tx.bidAward.findFirst({
      where: {
        bookingId,
        activeKey: bookingId,
        status: BidAwardStatus.PAYMENT_PENDING,
        customerId: actor.userId,
      },
    });
    if (!award) throw AppError.notFound('Pending bid award not found');
    if (award.paymentDeadline.getTime() <= Date.now()) {
      throw AppError.conflict('Payment deadline has expired', 'PAYMENT_DEADLINE_EXPIRED');
    }
    const secured = await tx.booking.updateMany({
      where: {
        id: bookingId,
        customerId: actor.userId,
        bookingMode: BookingMode.PRIVATE_BID,
        paymentStatus: PaymentStatus.PENDING,
      },
      data: { paymentMethod: PaymentMethod.CASH },
    });
    if (secured.count !== 1) {
      throw AppError.conflict('Booking payment state changed', 'PAYMENT_STATE_CONFLICT');
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return finalizeSecuredAward(bookingId);
}

export async function finalizePaidAward(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { bookingMode: true, paymentStatus: true } });
  if (!booking || booking.bookingMode !== BookingMode.PRIVATE_BID) return null;
  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw AppError.conflict('Payment is not secured for this bid award', 'PAYMENT_NOT_SECURED');
  }
  return finalizeSecuredAward(bookingId);
}

async function finalizeSecuredAward(bookingId: string) {
  const award = await prisma.bidAward.findFirst({
    where: { bookingId, activeKey: bookingId },
    include: { bid: { include: { booking: true } }, booking: true, revision: true },
  });
  if (!award) return null;
  if (award.status === BidAwardStatus.CONFIRMED) return award;
  if (award.status !== BidAwardStatus.PAYMENT_PENDING && award.status !== BidAwardStatus.PAYMENT_RECONCILING) {
    throw AppError.conflict('Bid award is no longer active', 'BID_AWARD_NOT_ACTIVE');
  }

  const isCash = award.booking.paymentMethod === PaymentMethod.CASH;
  if (!isCash && award.booking.paymentStatus !== PaymentStatus.PAID) {
    throw AppError.conflict('Payment is not secured', 'PAYMENT_NOT_SECURED');
  }
  await revalidateWinningProvider(award.bid, award.revision);
  if (award.bid.partyType === BidPartyType.DRIVER) {
    assertTransition(award.booking.status, BookingStatus.DRIVER_ASSIGNED);
  }

  const now = new Date();
  const finalized = await prisma.$transaction(async (tx) => {
    const confirmed = await tx.bidAward.updateMany({
      where: { id: award.id, status: { in: [BidAwardStatus.PAYMENT_PENDING, BidAwardStatus.PAYMENT_RECONCILING] }, activeKey: bookingId },
      data: { status: BidAwardStatus.CONFIRMED, confirmedAt: now },
    });
    if (confirmed.count !== 1) return false;

    await tx.bidWindow.update({
      where: { bookingId },
      data: { status: BidWindowStatus.CLOSED, closedAt: now, version: { increment: 1 } },
    });
    await tx.marketplaceBid.updateMany({
      where: { bookingId, id: { not: award.bidId }, status: MarketplaceBidStatus.OPEN },
      data: { status: MarketplaceBidStatus.NOT_SELECTED, closedAt: now },
    });

    if (award.bid.partyType === BidPartyType.DRIVER) {
      const reservedDriver = await tx.driver.updateMany({
        where: {
          id: award.bid.driverId!,
          isActive: true,
          isDocVerified: true,
          status: DriverStatus.AVAILABLE,
        },
        data: { status: DriverStatus.ON_TRIP },
      });
      if (reservedDriver.count !== 1) {
        throw AppError.conflict('Winning driver is no longer available', 'DRIVER_NOT_AVAILABLE');
      }
      const assigned = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: award.booking.status,
          driverId: null,
        },
        data: {
          driverId: award.bid.driverId,
          awardedFleetOwnerId: null,
          status: BookingStatus.DRIVER_ASSIGNED,
          marketplaceVersion: { increment: 1 },
        },
      });
      if (assigned.count !== 1) {
        throw AppError.conflict('Booking changed before provider assignment', 'BID_ACCEPTANCE_CONFLICT');
      }
    } else {
      const reservedForFleet = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: BookingStatus.CONFIRMED,
          driverId: null,
        },
        data: {
          driverId: null,
          awardedFleetOwnerId: award.bid.fleetOwnerId,
          status: BookingStatus.CONFIRMED,
          marketplaceVersion: { increment: 1 },
        },
      });
      if (reservedForFleet.count !== 1) {
        throw AppError.conflict('Booking changed before fleet reservation', 'BID_ACCEPTANCE_CONFLICT');
      }
    }
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!finalized) {
    return getAward(bookingId, { userId: award.customerId, role: UserRole.CUSTOMER });
  }

  const losing = await prisma.marketplaceBid.findMany({
    where: { bookingId, id: { not: award.bidId } },
    select: { createdByUserId: true, id: true },
  });
  const event = { bookingId, bidId: award.bidId, revisionId: award.revisionId, awardId: award.id };
  emitToMarketplaceCustomer(bookingId, 'bid_award_confirmed', event);
  emitToMarketplaceBid(award.bidId, 'bid_award_confirmed', event);
  await notifyUser(
    award.bid.createdByUserId,
    'Bid confirmed',
    award.bid.partyType === BidPartyType.DRIVER
      ? 'Payment is secured. Open the assigned booking and acknowledge the trip.'
      : 'Payment is secured. Assign an eligible truck and driver now.',
    {
      type: award.bid.partyType === BidPartyType.DRIVER ? 'BID_AWARDED_DRIVER' : 'BID_AWARDED_FLEET',
      bookingId,
      bidId: award.bidId,
    },
  );
  await Promise.allSettled(losing.map((item) => notifyUser(item.createdByUserId, 'Bid closed', 'Another provider was selected for this load.', {
    type: 'BID_NOT_SELECTED', bookingId, bidId: item.id,
  })));
  logger.info('[Marketplace] Award confirmed', event);
  return getAward(bookingId, { userId: award.customerId, role: UserRole.CUSTOMER });
}

export async function publishBidOpportunity(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { bidWindow: true, stops: { orderBy: { sequence: 'asc' }, take: 1 } },
  });
  if (!booking || booking.bookingMode !== BookingMode.PRIVATE_BID || booking.status !== BookingStatus.CONFIRMED) return;
  if (!booking.bidWindow || booking.bidWindow.status !== BidWindowStatus.OPEN) return;

  const [drivers, fleets] = await Promise.all([
    prisma.driver.findMany({
      where: {
        isActive: true,
        isDocVerified: true,
        status: 'AVAILABLE',
        vehicle: { is: { isActive: true, type: booking.vehicleType } },
        fleetMemberships: { none: { isActive: true } },
      },
      select: { user: { select: { id: true, fcmToken: true } } },
      take: 100,
    }),
    prisma.fleetOwner.findMany({
      where: {
        isActive: true,
        isVerified: true,
        trucks: { some: { isActive: true, type: booking.vehicleType } },
      },
      select: { user: { select: { id: true, fcmToken: true } } },
      take: 100,
    }),
  ]);

  const recipients = [...drivers.map((item) => item.user), ...fleets.map((item) => item.user)];
  const body = `${booking.vehicleType} • ₹${booking.totalFare ?? 0} guide • ${booking.pickupAddress} → ${booking.stops[0]?.address ?? 'Destination'}`;
  await Promise.allSettled(recipients.map(async (user) => {
    if (user.fcmToken) {
      await notificationService.sendToDevice(user.fcmToken, {
        title: 'New private bid opportunity',
        body,
        data: { type: 'NEW_BID_OPPORTUNITY', bookingId, closesAt: booking.bidWindow!.closesAt.toISOString() },
      });
    }
    emitToMarketplaceUser(user.id, 'opportunity_published', { bookingId, closesAt: booking.bidWindow!.closesAt });
  }));
  logger.info('[Marketplace] Bid opportunity published', { bookingId, recipients: recipients.length });
}

export async function expireMarketplaceState() {
  const now = new Date();

  const expiredWindows = await prisma.bidWindow.findMany({
    where: { status: BidWindowStatus.OPEN, closesAt: { lte: now } },
    select: { id: true, bookingId: true },
    take: 200,
  });
  for (const window of expiredWindows) {
    const changed = await prisma.bidWindow.updateMany({
      where: { id: window.id, status: BidWindowStatus.OPEN, closesAt: { lte: now } },
      data: { status: BidWindowStatus.EXPIRED, closedAt: now, version: { increment: 1 } },
    });
    if (changed.count !== 1) continue;
    const bidsToExpire = await prisma.marketplaceBid.findMany({
      where: { bookingId: window.bookingId, status: MarketplaceBidStatus.OPEN },
      select: { id: true, createdByUserId: true },
    });
    await prisma.marketplaceBid.updateMany({
      where: { bookingId: window.bookingId, status: MarketplaceBidStatus.OPEN },
      data: { status: MarketplaceBidStatus.EXPIRED, closedAt: now },
    });
    emitToMarketplaceCustomer(window.bookingId, 'bid_window_updated', { bookingId: window.bookingId, status: BidWindowStatus.EXPIRED });
    await Promise.allSettled(bidsToExpire.map(async (bid) => {
      emitToMarketplaceBid(bid.id, 'bid_status_changed', {
        bookingId: window.bookingId,
        bidId: bid.id,
        status: MarketplaceBidStatus.EXPIRED,
      });
      await notifyUser(
        bid.createdByUserId,
        'Bid window closed',
        'The private bid window ended without an award.',
        { type: 'BID_EXPIRED', bookingId: window.bookingId, bidId: bid.id },
      );
    }));
  }

  const overdueAwards = await prisma.bidAward.findMany({
    where: {
      status: { in: [BidAwardStatus.PAYMENT_PENDING, BidAwardStatus.PAYMENT_RECONCILING] },
      paymentDeadline: { lte: now },
      activeKey: { not: null },
    },
    include: { booking: true, bid: true },
    take: 100,
  });
  for (const award of overdueAwards) {
    if (award.booking.paymentStatus === PaymentStatus.PAID || award.booking.paymentMethod === PaymentMethod.CASH) {
      await finalizeSecuredAward(award.bookingId).catch((error) => logger.error('[Marketplace] Late finalization failed', { awardId: award.id, error }));
      continue;
    }
    let canExpire = !award.booking.razorpayOrderId;
    if (award.booking.razorpayOrderId) {
      await prisma.bidAward.updateMany({
        where: { id: award.id, status: BidAwardStatus.PAYMENT_PENDING },
        data: { status: BidAwardStatus.PAYMENT_RECONCILING },
      });
      const reconciliationEvent = {
        bookingId: award.bookingId,
        bidId: award.bidId,
        awardId: award.id,
        status: BidAwardStatus.PAYMENT_RECONCILING,
      };
      emitToMarketplaceCustomer(award.bookingId, 'bid_award_pending', reconciliationEvent);
      emitToMarketplaceBid(award.bidId, 'bid_award_pending', reconciliationEvent);

      try {
        const inspection = await inspectRazorpayOrder(
          award.booking.razorpayOrderId,
          Math.round(Number(award.customerTotal) * 100),
        );
        if (inspection.exactCapturedPayment && inspection.orderMatches) {
          await secureCapturedBookingPayment({
            bookingId: award.bookingId,
            orderId: award.booking.razorpayOrderId,
            paymentId: inspection.exactCapturedPayment.id,
            amountPaise: Number(inspection.exactCapturedPayment.amount),
            currency: inspection.exactCapturedPayment.currency,
          });
          await finalizeSecuredAward(award.bookingId);
          continue;
        }

        const reconciliationDeadline = new Date(
          award.paymentDeadline.getTime() + env.BID_PAYMENT_RECONCILE_MINUTES * 60_000,
        );
        canExpire = now >= reconciliationDeadline && inspection.canSafelyExpire;
        if (!canExpire) {
          logger.warn('[Marketplace] Bid award retained for payment reconciliation', {
            awardId: award.id,
            orderStatus: inspection.orderStatus,
            orderMatches: inspection.orderMatches,
            hasCapturedPayment: inspection.hasCapturedPayment,
            hasAuthorizedPayment: inspection.hasAuthorizedPayment,
          });
          continue;
        }
      } catch (error) {
        // A gateway outage is not proof of non-payment. Keep the lock and retry on the next job run.
        logger.error('[Marketplace] Razorpay reconciliation failed; award remains locked', {
          awardId: award.id,
          error,
        });
        continue;
      }
    }
    if (!canExpire) continue;

    const previous = award.previousPricingSnapshot as any;
    const closesAt = new Date(now.getTime() + env.BID_REOPEN_WINDOW_MINUTES * 60_000);
    const reopened = await prisma.$transaction(async (tx) => {
      const currentBooking = await tx.booking.findUnique({ where: { id: award.bookingId } });
      if (
        !currentBooking ||
        currentBooking.paymentStatus === PaymentStatus.PAID ||
        currentBooking.paymentMethod === PaymentMethod.CASH
      ) {
        return false;
      }
      const expired = await tx.bidAward.updateMany({
        where: {
          id: award.id,
          status: { in: [BidAwardStatus.PAYMENT_PENDING, BidAwardStatus.PAYMENT_RECONCILING] },
          activeKey: award.bookingId,
        },
        data: { status: BidAwardStatus.EXPIRED, activeKey: null, expiredAt: now },
      });
      if (expired.count !== 1) return false;
      await tx.bidWindow.update({
        where: { bookingId: award.bookingId },
        data: { status: BidWindowStatus.OPEN, lockedAt: null, closedAt: null, closesAt, version: { increment: 1 } },
      });
      await tx.marketplaceBid.update({ where: { id: award.bidId }, data: { status: MarketplaceBidStatus.OPEN } });
      await tx.booking.update({
        where: { id: award.bookingId },
        data: {
          totalFare: previous.totalFare ?? null,
          gstAmount: previous.gstAmount ?? null,
          taxAmount: previous.gstAmount ?? null,
          grandTotal: previous.grandTotal ?? null,
          paymentStatus: previous.paymentStatus ?? PaymentStatus.PENDING,
          paymentMethod: previous.paymentMethod ?? null,
          razorpayOrderId: previous.razorpayOrderId ?? null,
          marketplaceVersion: { increment: 1 },
        },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!reopened) {
      await finalizeSecuredAward(award.bookingId).catch((error) => {
        logger.error('[Marketplace] Secured award finalization retry failed', { awardId: award.id, error });
      });
      continue;
    }
    const event = { bookingId: award.bookingId, bidId: award.bidId, awardId: award.id, closesAt };
    emitToMarketplaceCustomer(award.bookingId, 'bid_award_expired', event);
    emitToMarketplaceBid(award.bidId, 'bid_award_expired', event);
    await notifyUser(award.customerId, 'Payment time expired', 'The load has reopened for bidding. No provider was assigned.', {
      type: 'BID_AWARD_EXPIRED', bookingId: award.bookingId, bidId: award.bidId,
    });
    await notifyUser(award.bid.createdByUserId, 'Selection expired', 'Customer payment was not completed; the load is open again.', {
      type: 'BID_AWARD_EXPIRED', bookingId: award.bookingId, bidId: award.bidId,
    });
  }
}

export async function notifyMarketplaceBookingCancelled(bookingId: string) {
  const bids = await prisma.marketplaceBid.findMany({
    where: { bookingId },
    select: { id: true, createdByUserId: true, status: true },
  });
  emitToMarketplaceCustomer(bookingId, 'bid_window_updated', {
    bookingId,
    status: BidWindowStatus.WITHDRAWN,
  });

  const notifiedUsers = new Set<string>();
  await Promise.allSettled(bids.map(async (bid) => {
    emitToMarketplaceBid(bid.id, 'bid_status_changed', {
      bookingId,
      bidId: bid.id,
      status: 'BOOKING_CANCELLED',
    });
    emitToMarketplaceUser(bid.createdByUserId, 'opportunity_published', {
      bookingId,
      status: 'BOOKING_CANCELLED',
    });
    if (notifiedUsers.has(bid.createdByUserId)) return;
    notifiedUsers.add(bid.createdByUserId);
    await notifyUser(
      bid.createdByUserId,
      'Bid booking cancelled',
      'The customer cancelled this load. The private negotiation is now closed.',
      { type: 'BID_BOOKING_CANCELLED', bookingId, bidId: bid.id },
    );
  }));
}

export async function canSubscribeToBidWindow(bookingId: string, actor: Actor): Promise<boolean> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true } });
  return Boolean(booking && actor.role === UserRole.CUSTOMER && booking.customerId === actor.userId);
}

export async function canSubscribeToBidThread(bidId: string, actor: Actor): Promise<boolean> {
  try {
    await getBidForAccess(bidId, actor);
    return true;
  } catch {
    return false;
  }
}
