import { prisma } from '@shared/db/prisma';
import jwt from 'jsonwebtoken';
import { randomInt } from 'crypto';
import { getRedis } from '@config/redis';
import { getMessaging } from '@config/firebase';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import type { SendOtpInput, VerifyOtpInput, RefreshInput } from './auth.schema';

const redis = getRedis();

const OTP_TTL_SECONDS = env.OTP_EXPIRY_MINUTES * 60;   // 5 min = 300s
const OTP_KEY = (phone: string) => `otp:${phone}`;

// ─────────────────────────────────────────────────────────────────────────────
// DEMO / REVIEW ACCOUNTS
// These accounts bypass real OTP delivery and always accept the static OTP.
// Used by Google Play reviewers to access the app during app review.
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_ACCOUNTS: Record<string, { staticOtp: string; role: string; name: string }> = {
  '9000000000': { staticOtp: '123456', role: 'DRIVER',      name: 'GMT Demo Driver' },
  '9000000001': { staticOtp: '123456', role: 'FLEET_OWNER', name: 'GMT Demo Fleet' },
  '9852364101': { staticOtp: '123456', role: 'CUSTOMER',    name: 'GMT Demo Customer' },
};

const isDemoAccount = (phone: string) => phone in DEMO_ACCOUNTS;

// In-memory store — always written alongside Redis as a dual-write safety net
// This prevents OTP_EXPIRED errors caused by Redis availability flickering between
// the send-otp and verify-otp requests.
const inMemoryOtp = new Map<string, { otp: string; expiresAt: number }>();

// Helper: Store OTP — DUAL WRITE to both Redis AND in-memory simultaneously
async function storeOtp(phone: string, otp: string): Promise<void> {
  // Always store in-memory first (instant, never fails)
  inMemoryOtp.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });

  // Also try Redis (best-effort, don't fail if unavailable)
  try {
    await redis.set(OTP_KEY(phone), otp, 'EX', OTP_TTL_SECONDS);
    logger.info('[OTP] Stored in Redis + in-memory (dual write)');
  } catch {
    logger.warn('[OTP] Redis write failed — falling back to in-memory only (still works)');
  }
}

// Helper: Get OTP — check Redis first, then in-memory fallback
async function getOtp(phone: string): Promise<string | null> {
  // 1. Try Redis first
  try {
    const redisOtp = await redis.get(OTP_KEY(phone));
    if (redisOtp) {
      logger.info('[OTP] Found in Redis');
      return redisOtp;
    }
  } catch {
    logger.warn('[OTP] Redis read failed — falling back to in-memory');
  }

  // 2. FIX S7: In-memory fallback only in non-production.
  // In production with multiple server instances, the instance that sent the OTP
  // may differ from the one that verifies it — in-memory would silently fail.
  if (process.env.NODE_ENV !== 'production') {
    const record = inMemoryOtp.get(phone);
    if (record && record.expiresAt > Date.now()) {
      logger.info('[OTP] Found in in-memory store (dev fallback)');
      return record.otp;
    }
    inMemoryOtp.delete(phone);
  }

  return null;
}

// Helper: Delete OTP from BOTH stores
async function deleteOtp(phone: string): Promise<void> {
  // Always delete from memory
  inMemoryOtp.delete(phone);

  // Best-effort delete from Redis
  try {
    await redis.del(OTP_KEY(phone));
  } catch {
    // Non-fatal — TTL will expire it anyway
  }
}

// Helper: Store FCM token temporarily in Redis alongside OTP (for first-time logins)
const FCM_KEY = (phone: string) => `fcm:${phone}`;

// In-memory fallback for FCM tokens
const inMemoryFcm = new Map<string, { fcmToken: string; expiresAt: number }>();

async function storeFcmToken(phone: string, fcmToken: string): Promise<void> {
  // Always store in-memory first
  inMemoryFcm.set(phone, { fcmToken, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });

  // Best-effort Redis write
  try {
    await redis.set(FCM_KEY(phone), fcmToken, 'EX', OTP_TTL_SECONDS);
  } catch {
    // Non-fatal, in-memory works
  }
}

async function getStoredFcmToken(phone: string): Promise<string | null> {
  // 1. Try Redis
  try {
    const token = await redis.get(FCM_KEY(phone));
    if (token) return token;
  } catch {
    // Non-fatal, fallback to memory
  }

  // 2. In-memory fallback only in non-production (same reasoning as OTP)
  if (process.env.NODE_ENV !== 'production') {
    const record = inMemoryFcm.get(phone);
    if (record && record.expiresAt > Date.now()) {
      return record.fcmToken;
    }
    inMemoryFcm.delete(phone);
  }

  return null;
}

// Helper: Send OTP via Firebase Cloud Messaging (FCM) — data-only message
//
// WHY data-only (no 'notification' key):
//   • notification messages: Android auto-shows in background ✅ but silently
//     drops in foreground ❌ (delivers to onMessage with no UI)
//   • data-only messages: ALWAYS delivered to app code in ALL states — foreground,
//     background, and killed. The Flutter app uses flutter_local_notifications
//     to display the system heads-up notification consistently every time.
async function sendOtpViaPush(fcmToken: string, otp: string): Promise<void> {
  try {
    const messaging = getMessaging();
    await messaging.send({
      token: fcmToken,
      // NO 'notification' key — this makes it a pure data message
      // The Flutter app reads these fields and shows its own system notification
      data: {
        type: 'OTP',
        otp: otp,
        title: '\uD83D\uDD10 Your Truker Captain OTP',
        body: `Your verification code is: ${otp}. Valid for 5 minutes. Do not share with anyone.`,
      },
      android: {
        // High priority ensures delivery even when device is in Doze mode
        priority: 'high',
      },
    });
    logger.info('[FCM] OTP push notification sent successfully');
  } catch (error) {
    // Log but don't throw — fallback is the dev console log below
    logger.error(`[FCM] Failed to send OTP push notification: ${error}`);
  }
}

// ─────────────────────────────────────────────
// SEND OTP
// ─────────────────────────────────────────────
export async function sendOtp({ phone, fcmToken }: SendOtpInput & { fcmToken?: string }) {
  // ── Demo account: skip real OTP entirely ────────────────────────────────
  if (isDemoAccount(phone)) {
    if (fcmToken) {
      await storeFcmToken(phone, fcmToken);
      logger.info(`[OTP] FCM token saved to Redis for demo account ${phone}`);
    }
    logger.info(`[OTP] Demo account ${phone} — static OTP accepted, skipping delivery`);
    return { message: 'OTP sent successfully' };
  }

  // Generate 6-digit OTP
  const otp = randomInt(100000, 999999).toString();

  // Store OTP in Redis (with in-memory fallback)
  await storeOtp(phone, otp);

  // ── Determine which FCM token to use ──────────────────────────────────
  let tokenToUse: string | null | undefined = fcmToken;

  if (tokenToUse) {
    // New login: store FCM token temporarily in Redis so it's available before user row exists
    await storeFcmToken(phone, tokenToUse);
    logger.info(`[OTP] FCM token received from app for ${phone}`);
  } else {
    // Returning driver: look up their saved FCM token from the database
    const existingUser = await prisma.user.findUnique({
      where: { phone },
      select: { fcmToken: true },
    });
    tokenToUse = existingUser?.fcmToken;
    if (tokenToUse) {
      logger.info(`[OTP] Using saved DB FCM token for returning driver ${phone}`);
    } else {
      logger.warn(`[OTP] No FCM token available for ${phone} — OTP only visible in dev logs`);
    }
  }

  // ── Deliver OTP via FCM push notification ────────────────────────────
  if (tokenToUse) {
    await sendOtpViaPush(tokenToUse, otp);
  }

  // Always log OTP in development as a fallback
  if (env.NODE_ENV === 'development') {
    logger.info(`[OTP] Generated for ${phone}: ${otp}`);
  } else {
    logger.info(`[OTP] Generated for ${phone}`);
  }

  return {
    message: 'OTP sent successfully',
    // Dev-only: remove this before going to production
    ...(env.NODE_ENV === 'development' && { _devOtp: otp }),
  };
}

// ─────────────────────────────────────────────
// VERIFY OTP
// ─────────────────────────────────────────────
export async function verifyOtp({ phone, otp, fcmToken, role = 'CUSTOMER' }: VerifyOtpInput & { role?: any }) {
  // ── Demo account: accept static OTP, skip Redis entirely ────────────────
  if (isDemoAccount(phone)) {
    const demo = DEMO_ACCOUNTS[phone];
    if (otp !== demo.staticOtp) {
      throw AppError.badRequest('Invalid OTP', 'OTP_INVALID');
    }
    // Use the pre-configured role for this demo account
    role = demo.role;
    logger.info(`[OTP] Demo account ${phone} verified — role=${role}`);
  } else {
    const storedOtp = await getOtp(phone);

    if (!storedOtp) {
      throw AppError.badRequest('OTP expired or not found. Request a new one.', 'OTP_EXPIRED');
    }

    if (storedOtp !== otp) {
      throw AppError.badRequest('Invalid OTP', 'OTP_INVALID');
    }

    // OTP is correct — delete it immediately (one-time use)
    await deleteOtp(phone);
  }

  // Fetch existing user to check if they are deactivated
  const existingUser = await prisma.user.findUnique({ 
    where: { phone },
    include: { fleetOwner: true } 
  });
  
  if (existingUser) {
    if (!existingUser.isActive) {
      throw AppError.forbidden('Your account has been deactivated by an administrator.');
    }
    if (existingUser.role === 'FLEET_OWNER' && existingUser.fleetOwner && !existingUser.fleetOwner.isActive) {
      throw AppError.forbidden('Your fleet account has been deactivated by an administrator.');
    }
  }

  // Prepare update data - include fcmToken if provided or found in Redis cache
  const updateData: any = {};
  let tokenToSave: string | null = fcmToken || null;
  if (!tokenToSave) {
    tokenToSave = await getStoredFcmToken(phone);
  }
  if (tokenToSave) {
    updateData.fcmToken = tokenToSave;
  }

  // Find or create user (phone is the unique identifier in this system)
  const demoInfo = DEMO_ACCOUNTS[phone];
  const user = await prisma.user.upsert({
    where: { phone },
    update: updateData,
    create: { 

      phone, 
      role: role as any,
      name: demoInfo?.name,           // pre-fill name for demo accounts
      profileComplete: !!demoInfo,    // mark profile complete for demo accounts
      ...(tokenToSave && { fcmToken: tokenToSave }) 
    },
    select: {
      id: true,
      phone: true,
      name: true,
      email: true,
      profileImageUrl: true,
      role: true,
      usageType: true,
      whatsappOptIn: true,
      profileComplete: true,
    },
  });

  // ── Auto-provision demo profiles to prevent 404s ──
  if (demoInfo) {
    if (demoInfo.role === 'DRIVER') {
      await prisma.driver.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          licenseNumber: `DL-DEMO-${phone.substring(6)}`,
          isDocVerified: true,
          status: 'OFFLINE',
        }
      });
    } else if (demoInfo.role === 'FLEET_OWNER') {
      await prisma.fleetOwner.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          companyName: 'Demo Fleet LLC',
          isVerified: true,
        }
      });
    }
  }

  // Issue token pair
  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.phone, role);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      profileImageUrl: user.profileImageUrl,
      role: role, // Contextual Login override
      usageType: user.usageType,
      whatsappOptIn: user.whatsappOptIn,
      profileComplete: user.profileComplete,
      isNewUser: !user.name, // true if they haven't set their name yet
    },
  };
}

// ─────────────────────────────────────────────
// REFRESH TOKENS
// ─────────────────────────────────────────────
export async function refreshTokens({ refreshToken }: RefreshInput) {
  // Extract contextual role if the refreshToken is a JWT
  let contextualRole: string | undefined;
  try {
    const decoded = jwt.decode(refreshToken) as any;
    if (decoded && decoded.role) {
      contextualRole = decoded.role;
    }
  } catch (e) {
    // Legacy UUID token, ignore
  }

  // Look up the refresh token in DB
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored) {
    throw AppError.unauthorized('Invalid refresh token');
  }

  if (stored.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    throw AppError.unauthorized('Refresh token expired. Please log in again.');
  }

  if (!stored.user.isActive) {
    throw AppError.unauthorized('Account is deactivated');
  }

  // Rotate: delete old, issue new pair
  await prisma.refreshToken.delete({ where: { id: stored.id } });
  
  // Use contextualRole if available, fallback to user's root DB role for legacy tokens
  const roleToIssue = contextualRole || stored.user.role;
  const tokens = await issueTokenPair(stored.user.id, stored.user.phone, roleToIssue);

  return tokens;
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────
export async function logout(refreshToken: string) {
  // Silently succeed even if the token doesn't exist (idempotent)
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  return { message: 'Logged out successfully' };
}

// ─────────────────────────────────────────────
// INTERNAL: Issue access + refresh token pair
// ─────────────────────────────────────────────
async function issueTokenPair(userId: string, phone: string, role: string) {
  const accessToken = jwt.sign(
    { userId, phone, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as any }  // '15m'
  );

  // Refresh token: encode the role into it, and store the JWT in DB
  const { v4: uuidv4 } = await import('uuid');
  const jti = uuidv4();
  
  const rawRefreshToken = jwt.sign(
    { userId, role, jti },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '30d' }
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

  await prisma.refreshToken.create({
    data: {
      token: rawRefreshToken,
      userId,
      expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: 15 * 60, // seconds, useful for the client to know
  };
}

// ─────────────────────────────────────────────
// GET ME
// ─────────────────────────────────────────────
export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      name: true,
      email: true,
      profileImageUrl: true,
      role: true,
      usageType: true,
      whatsappOptIn: true,
      profileComplete: true,
      // If the role is DRIVER, also fetch the driver profile info for onboarding resume
      driver: {
        select: {
          id: true,
          dlNumber: true,       // Used by router to determine onboarding step
          isDocVerified: true,
          vehicle: {            // Used by router to determine onboarding step
            select: {
              id: true,
              registrationNo: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw AppError.notFound('User not found');
  }

  return user;
}
