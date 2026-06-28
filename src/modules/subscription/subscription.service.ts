import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';

// Plan pricing map (in INR, not paise)
const PLAN_PRICES: Record<string, number> = {
  BASIC: 999,
  STANDARD: 1499,
  PRO: 2499,
  PREMIUM: 3999,
};

/**
 * Create or update a driver's subscription.
 * In Phase 1 (mock payment), this creates the subscription immediately.
 * In Phase 2, a real payment gateway (Razorpay) webhook will call this after payment.
 */
export async function selectPlan(
  userId: string,
  plan: 'BASIC' | 'STANDARD' | 'PRO' | 'PREMIUM',
  paymentReference?: string,
) {
  // 1. Find the driver record for this user
  const driver = await prisma.driver.findUnique({
    where: { userId },
    select: { id: true, subscription: { select: { id: true } } },
  });

  if (!driver) {
    throw AppError.notFound(
      'Driver profile not found. Complete your profile before selecting a plan.',
    );
  }

  const pricePerMonth = PLAN_PRICES[plan];
  if (!pricePerMonth) {
    throw AppError.badRequest(`Unknown plan: ${plan}`);
  }

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30); // 30-day subscription

  let subscription;

  if (driver.subscription) {
    // Update existing subscription (plan upgrade/change)
    subscription = await prisma.driverSubscription.update({
      where: { driverId: driver.id },
      data: {
        plan: plan as any,
        pricePerMonth,
        startDate,
        endDate,
        isActive: true,
        paymentReference: paymentReference ?? null,
        paymentMethod: paymentReference ? 'razorpay' : 'mock',
      },
    });
    logger.info(`[Subscription] Driver ${driver.id} upgraded to plan: ${plan}`);
  } else {
    // Create new subscription
    subscription = await prisma.driverSubscription.create({
      data: {
        driverId: driver.id,
        plan: plan as any,
        pricePerMonth,
        startDate,
        endDate,
        isActive: true,
        paymentReference: paymentReference ?? null,
        paymentMethod: paymentReference ? 'razorpay' : 'mock',
      },
    });
    logger.info(`[Subscription] Driver ${driver.id} subscribed to plan: ${plan}`);
  }

  return {
    id: subscription.id,
    plan: subscription.plan,
    pricePerMonth: subscription.pricePerMonth,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    isActive: subscription.isActive,
    paymentMethod: subscription.paymentMethod,
  };
}

/**
 * Get the current subscription for a driver.
 */
export async function getSubscription(userId: string) {
  const driver = await prisma.driver.findUnique({
    where: { userId },
    select: {
      id: true,
      subscription: {
        select: {
          id: true,
          plan: true,
          pricePerMonth: true,
          startDate: true,
          endDate: true,
          isActive: true,
          paymentMethod: true,
          createdAt: true,
        },
      },
    },
  });

  if (!driver) {
    throw AppError.notFound('Driver profile not found.');
  }

  return driver.subscription ?? null;
}
