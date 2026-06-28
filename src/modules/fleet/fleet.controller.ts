/**
 * fleet.controller.ts — HTTP layer for fleet endpoints
 *
 * Thin layer: validate input → call service → send response.
 * No business logic here — all of that is in fleet.service.ts.
 */

import { Request, Response, NextFunction } from 'express';
import * as fleetService from './fleet.service';
import {
  registerDriverSchema,
  registerVehicleSchema,
  verifyLicenseSchema,
  verifyVehicleRcSchema,
  updateDriverStatusSchema,
} from './fleet.schema';

// POST /api/v1/fleet/drivers/register
export async function registerDriver(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = registerDriverSchema.parse(req.body);
    const data = await fleetService.registerDriver(req.user!.id, input);
    res.status(201).json({ success: true, data, message: 'Driver profile created' });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/fleet/drivers/me
export async function getMyProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await fleetService.getMyDriverProfile(req.user!.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/fleet/vehicles/register
export async function registerVehicle(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = registerVehicleSchema.parse(req.body);
    const data = await fleetService.registerVehicle(req.user!.id, input);
    res.status(201).json({ success: true, data, message: 'Vehicle registered' });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/fleet/drivers/verify-license
export async function verifyLicense(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = verifyLicenseSchema.parse(req.body);
    const data = await fleetService.verifyDriverLicense(req.user!.id, input);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/fleet/vehicles/verify-rc
export async function verifyVehicleRc(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = verifyVehicleRcSchema.parse(req.body);
    const data = await fleetService.verifyVehicleRc(req.user!.id, input);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/fleet/drivers/status
export async function updateStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = updateDriverStatusSchema.parse(req.body);
    const data = await fleetService.updateDriverStatus(req.user!.id, input);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/fleet/admin/drivers/:driverId/verify-override
export async function adminOverrideVerification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const driverId = req.params.driverId as string;
    const notes = req.body.notes as string | undefined; // Optional context from admin
    const data = await fleetService.adminOverrideVerification(req.user!.id, driverId, notes);
    res.json({ success: true, data, message: 'Driver verification manually overridden by admin' });
  } catch (err) {
    next(err);
  }
}
