import { BookingStatus } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';

// The single booking lifecycle policy used by every module that changes status.
const VALID_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.DRAFT]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.DRIVER_ASSIGNED]: [
    BookingStatus.CONFIRMED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.DRIVER_ARRIVING]: [BookingStatus.PICKED_UP, BookingStatus.CANCELLED],
  [BookingStatus.PICKED_UP]: [BookingStatus.IN_TRANSIT, BookingStatus.DELIVERED],
  [BookingStatus.IN_TRANSIT]: [BookingStatus.DELIVERED],
  [BookingStatus.DELIVERED]: [BookingStatus.COMPLETED],
};

export function assertTransition(current: BookingStatus, next: BookingStatus): void {
  const allowed = VALID_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw AppError.badRequest(
      `Cannot move booking from ${current} to ${next}`,
      'INVALID_STATE_TRANSITION',
    );
  }
}
