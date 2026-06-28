import { Router } from 'express';
import { mapsController } from './maps.controller';

export const mapsRouter = Router();

// Place search
mapsRouter.get('/autocomplete', mapsController.autocomplete);
mapsRouter.get('/place-details', mapsController.placeDetails);

// Geocoding
mapsRouter.get('/reverse-geocode', mapsController.reverseGeocode);
mapsRouter.get('/geocode', mapsController.geocode);

// Distance / routing
mapsRouter.get('/distance-matrix', mapsController.distanceMatrix);

// Recent searches
mapsRouter.get('/recent-searches', mapsController.getRecentSearches);
mapsRouter.post('/recent-searches', mapsController.addRecentSearch);
mapsRouter.delete('/recent-searches/clear', mapsController.clearRecentSearches);
mapsRouter.delete('/recent-searches/:id', mapsController.deleteRecentSearch);
