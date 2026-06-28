import { Request, Response, NextFunction } from 'express';
import * as adminService from './admin.service';
import * as pricingAdminService from '@modules/pricing/pricing.admin.service';
import {
  loginSchema, forgotPasswordSchema, resetPasswordSchema, refreshSchema,
  bookingsQuerySchema, usersQuerySchema, driversQuerySchema, fleetQuerySchema,
  financeQuerySchema, ticketsQuerySchema, assignDriverSchema, cancelBookingSchema,
  refundSchema, walletCreditSchema, docStatusSchema, docVerifiedSchema,
  pricingUpdateSchema, announcementSchema, broadcastNotificationSchema,
  subscriptionUpdateSchema, ulipLogsQuerySchema, userStatusSchema,
  fleetStatusSchema, ticketStatusSchema, ticketReplySchema,
} from './admin.schema';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — standardized success response
// ─────────────────────────────────────────────────────────────────────────────

function ok(res: Response, data: any, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

/** Cast Express req.params value (string | string[]) safely to string */
const p = (val: string | string[]) => (Array.isArray(val) ? val[0] : val);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    ok(res, await adminService.loginAdmin(input));
  } catch (e) { next(e); }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = refreshSchema.parse(req.body);
    ok(res, await adminService.refreshAdminToken(input));
  } catch (e) { next(e); }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await adminService.logoutAdmin(req.body?.refreshToken ?? '');
    ok(res, { message: 'Logged out successfully' });
  } catch (e) { next(e); }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.getAdminProfile(req.user!.id));
  } catch (e) { next(e); }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    await adminService.forgotPassword(input);
    ok(res, { message: 'If that email exists, a reset link has been sent.' });
  } catch (e) { next(e); }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    await adminService.resetPassword(input);
    ok(res, { message: 'Password reset successfully. Please log in with your new password.' });
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardStats = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getDashboardStats()); } catch (e) { next(e); }
};

export const getRevenueTrend = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(p(req.query.days as any ?? '30'), 10)));
    ok(res, await adminService.getRevenueTrend(days));
  } catch (e) { next(e); }
};

export const getDashboardAlerts = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getDashboardAlerts()); } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

export const listBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = bookingsQuerySchema.parse(req.query);
    ok(res, await adminService.getBookings(q));
  } catch (e) { next(e); }
};

export const getBooking = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getBookingById(p(req.params.id))); } catch (e) { next(e); }
};

export const assignDriver = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = assignDriverSchema.parse(req.body);
    ok(res, await adminService.adminAssignDriver(p(req.params.id), input));
  } catch (e) { next(e); }
};

export const cancelBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = cancelBookingSchema.parse(req.body);
    ok(res, await adminService.adminCancelBooking(p(req.params.id), input));
  } catch (e) { next(e); }
};

export const refundBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = refundSchema.parse(req.body);
    ok(res, await adminService.adminRefundBooking(p(req.params.id), input));
  } catch (e) { next(e); }
};

export const exportBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = bookingsQuerySchema.parse({ ...req.query, limit: '1000', page: '1' });
    const result = await adminService.getBookings(q);

    const headers = ['bookingNumber', 'status', 'totalFare', 'vehicleType', 'paymentStatus', 'createdAt'];
    const csv = [
      headers.join(','),
      ...result.data.map((b: any) =>
        headers.map(h => JSON.stringify(b[h] ?? '')).join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────

export const listUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = usersQuerySchema.parse(req.query);
    ok(res, await adminService.getUsers(q));
  } catch (e) { next(e); }
};

export const getUser = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getUserById(p(req.params.id))); } catch (e) { next(e); }
};

export const setUserStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isActive } = userStatusSchema.parse(req.body);
    ok(res, await adminService.toggleUserStatus(p(req.params.id), isActive));
  } catch (e) { next(e); }
};

export const forceLogoutUser = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.forceLogoutAllSessions(p(req.params.id))); } catch (e) { next(e); }
};

export const creditWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = walletCreditSchema.parse(req.body);
    ok(res, await adminService.adminWalletCredit(p(req.params.id), input));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DRIVERS
// ─────────────────────────────────────────────────────────────────────────────

export const listDrivers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = driversQuerySchema.parse(req.query);
    ok(res, await adminService.getDrivers(q));
  } catch (e) { next(e); }
};

export const getDriver = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getDriverById(p(req.params.id))); } catch (e) { next(e); }
};

export const updateDocStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = docStatusSchema.parse(req.body);
    ok(res, await adminService.updateDocumentStatus(p(req.params.id), p(req.params.docId), input));
  } catch (e) { next(e); }
};

export const setDocVerified = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = docVerifiedSchema.parse(req.body);
    ok(res, await adminService.setDriverDocVerified(p(req.params.id), input));
  } catch (e) { next(e); }
};

export const getDriverVerifLogs = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getDriverVerificationLogs(p(req.params.id))); } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// FLEET OWNERS & TRUCKS
// ─────────────────────────────────────────────────────────────────────────────

export const listFleetOwners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = fleetQuerySchema.parse(req.query);
    ok(res, await adminService.getFleetOwners(q));
  } catch (e) { next(e); }
};

export const getFleetOwner = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getFleetOwnerById(p(req.params.id))); } catch (e) { next(e); }
};

export const setFleetOwnerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = fleetStatusSchema.parse(req.body);
    ok(res, await adminService.toggleFleetOwnerStatus(p(req.params.id), data));
  } catch (e) { next(e); }
};

export const listFleetTrucks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = fleetQuerySchema.parse(req.query);
    ok(res, await adminService.getFleetTrucks(q));
  } catch (e) { next(e); }
};

export const getExpiringTrucks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(p(req.query.days as any ?? '30'), 10);
    ok(res, await adminService.getExpiringFleetTrucks(days));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────────────────────────────────────────

export const getRevenue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = financeQuerySchema.parse(req.query);
    ok(res, await adminService.getRevenueOverview(q));
  } catch (e) { next(e); }
};

export const listDriverEarnings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = financeQuerySchema.parse(req.query);
    ok(res, await adminService.getDriverEarnings(q));
  } catch (e) { next(e); }
};

export const markEarningPaid = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.markDriverEarningPaid(p(req.params.id))); } catch (e) { next(e); }
};

export const listFleetEarnings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = financeQuerySchema.parse(req.query);
    ok(res, await adminService.getFleetEarnings(q));
  } catch (e) { next(e); }
};

export const listSubscriptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = financeQuerySchema.parse(req.query);
    ok(res, await adminService.getSubscriptions(q));
  } catch (e) { next(e); }
};

export const updateSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = subscriptionUpdateSchema.parse(req.body);
    ok(res, await adminService.updateSubscription(p(req.params.id), data));
  } catch (e) { next(e); }
};

export const listWalletTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = financeQuerySchema.parse(req.query);
    ok(res, await adminService.getWalletTransactions(q));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT
// ─────────────────────────────────────────────────────────────────────────────

export const listTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = ticketsQuerySchema.parse(req.query);
    ok(res, await adminService.getTickets(q));
  } catch (e) { next(e); }
};

export const getTicket = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getTicketById(p(req.params.id))); } catch (e) { next(e); }
};

export const replyTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = ticketReplySchema.parse(req.body);
    ok(res, await adminService.replyToTicket(p(req.params.id), req.user!.id, content));
  } catch (e) { next(e); }
};

export const setTicketStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = ticketStatusSchema.parse(req.body);
    ok(res, await adminService.updateTicketStatus(p(req.params.id), status as any));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// ── Pricing Engine v2 (new admin endpoints) ───────────────────────────────────

export const listPricingVehicles = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await pricingAdminService.adminListVehicles()); } catch (e) { next(e); }
};

export const updatePricingVehicle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await pricingAdminService.adminUpdateVehicle(p(req.params.vehicleType), req.body, req.user!.id));
  } catch (e) { next(e); }
};

export const listPricingConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await pricingAdminService.adminListConfig()); } catch (e) { next(e); }
};

export const updatePricingConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { value } = req.body;
    if (!value) { res.status(400).json({ success: false, message: 'value is required' }); return; }
    ok(res, await pricingAdminService.adminUpdateConfig(p(req.params.key), String(value), req.user!.id));
  } catch (e) { next(e); }
};

export const getCommissionRate = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await pricingAdminService.adminGetCommissionRate()); } catch (e) { next(e); }
};

export const setCommissionRate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rate, reason } = req.body;
    ok(res, await pricingAdminService.adminSetCommissionRate(Number(rate), reason, req.user!.id));
  } catch (e) { next(e); }
};

export const getFuelStatus = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await pricingAdminService.adminGetFuelStatus()); } catch (e) { next(e); }
};

export const updateFuelPrice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPrice } = req.body;
    ok(res, await pricingAdminService.adminUpdateFuelPrice(Number(currentPrice), req.user!.id));
  } catch (e) { next(e); }
};

export const getPricingAuditLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '25')));
    ok(res, await pricingAdminService.adminGetPricingAuditLog(
      page, limit,
      req.query.vehicleType as string | undefined,
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    ));
  } catch (e) { next(e); }
};

export const getPricingSubsidies = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '25')));
    ok(res, await pricingAdminService.adminGetSubsidies(page, limit));
  } catch (e) { next(e); }
};

// ── Legacy aliases (kept for backward compat) ────────────────────────────────
export const listPricing = listPricingVehicles;
export const setPricing  = updatePricingVehicle;

export const listAnnouncements = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getAnnouncements()); } catch (e) { next(e); }
};

export const createAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = announcementSchema.parse(req.body);
    ok(res, await adminService.createAnnouncement(data), 201);
  } catch (e) { next(e); }
};

export const editAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = announcementSchema.partial().parse(req.body);
    ok(res, await adminService.updateAnnouncement(p(req.params.id), data));
  } catch (e) { next(e); }
};

export const removeAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await adminService.deleteAnnouncement(p(req.params.id));
    ok(res, { message: 'Announcement deleted' });
  } catch (e) { next(e); }
};

export const sendBroadcast = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = broadcastNotificationSchema.parse(req.body);
    ok(res, await adminService.broadcastNotification(req.user!.id, data));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// ULIP LOGS
// ─────────────────────────────────────────────────────────────────────────────

export const listUlipLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = ulipLogsQuerySchema.parse(req.query);
    ok(res, await adminService.getUlipLogs(q));
  } catch (e) { next(e); }
};

export const getUlipLog = async (req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getUlipLogById(p(req.params.id))); } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export const systemHealth = async (_req: Request, res: Response, next: NextFunction) => {
  try { ok(res, await adminService.getSystemHealth()); } catch (e) { next(e); }
};
