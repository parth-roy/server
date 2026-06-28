import { Request, Response, NextFunction } from 'express';
import * as SupportService from './support.service';
import { sendSuccess } from '@shared/utils/response';

export async function createTicket(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await SupportService.createTicket(req.user!.id, req.body);
        sendSuccess(res, result, 'Support ticket created successfully', 201);
    } catch (err) {
        next(err);
    }
}

export async function getTickets(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await SupportService.getTickets(req.user!.id);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}

export async function getTicketDetails(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await SupportService.getTicketDetails(req.params.id as string, req.user!.id);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}

export async function addMessage(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await SupportService.addMessage(req.params.id as string, req.user!.id, req.body);
        sendSuccess(res, result, 'Message added', 201);
    } catch (err) {
        next(err);
    }
}
