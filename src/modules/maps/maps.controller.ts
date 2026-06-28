import { Request, Response, NextFunction } from 'express';
import { recentSearchService } from './recent-search.service';
import { mapsService } from './maps.service';

export const mapsController = {
  autocomplete: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.query.input as string | undefined;
      if (!input) return res.status(400).json({ success: false, message: 'input query is required' });
      const sessionToken = typeof req.query.sessionToken === 'string' ? req.query.sessionToken : undefined;
      const predictions = await mapsService.autocomplete(input, sessionToken);
      res.status(200).json({ success: true, data: predictions });
    } catch (error) { next(error); }
  },

  placeDetails: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const placeId = req.query.placeId as string | undefined;
      if (!placeId) return res.status(400).json({ success: false, message: 'placeId is required' });
      const sessionToken = typeof req.query.sessionToken === 'string' ? req.query.sessionToken : undefined;
      const details = await mapsService.placeDetails(placeId, sessionToken);
      res.status(200).json({ success: true, data: details });
    } catch (error) { next(error); }
  },

  reverseGeocode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lat, lng } = req.query;
      if (lat === undefined || lng === undefined) return res.status(400).json({ success: false, message: 'lat and lng are required' });
      const result = await mapsService.reverseGeocode(parseFloat(lat as string), parseFloat(lng as string));
      res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },

  geocode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.query.address as string | undefined;
      if (!address) return res.status(400).json({ success: false, message: 'address query is required' });
      const results = await mapsService.autocomplete(address, undefined);
      if (!results || results.length === 0) return res.status(404).json({ success: false, message: 'No results found' });
      const details = await mapsService.placeDetails(results[0].placeId as string);
      res.status(200).json({ success: true, data: details });
    } catch (error) { next(error); }
  },

  distanceMatrix: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { originLat, originLng, destLat, destLng } = req.query;
      if (!originLat || !originLng || !destLat || !destLng) return res.status(400).json({ success: false, message: 'originLat, originLng, destLat, destLng are required' });
      const result = await mapsService.getDistanceMatrix(parseFloat(originLat as string), parseFloat(originLng as string), parseFloat(destLat as string), parseFloat(destLng as string));
      res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },

  getRecentSearches: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIdHeader = req.headers['x-user-id'];
      const userId = typeof userIdHeader === 'string' ? userIdHeader : undefined;
      const limit = parseInt(req.query.limit as string) || 10;
      const searches = await recentSearchService.getRecentSearches(userId, limit);
      res.status(200).json({ success: true, data: searches });
    } catch (error) { next(error); }
  },

  addRecentSearch: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIdHeader = req.headers['x-user-id'];
      const userId = typeof userIdHeader === 'string' ? userIdHeader : undefined;
      const { placeId, address, latitude, longitude, searchType } = req.body;
      if (!placeId || !address || latitude === undefined || longitude === undefined) return res.status(400).json({ success: false, message: 'placeId, address, latitude, and longitude are required' });
      await mapsService.placeDetails(placeId);
      const search = await recentSearchService.addRecentSearch({ userId, placeId, address, latitude, longitude, searchType });
      res.status(201).json({ success: true, data: search });
    } catch (error) { next(error); }
  },

  deleteRecentSearch: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIdHeader = req.headers['x-user-id'];
      const userId = typeof userIdHeader === 'string' ? userIdHeader : undefined;
      const id = req.params['id'] as string;
      if (!id) return res.status(400).json({ success: false, message: 'id is required' });
      await recentSearchService.deleteRecentSearch(id, userId);
      res.status(200).json({ success: true, message: 'Recent search deleted' });
    } catch (error) { next(error); }
  },

  clearRecentSearches: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIdHeader = req.headers['x-user-id'];
      const userId = typeof userIdHeader === 'string' ? userIdHeader : undefined;
      await recentSearchService.clearRecentSearches(userId);
      res.status(200).json({ success: true, message: 'All recent searches cleared' });
    } catch (error) { next(error); }
  },
};
