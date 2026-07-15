import { prisma } from '@shared/db/prisma';
import { eventBus } from '@shared/eventbus';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { sendPasswordResetEmail } from '@shared/services/email.service';
import { notificationService } from '@modules/notifications/notification.service';
import { UserRole, BookingStatus, WalletTransactionReason, WalletTransactionType, DocumentStatus, SupportTicketStatus } from '@prisma/client';
import type {
  LoginInput, ForgotPasswordInput, ResetPasswordInput, RefreshInput,
  BookingsQuery, UsersQuery, DriversQuery, FleetQuery, FinanceQuery,
  TicketsQuery, AssignDriverInput, CancelBookingInput, RefundInput,
  WalletCreditInput, DocStatusInput, DocVerifiedInput, PricingUpdateInput,
  AnnouncementInput, BroadcastInput, SubscriptionUpdate, UlipLogsQuery,
} from './admin.schema';
import { cancelBookingBySystem, assertTransition } from '../booking/booking.service';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function issueTokenPair(userId: string, phone: string, role: UserRole) {
  const accessToken = jwt.sign(
    { userId, phone, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as any }
  );
  const refreshToken = randomUUID();
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId: string, token: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30-day refresh token
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

export async function loginAdmin(input: LoginInput) {
  const admin = await prisma.user.findFirst({
    where: { email: input.email.toLowerCase(), role: UserRole.ADMIN, isActive: true },
  });

  if (!admin || !admin.passwordHash) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const passwordValid = await argon2.verify(admin.passwordHash, input.password);
  if (!passwordValid) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const { accessToken, refreshToken } = issueTokenPair(admin.id, admin.phone ?? admin.email!, UserRole.ADMIN);
  await storeRefreshToken(admin.id, refreshToken);

  logger.info(`[Admin] Login: ${admin.email}`);

  return {
    accessToken,
    refreshToken,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  };
}

export async function refreshAdminToken(input: RefreshInput) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: input.refreshToken },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date() || stored.user.role !== UserRole.ADMIN) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  // Delete old token (rotating refresh)
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const { accessToken, refreshToken } = issueTokenPair(
    stored.user.id, stored.user.phone ?? stored.user.email!, UserRole.ADMIN
  );
  await storeRefreshToken(stored.user.id, refreshToken);

  return { accessToken, refreshToken };
}

export async function logoutAdmin(refreshToken: string) {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
}

export async function getAdminProfile(userId: string) {
  const admin = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, role: true, profileImageUrl: true, createdAt: true },
  });
  if (!admin) throw AppError.notFound('Admin not found');
  return admin;
}

export async function forgotPassword(input: ForgotPasswordInput) {
  const admin = await prisma.user.findFirst({
    where: { email: input.email.toLowerCase(), role: UserRole.ADMIN, isActive: true },
  });

  // Always respond with success to prevent email enumeration
  if (!admin) {
    logger.warn(`[Admin] Forgot password: no ADMIN with email ${input.email}`);
    return;
  }

  const resetToken = randomUUID();
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordResetToken: resetToken, passwordResetExpiry: resetExpiry },
  });

  await sendPasswordResetEmail(admin.email!, admin.name ?? 'Admin', resetToken);
  logger.info(`[Admin] Password reset email sent to ${admin.email}`);
}

export async function resetPassword(input: ResetPasswordInput) {
  const admin = await prisma.user.findFirst({
    where: {
      passwordResetToken: input.token,
      passwordResetExpiry: { gt: new Date() },
      role: UserRole.ADMIN,
    },
  });

  if (!admin) {
    throw AppError.badRequest('Invalid or expired reset token. Please request a new password reset.', 'INVALID_RESET_TOKEN');
  }

  const passwordHash = await argon2.hash(input.newPassword);

  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash, passwordResetToken: null, passwordResetExpiry: null },
  });

  // Revoke all active sessions after password change
  await prisma.refreshToken.deleteMany({ where: { userId: admin.id } });

  logger.info(`[Admin] Password reset successful for ${admin.email}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    activeBookings, driversOnline, pendingAssignment, openTickets,
    todayRevenue, todayBookings, newUsers, driverApplications,
  ] = await Promise.all([
    prisma.booking.count({ where: { status: { in: ['CONFIRMED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT'] } } }),
    prisma.driver.count({ where: { status: { in: ['AVAILABLE', 'ON_TRIP'] } } }),
    prisma.booking.count({ where: { status: 'CONFIRMED', driverId: null } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.booking.aggregate({ where: { status: 'COMPLETED', updatedAt: { gte: today } }, _sum: { totalFare: true } }),
    prisma.booking.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: today }, role: 'CUSTOMER' } }),
    prisma.driver.count({ where: { createdAt: { gte: today }, isDocVerified: false } }),
  ]);

  return {
    activeBookings,
    driversOnline,
    pendingAssignment,
    openTickets,
    todayRevenue: todayRevenue._sum.totalFare ?? 0,
    todayBookings,
    newUsers,
    driverApplications,
  };
}

export async function getRevenueTrend(days = 30) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const bookings = await prisma.booking.findMany({
    where: { status: 'COMPLETED', updatedAt: { gte: from } },
    select: { totalFare: true, updatedAt: true },
  });

  // Group by day
  const map = new Map<string, { revenue: number; count: number }>();
  bookings.forEach(b => {
    const day = b.updatedAt.toISOString().slice(0, 10);
    const cur = map.get(day) ?? { revenue: 0, count: 0 };
    map.set(day, { revenue: cur.revenue + (b.totalFare ?? 0), count: cur.count + 1 });
  });

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    const data = map.get(day) ?? { revenue: 0, count: 0 };
    result.push({ day, revenue: data.revenue, bookings: data.count });
  }
  return result;
}

export async function getDashboardAlerts() {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [ulipManualReview, docsPending, fleetDocsExpiring, paymentFailures, subscriptionsExpiring] = await Promise.all([
    prisma.driver.count({ where: { OR: [{ dlVerifStatus: 'MANUAL_REVIEW' }, { vehicle: { rcVerifStatus: 'MANUAL_REVIEW' } }] } }),
    prisma.driverDocument.count({ where: { status: 'PENDING' } }),
    prisma.fleetTruck.count({ where: { OR: [
      { insuranceExpiry: { lte: thirtyDaysFromNow, gte: new Date() } },
      { fitnessExpiry:   { lte: thirtyDaysFromNow, gte: new Date() } },
      { pucExpiry:       { lte: thirtyDaysFromNow, gte: new Date() } },
      { permitExpiry:    { lte: thirtyDaysFromNow, gte: new Date() } },
    ]}}),
    prisma.booking.count({ where: { paymentStatus: 'FAILED' } }),
    prisma.driverSubscription.count({ where: { isActive: true, endDate: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } } }),
  ]);

  return { ulipManualReview, docsPending, fleetDocsExpiring, paymentFailures, subscriptionsExpiring };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getBookings(q: BookingsQuery) {
  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.vehicleType) where.vehicleType = q.vehicleType;
  if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
  if (q.unassigned) where.driverId = null;
  if (q.search) {
    where.OR = [
      { bookingNumber: { contains: q.search, mode: 'insensitive' } },
      { customer: { phone: { contains: q.search } } },
    ];
  }
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to) where.createdAt.lte = new Date(q.to);
  }

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: bookings };
}

export async function getBookingById(id: string) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      driver: { include: { user: { select: { name: true, phone: true } } } },
      stops: { orderBy: { sequence: 'asc' } },
      locationHistory: { orderBy: { recordedAt: 'desc' }, take: 100 },
      earning: true,
      fleetEarning: true,
    },
  });
  if (!booking) throw AppError.notFound('Booking not found');

  const pricingLog = await prisma.pricingAuditLog.findFirst({
    where: { bookingId: booking.id },
    orderBy: { calculatedAt: 'desc' }
  });

  return {
    ...booking,
    pricingAuditLog: pricingLog ? [pricingLog] : []
  };
}

export async function adminAssignDriver(bookingId: string, input: AssignDriverInput) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw AppError.notFound('Booking not found');
  if (booking.status !== 'CONFIRMED') throw AppError.badRequest('Can only assign driver to CONFIRMED bookings');

  const driver = await prisma.driver.findUnique({ where: { id: input.driverId }, include: { user: true } });
  if (!driver) throw AppError.notFound('Driver not found');
  if (driver.status !== 'AVAILABLE') throw AppError.badRequest('Driver is not available');

  assertTransition(booking.status, BookingStatus.DRIVER_ASSIGNED);

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { driverId: input.driverId, status: 'DRIVER_ASSIGNED' },
  });

  // Notify driver via FCM
  if (driver.user.fcmToken) {
    await notificationService.sendToDevice(driver.user.fcmToken, {
      title: 'New Booking Assigned',
      body: `Booking ${booking.bookingNumber} has been assigned to you by admin.`,
      data: { bookingId, type: 'BOOKING_ASSIGNED' },
    });
  }

  return updated;
}

export async function adminCancelBooking(bookingId: string, input: CancelBookingInput) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw AppError.notFound('Booking not found');
  if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
    throw AppError.badRequest('Cannot cancel a completed or already cancelled booking');
  }

  // Delegate to the booking service to ensure state machine rules and event bus notifications fire
  const updated = await cancelBookingBySystem(bookingId, input.reason, 'ADMIN');
  if (!updated) throw AppError.internal('Failed to cancel booking');
  return updated;
}

export async function adminRefundBooking(bookingId: string, input: RefundInput) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true },
  });
  if (!booking) throw AppError.notFound('Booking not found');
  if (booking.paymentStatus !== 'PAID') throw AppError.badRequest('Booking has not been paid');

  const wallet = await prisma.wallet.findUnique({ where: { userId: booking.customerId } });
  if (!wallet) throw AppError.badRequest('Customer wallet not found');

  const newBalance = wallet.cachedBalance + input.amount;

  await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.CREDIT,
        reason: WalletTransactionReason.REFUND,
        amount: input.amount,
        balanceAfter: newBalance,
        referenceId: bookingId,
        note: input.note,
      },
    }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { cachedBalance: newBalance } }),
    prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: 'REFUNDED' } }),
  ]);

  return { success: true, refunded: input.amount, newBalance };
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────

export async function getUsers(q: UsersQuery) {
  const where: any = {};
  if (q.role) where.role = q.role;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { phone: { contains: q.search } },
      { email: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        wallet: { select: { cachedBalance: true } },
        coinBalance: { select: { cachedBalance: true } },
        _count: { select: { bookings: true } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: users };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      coinBalance: true,
      addresses: true,
      gstDetails: true,
      driver: {
        include: {
          vehicle: true,
          documents: true,
          subscription: true,
        },
      },
      fleetOwner: {
        include: {
          trucks: { take: 10 },
          wallet: true,
        },
      },
      supportTickets: { take: 5, orderBy: { createdAt: 'desc' } },
      bookings: { take: 5, orderBy: { createdAt: 'desc' } },
      teamMembers: true,
    },
  });
  if (!user) throw AppError.notFound('User not found');
  return user;
}

export async function toggleUserStatus(userId: string, isActive: boolean) {
  const user = await prisma.user.update({ where: { id: userId }, data: { isActive } });
  if (!isActive) {
    await forceLogoutAllSessions(userId);
  }
  return user;
}

export async function forceLogoutAllSessions(userId: string) {
  const result = await prisma.refreshToken.deleteMany({ where: { userId } });
  return { revokedSessions: result.count };
}

export async function adminWalletCredit(userId: string, input: WalletCreditInput) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { userId, cachedBalance: 0 } });
  }

  const newBalance = wallet.cachedBalance + input.amount;

  await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.CREDIT,
        reason: WalletTransactionReason.ADMIN_CREDIT,
        amount: input.amount,
        balanceAfter: newBalance,
        note: input.note,
      },
    }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { cachedBalance: newBalance } }),
  ]);

  return { success: true, credited: input.amount, newBalance };
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVERS & VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export async function getDrivers(q: DriversQuery) {
  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.dlVerifStatus) where.dlVerifStatus = q.dlVerifStatus;
  if (q.rcVerifStatus) where.vehicle = { rcVerifStatus: q.rcVerifStatus };
  if (q.plan) where.subscription = { plan: q.plan };
  if (q.isDocVerified !== undefined) where.isDocVerified = q.isDocVerified;
  if (q.search) {
    where.OR = [
      { user: { name: { contains: q.search, mode: 'insensitive' } } },
      { user: { phone: { contains: q.search } } },
      { licenseNumber: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  const [total, rawDrivers] = await Promise.all([
    prisma.driver.count({ where }),
    prisma.driver.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true, isActive: true } },
        vehicle: { select: { id: true, registrationNo: true, type: true, rcVerifStatus: true } },
        subscription: { select: { plan: true, endDate: true, isActive: true } },
        documents: { select: { id: true, type: true, status: true } },
      },
    }),
  ]);

  const drivers = rawDrivers.map(d => {
    let complianceScore = 0;
    if (d.dlVerifStatus === 'VERIFIED') complianceScore += 30;
    if (d.isDocVerified) complianceScore += 40;
    if (d.user?.isActive) complianceScore += 10;
    if (d.vehicle?.rcVerifStatus === 'VERIFIED') complianceScore += 20;
    return { ...d, complianceScore };
  });

  return { total, page: q.page, limit: q.limit, data: drivers };
}

export async function getDriverById(id: string) {
  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      user: { include: { wallet: true, coinBalance: true } },
      vehicle: true,
      documents: { orderBy: { createdAt: 'desc' } },
      subscription: true,
      earnings: { take: 20, orderBy: { createdAt: 'desc' } },
      verificationLogs: { orderBy: { calledAt: 'desc' }, take: 10 },
    },
  });
  if (!driver) throw AppError.notFound('Driver not found');
  return driver;
}

export async function updateDocumentStatus(driverId: string, docId: string, input: DocStatusInput) {
  const doc = await prisma.driverDocument.findFirst({ where: { id: docId, driverId } });
  if (!doc) throw AppError.notFound('Document not found');

  return prisma.driverDocument.update({
    where: { id: docId },
    data: {
      status: input.status as DocumentStatus,
      rejectedReason: input.rejectedReason ?? null,
      verifiedAt: input.status === 'VERIFIED' ? new Date() : null,
    },
  });
}

export async function setDriverDocVerified(driverId: string, input: DocVerifiedInput) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
  if (!driver) throw AppError.notFound('Driver not found');

  await prisma.$transaction([
    prisma.driver.update({ 
      where: { id: driverId }, 
      data: { 
        isDocVerified: input.isDocVerified,
        status: input.isDocVerified ? undefined : 'OFFLINE'
      } 
    }),
    ...(input.isDocVerified ? [
      prisma.user.update({
        where: { id: driver.userId },
        data: { profileComplete: true }
      })
    ] : [])
  ]);

  if (input.isDocVerified && driver.user.fcmToken) {
    await notificationService.sendToDevice(driver.user.fcmToken, {
      title: '🎉 Account Verified!',
      body: 'Your documents have been verified. You can now go online and accept bookings.',
      data: { type: 'ACCOUNT_VERIFIED' },
    });
  }

  return { success: true, driverId, isDocVerified: input.isDocVerified };
}

export async function getDriverVerificationLogs(driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw AppError.notFound('Driver not found');

  return prisma.verificationLog.findMany({
    where: { entityType: 'driver', entityId: driverId },
    orderBy: { calledAt: 'desc' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEET OWNERS & TRUCKS
// ─────────────────────────────────────────────────────────────────────────────

export async function getFleetOwners(q: FleetQuery) {
  const where: any = {};
  if (q.isVerified !== undefined) where.isVerified = q.isVerified;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.search) {
    where.OR = [
      { companyName: { contains: q.search, mode: 'insensitive' } },
      { user: { name: { contains: q.search, mode: 'insensitive' } } },
      { user: { phone: { contains: q.search } } },
    ];
  }

  const [total, rawOwners] = await Promise.all([
    prisma.fleetOwner.count({ where }),
    prisma.fleetOwner.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true, isActive: true } },
        wallet: { select: { cachedBalance: true } },
        _count: { select: { trucks: true, fleetDrivers: true } },
        trucks: {
          select: { rcVerifStatus: true, insuranceExpiry: true, pucExpiry: true, fitnessExpiry: true, permitExpiry: true }
        }
      },
    }),
  ]);

  const owners = rawOwners.map((o: any) => {
    let complianceScore = 0;
    if (o.isVerified) complianceScore += 20;
    if (o.user?.isActive) complianceScore += 10;
    
    let fleetScore = 30; // base score if no trucks
    if (o.trucks && o.trucks.length > 0) {
      const totalTruckScore = o.trucks.reduce((acc: number, t: any) => {
        let ts = 0;
        if (t.rcVerifStatus === 'VERIFIED') ts += 20;
        const now = Date.now();
        if (t.insuranceExpiry && new Date(t.insuranceExpiry).getTime() > now) ts += 12.5;
        if (t.pucExpiry && new Date(t.pucExpiry).getTime() > now) ts += 12.5;
        if (t.fitnessExpiry && new Date(t.fitnessExpiry).getTime() > now) ts += 12.5;
        if (t.permitExpiry && new Date(t.permitExpiry).getTime() > now) ts += 12.5;
        return acc + ts;
      }, 0);
      fleetScore = totalTruckScore / o.trucks.length;
    }
    complianceScore += fleetScore;
    
    // Remove trucks from output to keep payload light
    const { trucks, ...ownerWithoutTrucks } = o;
    return { ...ownerWithoutTrucks, complianceScore: Math.round(complianceScore) };
  });

  return { total, page: q.page, limit: q.limit, data: owners };
}

export async function getFleetOwnerById(id: string) {
  const owner = await prisma.fleetOwner.findUnique({
    where: { id },
    include: {
      user: true,
      trucks: { include: { documents: true } },
      fleetDrivers: { include: { driver: { include: { user: { select: { name: true, phone: true } } } } } },
      wallet: { include: { transactions: { take: 10, orderBy: { createdAt: 'desc' } } } },
      earnings: { take: 20, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!owner) throw AppError.notFound('Fleet owner not found');
  return owner;
}

export async function toggleFleetOwnerStatus(id: string, data: { isVerified?: boolean; isActive?: boolean }) {
  const fleetOwner = await prisma.fleetOwner.update({ where: { id }, data });
  
  if (data.isActive === false) {
    // If the fleet owner is deactivated, forcefully revoke all active sessions immediately
    await forceLogoutAllSessions(fleetOwner.userId);
  }
  
  return fleetOwner;
}

export async function getFleetTrucks(q: FleetQuery) {
  const where: any = {};
  if (q.search) {
    where.OR = [
      { registrationNo: { contains: q.search, mode: 'insensitive' } },
      { fleetOwner: { companyName: { contains: q.search, mode: 'insensitive' } } },
    ];
  }

  const [total, trucks] = await Promise.all([
    prisma.fleetTruck.count({ where }),
    prisma.fleetTruck.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        fleetOwner: { select: { companyName: true, user: { select: { name: true } } } },
        currentDriver: { include: { driver: { include: { user: { select: { name: true } } } } } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: trucks };
}

export async function getExpiringFleetTrucks(days = 30) {
  const threshold = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  return prisma.fleetTruck.findMany({
    where: {
      OR: [
        { insuranceExpiry: { lte: threshold } },
        { fitnessExpiry:   { lte: threshold } },
        { pucExpiry:       { lte: threshold } },
        { permitExpiry:    { lte: threshold } },
      ],
    },
    include: {
      fleetOwner: { select: { companyName: true, user: { select: { name: true, phone: true } } } },
    },
    orderBy: { insuranceExpiry: 'asc' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────────────────────────────────────────

export async function getRevenueOverview(q: FinanceQuery) {
  const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1)); // Start of month
  const to   = q.to   ? new Date(q.to)   : new Date();

  const [revenueAgg, commissionAgg, subscriptions, refunds] = await Promise.all([
    prisma.booking.aggregate({
      where: { status: 'COMPLETED', updatedAt: { gte: from, lte: to } },
      _sum: { totalFare: true },
      _count: true,
    }),
    prisma.driverEarning.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _sum: { commission: true },
    }),
    prisma.driverSubscription.count({ where: { isActive: true } }),
    prisma.walletTransaction.aggregate({
      where: { reason: 'REFUND', createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalRevenue: revenueAgg._sum.totalFare ?? 0,
    totalBookings: revenueAgg._count,
    platformCommission: commissionAgg._sum.commission ?? 0,
    activeSubscriptions: subscriptions,
    totalRefunds: refunds._sum.amount ?? 0,
  };
}

export async function getDriverEarnings(q: FinanceQuery) {
  const where: any = {};
  if (q.driverId) where.driverId = q.driverId;
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to)   where.createdAt.lte = new Date(q.to);
  }

  const [total, earnings] = await Promise.all([
    prisma.driverEarning.count({ where }),
    prisma.driverEarning.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        driver: { include: { user: { select: { name: true, phone: true } } } },
        booking: { select: { bookingNumber: true } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: earnings };
}

export async function markDriverEarningPaid(earningId: string) {
  const earning = await prisma.driverEarning.findUnique({ where: { id: earningId } });
  if (!earning) throw AppError.notFound('Earning record not found');
  if (earning.paidAt) throw AppError.badRequest('Earning already marked as paid');

  return prisma.driverEarning.update({ where: { id: earningId }, data: { paidAt: new Date() } });
}

export async function getFleetEarnings(q: FinanceQuery) {
  const where: any = {};
  if (q.fleetId) where.fleetOwnerId = q.fleetId;

  const [total, earnings] = await Promise.all([
    prisma.fleetEarning.count({ where }),
    prisma.fleetEarning.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        fleetOwner: { select: { companyName: true } },
        booking: { select: { bookingNumber: true } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: earnings };
}

export async function getSubscriptions(q: FinanceQuery) {
  const where: any = {};
  if (q.plan) where.plan = q.plan;
  if (q.isActive !== undefined) where.isActive = q.isActive;

  const [total, subs] = await Promise.all([
    prisma.driverSubscription.count({ where }),
    prisma.driverSubscription.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: { driver: { include: { user: { select: { name: true, phone: true } } } } },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: subs };
}

export async function updateSubscription(id: string, data: SubscriptionUpdate) {
  return prisma.driverSubscription.update({
    where: { id },
    data: {
      ...(data.plan && { plan: data.plan }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function getWalletTransactions(q: FinanceQuery) {
  const where: any = {};
  if (q.reason) where.reason = q.reason;
  if (q.userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: q.userId } });
    if (wallet) where.walletId = wallet.id;
  }

  const [total, transactions] = await Promise.all([
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: { wallet: { include: { user: { select: { name: true, phone: true } } } } },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: transactions };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS
// ─────────────────────────────────────────────────────────────────────────────

export async function getTickets(q: TicketsQuery) {
  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.search) {
    where.OR = [
      { subject: { contains: q.search, mode: 'insensitive' } },
      { user: { phone: { contains: q.search } } },
    ];
  }

  const [total, tickets] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, phone: true, role: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: tickets };
}

export async function getTicketById(id: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      user: { include: { wallet: { select: { cachedBalance: true } } } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw AppError.notFound('Ticket not found');
  return ticket;
}

export async function replyToTicket(ticketId: string, adminId: string, content: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw AppError.notFound('Ticket not found');

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: { ticketId, senderId: adminId, isAgent: true, content },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status },
    }),
  ]);

  return message;
}

export async function updateTicketStatus(ticketId: string, status: SupportTicketStatus) {
  return prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export async function getPricing() {
  return prisma.vehicleTypePricing.findMany({ orderBy: { vehicleType: 'asc' } });
}

export async function updatePricing(vehicleType: string, data: PricingUpdateInput) {
  return prisma.vehicleTypePricing.update({
    where: { vehicleType: vehicleType as any },
    data,
  });
}

export async function getAnnouncements() {
  return prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createAnnouncement(data: AnnouncementInput) {
  const announcement = await prisma.announcement.create({
    data: {
      ...data,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt:   data.endsAt   ? new Date(data.endsAt)   : null,
    },
  });

  // Emit event to trigger push notifications and background worker
  eventBus.emit('announcement.created', {
    target: announcement.target,
    title: announcement.title,
    body: announcement.body,
  });

  return announcement;
}

export async function updateAnnouncement(id: string, data: Partial<AnnouncementInput>) {
  return prisma.announcement.update({
    where: { id },
    data: {
      ...data,
      startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
      endsAt:   data.endsAt   ? new Date(data.endsAt)   : undefined,
    },
  });
}

export async function deleteAnnouncement(id: string) {
  return prisma.announcement.delete({ where: { id } });
}

export async function broadcastNotification(adminId: string, input: BroadcastInput) {
  // Get target user FCM tokens
  let users: { id: string; fcmToken: string | null }[] = [];

  if (input.target === 'ALL') {
    users = await prisma.user.findMany({ where: { isActive: true, fcmToken: { not: null } }, select: { id: true, fcmToken: true } });
  } else if (input.target === 'CUSTOMERS') {
    users = await prisma.user.findMany({ where: { role: 'CUSTOMER', isActive: true, fcmToken: { not: null } }, select: { id: true, fcmToken: true } });
  } else if (input.target === 'DRIVERS') {
    users = await prisma.user.findMany({ where: { role: 'DRIVER', isActive: true, fcmToken: { not: null } }, select: { id: true, fcmToken: true } });
  } else if (input.target === 'FLEET_OWNERS') {
    users = await prisma.user.findMany({ where: { role: 'FLEET_OWNER', isActive: true, fcmToken: { not: null } }, select: { id: true, fcmToken: true } });
  } else if (input.target === 'SPECIFIC' && input.targetUserId) {
    const u = await prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, fcmToken: true } });
    if (u) users = [u];
  }

  let sent = 0;
  for (const user of users) {
    if (!user.fcmToken) continue;
    try {
      await notificationService.sendToDevice(user.fcmToken, {
        title: input.title,
        body: input.body,
        data: { type: input.type, referenceId: input.referenceId ?? '' },
      });
      sent++;
    } catch { /* skip failed tokens */ }
  }

  return { success: true, targeted: users.length, sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// ULIP AUDIT LOGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getUlipLogs(q: UlipLogsQuery) {
  const where: any = {};
  if (q.entityType) where.entityType = q.entityType;
  if (q.status) where.status = q.status;
  if (q.from || q.to) {
    where.calledAt = {};
    if (q.from) where.calledAt.gte = new Date(q.from);
    if (q.to)   where.calledAt.lte = new Date(q.to);
  }

  const [total, logs] = await Promise.all([
    prisma.verificationLog.count({ where }),
    prisma.verificationLog.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { calledAt: 'desc' },
    }),
  ]);

  return { total, page: q.page, limit: q.limit, data: logs };
}

export async function getUlipLogById(id: string) {
  const log = await prisma.verificationLog.findUnique({ where: { id } });
  if (!log) throw AppError.notFound('Verification log not found');
  return log;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

export async function getSystemHealth() {
  const start = Date.now();
  let dbStatus = 'ok';
  let dbLatency = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - start;
  } catch {
    dbStatus = 'error';
  }

  return {
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, latencyMs: dbLatency },
    mockUlip: env.MOCK_ULIP === 'true',
    ulipEnv: env.ULIP_ENV,
    nodeEnv: env.NODE_ENV,
  };
}

// ─────────────────────────────────────────────
// WORKFORCE VERIFICATION
// ─────────────────────────────────────────────

export async function getPendingWorkerDocumentsCount() {
  const count = await prisma.worker.count({
    where: {
      isDocVerified: false,
      documents: {
        some: { status: 'PENDING' },
      },
    },
  });
  return { count };
}

export async function getPendingWorkerDocuments() {
  const pendingWorkers = await prisma.worker.findMany({
    where: {
      isDocVerified: false,
      documents: {
        some: { status: 'PENDING' },
      },
    },
    include: {
      user: { select: { name: true, phone: true } },
      documents: true,
    },
  });
  return pendingWorkers;
}

export async function verifyWorkerDocuments(workerId: string, input: any) {
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) throw AppError.notFound('Worker not found');

  if (input.approve) {
    // Update worker status and insert extracted data
    await prisma.worker.update({
      where: { id: workerId },
      data: {
        isDocVerified: true,
        aadhaarNumber: input.aadhaarNumber,
        panNumber: input.panNumber,
      },
    });

    // Mark documents as verified
    await prisma.workerDocument.updateMany({
      where: { workerId },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
  } else {
    // Reject documents
    await prisma.workerDocument.updateMany({
      where: { workerId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectedReason: input.rejectReason },
    });
  }

  return { success: true };
}
