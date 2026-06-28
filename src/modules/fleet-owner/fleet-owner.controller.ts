/**
 * fleet-owner.controller.ts — Thin HTTP handlers for Fleet Owner routes
 * All business logic lives in fleet-owner.service.ts
 *
 * Note: auth.middleware.ts sets req.user.id (not req.user.userId)
 */

import { Request, Response, NextFunction } from 'express';
import * as FleetOwnerService from './fleet-owner.service';

export async function registerFleetOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.registerFleetOwner(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.getMyFleetOwnerProfile(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.getFleetDashboard(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Trucks ────────────────────────────────────────────────────────────

export async function addTruck(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.addFleetTruck(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listTrucks(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listFleetTrucks(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function updateTruck(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.updateFleetTruck(
      req.user!.id,
      req.params.truckId as string,
      req.body
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setTruckDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.setCurrentTruckDriver(
      req.user!.id,
      req.params.truckId as string,
      req.body
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Fleet Drivers ─────────────────────────────────────────────────────

export async function addDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.addFleetDriver(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listDrivers(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listFleetDrivers(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function removeDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.removeFleetDriver(
      req.user!.id,
      req.params.fleetDriverId as string
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Bookings & Assignment ─────────────────────────────────────────────

export async function listPendingBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listPendingBookings(req.user!.id, req.query as any);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function assignTruck(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.assignTruckToBooking(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Earnings ──────────────────────────────────────────────────────────

export async function getEarnings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.getFleetEarnings(req.user!.id, req.query as any);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Maintenance ──────────────────────────────────────────────────────────

export async function listMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listMaintenance(req.user!.id, req.query.truckId as string | undefined);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function addMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.addMaintenance(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function deleteMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.deleteMaintenance(req.user!.id, req.params.id as string);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Fuel Logs ────────────────────────────────────────────────────────────

export async function listFuelLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listFuelLogs(req.user!.id, req.query.truckId as string | undefined);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function addFuelLog(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.addFuelLog(req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Truck Documents ──────────────────────────────────────────────────────

export async function listTruckDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listTruckDocuments(req.user!.id, req.params.truckId as string);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function addTruckDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.addTruckDocument(req.user!.id, req.params.truckId as string, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Per-Driver Earnings & Analytics ──────────────────────────────────────

export async function perDriverEarnings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.perDriverEarnings(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getFleetAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.getFleetAnalytics(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── New Handlers ──────────────────────────────────────────────────────

export async function deleteTruck(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.deleteFleetTruck(req.user!.id, req.params.truckId as string);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function updateMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.updateMaintenance(req.user!.id, req.params.id as string, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function deleteFuelLog(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.deleteFuelLog(req.user!.id, req.params.id as string);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listActiveBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await FleetOwnerService.listActiveBookings(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
