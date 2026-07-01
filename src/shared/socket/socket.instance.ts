/**
 * socket.instance.ts — Socket.IO server singleton.
 *
 * Why this exists:
 *   BullMQ workers run in a different execution context from the HTTP server.
 *   The ETA worker needs to emit socket events to customers without having
 *   access to the `io` instance created in server.ts.
 *
 *   Pattern: server.ts calls setSocketInstance(io) at startup.
 *            Any module calls getSocketInstance() to emit events.
 *
 * Thread safety: Node.js is single-threaded. Module-level variable is safe.
 */

import type { Server as SocketServer } from 'socket.io';

let socketInstance: SocketServer | null = null;

export function setSocketInstance(io: SocketServer): void {
    socketInstance = io;
}

export function getSocketInstance(): SocketServer | null {
    return socketInstance;
}

/**
 * Emit an event to all subscribers of a booking room.
 * Safe to call even if socket instance is not yet initialized (no-op).
 */
export function emitToBookingRoom(bookingId: string, event: string, data: object): void {
    if (!socketInstance) return;
    socketInstance.of('/tracking').to(`booking_${bookingId}`).emit(event, data);
}

/**
 * Emit an event to a specific driver's personal room.
 * Drivers join the room `driver_{driverId}` on connection in the tracking gateway.
 * Used by ULIP worker to push document verification results without a booking context.
 */
export function emitToDriverRoom(driverId: string, event: string, data: object): void {
    if (!socketInstance) return;
    socketInstance.of('/tracking').to(`driver_${driverId}`).emit(event, data);
}

/**
 * Emit an event to a specific worker's personal room.
 * Workers join the room `worker_{workerId}` on connection in the workforce gateway.
 * Used by dispatch to push new job alerts directly to individual workers.
 */
export function emitToWorkerRoom(workerId: string, event: string, data: object): void {
    if (!socketInstance) return;
    socketInstance.of('/workforce').to(`worker_${workerId}`).emit(event, data);
}


