-- AlterTable
ALTER TABLE "users" ADD COLUMN     "profileComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usageType" TEXT DEFAULT 'Personal Usage',
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true;
