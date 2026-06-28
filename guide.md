# Logistics App — Complete Backend Build Guide
## Your Co-Engineer's Full Step-by-Step Playbook
### Stack: Node.js · TypeScript · Express · Prisma · Supabase (PostgreSQL) · Upstash Redis · BullMQ · Socket.io · JWT

> **Architecture: Modular Monolith** — one codebase, clean module boundaries, easy to split later when you have 1000+ users.
> **Two key updates from previous discussion:** Supabase replaces local PostgreSQL. Upstash Redis replaces local Redis.

---

## BEFORE WE START — THE FULL ROADMAP

```
Phase 1 — Project Setup & Dependencies
Phase 2 — Supabase + Upstash Config + Full DB Schema
Phase 3 — Auth Module (OTP via MSG91, JWT, Refresh tokens)
Phase 4 — User Module (Profile, Addresses, GST)
Phase 5 — Booking Module (State machine, multi-stop)
Phase 6 — Pricing Engine (Distance-based, surge, add-ons)
Phase 7 — Dispatch Engine (Redis GEO, sequential matching)
Phase 8 — Tracking (Socket.io real-time GPS)
Phase 9 — Payment (Easebuzz + Wallet ledger)
Phase 10 — Rewards (Coins earn/burn)
Phase 11 — Notifications (FCM push + MSG91 SMS)
Phase 12 — Fleet & Support modules
Phase 13 — Deployment (PM2 + Nginx + AWS EC2 Mumbai)
```

This document covers **Phase 1 & 2** completely. Run it, get the server healthy, then ask for Phase 3.

---

## WHY SUPABASE + UPSTASH (The honest reasoning)

**Supabase** = hosted PostgreSQL + automatic backups + connection pooling built-in + dashboard to inspect tables. You get all the power of Postgres without running a DB server. Prisma connects to it exactly the same way — nothing changes in your code.

**Upstash Redis** = serverless Redis. Pay per request, free tier is generous, no server to manage. BullMQ works with it via ioredis (use the standard Redis URL from Upstash, not the REST URL). Socket.io Redis adapter also works fine.

**Cost to start:** Supabase free tier (500 MB, enough for thousands of users). Upstash free tier (10,000 requests/day). You pay ₹0 until you have real traffic.

---

## STEP 0 — SET UP SUPABASE (Do this before writing any code)

### 0.1 Create Supabase Project
1. Go to **https://supabase.com** → Sign up (free)
2. Click **"New Project"**
3. Set project name: `logistics-app`
4. Set a strong database password (save it — you'll need it)
5. Region: **Southeast Asia (Singapore)** — closest to Kolkata
6. Click **"Create new project"** — wait 2 minutes

### 0.2 Get Your Database URLs
After the project loads:
1. Go to **Settings → Database**
2. Under **"Connection string"** → select **"URI"**
3. Copy **two URLs** — you need both:

```
# For Prisma migrations (direct connection — bypasses pgBouncer)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# For your app at runtime (pooled via pgBouncer — handles connection limits)
DATABASE_DIRECT_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
```

> **Important:** Replace `[YOUR-PASSWORD]` with your actual password. Replace `[YOUR-PROJECT-REF]` with your project reference ID (visible in the URL and settings page).

> **Why two URLs?** Supabase uses pgBouncer for connection pooling. Prisma migrations need a direct connection. The app uses the pooled one. This is the correct setup for production.

---

## STEP 0B — SET UP UPSTASH REDIS

### 0B.1 Create Upstash Database
1. Go to **https://upstash.com** → Sign up (free)
2. Click **"Create Database"**
3. Name: `logistics-redis`
4. Region: **ap-southeast-1 (Singapore)** — closest to Kolkata
5. Type: **Regional** (not Global — you don't need multi-region yet)
6. Click **"Create"**

### 0B.2 Get Your Redis URL
After creation:
1. Go to your database dashboard
2. Find **"Redis URL"** (the `rediss://` URL — note the double `s` for SSL)
3. Copy it — looks like: `rediss://default:[password]@[host].upstash.io:6379`

> **Important:** Use the `rediss://` (with SSL) URL, not the REST API URL. BullMQ and ioredis need the standard Redis protocol URL.

---

## STEP 1 — PREREQUISITES (Verify these)

You only need Node.js on your machine. PostgreSQL and Redis are now in the cloud.

```bash
node --version   # Must be 20.x LTS
npm --version    # 10.x
```

Install Node 20 via nvm if needed:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or restart terminal
nvm install 20
nvm use 20
nvm alias default 20
```

Verify:
```bash
node --version   # v20.x.x ✅
```

---

## STEP 2 — INITIALIZE THE PROJECT

```bash
mkdir logistics-backend
cd logistics-backend
npm init -y
```

Install TypeScript and dev tools:
```bash
npm install -D typescript ts-node nodemon @types/node @types/express rimraf tsconfig-paths
```

Initialize TypeScript:
```bash
npx tsc --init
```

Now **replace the entire `tsconfig.json`** with this:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "paths": {
      "@modules/*": ["./src/modules/*"],
      "@shared/*": ["./src/shared/*"],
      "@config/*": ["./src/config/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Update `package.json` scripts section:
```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node -r tsconfig-paths/register src/server.ts",
    "build": "rimraf dist && tsc",
    "start": "node dist/server.js",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio",
    "db:seed": "ts-node -r tsconfig-paths/register src/database/seed.ts",
    "db:push": "prisma db push"
  }
}
```

---

## STEP 3 — INSTALL ALL DEPENDENCIES (Do this once, takes ~3 minutes)

Copy and run each block one at a time:

**Core framework:**
```bash
npm install express cors helmet morgan compression express-rate-limit
npm install -D @types/cors @types/morgan @types/compression
```

**Database (Prisma + Supabase):**
```bash
npm install @prisma/client prisma
```

**Redis (Upstash-compatible via ioredis):**
```bash
npm install ioredis
npm install -D @types/ioredis
```

**Job Queue:**
```bash
npm install bullmq
```

**Authentication:**
```bash
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs
```

**Validation:**
```bash
npm install zod
```

**WebSocket (real-time tracking):**
```bash
npm install socket.io @socket.io/redis-adapter
```

**Notifications & Messaging:**
```bash
npm install firebase-admin
npm install axios
```

**File storage:**
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**PDF invoice generation:**
```bash
npm install pdfmake
npm install -D @types/pdfmake
```

**Utilities:**
```bash
npm install dayjs uuid dotenv winston eventemitter2
npm install -D @types/uuid
```

**Maps:**
```bash
npm install @googlemaps/google-maps-services-js
```

Verify everything installed:
```bash
ls node_modules | wc -l
# Should show a large number (100+)
```

---

## STEP 4 — CREATE THE FULL FOLDER STRUCTURE

Run this all at once:
```bash
mkdir -p src/{modules,shared,config,database}
mkdir -p src/modules/{auth,user,booking,pricing,dispatch,tracking,payment,rewards,notifications,fleet,support,admin}
mkdir -p src/shared/{eventbus,queue,redis,logger,errors,middleware,utils,types}
mkdir -p src/shared/queue/workers
mkdir -p src/config
mkdir -p prisma
```

Your folder structure should look like this:
```
logistics-backend/
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── workers.ts
│   ├── config/
│   │   ├── env.ts          ← Validates all env vars at startup
│   │   ├── redis.ts        ← Upstash Redis client
│   │   ├── firebase.ts     ← Firebase Admin
│   │   └── maps.ts         ← Google Maps client
│   ├── database/
│   │   └── seed.ts
│   ├── shared/
│   │   ├── eventbus/index.ts
│   │   ├── queue/
│   │   │   ├── index.ts
│   │   │   └── workers/
│   │   │       ├── notification.worker.ts
│   │   │       ├── otp.worker.ts
│   │   │       └── invoice.worker.ts
│   │   ├── errors/
│   │   │   ├── AppError.ts
│   │   │   └── errorHandler.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── validate.ts
│   │   │   └── rateLimiter.ts
│   │   ├── utils/
│   │   │   ├── response.ts
│   │   │   ├── pagination.ts
│   │   │   └── distance.ts
│   │   ├── logger/index.ts
│   │   └── types/
│   │       └── express.d.ts
│   └── modules/
│       ├── auth/
│       ├── user/
│       ├── booking/
│       ├── pricing/
│       ├── dispatch/
│       ├── tracking/
│       ├── payment/
│       ├── rewards/
│       ├── notifications/
│       ├── fleet/
│       └── support/
├── prisma/
│   └── schema.prisma
├── .env
├── .env.example
├── .gitignore
├── tsconfig.json
└── package.json
```

---

## STEP 5 — ENVIRONMENT VARIABLES

Create `.env` in the root folder:

```env
# ────────────────────────────────
# App
# ────────────────────────────────
NODE_ENV=development
PORT=5000
APP_NAME=LogisticsApp

# ────────────────────────────────
# Supabase / Database
# ────────────────────────────────
# IMPORTANT: Two URLs needed for Supabase + Prisma
# 1. Pooled connection (used by your app at runtime)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres?pgbouncer=true&connection_limit=1

# 2. Direct connection (used by Prisma for migrations only)
DIRECT_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# ────────────────────────────────
# Upstash Redis
# ────────────────────────────────
# Use the rediss:// URL from Upstash dashboard (standard Redis protocol, not REST)
REDIS_URL=rediss://default:[YOUR-UPSTASH-PASSWORD]@[YOUR-HOST].upstash.io:6379

# ────────────────────────────────
# JWT
# ────────────────────────────────
JWT_ACCESS_SECRET=your_very_long_random_secret_minimum_64_chars_here_change_this
JWT_REFRESH_SECRET=another_very_long_random_secret_minimum_64_chars_here_change_this
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

# ────────────────────────────────
# MSG91 (OTP SMS - India)
# ────────────────────────────────
MSG91_AUTH_KEY=your_msg91_auth_key
MSG91_TEMPLATE_ID=your_otp_template_id
MSG91_SENDER_ID=LGSTCS

# ────────────────────────────────
# Google Maps
# ────────────────────────────────
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# ────────────────────────────────
# Firebase (Push Notifications)
# ────────────────────────────────
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email

# ────────────────────────────────
# AWS S3 (Document + Invoice storage)
# ────────────────────────────────
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=ap-south-1
AWS_S3_BUCKET=your-bucket-name

# ────────────────────────────────
# Easebuzz (Payment Gateway)
# ────────────────────────────────
EASEBUZZ_KEY=your_easebuzz_key
EASEBUZZ_SALT=your_easebuzz_salt
EASEBUZZ_ENV=test

# ────────────────────────────────
# OTP Config
# ────────────────────────────────
OTP_EXPIRY_MINUTES=5
OTP_LENGTH=6

# ────────────────────────────────
# Pricing (configurable, not hardcoded)
# ────────────────────────────────
BASE_FARE_BIKE=30
BASE_FARE_THREE_WHEELER=80
BASE_FARE_TATA_ACE=150
BASE_FARE_MINI_TRUCK=300
PRICE_PER_KM_BIKE=8
PRICE_PER_KM_THREE_WHEELER=15
PRICE_PER_KM_TATA_ACE=25
PRICE_PER_KM_MINI_TRUCK=40
LOADING_UNLOADING_CHARGE=150

# ────────────────────────────────
# Rewards / Coins
# ────────────────────────────────
COINS_PER_100_RUPEES=10
COIN_VALUE_RUPEES=0.9
MAX_COIN_REDEMPTION_PERCENT=20
COIN_EXPIRY_DAYS=365
```

Create `.env.example` — same file but with all values emptied (commit this to git):
```bash
cp .env .env.example
# Then manually clear all values in .env.example
```

Create `.gitignore`:
```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
```

---

## STEP 6 — CONFIG FILES

### `src/config/env.ts`
This file runs at startup and kills the process if anything is missing. No silent failures.

```typescript
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('5000'),
  APP_NAME: z.string().default('LogisticsApp'),

  // Supabase — two URLs
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required for migrations'),

  // Upstash Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('30d'),

  MSG91_AUTH_KEY: z.string().min(1),
  MSG91_TEMPLATE_ID: z.string().min(1),
  MSG91_SENDER_ID: z.string().default('LGSTCS'),

  GOOGLE_MAPS_API_KEY: z.string().min(1),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),

  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_BUCKET: z.string().min(1),

  EASEBUZZ_KEY: z.string().min(1),
  EASEBUZZ_SALT: z.string().min(1),
  EASEBUZZ_ENV: z.enum(['test', 'prod']).default('test'),

  OTP_EXPIRY_MINUTES: z.string().transform(Number).default('5'),
  OTP_LENGTH: z.string().transform(Number).default('6'),

  BASE_FARE_BIKE: z.string().transform(Number).default('30'),
  BASE_FARE_THREE_WHEELER: z.string().transform(Number).default('80'),
  BASE_FARE_TATA_ACE: z.string().transform(Number).default('150'),
  BASE_FARE_MINI_TRUCK: z.string().transform(Number).default('300'),
  PRICE_PER_KM_BIKE: z.string().transform(Number).default('8'),
  PRICE_PER_KM_THREE_WHEELER: z.string().transform(Number).default('15'),
  PRICE_PER_KM_TATA_ACE: z.string().transform(Number).default('25'),
  PRICE_PER_KM_MINI_TRUCK: z.string().transform(Number).default('40'),
  LOADING_UNLOADING_CHARGE: z.string().transform(Number).default('150'),

  COINS_PER_100_RUPEES: z.string().transform(Number).default('10'),
  COIN_VALUE_RUPEES: z.string().transform(Number).default('0.9'),
  MAX_COIN_REDEMPTION_PERCENT: z.string().transform(Number).default('20'),
  COIN_EXPIRY_DAYS: z.string().transform(Number).default('365'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
```

### `src/config/redis.ts`
Updated for Upstash. Key difference: Upstash uses SSL (`rediss://`) and needs `tls: {}` option.

```typescript
import { Redis } from 'ioredis';
import { env } from './env';

let redisClient: Redis;

// Detect if Upstash (rediss:// = SSL required)
const isUpstash = env.REDIS_URL.startsWith('rediss://');

const baseOptions = {
  maxRetriesPerRequest: null,  // REQUIRED for BullMQ — do not remove
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isUpstash && { tls: {} }),  // Upstash requires TLS
};

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, baseOptions);

    redisClient.on('connect', () => console.log('✅ Redis (Upstash) connected'));
    redisClient.on('error', (err) => console.error('Redis error:', err.message));
    redisClient.on('reconnecting', () => console.warn('Redis reconnecting...'));
  }
  return redisClient;
}

// Separate pub/sub clients (required by Socket.io Redis adapter)
export function createRedisClient(): Redis {
  return new Redis(env.REDIS_URL, baseOptions);
}
```

### `src/config/firebase.ts`
```typescript
import admin from 'firebase-admin';
import { env } from './env';

let firebaseApp: admin.app.App;

export function getFirebase(): admin.app.App {
  if (!firebaseApp) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
  return firebaseApp;
}

export function getMessaging(): admin.messaging.Messaging {
  return getFirebase().messaging();
}
```

### `src/config/maps.ts`
```typescript
import { Client } from '@googlemaps/google-maps-services-js';
import { env } from './env';

export const mapsClient = new Client({});
export const MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY;
```

---

## STEP 7 — LOGGER

### `src/shared/logger/index.ts`
```typescript
import winston from 'winston';
import { env } from '@config/env';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${stack || message} ${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  exceptionHandlers: [new winston.transports.Console()],
  rejectionHandlers: [new winston.transports.Console()],
});
```

---

## STEP 8 — PRISMA SCHEMA (Full database for entire app)

Initialize Prisma:
```bash
npx prisma init --datasource-provider postgresql
```

Now **replace the entire `prisma/schema.prisma`** with this.

**CRITICAL CHANGE FOR SUPABASE:** The schema uses `directUrl` — this is mandatory for Supabase with Prisma.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  // directUrl bypasses pgBouncer for migrations
  // This is the correct Supabase + Prisma setup
}

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

enum UserRole {
  CUSTOMER
  DRIVER
  ADMIN
}

enum VehicleType {
  BIKE
  THREE_WHEELER
  TATA_ACE
  MINI_TRUCK
}

enum BookingStatus {
  DRAFT
  CONFIRMED
  DRIVER_ASSIGNED
  DRIVER_ARRIVING
  PICKED_UP
  IN_TRANSIT
  DELIVERED
  COMPLETED
  CANCELLED
}

enum PaymentStatus {
  PENDING
  PAID
  REFUNDED
  FAILED
}

enum PaymentMethod {
  WALLET
  UPI
  NETBANKING
  CARD
  CASH
  COINS
}

enum WalletTransactionType {
  CREDIT
  DEBIT
}

enum WalletTransactionReason {
  TOP_UP
  BOOKING_PAYMENT
  REFUND
  CASHBACK
  ADMIN_CREDIT
}

enum CoinTransactionType {
  EARN
  REDEEM
  EXPIRE
}

enum DriverStatus {
  OFFLINE
  AVAILABLE
  ON_TRIP
  BREAK
}

enum DocumentStatus {
  PENDING
  VERIFIED
  REJECTED
}

enum SupportTicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}

// ─────────────────────────────────────────────
// USER & AUTH
// ─────────────────────────────────────────────

model User {
  id              String   @id @default(uuid())
  phone           String   @unique
  name            String?
  email           String?  @unique
  profileImageUrl String?
  role            UserRole @default(CUSTOMER)
  isActive        Boolean  @default(true)
  language        String   @default("en")
  fcmToken        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  addresses      SavedAddress[]
  bookings       Booking[]        @relation("CustomerBookings")
  wallet         Wallet?
  coinBalance    CoinBalance?
  gstDetails     GstDetail[]
  supportTickets SupportTicket[]
  driver         Driver?
  refreshTokens  RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@map("refresh_tokens")
}

model SavedAddress {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  label        String
  addressLine1 String
  addressLine2 String?
  city         String
  state        String
  pincode      String
  latitude     Float
  longitude    Float
  isDefault    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("saved_addresses")
}

model GstDetail {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  gstin        String
  businessName String?
  isVerified   Boolean  @default(false)
  isPrimary    Boolean  @default(false)
  createdAt    DateTime @default(now())

  @@map("gst_details")
}

// ─────────────────────────────────────────────
// DRIVER & FLEET
// ─────────────────────────────────────────────

model Driver {
  id             String       @id @default(uuid())
  userId         String       @unique
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  licenseNumber  String       @unique
  vehicleId      String       @unique
  vehicle        Vehicle      @relation(fields: [vehicleId], references: [id])
  status         DriverStatus @default(OFFLINE)
  rating         Float        @default(5.0)
  totalTrips     Int          @default(0)
  isDocVerified  Boolean      @default(false)
  isActive       Boolean      @default(true)
  currentLat     Float?
  currentLng     Float?
  lastLocationAt DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  bookings  Booking[]
  documents DriverDocument[]
  earnings  DriverEarning[]

  @@map("drivers")
}

model Vehicle {
  id             String      @id @default(uuid())
  registrationNo String      @unique
  type           VehicleType
  make           String
  model          String
  year           Int
  color          String?
  capacityKg     Float
  imageUrl       String?
  isActive       Boolean     @default(true)
  createdAt      DateTime    @default(now())

  driver Driver?

  @@map("vehicles")
}

model DriverDocument {
  id             String         @id @default(uuid())
  driverId       String
  driver         Driver         @relation(fields: [driverId], references: [id], onDelete: Cascade)
  type           String
  fileUrl        String
  status         DocumentStatus @default(PENDING)
  rejectedReason String?
  verifiedAt     DateTime?
  expiresAt      DateTime?
  createdAt      DateTime       @default(now())

  @@map("driver_documents")
}

model DriverEarning {
  id          String    @id @default(uuid())
  driverId    String
  driver      Driver    @relation(fields: [driverId], references: [id])
  bookingId   String    @unique
  booking     Booking   @relation(fields: [bookingId], references: [id])
  grossAmount Float
  commission  Float
  netAmount   Float
  paidAt      DateTime?
  createdAt   DateTime  @default(now())

  @@map("driver_earnings")
}

// ─────────────────────────────────────────────
// BOOKING
// ─────────────────────────────────────────────

model Booking {
  id            String  @id @default(uuid())
  bookingNumber String  @unique
  customerId    String
  customer      User    @relation("CustomerBookings", fields: [customerId], references: [id])
  driverId      String?
  driver        Driver? @relation(fields: [driverId], references: [id])

  pickupLat     Float
  pickupLng     Float
  pickupAddress String
  stops         BookingStop[]

  vehicleType      VehicleType
  hasLoadingService Boolean     @default(false)

  receiverName  String?
  receiverPhone String?

  gstin           String?
  gstBusinessName String?

  status BookingStatus @default(DRAFT)

  estimatedDistance  Float?
  estimatedDuration  Int?
  estimatedPickupEta Int?
  actualPickupTime   DateTime?
  actualDeliveryTime DateTime?

  baseFare        Float?
  distanceFare    Float?
  loadingCharge   Float?
  surgeMultiplier Float         @default(1.0)
  coinsRedeemed   Float         @default(0)
  discountAmount  Float         @default(0)
  taxAmount       Float?
  totalFare       Float?

  paymentStatus PaymentStatus  @default(PENDING)
  paymentMethod PaymentMethod?
  paymentRef    String?

  customerRating Float?
  driverRating   Float?
  customerNote   String?

  invoiceUrl String?

  cancellationReason String?
  cancelledBy        String?
  cancellationTime   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  earning         DriverEarning?
  locationHistory BookingLocationHistory[]

  @@map("bookings")
}

model BookingStop {
  id            String  @id @default(uuid())
  bookingId     String
  booking       Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  sequence      Int
  latitude      Float
  longitude     Float
  address       String
  receiverName  String?
  receiverPhone String?
  isCompleted   Boolean @default(false)

  @@map("booking_stops")
}

model BookingLocationHistory {
  id         String   @id @default(uuid())
  bookingId  String
  booking    Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  latitude   Float
  longitude  Float
  recordedAt DateTime @default(now())

  @@map("booking_location_history")
}

// ─────────────────────────────────────────────
// PAYMENT & WALLET
// ─────────────────────────────────────────────

model Wallet {
  id            String   @id @default(uuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cachedBalance Float    @default(0)
  updatedAt     DateTime @updatedAt
  createdAt     DateTime @default(now())

  transactions WalletTransaction[]

  @@map("wallets")
}

model WalletTransaction {
  id           String                  @id @default(uuid())
  walletId     String
  wallet       Wallet                  @relation(fields: [walletId], references: [id], onDelete: Cascade)
  type         WalletTransactionType
  reason       WalletTransactionReason
  amount       Float
  balanceAfter Float
  referenceId  String?
  note         String?
  createdAt    DateTime                @default(now())

  @@map("wallet_transactions")
}

// ─────────────────────────────────────────────
// REWARDS / COINS
// ─────────────────────────────────────────────

model CoinBalance {
  id            String   @id @default(uuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cachedBalance Float    @default(0)
  updatedAt     DateTime @updatedAt
  createdAt     DateTime @default(now())

  transactions CoinTransaction[]

  @@map("coin_balances")
}

model CoinTransaction {
  id            String             @id @default(uuid())
  coinBalanceId String
  coinBalance   CoinBalance        @relation(fields: [coinBalanceId], references: [id], onDelete: Cascade)
  type          CoinTransactionType
  coins         Float
  balanceAfter  Float
  referenceId   String?
  expiresAt     DateTime?
  note          String?
  createdAt     DateTime           @default(now())

  @@map("coin_transactions")
}

// ─────────────────────────────────────────────
// SUPPORT
// ─────────────────────────────────────────────

model SupportTicket {
  id        String              @id @default(uuid())
  userId    String
  user      User                @relation(fields: [userId], references: [id])
  bookingId String?
  subject   String
  status    SupportTicketStatus @default(OPEN)
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt

  messages SupportMessage[]

  @@map("support_tickets")
}

model SupportMessage {
  id            String        @id @default(uuid())
  ticketId      String
  ticket        SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  senderId      String
  isAgent       Boolean       @default(false)
  content       String
  attachmentUrl String?
  createdAt     DateTime      @default(now())

  @@map("support_messages")
}

// ─────────────────────────────────────────────
// PRICING CONFIG
// ─────────────────────────────────────────────

model VehicleTypePricing {
  id           String      @id @default(uuid())
  vehicleType  VehicleType @unique
  baseFare     Float
  pricePerKm   Float
  minFare      Float
  capacityKg   Float
  capacityDesc String
  estimatedEta Int
  displayName  String
  imageUrl     String?
  isActive     Boolean     @default(true)
  updatedAt    DateTime    @updatedAt

  @@map("vehicle_type_pricing")
}

model Announcement {
  id        String    @id @default(uuid())
  title     String
  body      String
  imageUrl  String?
  linkUrl   String?
  isActive  Boolean   @default(true)
  startsAt  DateTime?
  endsAt    DateTime?
  createdAt DateTime  @default(now())

  @@map("announcements")
}
```

Now run the migration (this creates all tables in Supabase):
```bash
npx prisma migrate dev --name init
npx prisma generate
```

After running, go to your **Supabase dashboard → Table Editor** — you'll see all your tables created. That's your live database.

---

## STEP 9 — SHARED INFRASTRUCTURE

### `src/shared/errors/AppError.ts`
```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }

  static badRequest(message: string, code?: string) {
    return new AppError(message, 400, code);
  }
  static unauthorized(message = 'Unauthorized') {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(message, 403, 'FORBIDDEN');
  }
  static notFound(message = 'Resource not found') {
    return new AppError(message, 404, 'NOT_FOUND');
  }
  static conflict(message: string, code?: string) {
    return new AppError(message, 409, code);
  }
  static tooManyRequests(message = 'Too many requests') {
    return new AppError(message, 429, 'RATE_LIMITED');
  }
  static internal(message = 'Internal server error') {
    return new AppError(message, 500, 'INTERNAL_ERROR', false);
  }
}
```

### `src/shared/errors/errorHandler.ts`
```typescript
import { Request, Response, NextFunction } from 'express';
import { AppError } from './AppError';
import { logger } from '@shared/logger';
import { ZodError } from 'zod';
import { env } from '@config/env';

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { stack: err.stack, code: err.code });
    }
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // Prisma unique constraint violation
  if ((err as any).code === 'P2002') {
    res.status(409).json({
      success: false,
      message: 'A record with that value already exists',
      code: 'DUPLICATE_ENTRY',
    });
    return;
  }

  logger.error('Unhandled error:', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    message: env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
    code: 'INTERNAL_ERROR',
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
}
```

### `src/shared/utils/response.ts`
```typescript
import { Response } from 'express';

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200,
  meta?: Record<string, any>
): void {
  const response: any = { success: true, message, data };
  if (meta) response.meta = meta;
  res.status(statusCode).json(response);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): void {
  sendSuccess(res, data, message, 201);
}
```

### `src/shared/middleware/validate.ts`
```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) return next(result.error);
    req[target] = result.data;
    next();
  };
}
```

### `src/shared/types/express.d.ts`
```typescript
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        phone: string;
        role: string;
      };
    }
  }
}
export {};
```

### `src/shared/eventbus/index.ts`
```typescript
import EventEmitter from 'eventemitter2';

export interface AppEvents {
  'booking.confirmed': { bookingId: string; customerId: string; vehicleType: string };
  'booking.driver_assigned': { bookingId: string; driverId: string; customerId: string };
  'booking.picked_up': { bookingId: string };
  'booking.delivered': { bookingId: string; customerId: string; totalFare: number };
  'booking.cancelled': { bookingId: string; customerId: string; reason: string };
  'payment.completed': { bookingId: string; customerId: string; amount: number; method: string };
  'payment.wallet_topped_up': { userId: string; amount: number };
  'rewards.coins_earned': { userId: string; coins: number; bookingId: string };
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): boolean {
    return super.emit(event as string, data);
  }
  on<K extends keyof AppEvents>(event: K, listener: (data: AppEvents[K]) => void): this {
    return super.on(event as string, listener);
  }
}

export const eventBus = new TypedEventBus({ wildcard: false, maxListeners: 20 });
```

### `src/shared/queue/index.ts`
```typescript
import { Queue, Worker, WorkerOptions } from 'bullmq';
import { getRedis } from '@config/redis';
import { logger } from '@shared/logger';

const connection = getRedis();

export const QUEUES = {
  OTP: 'otp',
  NOTIFICATION: 'notification',
  INVOICE: 'invoice',
  DISPATCH: 'dispatch',
} as const;

export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  });
}

export function createWorker(
  queueName: string,
  processor: WorkerOptions['processFn'],
  concurrency = 5
): Worker {
  const worker = new Worker(queueName, processor, { connection, concurrency });

  worker.on('completed', (job) => {
    logger.debug(`Job ${job.id} in ${queueName} completed`);
  });
  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} in ${queueName} failed: ${err.message}`);
  });

  return worker;
}

export const otpQueue = createQueue(QUEUES.OTP);
export const notificationQueue = createQueue(QUEUES.NOTIFICATION);
export const invoiceQueue = createQueue(QUEUES.INVOICE);
export const dispatchQueue = createQueue(QUEUES.DISPATCH);
```

### Placeholder workers (to be filled in Phase 3+)

Create these files with placeholder exports so the app compiles:

**`src/shared/queue/workers/otp.worker.ts`**
```typescript
import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';

export function startOtpWorker() {
  createWorker(QUEUES.OTP, async (job) => {
    logger.debug(`OTP job received: ${job.id} — will be implemented in Phase 3`);
  });
  logger.info('✅ OTP worker started');
}
```

**`src/shared/queue/workers/notification.worker.ts`**
```typescript
import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';

export function startNotificationWorker() {
  createWorker(QUEUES.NOTIFICATION, async (job) => {
    logger.debug(`Notification job received: ${job.id} — will be implemented in Phase 11`);
  });
  logger.info('✅ Notification worker started');
}
```

**`src/shared/queue/workers/invoice.worker.ts`**
```typescript
import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';

export function startInvoiceWorker() {
  createWorker(QUEUES.INVOICE, async (job) => {
    logger.debug(`Invoice job received: ${job.id} — will be implemented in Phase 9`);
  });
  logger.info('✅ Invoice worker started');
}
```

---

## STEP 10 — AUTH MIDDLEWARE

### `src/shared/middleware/auth.middleware.ts`
```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  phone: string;
  role: UserRole;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('No token provided'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = { id: payload.userId, phone: payload.phone, role: payload.role };
    next();
  } catch (err) {
    if ((err as any).name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Token expired'));
    }
    return next(AppError.unauthorized('Invalid token'));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role as UserRole)) {
      return next(AppError.forbidden('Insufficient permissions'));
    }
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = { id: payload.userId, phone: payload.phone, role: payload.role };
  } catch {
    // Invalid token — continue without user (optional auth)
  }
  next();
}
```

---

## STEP 11 — MODULE PLACEHOLDER ROUTERS

You need these files to exist so `app.ts` compiles. Each will be filled with full code in their phase.

Create these placeholder router files:

**`src/modules/auth/auth.router.ts`**
```typescript
import { Router } from 'express';
export const authRouter = Router();
// Full implementation in Phase 3
authRouter.get('/ping', (_req, res) => res.json({ module: 'auth', status: 'placeholder' }));
```

**`src/modules/user/user.router.ts`**
```typescript
import { Router } from 'express';
export const userRouter = Router();
```

**`src/modules/booking/booking.router.ts`**
```typescript
import { Router } from 'express';
export const bookingRouter = Router();
```

**`src/modules/pricing/pricing.router.ts`**
```typescript
import { Router } from 'express';
export const pricingRouter = Router();
```

**`src/modules/payment/payment.router.ts`**
```typescript
import { Router } from 'express';
export const paymentRouter = Router();
```

**`src/modules/rewards/rewards.router.ts`**
```typescript
import { Router } from 'express';
export const rewardsRouter = Router();
```

**`src/modules/fleet/fleet.router.ts`**
```typescript
import { Router } from 'express';
export const fleetRouter = Router();
```

**`src/modules/support/support.router.ts`**
```typescript
import { Router } from 'express';
export const supportRouter = Router();
```

**`src/modules/tracking/tracking.gateway.ts`**
```typescript
import { Server as SocketServer } from 'socket.io';
import { logger } from '@shared/logger';

export function setupTrackingGateway(io: SocketServer) {
  const tracking = io.of('/tracking');
  tracking.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);
    // Full implementation in Phase 8
  });
  logger.info('✅ Tracking gateway placeholder ready');
}
```

**`src/modules/dispatch/dispatch.worker.ts`**
```typescript
import { createWorker, QUEUES } from '@shared/queue';
import { logger } from '@shared/logger';

export function startDispatchWorker() {
  createWorker(QUEUES.DISPATCH, async (job) => {
    logger.debug(`Dispatch job: ${job.id} — will be implemented in Phase 7`);
  });
  logger.info('✅ Dispatch worker started');
}
```

---

## STEP 12 — EXPRESS APP

### `src/app.ts`
```typescript
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { env } from '@config/env';
import { globalErrorHandler, notFoundHandler } from '@shared/errors/errorHandler';
import { logger } from '@shared/logger';

import { authRouter } from '@modules/auth/auth.router';
import { userRouter } from '@modules/user/user.router';
import { bookingRouter } from '@modules/booking/booking.router';
import { pricingRouter } from '@modules/pricing/pricing.router';
import { paymentRouter } from '@modules/payment/payment.router';
import { rewardsRouter } from '@modules/rewards/rewards.router';
import { fleetRouter } from '@modules/fleet/fleet.router';
import { supportRouter } from '@modules/support/support.router';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : '*',
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());

  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests', code: 'RATE_LIMITED' },
  });
  app.use('/api', limiter);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: env.APP_NAME,
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/bookings', bookingRouter);
  app.use('/api/v1/pricing', pricingRouter);
  app.use('/api/v1/payments', paymentRouter);
  app.use('/api/v1/rewards', rewardsRouter);
  app.use('/api/v1/fleet', fleetRouter);
  app.use('/api/v1/support', supportRouter);

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
```

---

## STEP 13 — WORKERS AGGREGATOR

### `src/workers.ts`
```typescript
import { logger } from '@shared/logger';

export async function startAllWorkers() {
  const { startNotificationWorker } = await import('@shared/queue/workers/notification.worker');
  const { startOtpWorker } = await import('@shared/queue/workers/otp.worker');
  const { startInvoiceWorker } = await import('@shared/queue/workers/invoice.worker');
  const { startDispatchWorker } = await import('@modules/dispatch/dispatch.worker');

  startOtpWorker();
  startNotificationWorker();
  startInvoiceWorker();
  startDispatchWorker();

  logger.info('All workers initialised');
}
```

---

## STEP 14 — SERVER ENTRY POINT

### `src/server.ts`
```typescript
import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createApp } from './app';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { getRedis, createRedisClient } from '@config/redis';
import { setupTrackingGateway } from '@modules/tracking/tracking.gateway';
import { startAllWorkers } from './workers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function bootstrap() {
  // 1. Test Supabase connection
  try {
    await prisma.$connect();
    logger.info('✅ Supabase (PostgreSQL) connected');
  } catch (err) {
    logger.error('❌ Supabase connection failed. Check DATABASE_URL in .env:', err);
    process.exit(1);
  }

  // 2. Connect Upstash Redis
  const redisClient = getRedis();
  try {
    await redisClient.connect();
    logger.info('✅ Upstash Redis connected');
  } catch (err) {
    logger.error('❌ Upstash Redis connection failed. Check REDIS_URL in .env:', err);
    process.exit(1);
  }

  // 3. Express app
  const app = createApp();
  const httpServer = createServer(app);

  // 4. Socket.io with Redis adapter for horizontal scaling
  const io = new SocketServer(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'production' ? 'https://yourdomain.com' : '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  const pubClient = createRedisClient();
  const subClient = createRedisClient();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('✅ Socket.io Redis adapter ready');

  // 5. Tracking gateway
  setupTrackingGateway(io);

  // 6. BullMQ workers
  await startAllWorkers();
  logger.info('✅ BullMQ workers started');

  // 7. Start HTTP server
  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 ${env.APP_NAME} running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`   Health: http://localhost:${env.PORT}/health`);
  });

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      await redisClient.quit();
      logger.info('Server closed cleanly');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});
```

---

## STEP 15 — VERIFY THE FOUNDATION WORKS

This is the critical test. Run this:

```bash
npm run db:migrate
```
You should see Prisma connect to Supabase and create all tables. Go check your Supabase dashboard — 15+ tables will be there.

Then:
```bash
npm run dev
```

You should see all 5 green checkmarks:
```
✅ Supabase (PostgreSQL) connected
✅ Upstash Redis connected
✅ Socket.io Redis adapter ready
✅ All workers initialised
🚀 LogisticsApp running on port 5000 [development]
   Health: http://localhost:5000/health
```

Test the health endpoint:
```bash
curl http://localhost:5000/health
```
Response:
```json
{"status":"ok","app":"LogisticsApp","env":"development","timestamp":"..."}
```

---

## TROUBLESHOOTING (Common Issues at This Stage)

**"P1001: Can't reach database server"**
→ Your DATABASE_URL is wrong. Go back to Supabase Settings → Database → copy the URI again exactly. Make sure password is correct.

**"Redis connection failed"**
→ Your REDIS_URL is wrong. Use the `rediss://` URL from Upstash dashboard (with SSL), not the REST URL.

**"BullMQ maxRetriesPerRequest must be null"**
→ The `maxRetriesPerRequest: null` line in `redis.ts` is mandatory for BullMQ. Don't remove it.

**"Module not found @modules/..."**
→ Run `npm install -D tsconfig-paths` if you missed it, and confirm the `paths` section is in your tsconfig.json.

**"prisma migrate failed — SSL required"**
→ Supabase requires SSL. Add `?sslmode=require` to the end of both URLs in your .env if you get this error.

**"Cannot find module 'eventemitter2'"**
→ Run `npm install eventemitter2`

---

## WHAT YOU'VE BUILT SO FAR

```
✅ TypeScript project with path aliases
✅ All 40+ dependencies installed
✅ Full folder structure (12 modules)
✅ Environment variables — validated at startup, app crashes if missing
✅ Supabase connection (Prisma with direct + pooled URLs)
✅ Upstash Redis connection (ioredis with TLS for Upstash)
✅ Complete database schema — 20+ tables, all enums, all relations
✅ Database migrated to Supabase
✅ Logger (dev: coloured, prod: JSON)
✅ AppError class + global error handler
✅ Zod request validation middleware
✅ Internal EventBus (typed, in-process)
✅ BullMQ queue factory (OTP, Notification, Invoice, Dispatch queues)
✅ JWT auth middleware with role-based access
✅ Express app with security (helmet, cors, rate limiting, compression)
✅ HTTP + WebSocket server
✅ Socket.io Redis adapter (works across multiple server instances)
✅ Graceful shutdown
✅ Placeholder modules (all routers registered, ready to fill)
```

---

## YOUR NEXT STEPS

Once your server shows all 5 green checkmarks and health check returns `ok`:

1. Open Supabase dashboard → **Table Editor** → verify all tables are there
2. Open Upstash dashboard → **Data Browser** → it should show 0 keys (empty, that's correct)
3. Tell me "foundation is running" and we immediately go into **Phase 3 — Auth Module**

Phase 3 covers:
- `POST /api/v1/auth/send-otp` — generates 6-digit OTP, stores in Upstash Redis with 5-min TTL, sends via MSG91
- `POST /api/v1/auth/verify-otp` — validates OTP, issues JWT access token (15min) + refresh token (30 days)
- `POST /api/v1/auth/refresh` — silent token rotation
- `POST /api/v1/auth/logout` — invalidates refresh token
- Full MSG91 SMS integration with DLT compliance notes
- Rate limiting on OTP endpoint (max 3 attempts per phone per hour)

One phase at a time. Foundation first, always.

---

## RECENT UPDATES: Trip Module Backend (May 2026)

The backend has been enhanced to support the full **Driver Trip Module** capabilities.

### 1. Proof of Delivery (POD) Flow
The booking delivery process has been secured with a 2-step verification system:
- **`POST /api/v1/bookings/:id/stops/:stopId/request-pod-otp`**: Generates a 4-digit OTP, stores it in Upstash Redis (`POD_OTP:{bookingId}:{stopId}`) with a 15-minute expiration, and fires an FCM push notification to the customer containing the code.
- **`POST /api/v1/bookings/:id/stops/:stopId/pod`**: The driver submits the OTP they received from the customer, along with the `photoUrl` of the delivered goods (uploaded via the existing Upload module to AWS S3). The server verifies the OTP against Redis. If valid, the `BookingStop` is updated with `isCompleted = true`, `podPhotoUrl`, and `podVerifiedAt`. If all stops are completed, the booking transitions to `DELIVERED`.

### 2. Real-Time Tracking & WebSockets (`tracking.gateway.ts`)
The Socket.io gateway now supports live location broadcasting:
- **Room Subscription**: Customers and admins can subscribe to live updates by emitting `subscribe_booking` with the `bookingId`. They join a dedicated room `booking_{id}`.
- **Location Updates**: Drivers emit `driver_location_update` (containing lat/lng). The gateway instantly broadcasts this to everyone in the room via `location_updated`.
- **Database Persistence**: The location ping is asynchronously saved to `BookingLocationHistory` and updates the `Driver.currentLat`/`currentLng` to keep the database state fresh without blocking the WebSocket event loop.

### 3. Masked Calling
For now, the driver app features UI-level navigation for calling (`tel:` links). In the future, this will be integrated with Exotel to provide true masked calling (bridging the customer and driver through a virtual number) via a `POST /api/v1/bookings/:id/call` endpoint.

These updates keep the system fully compliant with our modular, scalable, industry-standard architecture.