import { Request, Response, NextFunction } from 'express';
import * as AnnouncementService from './announcement.service';
import { sendSuccess } from '@shared/utils/response';

export async function getAnnouncements(req: Request, res: Response, next: NextFunction) {
    try {
        const user = (req as any).user;
        const result = await AnnouncementService.getActiveAnnouncements(user?.role);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}
