import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import * as RewardsController from './rewards.controller';

export const rewardsRouter = Router();

rewardsRouter.use(authenticate);

rewardsRouter.get('/me', RewardsController.getCoinBalance);
rewardsRouter.get('/history', RewardsController.getCoinHistory);
rewardsRouter.post('/redeem', RewardsController.redeemCoins);