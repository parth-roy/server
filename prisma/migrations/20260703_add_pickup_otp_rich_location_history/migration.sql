-- AlterTable: Add pickup OTP to bookings
ALTER TABLE "bookings" ADD COLUMN "pickupOtp" TEXT;

-- AlterTable: Enrich booking_location_history with GPS metadata
ALTER TABLE "booking_location_history"
  ADD COLUMN "driverId"   TEXT,
  ADD COLUMN "speedKmh"   DOUBLE PRECISION,
  ADD COLUMN "headingDeg" DOUBLE PRECISION,
  ADD COLUMN "accuracyM"  DOUBLE PRECISION,
  ADD COLUMN "tripPhase"  TEXT;

-- CreateIndex: Fast admin/fleet queries by driver
CREATE INDEX "booking_location_history_driverId_recordedAt_idx"
  ON "booking_location_history"("driverId", "recordedAt");
