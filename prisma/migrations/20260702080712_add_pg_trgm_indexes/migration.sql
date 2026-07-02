-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "drivers_licenseNumber_idx" ON "drivers" USING GIN ("licenseNumber" gin_trgm_ops);
