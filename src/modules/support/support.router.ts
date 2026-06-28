import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as SupportController from './support.controller';
import { createTicketSchema, addMessageSchema } from './support.schema';

export const supportRouter = Router();

supportRouter.use(authenticate);

supportRouter.post('/', validate(createTicketSchema), SupportController.createTicket);
supportRouter.get('/', SupportController.getTickets);
supportRouter.get('/:id', SupportController.getTicketDetails);
supportRouter.post('/:id/messages', validate(addMessageSchema), SupportController.addMessage);