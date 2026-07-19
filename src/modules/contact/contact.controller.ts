import { Request, Response, NextFunction } from 'express';
import * as ContactService from './contact.service';
import { sendSuccess } from '@shared/utils/response';

export async function createMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const message = await ContactService.createContactMessage(req.body);
    sendSuccess(res, message, 'Message sent successfully', 201);
  } catch (err) {
    next(err);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const messages = await ContactService.getContactMessages();
    sendSuccess(res, messages, 'Contact messages retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const message = await ContactService.updateContactMessageStatus(id as string, status);
    sendSuccess(res, message, 'Contact message status updated');
  } catch (err) {
    next(err);
  }
}
