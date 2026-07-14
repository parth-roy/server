import { Router } from 'express';
import * as AnnouncementController from './announcement.controller';
import { authenticate } from '@shared/middleware/auth.middleware';

export const announcementRouter = Router();

// Now requires auth to know user role
announcementRouter.get('/', authenticate, AnnouncementController.getAnnouncements);
