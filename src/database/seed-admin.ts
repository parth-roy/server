/**
 * seed-admin.ts — Creates the first ADMIN user in the database.
 *
 * Run with:
 *   npm run db:seed-admin
 *
 * This script is IDEMPOTENT:
 *   - If an ADMIN user already exists with this email, it skips creation.
 *   - Safe to run multiple times.
 *
 * After running, update the ADMIN_EMAIL/ADMIN_PASSWORD below to your real values,
 * then delete or rotate the password after first login.
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// CONFIGURE YOUR ADMIN CREDENTIALS HERE
// ─────────────────────────────────────────────

const ADMIN_EMAIL    = 'admin@gomytruck.com';     // Change to your admin email
const ADMIN_PASSWORD = 'Parther@Admin2026';       // Change this IMMEDIATELY after first login
const ADMIN_NAME     = 'Super Admin';
const ADMIN_PHONE    = '+910000000000';           // Placeholder — must be unique in users table

// ─────────────────────────────────────────────

async function main() {
  console.log('🌱 Parther Admin Seed Script');
  console.log('────────────────────────────────────');

  // Check if admin already exists
  const existing = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL, role: 'ADMIN' },
  });

  if (existing) {
    console.log(`✅ Admin already exists: ${existing.email} (id: ${existing.id})`);
    console.log('⏭️  Skipping — no changes made.');
    return;
  }

  // Hash password using argon2id (secure, memory-hard)
  console.log('🔐 Hashing password with argon2id...');
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MB
    timeCost: 3,
    parallelism: 4,
  });

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email:        ADMIN_EMAIL,
      phone:        ADMIN_PHONE,
      name:         ADMIN_NAME,
      role:         'ADMIN',
      isActive:     true,
      passwordHash,
      profileComplete: true,
    },
  });

  console.log('');
  console.log('✅ Admin user created successfully!');
  console.log('────────────────────────────────────');
  console.log(`   ID:    ${admin.id}`);
  console.log(`   Email: ${admin.email}`);
  console.log(`   Name:  ${admin.name}`);
  console.log(`   Role:  ${admin.role}`);
  console.log('────────────────────────────────────');
  console.log('');
  console.log('⚠️  IMPORTANT: Change the password after first login!');
  console.log(`   Login URL: http://localhost:5689/login`);
  console.log(`   Email:     ${ADMIN_EMAIL}`);
  console.log(`   Password:  ${ADMIN_PASSWORD}`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
