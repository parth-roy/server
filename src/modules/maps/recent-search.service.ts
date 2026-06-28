import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';

export interface RecentSearch {
  id: string;
  placeId: string;
  address: string;
  latitude: number;
  longitude: number;
  searchType: string;
  createdAt: Date;
}

export const recentSearchService = {
  /**
   * Get recent searches for a user (or device)
   */
  getRecentSearches: async (userId?: string, limit: number = 10): Promise<RecentSearch[]> => {
    try {
      const searches = await prisma.recentSearch.findMany({
        where: userId ? { userId } : { userId: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return searches.map((s) => ({
        id: s.id,
        placeId: s.placeId,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        searchType: s.searchType,
        createdAt: s.createdAt,
      }));
    } catch (error: any) {
      logger.error('Error fetching recent searches:', error.message);
      throw AppError.internal('Failed to fetch recent searches');
    }
  },

  /**
   * Add a recent search
   */
  addRecentSearch: async (data: {
    userId?: string;
    placeId: string;
    address: string;
    latitude: number;
    longitude: number;
    searchType?: string;
  }): Promise<RecentSearch> => {
    try {
      // Check if this exact search already exists (within last hour)
      const existing = await prisma.recentSearch.findFirst({
        where: {
          placeId: data.placeId,
          userId: data.userId || null,
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // Last 1 hour
          },
        },
      });

      // If exists, just update the timestamp
      if (existing) {
        const updated = await prisma.recentSearch.update({
          where: { id: existing.id },
          data: { createdAt: new Date() },
        });
        
        return {
          id: updated.id,
          placeId: updated.placeId,
          address: updated.address,
          latitude: updated.latitude,
          longitude: updated.longitude,
          searchType: updated.searchType,
          createdAt: updated.createdAt,
        };
      }

      // Limit to 20 recent searches per user/device
      const count = await prisma.recentSearch.count({
        where: data.userId ? { userId: data.userId } : { userId: null },
      });

      if (count >= 20) {
        // Delete oldest entries
        const oldest = await prisma.recentSearch.findMany({
          where: data.userId ? { userId: data.userId } : { userId: null },
          orderBy: { createdAt: 'asc' },
          take: count - 19,
        });
        
        await prisma.recentSearch.deleteMany({
          where: {
            id: { in: oldest.map((s) => s.id) },
          },
        });
      }

      // Create new recent search
      const search = await prisma.recentSearch.create({
        data: {
          userId: data.userId || null,
          placeId: data.placeId,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
          searchType: data.searchType || 'pickup',
        },
      });

      return {
        id: search.id,
        placeId: search.placeId,
        address: search.address,
        latitude: search.latitude,
        longitude: search.longitude,
        searchType: search.searchType,
        createdAt: search.createdAt,
      };
    } catch (error: any) {
      logger.error('Error adding recent search:', error.message);
      throw AppError.internal('Failed to save recent search');
    }
  },

  /**
   * Delete a recent search
   */
  deleteRecentSearch: async (id: string, userId?: string): Promise<void> => {
    try {
      await prisma.recentSearch.delete({
        where: {
          id,
          ...(userId && { userId }),
        },
      });
    } catch (error: any) {
      logger.error('Error deleting recent search:', error.message);
      throw AppError.internal('Failed to delete recent search');
    }
  },

  /**
   * Clear all recent searches for a user/device
   */
  clearRecentSearches: async (userId?: string): Promise<void> => {
    try {
      await prisma.recentSearch.deleteMany({
        where: userId ? { userId } : { userId: null },
      });
    } catch (error: any) {
      logger.error('Error clearing recent searches:', error.message);
      throw AppError.internal('Failed to clear recent searches');
    }
  },
};