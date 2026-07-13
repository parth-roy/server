import { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '@shared/utils/response';
import * as MarketplaceService from './marketplace.service';

const actor = (req: Request) => ({ userId: req.user!.id, role: req.user!.role });

export async function listOpportunities(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.listOpportunities(actor(req), req.query as any);
    sendSuccess(res, result.opportunities, 'Opportunities fetched', 200, result.meta);
  } catch (error) { next(error); }
}

export async function getOpportunity(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.getOpportunity(req.params.bookingId as string, actor(req));
    sendSuccess(res, result, 'Opportunity fetched');
  } catch (error) { next(error); }
}

export async function listBookingBids(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.listBookingBids(req.params.bookingId as string, actor(req));
    sendSuccess(res, result, 'Private bids fetched');
  } catch (error) { next(error); }
}

export async function submitBid(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.submitBid(req.params.bookingId as string, actor(req), req.body);
    sendSuccess(res, result, 'Private bid submitted', 201);
  } catch (error) { next(error); }
}

export async function getBidThread(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.getBidThread(req.params.bidId as string, actor(req));
    sendSuccess(res, result, 'Bid negotiation fetched');
  } catch (error) { next(error); }
}

export async function createRevision(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.createRevision(req.params.bidId as string, actor(req), req.body);
    sendSuccess(res, result, 'Official offer revision created', 201);
  } catch (error) { next(error); }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.sendMessage(req.params.bidId as string, actor(req), req.body);
    sendSuccess(res, result, 'Message sent', 201);
  } catch (error) { next(error); }
}

export async function withdrawBid(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.withdrawBid(req.params.bidId as string, actor(req));
    sendSuccess(res, result, 'Bid withdrawn');
  } catch (error) { next(error); }
}

export async function rejectBid(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.rejectBid(req.params.bidId as string, actor(req));
    sendSuccess(res, result, 'Bid rejected');
  } catch (error) { next(error); }
}

export async function acceptRevision(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.acceptExactRevision(
      req.params.bidId as string,
      req.params.revisionId as string,
      actor(req),
    );
    sendSuccess(res, result, 'Offer selected; payment is required to confirm the award');
  } catch (error) { next(error); }
}

export async function getAward(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.getAward(req.params.bookingId as string, actor(req));
    sendSuccess(res, result, 'Bid award fetched');
  } catch (error) { next(error); }
}

export async function secureCashAward(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await MarketplaceService.secureCashAward(req.params.bookingId as string, actor(req));
    sendSuccess(res, result, 'Cash payment condition secured; award confirmed');
  } catch (error) { next(error); }
}
