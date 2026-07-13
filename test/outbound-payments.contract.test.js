const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The safety contract is fail-closed regardless of developer machine settings.
process.env.RAZORPAYX_PAYOUTS_ENABLED = 'false';
process.env.MULTI_PARTY_TRANSFERS_ENABLED = 'false';

const policy = require('../dist/shared/payments/outbound-payment.policy');
const driverWallet = require('../dist/modules/driver-wallet/driver-wallet.service');
const fleetWallet = require('../dist/modules/fleet-wallet/fleet-wallet.service');
const workforce = require('../dist/modules/workforce/workforce.service');
const driverWalletController = require('../dist/modules/driver-wallet/driver-wallet.controller');

function assertPaused(error, code) {
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, code);
  return true;
}

test('standard Razorpay collections remain enabled while outbound capabilities are paused', () => {
  assert.deepEqual(policy.paymentCapabilities, {
    razorpayCollectionsEnabled: true,
    razorpayXPayoutsEnabled: false,
    multiPartyTransfersEnabled: false,
  });
});

test('all withdrawal services fail before querying or mutating a wallet', async () => {
  await assert.rejects(
    driverWallet.requestWithdrawal('driver-not-queried', 100),
    (error) => assertPaused(error, 'RAZORPAYX_PAYOUTS_DISABLED')
  );
  await assert.rejects(
    fleetWallet.requestFleetWithdrawal('fleet-not-queried', 100),
    (error) => assertPaused(error, 'RAZORPAYX_PAYOUTS_DISABLED')
  );
  await assert.rejects(
    workforce.withdrawWallet('worker-not-queried', { amount: 100 }),
    (error) => assertPaused(error, 'RAZORPAYX_PAYOUTS_DISABLED')
  );
});

test('the RazorpayX executor itself is fail-closed', async () => {
  await assert.rejects(
    driverWallet.processWithdrawalViaRazorpayX('request-not-queried'),
    (error) => assertPaused(error, 'RAZORPAYX_PAYOUTS_DISABLED')
  );
});

test('fleet-to-driver wallet transfers fail before reading or changing balances', async () => {
  await assert.rejects(
    fleetWallet.transferToDriver('fleet-not-queried', 'driver-not-queried', 100),
    (error) => assertPaused(error, 'MULTI_PARTY_TRANSFERS_DISABLED')
  );
});

test('offline cash salary recording cannot create a second driver-wallet liability', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/modules/fleet-wallet/fleet-wallet.service.ts'),
    'utf8'
  );
  const start = source.indexOf('export async function recordOfflineDriverSalary');
  assert.notEqual(start, -1);
  const implementation = source.slice(start);

  assert.doesNotMatch(implementation, /driverWallet\.(?:upsert|update|create)/);
  assert.doesNotMatch(implementation, /driverWalletTransaction\.create/);
});

test('admin payout retry fails before changing withdrawal status', async () => {
  let forwardedError;
  await driverWalletController.adminRetryWithdrawal(
    { params: { id: 'request-not-mutated' }, user: { id: 'admin' } },
    {},
    (error) => { forwardedError = error; }
  );

  assertPaused(forwardedError, 'RAZORPAYX_PAYOUTS_DISABLED');
});
