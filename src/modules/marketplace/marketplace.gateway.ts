import jwt from 'jsonwebtoken';
import { Server as SocketServer, Socket } from 'socket.io';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { UserRole } from '@prisma/client';
import { canSubscribeToBidThread, canSubscribeToBidWindow } from './marketplace.service';

type MarketplaceSocket = Socket & { user?: { userId: string; role: UserRole } };

function authenticateSocket(socket: MarketplaceSocket, next: (error?: Error) => void) {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token || typeof token !== 'string') return next(new Error('Authentication error: Missing token'));
  try {
    socket.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string; role: UserRole };
    next();
  } catch {
    next(new Error('Authentication error: Invalid token'));
  }
}

export function setupMarketplaceGateway(io: SocketServer) {
  const marketplace = io.of('/marketplace');
  marketplace.use(authenticateSocket);

  marketplace.on('connection', (socket: MarketplaceSocket) => {
    const userId = socket.user!.userId;
    const role = socket.user!.role;
    socket.join(`marketplace_user_${userId}`);

    socket.on('subscribe_bid_window', async (bookingId: unknown, acknowledge?: (result: object) => void) => {
      if (typeof bookingId !== 'string') return acknowledge?.({ success: false, code: 'INVALID_BOOKING_ID' });
      const allowed = await canSubscribeToBidWindow(bookingId, { userId, role });
      if (!allowed) return acknowledge?.({ success: false, code: 'FORBIDDEN' });
      await socket.join(`marketplace_customer_${bookingId}`);
      acknowledge?.({ success: true });
    });

    socket.on('unsubscribe_bid_window', (bookingId: unknown) => {
      if (typeof bookingId === 'string') socket.leave(`marketplace_customer_${bookingId}`);
    });

    socket.on('subscribe_bid_thread', async (bidId: unknown, acknowledge?: (result: object) => void) => {
      if (typeof bidId !== 'string') return acknowledge?.({ success: false, code: 'INVALID_BID_ID' });
      const allowed = await canSubscribeToBidThread(bidId, { userId, role });
      if (!allowed) return acknowledge?.({ success: false, code: 'FORBIDDEN' });
      await socket.join(`marketplace_bid_${bidId}`);
      acknowledge?.({ success: true });
    });

    socket.on('unsubscribe_bid_thread', (bidId: unknown) => {
      if (typeof bidId === 'string') socket.leave(`marketplace_bid_${bidId}`);
    });

    socket.on('subscribe_opportunities', (_: unknown, acknowledge?: (result: object) => void) => {
      if (role !== UserRole.DRIVER && role !== UserRole.FLEET_OWNER) {
        return acknowledge?.({ success: false, code: 'FORBIDDEN' });
      }
      acknowledge?.({ success: true });
    });

    socket.on('disconnect', () => logger.debug(`[Marketplace] Socket disconnected: ${socket.id}`));
  });

  logger.info('✅ Marketplace gateway ready (/marketplace namespace)');
}
