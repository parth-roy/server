-- CreateEnum
CREATE TYPE "UlipVerifStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW');

-- DropForeignKey
ALTER TABLE "drivers" DROP CONSTRAINT "drivers_vehicleId_fkey";

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "dlNumber" TEXT,
ADD COLUMN     "dlUlipRawResponse" JSONB,
ADD COLUMN     "dlVerifStatus" "UlipVerifStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "dlVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "permitTypes" TEXT,
ALTER COLUMN "vehicleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "chassisNumber" TEXT,
ADD COLUMN     "engineNumber" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "rcUlipRawResponse" JSONB,
ADD COLUMN     "rcVerifStatus" "UlipVerifStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "rcVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "verification_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "apiCalled" TEXT NOT NULL,
    "requestBody" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "status" "UlipVerifStatus" NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledBy" TEXT NOT NULL,

    CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_logs_entityId_entityType_idx" ON "verification_logs"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "verification_logs_calledAt_idx" ON "verification_logs"("calledAt");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
