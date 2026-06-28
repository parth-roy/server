/**
 * fleet-owner.router.ts — All Fleet Owner API routes
 *
 * Base path: /api/v1/fleet-owners
 * All routes require:  authenticate  +  requireRole(UserRole.FLEET_OWNER)
 */

import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as FleetOwnerController from './fleet-owner.controller';
import {
  registerFleetOwnerSchema,
  addFleetTruckSchema,
  updateFleetTruckFullSchema,
  addFleetDriverSchema,
  assignTruckSchema,
  setTruckDriverSchema,
  listPendingBookingsSchema,
  fleetEarningsQuerySchema,
  addMaintenanceSchema,
  addFuelLogSchema,
  addTruckDocumentSchema,
  updateMaintenanceSchema,
} from './fleet-owner.schema';

export const fleetOwnerRouter = Router();

// All fleet-owner routes require valid JWT
fleetOwnerRouter.use(authenticate);

// ── Profile ────────────────────────────────────────────────────────────────
// POST /fleet-owners/register — called once after role selection in app
// Does NOT require FLEET_OWNER role yet (user has the role but no profile)
fleetOwnerRouter.post(
  '/register',
  validate(registerFleetOwnerSchema),
  FleetOwnerController.registerFleetOwner
);

// All routes below require FLEET_OWNER role
fleetOwnerRouter.use(requireRole(UserRole.FLEET_OWNER));

fleetOwnerRouter.get('/me', FleetOwnerController.getMyProfile);
fleetOwnerRouter.get('/dashboard', FleetOwnerController.getDashboard);

// ── Trucks ─────────────────────────────────────────────────────────────────
fleetOwnerRouter.post(
  '/trucks',
  validate(addFleetTruckSchema),
  FleetOwnerController.addTruck
);
fleetOwnerRouter.get('/trucks', FleetOwnerController.listTrucks);
fleetOwnerRouter.patch(
  '/trucks/:truckId',
  validate(updateFleetTruckFullSchema),
  FleetOwnerController.updateTruck
);
fleetOwnerRouter.delete('/trucks/:truckId', FleetOwnerController.deleteTruck);
fleetOwnerRouter.patch(
  '/trucks/:truckId/assign-driver',
  validate(setTruckDriverSchema),
  FleetOwnerController.setTruckDriver
);

// ── Truck Documents ────────────────────────────────────────────────────────
fleetOwnerRouter.get('/trucks/:truckId/documents', FleetOwnerController.listTruckDocuments);
fleetOwnerRouter.post(
  '/trucks/:truckId/documents',
  validate(addTruckDocumentSchema),
  FleetOwnerController.addTruckDocument
);

// ── Fleet Drivers ──────────────────────────────────────────────────────────
// IMPORTANT: /drivers/earnings MUST be registered BEFORE /drivers/:fleetDriverId
// otherwise Express will treat "earnings" as a :fleetDriverId param value.
fleetOwnerRouter.get('/drivers/earnings', FleetOwnerController.perDriverEarnings);
fleetOwnerRouter.post(
  '/drivers',
  validate(addFleetDriverSchema),
  FleetOwnerController.addDriver
);
fleetOwnerRouter.get('/drivers', FleetOwnerController.listDrivers);
fleetOwnerRouter.delete('/drivers/:fleetDriverId', FleetOwnerController.removeDriver);

// ── Bookings ───────────────────────────────────────────────────────────────
fleetOwnerRouter.get('/bookings/active', FleetOwnerController.listActiveBookings);
fleetOwnerRouter.get(
  '/bookings/pending',
  validate(listPendingBookingsSchema, 'query'),
  FleetOwnerController.listPendingBookings
);
fleetOwnerRouter.post(
  '/bookings/assign',
  validate(assignTruckSchema),
  FleetOwnerController.assignTruck
);

// ── Earnings ───────────────────────────────────────────────────────────────
fleetOwnerRouter.get(
  '/earnings',
  validate(fleetEarningsQuerySchema, 'query'),
  FleetOwnerController.getEarnings
);

// ── Maintenance ────────────────────────────────────────────────────────────
fleetOwnerRouter.get('/maintenance', FleetOwnerController.listMaintenance);
fleetOwnerRouter.post(
  '/maintenance',
  validate(addMaintenanceSchema),
  FleetOwnerController.addMaintenance
);
fleetOwnerRouter.patch(
  '/maintenance/:id',
  validate(updateMaintenanceSchema),
  FleetOwnerController.updateMaintenance
);
fleetOwnerRouter.delete('/maintenance/:id', FleetOwnerController.deleteMaintenance);

// ── Fuel Logs ──────────────────────────────────────────────────────────────
fleetOwnerRouter.get('/fuel-logs', FleetOwnerController.listFuelLogs);
fleetOwnerRouter.post(
  '/fuel-logs',
  validate(addFuelLogSchema),
  FleetOwnerController.addFuelLog
);
fleetOwnerRouter.delete('/fuel-logs/:id', FleetOwnerController.deleteFuelLog);

// ── Analytics ──────────────────────────────────────────────────────────────
fleetOwnerRouter.get('/analytics', FleetOwnerController.getFleetAnalytics);
