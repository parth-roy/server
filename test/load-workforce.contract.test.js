const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createBookingSchema } = require('../dist/modules/booking/booking.schema');

const baseBooking = {
  bookingMode: 'PRIVATE_BID',
  vehicleType: 'TATA_ACE',
  pickupLat: 28.6139,
  pickupLng: 77.209,
  pickupAddress: 'Connaught Place, New Delhi',
  stops: [{ latitude: 28.5355, longitude: 77.391, address: 'Sector 18, Noida' }],
  goodsType: 'Building Materials',
  goodsDescription: '12 cartons of ceramic tiles',
  goodsWeightKg: 420,
  goodsQuantity: 12,
  handlingInstructions: 'Keep cartons upright',
  containsRestrictedGoods: false,
  goodsImageUrls: ['https://cdn.example.com/bookings/load-1.jpg'],
  laborRequired: true,
  laborersCount: 2,
  laborType: 'BOTH',
};

test('booking contract accepts a complete goods declaration with linked workforce', () => {
  const result = createBookingSchema.safeParse(baseBooking);
  assert.equal(result.success, true);
  assert.equal(result.data.hasLoadingService, false);
  assert.equal(result.data.goodsQuantity, 12);
  assert.equal(createBookingSchema.safeParse({ ...baseBooking, goodsDescription: undefined }).success, false);
  assert.equal(createBookingSchema.safeParse({ ...baseBooking, goodsWeightKg: undefined }).success, false);
});

test('linked workforce requires both labour count and labour type', () => {
  assert.equal(
    createBookingSchema.safeParse({ ...baseBooking, laborersCount: undefined }).success,
    false,
  );
  assert.equal(
    createBookingSchema.safeParse({ ...baseBooking, laborType: undefined }).success,
    false,
  );
});

test('booking contract limits load evidence to five URLs', () => {
  const sixImages = Array.from({ length: 6 }, (_, index) => `https://cdn.example.com/${index}.jpg`);
  assert.equal(
    createBookingSchema.safeParse({ ...baseBooking, goodsImageUrls: sixImages }).success,
    false,
  );
});

test('workforce acceptance is serializable and stores per-worker payout', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/modules/workforce/workforce.service.ts'),
    'utf8',
  );
  const start = source.indexOf('export async function acceptJob');
  const end = source.indexOf('// JOBS — DECLINE', start);
  const implementation = source.slice(start, end);

  assert.match(implementation, /TransactionIsolationLevel\.Serializable/);
  assert.match(implementation, /payoutAmount:\s*\(booking\.laborCharge \?\? 0\) \/ totalSlots/);
  assert.match(implementation, /status:\s*WorkerStatus\.AVAILABLE/);
});
