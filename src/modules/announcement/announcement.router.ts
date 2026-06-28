import { Router } from 'express';
import * as AnnouncementController from './announcement.controller';

export const announcementRouter = Router();

// Publicly available (or can add auth if needed)
announcementRouter.get('/', AnnouncementController.getAnnouncements);
