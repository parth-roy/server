import { Router } from 'express';
import { pricingController } from './pricing.controller';

export const pricingRouter = Router();

// Public — no auth required
pricingRouter.get('/vehicles',      pricingController.getVehicles);
pricingRouter.post('/estimate',     pricingController.estimateFare);
pricingRouter.post('/estimate-all', pricingController.estimateAll);
pricingRouter.get('/config',        pricingController.getConfig);
pricingRouter.get('/surge-status',  pricingController.getSurgeStatus);
