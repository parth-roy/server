/**
 * admin.router.ts — All /api/v1/admin/* routes
 *
 * Auth structure:
 *   - /auth/login, /auth/forgot-password, /auth/reset-password, /auth/refresh
 *     → PUBLIC (no JWT required — these ARE the auth endpoints)
 *   - All other routes → authenticate + requireRole('ADMIN')
 */

import { Router } from 'express';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as ctrl from './admin.controller';
import {
  loginSchema, forgotPasswordSchema, resetPasswordSchema, refreshSchema,
} from './admin.schema';

export const adminRouter = Router();

// ── Auth (PUBLIC — no JWT required) ──────────────────────────────────────────
adminRouter.post('/auth/login',          validate(loginSchema),          ctrl.login);
adminRouter.post('/auth/refresh',        validate(refreshSchema),        ctrl.refresh);
adminRouter.post('/auth/logout',                                          ctrl.logout);
adminRouter.post('/auth/forgot-password',validate(forgotPasswordSchema), ctrl.forgotPassword);
adminRouter.post('/auth/reset-password', validate(resetPasswordSchema),  ctrl.resetPassword);

// ── Auth guard applied to ALL routes below ────────────────────────────────────
adminRouter.use(authenticate, requireRole('ADMIN'));

// ── Auth — Protected ─────────────────────────────────────────────────────────
adminRouter.get('/auth/me', ctrl.getMe);

// ── Dashboard ─────────────────────────────────────────────────────────────────
adminRouter.get('/dashboard/stats',          ctrl.getDashboardStats);
adminRouter.get('/dashboard/revenue-trend',  ctrl.getRevenueTrend);
adminRouter.get('/dashboard/alerts',         ctrl.getDashboardAlerts);

// ── Bookings ──────────────────────────────────────────────────────────────────
adminRouter.get('/bookings/export',                   ctrl.exportBookings);  // BEFORE /:id
adminRouter.get('/bookings',                          ctrl.listBookings);
adminRouter.get('/bookings/:id',                      ctrl.getBooking);
adminRouter.post('/bookings/:id/assign-driver',       ctrl.assignDriver);
adminRouter.post('/bookings/:id/cancel',              ctrl.cancelBooking);
adminRouter.post('/bookings/:id/refund',              ctrl.refundBooking);

// ── Users ─────────────────────────────────────────────────────────────────────
adminRouter.get('/users',                             ctrl.listUsers);
adminRouter.get('/users/:id',                         ctrl.getUser);
adminRouter.patch('/users/:id/status',                ctrl.setUserStatus);
adminRouter.delete('/users/:id/sessions',             ctrl.forceLogoutUser);
adminRouter.post('/users/:id/wallet-credit',          ctrl.creditWallet);

// ── Drivers ───────────────────────────────────────────────────────────────────
adminRouter.get('/drivers',                                          ctrl.listDrivers);
adminRouter.get('/drivers/:id',                                      ctrl.getDriver);
adminRouter.patch('/drivers/:id/documents/:docId/status',            ctrl.updateDocStatus);
adminRouter.patch('/drivers/:id/doc-verified',                       ctrl.setDocVerified);
adminRouter.get('/drivers/:id/verification-logs',                    ctrl.getDriverVerifLogs);

// ── Fleet Owners ──────────────────────────────────────────────────────────────
adminRouter.get('/fleet-owners',                      ctrl.listFleetOwners);
adminRouter.get('/fleet-owners/:id',                  ctrl.getFleetOwner);
adminRouter.patch('/fleet-owners/:id/status',         ctrl.setFleetOwnerStatus);

// ── Fleet Trucks ──────────────────────────────────────────────────────────────
adminRouter.get('/fleet-trucks/expiring',             ctrl.getExpiringTrucks);  // BEFORE /:id
adminRouter.get('/fleet-trucks',                      ctrl.listFleetTrucks);

// ── Finance ───────────────────────────────────────────────────────────────────
adminRouter.get('/finance/revenue',                       ctrl.getRevenue);
adminRouter.get('/finance/driver-earnings',               ctrl.listDriverEarnings);
adminRouter.patch('/finance/driver-earnings/:id/mark-paid', ctrl.markEarningPaid);
adminRouter.get('/finance/fleet-earnings',                ctrl.listFleetEarnings);
adminRouter.get('/finance/subscriptions',                 ctrl.listSubscriptions);
adminRouter.patch('/finance/subscriptions/:id',           ctrl.updateSubscription);
adminRouter.get('/finance/wallet-transactions',           ctrl.listWalletTransactions);

// ── Support Tickets ───────────────────────────────────────────────────────────
adminRouter.get('/support/tickets',                   ctrl.listTickets);
adminRouter.get('/support/tickets/:id',               ctrl.getTicket);
adminRouter.post('/support/tickets/:id/reply',        ctrl.replyTicket);
adminRouter.patch('/support/tickets/:id/status',      ctrl.setTicketStatus);

// ── Pricing Engine (v2) ───────────────────────────────────────────────────────
adminRouter.get('/pricing/vehicles',                  ctrl.listPricingVehicles);
adminRouter.patch('/pricing/vehicles/:vehicleType',   ctrl.updatePricingVehicle);
adminRouter.get('/pricing/config',                    ctrl.listPricingConfig);
adminRouter.patch('/pricing/config/:key',             ctrl.updatePricingConfig);
adminRouter.get('/pricing/commission',                ctrl.getCommissionRate);
adminRouter.patch('/pricing/commission',              ctrl.setCommissionRate);
adminRouter.get('/pricing/fuel',                      ctrl.getFuelStatus);
adminRouter.patch('/pricing/fuel',                    ctrl.updateFuelPrice);
adminRouter.get('/pricing/audit-log',                 ctrl.getPricingAuditLog);
adminRouter.get('/pricing/subsidies',                 ctrl.getPricingSubsidies);
// Legacy (kept for backward compat — maps to new vehicle endpoint)
adminRouter.get('/pricing',                           ctrl.listPricingVehicles);
adminRouter.patch('/pricing/:vehicleType',            ctrl.updatePricingVehicle);
adminRouter.get('/announcements',                     ctrl.listAnnouncements);
adminRouter.post('/announcements',                    ctrl.createAnnouncement);
adminRouter.patch('/announcements/:id',               ctrl.editAnnouncement);
adminRouter.delete('/announcements/:id',              ctrl.removeAnnouncement);
adminRouter.post('/notifications/broadcast',          ctrl.sendBroadcast);

// ── ULIP Audit Logs ───────────────────────────────────────────────────────────
adminRouter.get('/ulip-logs',                         ctrl.listUlipLogs);
adminRouter.get('/ulip-logs/:id',                     ctrl.getUlipLog);

// ── System ────────────────────────────────────────────────────────────────────
adminRouter.get('/system/health',                     ctrl.systemHealth);
