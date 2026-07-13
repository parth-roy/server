-- Full goods declaration and linked workforce requirements.
-- Additive/idempotent by design: no existing booking or workforce data is removed.

DO $$
BEGIN
  CREATE TYPE "LaborType" AS ENUM ('LOADING', 'UNLOADING', 'BOTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "goodsType" TEXT NOT NULL DEFAULT 'General Goods',
  ADD COLUMN IF NOT EXISTS "goodsDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "goodsWeightKg" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "goodsQuantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "goodsLengthCm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "goodsWidthCm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "goodsHeightCm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "declaredGoodsValue" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "handlingInstructions" TEXT,
  ADD COLUMN IF NOT EXISTS "containsRestrictedGoods" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "goodsImageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "laborRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "laborersCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "laborType" "LaborType",
  ADD COLUMN IF NOT EXISTS "laborCharge" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "bookings_laborRequired_status_idx"
  ON "bookings"("laborRequired", "status");

DO $$
BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_goods_quantity_check"
    CHECK ("goodsQuantity" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_goods_weight_check"
    CHECK ("goodsWeightKg" IS NULL OR "goodsWeightKg" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_labor_count_check"
    CHECK (
      ("laborRequired" = false AND "laborersCount" IS NULL AND "laborType" IS NULL)
      OR
      ("laborRequired" = true AND "laborersCount" > 0 AND "laborType" IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
