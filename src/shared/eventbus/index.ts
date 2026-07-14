import { EventEmitter2 } from 'eventemitter2';

export interface AppEvents {
  // Auth
  'user.registered': { userId: string; fcmToken?: string };
  // Booking lifecycle
  'booking.confirmed': { bookingId: string; customerId: string; vehicleType: string };
  'booking.driver_assigned': { bookingId: string; driverId: string; customerId: string };
  'booking.driver_arriving': { bookingId: string; customerId: string };
  'booking.goods_loaded': { bookingId: string; customerId: string };
  'booking.picked_up': { bookingId: string };
  'booking.delivered': { bookingId: string; customerId: string; totalFare: number };
  'booking.cancelled': { bookingId: string; customerId: string; reason: string };
  'booking.bid_accepted': { bookingId: string; driverId: string };
  // Payments
  'payment.completed': { bookingId: string; customerId: string; amount: number; method: string };
  'payment.wallet_topped_up': { userId: string; amount: number };
  // Rewards
  'rewards.coins_earned': { userId: string; coins: number; bookingId: string };
  'rewards.scratch_card_ready': { userId: string };
  // Announcements
  'announcement.created': { target: string; title: string; body: string };
}

class TypedEventBus extends EventEmitter2 {
  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): boolean {
    return super.emit(event as string, data);
  }
  on<K extends keyof AppEvents>(event: K, listener: (data: AppEvents[K]) => void): this {
    return super.on(event as string, listener) as this;
  }
}

export const eventBus = new TypedEventBus({ wildcard: false, maxListeners: 20 });