import { Request, Response } from 'express';
import { sendSuccess } from '@shared/utils/response';
import * as gigService from './gig.service';

export async function createGig(req: Request, res: Response) {
    const gig = await gigService.createGig(req.user!.id, req.body);
    return sendSuccess(res, gig, 'Gig job posted successfully', 201);
}

export async function getCustomerGigs(req: Request, res: Response) {
    const gigs = await gigService.getCustomerGigs(req.user!.id);
    return sendSuccess(res, gigs);
}

export async function getNearbyGigs(req: Request, res: Response) {
    const { lat, lng, radiusKm } = req.query;
    const latitude = parseFloat(lat as any);
    const longitude = parseFloat(lng as any);
    const gigs = await gigService.getNearbyGigs(
        latitude || 0,
        longitude || 0,
        parseFloat(radiusKm as any) || 10
    );
    return sendSuccess(res, gigs);
}

export async function getAllGigsAdmin(req: Request, res: Response) {
    const gigs = await gigService.getAllGigs();
    return sendSuccess(res, gigs);
}

export async function acceptGig(req: Request, res: Response) {
    const assignment = await gigService.acceptGig(req.user!.id as string, req.params.id as string);
    return sendSuccess(res, assignment, 'Job accepted successfully');
}
