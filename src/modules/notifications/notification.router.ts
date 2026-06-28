import { Router } from 'express';
import { notificationController } from './notification.controller';
import * as InAppController from './inapp.notification.controller';
import { authenticate } from '@shared/middleware/auth.middleware';

export const notificationRouter = Router();

// ── Admin/server push routes (no auth for internal server-to-server calls) ───
notificationRouter.post('/send', notificationController.send);
notificationRouter.post('/send-multicast', notificationController.sendMulticast);
notificationRouter.post('/subscribe', notificationController.subscribe);

// ── Customer-facing in-app notification routes (require auth) ──────────────
notificationRouter.use(authenticate);
notificationRouter.get('/me', InAppController.listNotifications);
notificationRouter.patch('/read-all', InAppController.markAllRead);
notificationRouter.patch('/:id/read', InAppController.markOneRead);