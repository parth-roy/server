import { prisma } from '@shared/db/prisma';
/**
 * fleet-owner.service.ts — Business logic for Fleet Owner operations
 *
 * Responsibilities:
 *  1. Register a fleet owner profile
 *  2. Manage fleet trucks (add, update, list)
 *  3. Manage fleet drivers (add, list)
 *  4. Assign a truck+driver to a confirmed booking
 *  5. Fleet dashboard summary
 *  6. Fleet earnings
 *  7. List pending (CONFIRMED) bookings available to dispatch
 */

import {
  BidAwardStatus,
  BookingMode,
  BookingStatus,
  DriverStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { assertTransition } from '@modules/booking/booking.transition';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { notificationService } from '@modules/notifications/notification.service';
import type {
  RegisterFleetOwnerInput,
  AddFleetTruckInput,
  UpdateFleetTruckInput,
  AddFleetDriverInput,
  AssignTruckInput,
  SetTruckDriverInput,
  ListPendingBookingsQuery,
  FleetEarningsQuery,
} from './fleet-owner.schema';


// ─────────────────────────────────────────────
// FLEET OWNER PROFILE
// ─────────────────────────────────────────────

export async function registerFleetOwner(
  userId: string,
  input: RegisterFleetOwnerInput
): Promise<object> {
  const existing = await prisma.fleetOwner.findUnique({ where: { userId } });
  if (existing) {
    throw AppError.conflict(
      'Fleet owner profile already exists for this account',
      'FLEET_OWNER_EXISTS'
    );
  }

  const fleetOwner = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { role: UserRole.FLEET_OWNER, profileComplete: true },
    });
    const fo = await tx.fleetOwner.create({
      data: {
        userId,
        companyName: input.companyName,
        gstin: input.gstin,
        pan: input.pan,
      },
    });
    await tx.fleetWallet.create({ data: { fleetOwnerId: fo.id } });
    return fo;
  });

  logger.info('[FleetOwner] Profile created', { userId, fleetOwnerId: fleetOwner.id });
  return _formatFleetOwner(fleetOwner);
}

export async function getMyFleetOwnerProfile(userId: string): Promise<object> {
  const fleetOwner = await prisma.fleetOwner.findUnique({
    where: { userId },
    include: {
      wallet: true,
      _count: { select: { trucks: true, fleetDrivers: true } },
    },
  });
  if (!fleetOwner) {
    throw AppError.notFound('Fleet owner profile not found. Please register first.');
  }
  return _formatFleetOwner(fleetOwner);
}

// ─────────────────────────────────────────────
// FLEET DASHBOARD
// ─────────────────────────────────────────────

export async function getFleetDashboard(userId: string): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalTrucks,
    activeTrips,
    todayEarnings,
    driversCount,
    recentAssignments,
  ] = await Promise.all([
    prisma.fleetTruck.count({ where: { fleetOwnerId: fleetOwner.id, isActive: true } }),
    prisma.truckAssignment.count({
      where: {
        fleetOwnerId: fleetOwner.id,
        booking: {
          status: { in: [BookingStatus.DRIVER_ASSIGNED, BookingStatus.DRIVER_ARRIVING, BookingStatus.PICKED_UP, BookingStatus.IN_TRANSIT] },
        },
      },
    }),
    prisma.fleetEarning.aggregate({
      where: { fleetOwnerId: fleetOwner.id, createdAt: { gte: today } },
      _sum: { netAmount: true },
    }),
    prisma.fleetDriver.count({ where: { fleetOwnerId: fleetOwner.id, isActive: true } }),
    prisma.truckAssignment.findMany({
      where: { fleetOwnerId: fleetOwner.id },
      orderBy: { assignedAt: 'desc' },
      take: 5,
      include: {
        booking: {
          select: {
            bookingNumber: true,
            status: true,
            pickupAddress: true,
            stops: { select: { address: true }, orderBy: { sequence: 'asc' }, take: 1 },
            totalFare: true,
          },
        },
        fleetDriver: {
          include: {
            driver: { include: { user: { select: { name: true, phone: true } } } },
          },
        },
      },
    }),
  ]);

  return {
    summary: {
      totalTrucks,
      activeTrips,
      todayEarnings: todayEarnings._sum.netAmount ?? 0,
      totalActiveDrivers: driversCount,
    },
    recentActivity: recentAssignments,
  };
}

// ─────────────────────────────────────────────
// FLEET TRUCKS
// ─────────────────────────────────────────────

export async function addFleetTruck(
  userId: string,
  input: AddFleetTruckInput
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  const existing = await prisma.fleetTruck.findUnique({
    where: { registrationNo: input.registrationNo },
  });
  if (existing) {
    throw AppError.conflict(
      `Truck "${input.registrationNo}" is already registered in the system`,
      'TRUCK_REG_NO_TAKEN'
    );
  }

  const truck = await prisma.fleetTruck.create({
    data: {
      fleetOwnerId: fleetOwner.id,
      registrationNo: input.registrationNo,
      type: input.type as any,
      make: input.make,
      model: input.model,
      year: input.year,
      color: input.color,
      capacityKg: input.capacityKg,
      imageUrl: input.imageUrl,
    },
  });

  logger.info('[FleetOwner] Truck added', { fleetOwnerId: fleetOwner.id, truckId: truck.id });
  return truck;
}

export async function listFleetTrucks(userId: string): Promise<object[]> {
  const fleetOwner = await _requireFleetOwner(userId);

  return prisma.fleetTruck.findMany({
    where: { fleetOwnerId: fleetOwner.id },
    include: {
      currentDriver: {
        include: {
          driver: { include: { user: { select: { name: true, phone: true, profileImageUrl: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateFleetTruck(
  userId: string,
  truckId: string,
  input: UpdateFleetTruckInput
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);
  await _requireTruckOwnership(truckId, fleetOwner.id);

  return prisma.fleetTruck.update({
    where: { id: truckId },
    data: {
      ...input,
      insuranceExpiry: input.insuranceExpiry ? new Date(input.insuranceExpiry) : undefined,
      fitnessExpiry: input.fitnessExpiry ? new Date(input.fitnessExpiry) : undefined,
      pucExpiry: input.pucExpiry ? new Date(input.pucExpiry) : undefined,
      permitExpiry: input.permitExpiry ? new Date(input.permitExpiry) : undefined,
    },
  });
}

export async function setCurrentTruckDriver(
  userId: string,
  truckId: string,
  input: SetTruckDriverInput
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);
  await _requireTruckOwnership(truckId, fleetOwner.id);

  if (input.fleetDriverId) {
    const fleetDriver = await prisma.fleetDriver.findFirst({
      where: { id: input.fleetDriverId, fleetOwnerId: fleetOwner.id },
    });
    if (!fleetDriver) {
      throw AppError.notFound('Driver not found in your fleet');
    }
  }

  return prisma.fleetTruck.update({
    where: { id: truckId },
    data: { currentDriverId: input.fleetDriverId },
  });
}

// ─────────────────────────────────────────────
// FLEET DRIVERS
// ─────────────────────────────────────────────

export async function addFleetDriver(
  userId: string,
  input: AddFleetDriverInput
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  // Find user by phone
  const targetUser = await prisma.user.findUnique({
    where: { phone: input.phone },
    include: { driver: true },
  });

  if (!targetUser) {
    throw AppError.notFound(
      'No account found with this phone number. Ask the driver to register in the Driver app first.'
    );
  }

  if (!targetUser.driver) {
    throw AppError.badRequest(
      'This phone number is not a registered driver account',
      'NOT_A_DRIVER'
    );
  }

  const existingMembership = await prisma.fleetDriver.findUnique({
    where: {
      fleetOwnerId_driverId: {
        fleetOwnerId: fleetOwner.id,
        driverId: targetUser.driver.id,
      },
    },
  });

  if (existingMembership) {
    if (existingMembership.isActive) {
      throw AppError.conflict('This driver is already in your fleet', 'DRIVER_ALREADY_IN_FLEET');
    }
    // Reactivate if previously removed
    const reactivated = await prisma.fleetDriver.update({
      where: { id: existingMembership.id },
      data: { isActive: true },
    });
    return reactivated;
  }

  const membership = await prisma.fleetDriver.create({
    data: {
      fleetOwnerId: fleetOwner.id,
      driverId: targetUser.driver.id,
    },
    include: {
      driver: { include: { user: { select: { name: true, phone: true, profileImageUrl: true } } } },
    },
  });

  // Notify driver via FCM
  if (targetUser.fcmToken) {
    await notificationService.sendToDevice(targetUser.fcmToken, {
      title: '🚛 Fleet Invitation',
      body: `${fleetOwner.companyName ?? 'A fleet owner'} has added you to their fleet on Parther.`,
    });
  }

  logger.info('[FleetOwner] Driver added to fleet', {
    fleetOwnerId: fleetOwner.id,
    driverId: targetUser.driver.id,
  });

  return membership;
}

export async function listFleetDrivers(userId: string): Promise<object[]> {
  const fleetOwner = await _requireFleetOwner(userId);

  return prisma.fleetDriver.findMany({
    where: { fleetOwnerId: fleetOwner.id, isActive: true },
    include: {
      driver: {
        include: {
          user: { select: { name: true, phone: true, profileImageUrl: true } },
          vehicle: { select: { type: true, registrationNo: true } },
        },
      },
      currentTrucks: { select: { id: true, registrationNo: true, type: true } },
    },
    orderBy: { joinedAt: 'desc' },
  });
}

export async function removeFleetDriver(
  userId: string,
  fleetDriverId: string
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  const membership = await prisma.fleetDriver.findFirst({
    where: { id: fleetDriverId, fleetOwnerId: fleetOwner.id },
  });
  if (!membership) throw AppError.notFound('Driver not found in your fleet');

  return prisma.fleetDriver.update({
    where: { id: fleetDriverId },
    data: { isActive: false },
  });
}

// ─────────────────────────────────────────────
// PENDING BOOKINGS (for fleet owner to dispatch)
// ─────────────────────────────────────────────

export async function listPendingBookings(
  userId: string,
  query: ListPendingBookingsQuery
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  const { page, limit, vehicleType } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    status: BookingStatus.CONFIRMED,
    truckAssignment: { is: null }, // not yet assigned to any fleet
    OR: [
      { bookingMode: BookingMode.INSTANT },
      {
        bookingMode: BookingMode.PRIVATE_BID,
        awardedFleetOwnerId: fleetOwner.id,
        bidAwards: { some: { status: BidAwardStatus.CONFIRMED, activeKey: { not: null } } },
      },
    ],
    ...(vehicleType && { vehicleType }),
  };

  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'asc' }, // oldest first = most urgent
      skip,
      take: limit,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        bookingMode: true,
        vehicleType: true,
        pickupAddress: true,
        pickupLat: true,
        pickupLng: true,
        stops: {
          select: { address: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
        totalFare: true,
        hasLoadingService: true,
        estimatedDistance: true,
        estimatedDuration: true,
        createdAt: true,
        customer: { select: { name: true } },
        bidAwards: {
          where: { status: BidAwardStatus.CONFIRMED, activeKey: { not: null } },
          select: { revision: { select: { vehicleId: true } } },
          take: 1,
        },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return {
    bookings,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// ─────────────────────────────────────────────
// ASSIGN TRUCK TO BOOKING
// ─────────────────────────────────────────────

export async function assignTruckToBooking(
  userId: string,
  input: AssignTruckInput
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);

  // Validate booking is CONFIRMED and unassigned
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      truckAssignment: true,
      bidAwards: {
        where: { status: BidAwardStatus.CONFIRMED, activeKey: { not: null } },
        select: { id: true, revision: { select: { vehicleId: true } } },
        take: 1,
      },
    },
  });
  if (!booking) throw AppError.notFound('Booking not found');
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw AppError.badRequest(
      `Booking is in ${booking.status} status — only CONFIRMED bookings can be assigned`,
      'BOOKING_NOT_CONFIRMED'
    );
  }
  if (booking.truckAssignment) {
    throw AppError.conflict('This booking has already been assigned to a fleet', 'ALREADY_ASSIGNED');
  }
  if (booking.bookingMode === BookingMode.PRIVATE_BID) {
    if (booking.awardedFleetOwnerId !== fleetOwner.id || booking.bidAwards.length === 0) {
      throw AppError.forbidden('Only the fleet that won and secured this bid may assign it');
    }
    if (booking.bidAwards[0].revision.vehicleId !== input.truckId) {
      throw AppError.badRequest(
        'Assign the exact fleet truck committed in the accepted bid revision',
        'AWARDED_VEHICLE_MISMATCH',
      );
    }
  }

  // Validate truck belongs to this fleet and is not already on an active trip
  const truck = await _requireTruckOwnership(input.truckId, fleetOwner.id);
  if (!truck.isActive || truck.type !== booking.vehicleType) {
    throw AppError.badRequest('Selected truck does not match the awarded booking', 'VEHICLE_MISMATCH');
  }
  const activeTripForTruck = await prisma.truckAssignment.findFirst({
    where: {
      truckId: input.truckId,
      booking: {
        status: {
          in: [
            BookingStatus.DRIVER_ASSIGNED,
            BookingStatus.DRIVER_ARRIVING,
            BookingStatus.PICKED_UP,
            BookingStatus.IN_TRANSIT,
          ],
        },
      },
    },
  });
  if (activeTripForTruck) {
    throw AppError.conflict(
      'This truck is already on an active trip and cannot be reassigned',
      'TRUCK_ALREADY_ON_TRIP'
    );
  }
  const reservedTruckAward = await prisma.bidAward.findFirst({
    where: {
      bookingId: { not: input.bookingId },
      activeKey: { not: null },
      status: {
        in: [
          BidAwardStatus.PAYMENT_PENDING,
          BidAwardStatus.PAYMENT_RECONCILING,
          BidAwardStatus.CONFIRMED,
        ],
      },
      booking: { status: BookingStatus.CONFIRMED },
      revision: { vehicleId: input.truckId },
    },
    select: { id: true },
  });
  if (reservedTruckAward) {
    throw AppError.conflict(
      'This truck is reserved by another accepted private bid',
      'TRUCK_RESERVED_FOR_BID',
    );
  }

  // Validate fleet driver belongs to this fleet
  const fleetDriver = await prisma.fleetDriver.findFirst({
    where: { id: input.fleetDriverId, fleetOwnerId: fleetOwner.id, isActive: true },
    include: {
      driver: { include: { user: true } },
    },
  });
  if (!fleetDriver) throw AppError.notFound('Driver not found in your fleet');
  if (
    !fleetDriver.driver.isActive ||
    !fleetDriver.driver.isDocVerified ||
    fleetDriver.driver.status !== DriverStatus.AVAILABLE
  ) {
    throw AppError.conflict('Selected driver is not currently eligible and available', 'DRIVER_NOT_AVAILABLE');
  }
  assertTransition(booking.status, BookingStatus.DRIVER_ASSIGNED);

  // Execute in a single clean transaction:
  // 1. Create TruckAssignment
  // 2. Update booking → DRIVER_ASSIGNED with fleet driver's Driver record
  // 3. Set truck's current driver
  const { assignment } = await prisma.$transaction(async (tx) => {
    const currentBooking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: {
        truckAssignment: true,
        bidAwards: {
          where: { status: BidAwardStatus.CONFIRMED, activeKey: { not: null } },
          select: { id: true, revision: { select: { vehicleId: true } } },
          take: 1,
        },
      },
    });
    if (
      !currentBooking ||
      currentBooking.status !== BookingStatus.CONFIRMED ||
      currentBooking.driverId !== null ||
      currentBooking.truckAssignment
    ) {
      throw AppError.conflict('Booking changed before fleet assignment', 'BOOKING_STATE_CONFLICT');
    }
    if (
      currentBooking.bookingMode === BookingMode.PRIVATE_BID &&
      (currentBooking.awardedFleetOwnerId !== fleetOwner.id || currentBooking.bidAwards.length === 0)
    ) {
      throw AppError.forbidden('Only the fleet that won and secured this bid may assign it');
    }
    if (
      currentBooking.bookingMode === BookingMode.PRIVATE_BID &&
      currentBooking.bidAwards[0].revision.vehicleId !== input.truckId
    ) {
      throw AppError.badRequest(
        'Assign the exact fleet truck committed in the accepted bid revision',
        'AWARDED_VEHICLE_MISMATCH',
      );
    }

    const [currentTruck, currentFleetDriver, busyTruck, busyDriverBooking, reservedAward] = await Promise.all([
      tx.fleetTruck.findFirst({
        where: {
          id: input.truckId,
          fleetOwnerId: fleetOwner.id,
          isActive: true,
          type: currentBooking.vehicleType,
        },
      }),
      tx.fleetDriver.findFirst({
        where: { id: input.fleetDriverId, fleetOwnerId: fleetOwner.id, isActive: true },
        include: { driver: true },
      }),
      tx.truckAssignment.findFirst({
        where: {
          truckId: input.truckId,
          booking: {
            status: {
              in: [
                BookingStatus.DRIVER_ASSIGNED,
                BookingStatus.DRIVER_ARRIVING,
                BookingStatus.PICKED_UP,
                BookingStatus.IN_TRANSIT,
              ],
            },
          },
        },
        select: { id: true },
      }),
      tx.booking.findFirst({
        where: {
          driverId: fleetDriver.driverId,
          status: {
            in: [
              BookingStatus.DRIVER_ASSIGNED,
              BookingStatus.DRIVER_ARRIVING,
              BookingStatus.PICKED_UP,
              BookingStatus.IN_TRANSIT,
            ],
          },
        },
        select: { id: true },
      }),
      tx.bidAward.findFirst({
        where: {
          bookingId: { not: input.bookingId },
          activeKey: { not: null },
          status: {
            in: [
              BidAwardStatus.PAYMENT_PENDING,
              BidAwardStatus.PAYMENT_RECONCILING,
              BidAwardStatus.CONFIRMED,
            ],
          },
          booking: { status: BookingStatus.CONFIRMED },
          revision: { vehicleId: input.truckId },
        },
        select: { id: true },
      }),
    ]);
    if (!currentTruck || busyTruck || reservedAward) {
      throw AppError.conflict('Selected truck is no longer available', 'TRUCK_ALREADY_ON_TRIP');
    }
    if (
      !currentFleetDriver ||
      !currentFleetDriver.driver.isActive ||
      !currentFleetDriver.driver.isDocVerified ||
      currentFleetDriver.driver.status !== DriverStatus.AVAILABLE ||
      busyDriverBooking
    ) {
      throw AppError.conflict('Selected driver is no longer available', 'DRIVER_NOT_AVAILABLE');
    }

    const reservedDriver = await tx.driver.updateMany({
      where: {
        id: currentFleetDriver.driverId,
        isActive: true,
        isDocVerified: true,
        status: DriverStatus.AVAILABLE,
      },
      data: { status: DriverStatus.ON_TRIP },
    });
    if (reservedDriver.count !== 1) {
      throw AppError.conflict('Selected driver is no longer available', 'DRIVER_NOT_AVAILABLE');
    }

    const assignment = await tx.truckAssignment.create({
      data: {
        bookingId: input.bookingId,
        fleetOwnerId: fleetOwner.id,
        truckId: input.truckId,
        fleetDriverId: input.fleetDriverId,
      },
    });

    const assigned = await tx.booking.updateMany({
      where: {
        id: input.bookingId,
        status: BookingStatus.CONFIRMED,
        driverId: null,
        awardedFleetOwnerId: currentBooking.awardedFleetOwnerId,
      },
      data: {
        status: BookingStatus.DRIVER_ASSIGNED,
        driverId: currentFleetDriver.driverId,
      },
    });
    if (assigned.count !== 1) {
      throw AppError.conflict('Booking changed before fleet assignment', 'BOOKING_STATE_CONFLICT');
    }

    await tx.fleetTruck.update({
      where: { id: input.truckId },
      data: { currentDriverId: input.fleetDriverId },
    });

    // Create FleetTruckUsage inside the same transaction so it's atomic
    await tx.fleetTruckUsage.create({
      data: {
        truckId: input.truckId,
        assignmentId: assignment.id,
      },
    });

    return { assignment };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Notify the driver via FCM (outside transaction — non-blocking)
  if (fleetDriver.driver.user.fcmToken) {
    notificationService.sendToDevice(fleetDriver.driver.user.fcmToken, {
      title: '📦 New Trip Assigned',
      body: `You have been assigned a new delivery. Check your Parther app for details.`,
      data: { bookingId: input.bookingId, type: 'BOOKING_ASSIGNED' },
    }).catch((err) => logger.error('[FleetOwner] FCM notification failed', err));
  }

  logger.info('[FleetOwner] Truck assigned to booking', {
    fleetOwnerId: fleetOwner.id,
    bookingId: input.bookingId,
    truckId: input.truckId,
    fleetDriverId: input.fleetDriverId,
  });

  return { success: true, assignmentId: assignment.id, bookingId: input.bookingId };
}

// ─────────────────────────────────────────────
// FLEET EARNINGS
// ─────────────────────────────────────────────

export async function getFleetEarnings(
  userId: string,
  query: FleetEarningsQuery
): Promise<object> {
  const fleetOwner = await _requireFleetOwner(userId);
  const { page, limit, from, to } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    fleetOwnerId: fleetOwner.id,
    ...(from && { createdAt: { gte: new Date(from) } }),
    ...(to && { createdAt: { lte: new Date(to) } }),
  };

  const [earnings, total, summary] = await prisma.$transaction([
    prisma.fleetEarning.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        booking: {
          select: { bookingNumber: true, pickupAddress: true, stops: { take: 1, orderBy: { sequence: 'asc' } } },
        },
      },
    }),
    prisma.fleetEarning.count({ where }),
    prisma.fleetEarning.aggregate({
      where,
      _sum: { grossAmount: true, driverPayout: true, netAmount: true },
    }),
  ]);

  return {
    earnings,
    summary: {
      grossTotal: summary._sum.grossAmount ?? 0,
      driverPayouts: summary._sum.driverPayout ?? 0,
      netTotal: summary._sum.netAmount ?? 0,
    },
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// ─────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────

async function _requireFleetOwner(userId: string) {
  const fleetOwner = await prisma.fleetOwner.findUnique({ where: { userId } });
  if (!fleetOwner) {
    throw AppError.notFound(
      'Fleet owner profile not found. Please complete registration first.'
    );
  }
  return fleetOwner;
}

async function _requireTruckOwnership(truckId: string, fleetOwnerId: string) {
  const truck = await prisma.fleetTruck.findFirst({
    where: { id: truckId, fleetOwnerId },
  });
  if (!truck) throw AppError.forbidden('Truck not found or does not belong to your fleet');
  return truck;
}

function _formatFleetOwner(fo: any) {
  return fo;
}

// ─────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────

export async function listMaintenance(userId: string, truckId?: string) {
  const fo = await _requireFleetOwner(userId);
  return prisma.fleetMaintenance.findMany({
    where: { fleetOwnerId: fo.id, ...(truckId ? { truckId } : {}) },
    include: { truck: { select: { registrationNo: true, type: true } } },
    orderBy: { servicedAt: 'desc' },
  });
}

export async function addMaintenance(userId: string, input: any) {
  const fo = await _requireFleetOwner(userId);
  await _requireTruckOwnership(input.truckId, fo.id);
  if (!input.servicedAt || isNaN(Date.parse(input.servicedAt))) {
    throw AppError.badRequest('Invalid or missing servicedAt — use ISO 8601 format', 'INVALID_DATE');
  }
  return prisma.fleetMaintenance.create({
    data: {
      fleetOwnerId: fo.id,
      truckId: input.truckId,
      serviceType: input.serviceType,
      description: input.notes ?? null,
      costRupees: input.cost ?? 0,
      servicedAt: new Date(input.servicedAt),
      nextDueDate: input.nextDueDate ? new Date(input.nextDueDate) : null,
      workshop: input.workshop ?? null,
    },
  });
}

export async function updateMaintenance(userId: string, id: string, input: any) {
  const fo = await _requireFleetOwner(userId);
  const record = await prisma.fleetMaintenance.findFirst({ where: { id, fleetOwnerId: fo.id } });
  if (!record) throw AppError.notFound('Maintenance record not found');
  return prisma.fleetMaintenance.update({
    where: { id },
    data: {
      ...(input.serviceType !== undefined && { serviceType: input.serviceType }),
      ...(input.cost !== undefined && { costRupees: input.cost }),
      ...(input.notes !== undefined && { description: input.notes }),
      ...(input.servicedAt !== undefined && { servicedAt: new Date(input.servicedAt) }),
      ...(input.nextDueDate !== undefined && { nextDueDate: new Date(input.nextDueDate) }),
    },
  });
}

export async function deleteMaintenance(userId: string, maintenanceId: string) {
  const fo = await _requireFleetOwner(userId);
  const record = await prisma.fleetMaintenance.findFirst({ where: { id: maintenanceId, fleetOwnerId: fo.id } });
  if (!record) throw AppError.notFound('Maintenance record not found');
  await prisma.fleetMaintenance.delete({ where: { id: maintenanceId } });
  return { success: true };
}

// ─────────────────────────────────────────────
// FUEL LOGS
// ─────────────────────────────────────────────

export async function listFuelLogs(userId: string, truckId?: string) {
  const fo = await _requireFleetOwner(userId);
  return prisma.fleetFuelLog.findMany({
    where: { fleetOwnerId: fo.id, ...(truckId ? { truckId } : {}) },
    include: { truck: { select: { registrationNo: true, type: true } } },
    orderBy: { filledAt: 'desc' },
  });
}

export async function addFuelLog(userId: string, input: any) {
  const fo = await _requireFleetOwner(userId);
  await _requireTruckOwnership(input.truckId, fo.id);
  if (typeof input.litresFilled !== 'number' || typeof input.pricePerLitre !== 'number') {
    throw AppError.badRequest(
      'litresFilled and pricePerLitre must be valid numbers',
      'INVALID_FUEL_INPUT'
    );
  }
  return prisma.fleetFuelLog.create({
    data: {
      fleetOwnerId: fo.id,
      truckId: input.truckId,
      litresFilled: input.litresFilled,
      pricePerLitre: input.pricePerLitre,
      totalCost: parseFloat((input.litresFilled * input.pricePerLitre).toFixed(2)),
      odometerKm: input.odometerKm ?? null,
      filledAt: new Date(input.filledAt),
      fuelStation: input.fuelStation ?? null,
    },
  });
}

export async function deleteFuelLog(userId: string, id: string) {
  const fo = await _requireFleetOwner(userId);
  const record = await prisma.fleetFuelLog.findFirst({ where: { id, fleetOwnerId: fo.id } });
  if (!record) throw AppError.notFound('Fuel log not found');
  await prisma.fleetFuelLog.delete({ where: { id } });
  return { success: true };
}

// ─────────────────────────────────────────────
// TRUCK DOCUMENTS
// ─────────────────────────────────────────────

export async function listTruckDocuments(userId: string, truckId: string) {
  const fo = await _requireFleetOwner(userId);
  await _requireTruckOwnership(truckId, fo.id);
  return prisma.fleetTruckDocument.findMany({
    where: { truckId },
    orderBy: { uploadedAt: 'desc' },
  });
}

export async function addTruckDocument(userId: string, truckId: string, input: any) {
  const fo = await _requireFleetOwner(userId);
  await _requireTruckOwnership(truckId, fo.id);
  return prisma.fleetTruckDocument.create({
    data: {
      truckId,
      docType: input.docType,
      fileUrl: input.fileUrl,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
    },
  });
}

// ─────────────────────────────────────────────
// PER-DRIVER EARNINGS
// ─────────────────────────────────────────────

export async function perDriverEarnings(userId: string) {
  const fo = await _requireFleetOwner(userId);
  const drivers = await prisma.fleetDriver.findMany({
    where: { fleetOwnerId: fo.id },
    include: {
      driver: {
        select: {
          id: true,
          user: { select: { name: true, phone: true, profileImageUrl: true } },
          rating: true,
        },
      },
    },
  });

  const driverIds = drivers.map((fd) => fd.id);
  const driverRecordIds = drivers.map((fd) => fd.driver.id);

  // Fetch all trip counts in a single groupBy query (eliminates N+1)
  const tripCounts = await prisma.truckAssignment.groupBy({
    by: ['fleetDriverId'],
    where: { fleetDriverId: { in: driverIds } },
    _count: { id: true },
  });
  const tripCountMap = new Map(tripCounts.map((t) => [t.fleetDriverId, t._count.id]));

  // Fetch all earnings aggregates in a single groupBy query (eliminates N+1)
  // Group by the booking's driverId via a raw join isn't possible in groupBy,
  // so we aggregate per fleetOwner+driverId combination using findMany + reduce
  const earningsRaw = await prisma.fleetEarning.findMany({
    where: {
      fleetOwnerId: fo.id,
      booking: { driverId: { in: driverRecordIds } },
    },
    select: {
      driverPayout: true,
      grossAmount: true,
      booking: { select: { driverId: true } },
    },
  });

  // Build a map: driverRecordId -> { totalPayout, totalRevenue, completedBookings }
  const earningsMap = new Map<string, { totalPayout: number; totalRevenue: number; completedBookings: number }>();
  for (const e of earningsRaw) {
    const dId = e.booking.driverId!;
    const existing = earningsMap.get(dId) ?? { totalPayout: 0, totalRevenue: 0, completedBookings: 0 };
    earningsMap.set(dId, {
      totalPayout: existing.totalPayout + (e.driverPayout ?? 0),
      totalRevenue: existing.totalRevenue + (e.grossAmount ?? 0),
      completedBookings: existing.completedBookings + 1,
    });
  }

  const result = drivers.map((fd) => {
    const earning = earningsMap.get(fd.driver.id) ?? { totalPayout: 0, totalRevenue: 0, completedBookings: 0 };
    return {
      fleetDriverId: fd.id,
      driver: fd.driver,
      totalTrips: tripCountMap.get(fd.id) ?? 0,
      totalPayout: earning.totalPayout,
      totalRevenue: earning.totalRevenue,
      completedBookings: earning.completedBookings,
    };
  });
  return result;
}

// ─────────────────────────────────────────────
// ACTIVE BOOKINGS
// ─────────────────────────────────────────────

export async function listActiveBookings(userId: string) {
  const owner = await _requireFleetOwner(userId);
  return prisma.booking.findMany({
    where: {
      fleetOwnerId: owner.id,
      status: { in: ['DRIVER_ASSIGNED', 'OUT_FOR_DELIVERY', 'IN_TRANSIT'] as any[] },
    },
    include: {
      pickupLocation: true,
      stops: { orderBy: { sequence: 'asc' } },
      truckAssignment: {
        include: {
          truck: {
            select: {
              registrationNo: true,
              make: true,
              model: true,
              currentLat: true,
              currentLng: true,
            },
          },
          fleetDriver: {
            include: {
              driver: { include: { user: { select: { name: true, phone: true } } } },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

// ─────────────────────────────────────────────
// DELETE FLEET TRUCK
// ─────────────────────────────────────────────

export async function deleteFleetTruck(userId: string, truckId: string) {
  const fo = await _requireFleetOwner(userId);
  await _requireTruckOwnership(truckId, fo.id);
  // Guard: ensure no active assignments before deletion
  const activeAssignment = await prisma.truckAssignment.findFirst({
    where: {
      truckId,
      booking: {
        status: {
          in: [
            BookingStatus.DRIVER_ASSIGNED,
            BookingStatus.DRIVER_ARRIVING,
            BookingStatus.PICKED_UP,
            BookingStatus.IN_TRANSIT,
          ],
        },
      },
    },
  });
  if (activeAssignment) {
    throw AppError.conflict(
      'Cannot delete a truck that is currently on an active trip',
      'TRUCK_ON_ACTIVE_TRIP'
    );
  }
  await prisma.fleetTruck.delete({ where: { id: truckId } });
  return { success: true };
}

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────

export async function getFleetAnalytics(userId: string) {
  const fo = await _requireFleetOwner(userId);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);

  const [
    totalTrucks, activeTrucks, totalDrivers,
    monthEarnings, weekEarnings,
    totalBookings, completedBookings, cancelledBookings,
    totalFuelCost, totalMaintenanceCost,
  ] = await Promise.all([
    prisma.fleetTruck.count({ where: { fleetOwnerId: fo.id } }),
    prisma.fleetTruck.count({ where: { fleetOwnerId: fo.id, isActive: true } }),
    prisma.fleetDriver.count({ where: { fleetOwnerId: fo.id, isActive: true } }),
    prisma.fleetEarning.aggregate({
      where: { fleetOwnerId: fo.id, createdAt: { gte: startOfMonth } },
      _sum: { netAmount: true, grossAmount: true },
    }),
    prisma.fleetEarning.aggregate({
      where: { fleetOwnerId: fo.id, createdAt: { gte: startOfWeek } },
      _sum: { netAmount: true },
    }),
    prisma.truckAssignment.count({ where: { fleetOwnerId: fo.id } }),
    prisma.booking.count({ where: { truckAssignment: { fleetOwnerId: fo.id }, status: 'COMPLETED' } }),
    prisma.booking.count({ where: { truckAssignment: { fleetOwnerId: fo.id }, status: 'CANCELLED' } }),
    prisma.fleetFuelLog.aggregate({
      where: { fleetOwnerId: fo.id, filledAt: { gte: startOfMonth } },
      _sum: { totalCost: true },
    }),
    prisma.fleetMaintenance.aggregate({
      where: { fleetOwnerId: fo.id, servicedAt: { gte: startOfMonth } },
      _sum: { costRupees: true },
    }),
  ]);

  return {
    fleet: { totalTrucks, activeTrucks, totalDrivers },
    earnings: {
      thisMonth: monthEarnings._sum.netAmount ?? 0,
      thisMonthGross: monthEarnings._sum.grossAmount ?? 0,
      thisWeek: weekEarnings._sum.netAmount ?? 0,
    },
    trips: {
      total: totalBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      completionRate: totalBookings > 0
        ? Math.round((completedBookings / totalBookings) * 100)
        : 0,
    },
    costs: {
      fuelThisMonth: totalFuelCost._sum.totalCost ?? 0,
      maintenanceThisMonth: totalMaintenanceCost._sum.costRupees ?? 0,
    },
  };
}
