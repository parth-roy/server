import { Request, Response, NextFunction } from 'express';
import { pricingService } from './pricing.service';
import { sendSuccess } from '@shared/utils/response';
import { AppError } from '@shared/errors/AppError';

export const pricingController = {

  // GET /api/v1/pricing/vehicles
  getVehicles: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vehicles = await pricingService.getVehicleTypes();
      sendSuccess(res, vehicles, 'Vehicle types fetched');
    } catch (error) { next(error); }
  },

  // POST /api/v1/pricing/estimate
  estimateFare: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        pickupLat, pickupLng, dropLat, dropLng, vehicleType,
        hasLoadingService, helperCount, insuranceOpted, stops,
      } = req.body;

      if (!pickupLat || !pickupLng || !dropLat || !dropLng || !vehicleType) {
        throw AppError.badRequest(
          'Required fields: pickupLat, pickupLng, dropLat, dropLng, vehicleType'
        );
      }

      const estimate = await pricingService.estimateFare({
        pickupLat:        Number(pickupLat),
        pickupLng:        Number(pickupLng),
        dropLat:          Number(dropLat),
        dropLng:          Number(dropLng),
        vehicleType,
        hasLoadingService: Boolean(hasLoadingService),
        helperCount:       helperCount !== undefined ? Number(helperCount) : undefined,
        insuranceOpted:    Boolean(insuranceOpted),
        stops,
      });

      sendSuccess(res, estimate, 'Fare estimated');
    } catch (error) { next(error); }
  },

  // POST /api/v1/pricing/estimate-all
  estimateAll: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pickupLat, pickupLng, dropLat, dropLng } = req.body;

      if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
        throw AppError.badRequest(
          'Required fields: pickupLat, pickupLng, dropLat, dropLng'
        );
      }

      const estimates = await pricingService.estimateAll(
        Number(pickupLat),
        Number(pickupLng),
        Number(dropLat),
        Number(dropLng),
      );

      sendSuccess(res, estimates, 'Bulk fare estimates calculated');
    } catch (error) { next(error); }
  },

  // GET /api/v1/pricing/config
  getConfig: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await pricingService.getPublicConfig();
      sendSuccess(res, config, 'Pricing config fetched');
    } catch (error) { next(error); }
  },

  // GET /api/v1/pricing/surge-status?lat=&lng=&vehicleType=
  getSurgeStatus: async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Stage 1: always returns no surge
      sendSuccess(res, {
        surgeActive:       false,
        surgeMultiplier:   1.0,
        surgeReason:       null,
        estimatedNormalAt: null,
      }, 'Surge status fetched');
    } catch (error) { next(error); }
  },
};
