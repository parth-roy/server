import { Request, Response, NextFunction } from 'express';
import * as InAppService from './inapp.notification.service';
import { sendSuccess } from '@shared/utils/response';
import { AppError } from '@shared/errors/AppError';

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

        const result = await InAppService.listNotifications(req.user!.id, page, limit);
        sendSuccess(res, result.notifications, 'Notifications fetched', 200, {
            ...result.meta,
            unreadCount: result.unreadCount,
        });
    } catch (err) {
        next(err);
    }
}

export async function markOneRead(req: Request, res: Response, next: NextFunction) {
    try {
        const id = req.params['id'] as string;
        if (!id) throw AppError.badRequest('Notification ID is required');

        const notification = await InAppService.markOneRead(id, req.user!.id);
        sendSuccess(res, notification, 'Notification marked as read');
    } catch (err) {
        next(err);
    }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await InAppService.markAllRead(req.user!.id);
        sendSuccess(res, result, `${result.updatedCount} notifications marked as read`);
    } catch (err) {
        next(err);
    }
}
