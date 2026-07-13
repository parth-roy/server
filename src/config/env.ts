import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Helper: string env var that transforms to number
// Order matters: default first (string), then transform (to number)
const numStr = (defaultVal: string) =>
  z.string().default(defaultVal).transform(Number);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: numStr('5000'),
  APP_NAME: z.string().default('LogisticsApp'),
  // Comma-separated list of allowed CORS origins in production.
  // Example: https://api.parther.in,https://admin.parther.in
  ALLOWED_ORIGINS: z.string().default('https://api.parther.in'),
  SENTRY_DSN: z.string().url().optional(),

  // ── Admin Panel ────────────────────────────────────────────────────
  // URL of the admin panel (used for password reset email links)
  // Dev: http://localhost:5689  |  Prod: https://admin.gomytruck.com
  ADMIN_PANEL_URL: z.string().url().default('http://localhost:5689'),

  // ── Zoho Mail SMTP (Nodemailer) ────────────────────────────────────
  // Host: smtppro.zoho.in (India data center)
  // Port: 465 (SSL/TLS)  |  Auth: full email + app-specific password
  // Generate app password: Zoho Mail → Settings → Security → App Passwords
  ZOHO_SMTP_HOST: z.string().default('smtppro.zoho.in'),
  ZOHO_SMTP_PORT: numStr('465'),
  ZOHO_SMTP_USER: z.string().email().optional(), // e.g. admin@gomytruck.com
  ZOHO_SMTP_PASS: z.string().min(1).optional(), // Zoho app-specific password
  ZOHO_FROM_EMAIL: z.string().email().optional(), // Sender: "Parther Admin <admin@gomytruck.com>"

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required for migrations'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('30d'),

  MSG91_AUTH_KEY: z.string().min(1).optional(),
  MSG91_TEMPLATE_ID: z.string().min(1).optional(),
  MSG91_SENDER_ID: z.string().default('LGSTCS'),

  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  MAPBOX_API_KEY: z.string().min(1).optional(),

  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),

  // Legacy AWS aliases (kept for backward-compat — values come from DO Spaces .env)
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().default('sgp1'),
  AWS_S3_BUCKET: z.string().min(1).optional(),

  // ── DigitalOcean Spaces (S3-compatible) ──────────────────────────────
  DO_SPACES_KEY: z.string().min(1).optional(),
  DO_SPACES_SECRET: z.string().min(1).optional(),
  DO_SPACES_BUCKET: z.string().default('gomytruck'),
  DO_SPACES_ENDPOINT: z.string().url().default('https://sgp1.digitaloceanspaces.com'),
  DO_SPACES_CDN_ENDPOINT: z.string().url().default('https://gomytruck.sgp1.digitaloceanspaces.com'),

  EASEBUZZ_KEY: z.string().min(1).optional(),
  EASEBUZZ_SALT: z.string().min(1).optional(),
  EASEBUZZ_ENV: z.enum(['test', 'prod']).default('test'),

  // ── ULIP (Unified Logistics Interface Platform) ────────────────────
  // Register at: ulip.dpiit.gov.in — get username + password via email
  // Token: expires every 30 min; auto-refreshed by ulipAuth.service.ts
  ULIP_USERNAME: z.string().min(1).optional(),
  ULIP_PASSWORD: z.string().min(1).optional(),
  ULIP_BASE_URL: z
    .string()
    .url()
    .default('https://www.ulip.dpiit.gov.in/ulip/v1.0.0'),
  ULIP_STAGING_URL: z
    .string()
    .url()
    .default('https://www.ulipstaging.dpiit.gov.in/ulip/v1.0.0'),
  // Set to 'staging' during development, 'production' when going live
  ULIP_ENV: z.enum(['staging', 'production']).default('staging'),
  // Set to 'true' to bypass ULIP govt APIs during development (IP not yet whitelisted)
  // Flip to 'false' once ULIP support whitelists the server IP
  MOCK_ULIP: z.enum(['true', 'false']).default('false'),

  OTP_EXPIRY_MINUTES: numStr('5'),
  OTP_LENGTH: numStr('6'),

  BASE_FARE_BIKE: numStr('30'),
  BASE_FARE_THREE_WHEELER: numStr('80'),
  BASE_FARE_TATA_ACE: numStr('150'),
  BASE_FARE_MINI_TRUCK: numStr('300'),
  PRICE_PER_KM_BIKE: numStr('8'),
  PRICE_PER_KM_THREE_WHEELER: numStr('15'),
  PRICE_PER_KM_TATA_ACE: numStr('25'),
  PRICE_PER_KM_MINI_TRUCK: numStr('40'),
  LOADING_UNLOADING_CHARGE: numStr('150'),

  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ── Outbound payment safety controls ─────────────────────────────
  // Fail closed until RazorpayX access and the payout flows are certified.
  // Standard inbound Razorpay collections are not controlled by these flags.
  RAZORPAYX_PAYOUTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MULTI_PARTY_TRANSFERS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  // ── Private marketplace bidding ───────────────────────────────────
  BID_DEFAULT_WINDOW_MINUTES: numStr('10'),
  BID_PAYMENT_DEADLINE_MINUTES: numStr('10'),
  BID_PAYMENT_RECONCILE_MINUTES: numStr('15'),
  BID_REOPEN_WINDOW_MINUTES: numStr('10'),
  BID_MAX_REVISIONS: numStr('20'),
  BID_MIN_FARE_MULTIPLIER: numStr('0.5'),
  BID_MAX_FARE_MULTIPLIER: numStr('2.0'),
  BID_GST_RATE: numStr('0.05'),
  BID_ALLOW_CASH: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),

  COINS_PER_100_RUPEES: numStr('10'),
  COIN_VALUE_RUPEES: numStr('0.9'),
  MAX_COIN_REDEMPTION_PERCENT: numStr('20'),
  COIN_EXPIRY_DAYS: numStr('365'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
