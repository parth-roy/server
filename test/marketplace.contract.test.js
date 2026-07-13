const test = require('node:test');
const assert = require('node:assert/strict');
const { BookingStatus } = require('@prisma/client');
const {
  createRevisionSchema,
  sendBidMessageSchema,
  submitBidSchema,
} = require('../dist/modules/marketplace/marketplace.schema');
const {
  assertTransition,
} = require('../dist/modules/booking/booking.transition');

const id = '6d9ba650-3d6e-4e85-a92b-7de88cc7a2c4';
const revisionId = '7cfc67dd-e31d-48b6-8c60-a62e6f531dc5';

test('initial bid requires a complete official commercial offer', () => {
  const result = submitBidSchema.safeParse({
    idempotencyKey: id,
    amount: 25000,
    pickupCommitmentAt: new Date(Date.now() + 3_600_000).toISOString(),
    transitMinutes: 720,
    validForMinutes: 10,
    inclusions: ['Driver', 'Fuel'],
    exclusions: ['Toll'],
  });
  assert.equal(result.success, true);
  assert.equal(submitBidSchema.safeParse({ idempotencyKey: id, amount: 25000 }).success, false);
});

test('counteroffer must reference the exact latest revision and change a commercial field', () => {
  assert.equal(
    createRevisionSchema.safeParse({
      idempotencyKey: id,
      expectedLatestRevisionId: revisionId,
      amount: 24500,
    }).success,
    true,
  );
  assert.equal(
    createRevisionSchema.safeParse({
      idempotencyKey: id,
      expectedLatestRevisionId: revisionId,
      message: 'make it cheaper',
    }).success,
    false,
  );
});

test('private chat rejects empty messages and accepts bounded text', () => {
  assert.equal(sendBidMessageSchema.safeParse({ clientMessageId: id, message: '   ' }).success, false);
  assert.equal(sendBidMessageSchema.safeParse({ clientMessageId: id, message: 'Can pickup move to 4 PM?' }).success, true);
});

test('marketplace assignment uses the canonical booking state machine', () => {
  assert.doesNotThrow(() =>
    assertTransition(BookingStatus.CONFIRMED, BookingStatus.DRIVER_ASSIGNED),
  );
  assert.doesNotThrow(() =>
    assertTransition(BookingStatus.DRIVER_ASSIGNED, BookingStatus.CONFIRMED),
  );
  assert.throws(
    () => assertTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED),
    /Cannot move booking from CONFIRMED to COMPLETED/,
  );
});
