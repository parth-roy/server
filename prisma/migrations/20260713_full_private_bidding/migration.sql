-- Full private marketplace bidding.
-- This is an additive migration: the legacy `bids` table is intentionally retained.

CREATE TYPE "BookingMode" AS ENUM ('INSTANT', 'PRIVATE_BID');
CREATE TYPE "BidWindowStatus" AS ENUM ('OPEN', 'LOCKED', 'CLOSED', 'EXPIRED', 'WITHDRAWN');
CREATE TYPE "BidPartyType" AS ENUM ('DRIVER', 'FLEET_OWNER');
CREATE TYPE "MarketplaceBidStatus" AS ENUM ('OPEN', 'ACCEPTED', 'WITHDRAWN', 'REJECTED', 'NOT_SELECTED', 'EXPIRED');
CREATE TYPE "BidRevisionAuthorSide" AS ENUM ('CUSTOMER', 'PROVIDER');
CREATE TYPE "BidMessageType" AS ENUM ('TEXT', 'SYSTEM');
CREATE TYPE "BidAwardStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_RECONCILING', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "bookings"
  ADD COLUMN "bookingMode" "BookingMode" NOT NULL DEFAULT 'INSTANT',
  ADD COLUMN "bidWindowMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "marketplaceVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "awardedFleetOwnerId" TEXT;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bid_window_minutes_check"
  CHECK ("bidWindowMinutes" BETWEEN 1 AND 60);

CREATE TABLE "bid_windows" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "BidWindowStatus" NOT NULL DEFAULT 'OPEN',
  "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closesAt" TIMESTAMP(3) NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "maxRevisionsPerBid" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bid_windows_limits_check" CHECK (
    "closesAt" > "opensAt" AND "version" > 0 AND "maxRevisionsPerBid" > 0
  )
);

CREATE TABLE "marketplace_bids" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "windowId" TEXT NOT NULL,
  "participantKey" TEXT NOT NULL,
  "partyType" "BidPartyType" NOT NULL,
  "driverId" TEXT,
  "fleetOwnerId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "status" "MarketplaceBidStatus" NOT NULL DEFAULT 'OPEN',
  "latestRevisionNumber" INTEGER NOT NULL DEFAULT 0,
  "latestRevisionId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_bids_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketplace_bids_party_check" CHECK (
    ("partyType" = 'DRIVER' AND "driverId" IS NOT NULL AND "fleetOwnerId" IS NULL)
    OR
    ("partyType" = 'FLEET_OWNER' AND "fleetOwnerId" IS NOT NULL AND "driverId" IS NULL)
  )
);

CREATE TABLE "bid_revisions" (
  "id" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "previousRevisionId" TEXT,
  "authorUserId" TEXT NOT NULL,
  "authorSide" "BidRevisionAuthorSide" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "quotedAmount" DECIMAL(12,2) NOT NULL,
  "gstAmount" DECIMAL(12,2) NOT NULL,
  "customerTotal" DECIMAL(12,2) NOT NULL,
  "pickupCommitmentAt" TIMESTAMP(3) NOT NULL,
  "transitMinutes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "vehicleType" "VehicleType" NOT NULL,
  "vehicleId" TEXT,
  "inclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "exclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT,
  "termsSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bid_revisions_amount_check" CHECK ("quotedAmount" > 0 AND "gstAmount" >= 0 AND "customerTotal" >= "quotedAmount"),
  CONSTRAINT "bid_revisions_time_check" CHECK ("transitMinutes" > 0 AND "expiresAt" > "createdAt")
);

CREATE TABLE "bid_messages" (
  "id" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "clientMessageId" TEXT NOT NULL,
  "type" "BidMessageType" NOT NULL DEFAULT 'TEXT',
  "message" TEXT NOT NULL,
  "revisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bid_messages_nonempty_check" CHECK (char_length(btrim("message")) > 0)
);

CREATE TABLE "bid_awards" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "BidAwardStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
  "activeKey" TEXT,
  "quotedAmount" DECIMAL(12,2) NOT NULL,
  "gstAmount" DECIMAL(12,2) NOT NULL,
  "customerTotal" DECIMAL(12,2) NOT NULL,
  "previousPricingSnapshot" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paymentDeadline" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_awards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bid_awards_amount_check" CHECK (
    "quotedAmount" > 0 AND "gstAmount" >= 0 AND "customerTotal" >= "quotedAmount"
  ),
  CONSTRAINT "bid_awards_deadline_check" CHECK ("paymentDeadline" > "acceptedAt"),
  CONSTRAINT "bid_awards_active_status_check" CHECK (
    ("activeKey" IS NOT NULL AND "status" IN ('PAYMENT_PENDING', 'PAYMENT_RECONCILING', 'CONFIRMED'))
    OR
    ("activeKey" IS NULL AND "status" IN ('EXPIRED', 'CANCELLED'))
  )
);

CREATE UNIQUE INDEX "bid_windows_bookingId_key" ON "bid_windows"("bookingId");
CREATE INDEX "bid_windows_status_closesAt_idx" ON "bid_windows"("status", "closesAt");

CREATE UNIQUE INDEX "marketplace_bids_bookingId_participantKey_key" ON "marketplace_bids"("bookingId", "participantKey");
CREATE INDEX "marketplace_bids_bookingId_status_idx" ON "marketplace_bids"("bookingId", "status");
CREATE INDEX "marketplace_bids_driverId_status_idx" ON "marketplace_bids"("driverId", "status");
CREATE INDEX "marketplace_bids_fleetOwnerId_status_idx" ON "marketplace_bids"("fleetOwnerId", "status");

CREATE UNIQUE INDEX "bid_revisions_idempotencyKey_key" ON "bid_revisions"("idempotencyKey");
CREATE UNIQUE INDEX "bid_revisions_bidId_revisionNumber_key" ON "bid_revisions"("bidId", "revisionNumber");
CREATE INDEX "bid_revisions_bidId_createdAt_idx" ON "bid_revisions"("bidId", "createdAt");
CREATE INDEX "bid_revisions_expiresAt_idx" ON "bid_revisions"("expiresAt");

CREATE UNIQUE INDEX "bid_messages_clientMessageId_key" ON "bid_messages"("clientMessageId");
CREATE INDEX "bid_messages_bidId_createdAt_idx" ON "bid_messages"("bidId", "createdAt");

CREATE UNIQUE INDEX "bid_awards_revisionId_key" ON "bid_awards"("revisionId");
CREATE UNIQUE INDEX "bid_awards_activeKey_key" ON "bid_awards"("activeKey");
CREATE INDEX "bid_awards_bookingId_status_idx" ON "bid_awards"("bookingId", "status");
CREATE INDEX "bid_awards_status_paymentDeadline_idx" ON "bid_awards"("status", "paymentDeadline");

CREATE INDEX "bookings_bookingMode_status_idx" ON "bookings"("bookingMode", "status");
CREATE INDEX "bookings_awardedFleetOwnerId_status_idx" ON "bookings"("awardedFleetOwnerId", "status");

-- ALTER TABLE "bookings" ADD CONSTRAINT "bookings_awardedFleetOwnerId_fkey"
--  FOREIGN KEY ("awardedFleetOwnerId") REFERENCES "fleet_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bid_windows" ADD CONSTRAINT "bid_windows_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_windowId_fkey"
  FOREIGN KEY ("windowId") REFERENCES "bid_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_fleetOwnerId_fkey"
--  FOREIGN KEY ("fleetOwnerId") REFERENCES "fleet_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bid_revisions" ADD CONSTRAINT "bid_revisions_bidId_fkey"
  FOREIGN KEY ("bidId") REFERENCES "marketplace_bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_revisions" ADD CONSTRAINT "bid_revisions_previousRevisionId_fkey"
  FOREIGN KEY ("previousRevisionId") REFERENCES "bid_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_revisions" ADD CONSTRAINT "bid_revisions_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bid_messages" ADD CONSTRAINT "bid_messages_bidId_fkey"
  FOREIGN KEY ("bidId") REFERENCES "marketplace_bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_messages" ADD CONSTRAINT "bid_messages_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_messages" ADD CONSTRAINT "bid_messages_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "bid_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_bidId_fkey"
  FOREIGN KEY ("bidId") REFERENCES "marketplace_bids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "bid_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
