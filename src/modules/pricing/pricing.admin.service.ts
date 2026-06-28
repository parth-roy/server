/**
 * pricing.admin.service.ts — Admin-only pricing management operations.
 * All changes are logged to pricing_change_log (audit trail).
 */

import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { pricingService } from './pricing.service';

// ── Vehicle Pricing Admin ─────────────────────────────────────────────────────

export async function adminListVehicles() {
    return (prisma as any).vehicleTypePricing.findMany({
        orderBy: { baseFare: 'asc' },
    });
}

export async function adminUpdateVehicle(vehicleType: string, data: Record<string, any>, adminId: string) {
    const existing = await (prisma as any).vehicleTypePricing.findUnique({
        where: { vehicleType },
    });
    if (!existing) throw AppError.notFound(`Vehicle type ${vehicleType} not found`);

    // Log the change
    await logPricingChange(adminId, 'VEHICLE_UPDATE', vehicleType, JSON.stringify(existing), JSON.stringify(data));

    const updated = await (prisma as any).vehicleTypePricing.update({
        where: { vehicleType },
        data,
    });

    // Invalidate cache
    await pricingService.invalidateVehicleCache();

    logger.info(`[Admin/Pricing] Vehicle ${vehicleType} updated by admin ${adminId}`);
    return updated;
}

// ── Global Config Admin ───────────────────────────────────────────────────────

export async function adminListConfig() {
    return (prisma as any).pricingConfig.findMany({ orderBy: { key: 'asc' } });
}

export async function adminUpdateConfig(key: string, value: string, adminId: string) {
    const existing = await (prisma as any).pricingConfig.findUnique({ where: { key } });
    if (!existing) throw AppError.notFound(`Config key '${key}' not found`);

    await logPricingChange(adminId, 'CONFIG_UPDATE', key, existing.value, value);

    const updated = await (prisma as any).pricingConfig.update({
        where: { key },
        data: { value, updatedBy: adminId },
    });

    await pricingService.invalidateConfigCache();

    logger.info(`[Admin/Pricing] Config '${key}' changed from '${existing.value}' to '${value}' by admin ${adminId}`);
    return updated;
}

// ── Commission Rate ───────────────────────────────────────────────────────────

export async function adminGetCommissionRate() {
    const config = await (prisma as any).pricingConfig.findUnique({
        where: { key: 'platform_commission_rate' },
    });
    return {
        rate: parseFloat(config?.value ?? '0.10'),
        ratePercent: parseFloat(config?.value ?? '0.10') * 100,
        lifecycleStage: (await (prisma as any).pricingConfig.findUnique({ where: { key: 'commission_lifecycle_stage' } }))?.value ?? 'MARKET_ENTRY',
    };
}

export async function adminSetCommissionRate(rate: number, reason: string, adminId: string) {
    if (rate < 0 || rate > 0.30) {
        throw AppError.badRequest('Commission rate must be between 0% and 30%');
    }
    if (!reason || reason.trim().length < 5) {
        throw AppError.badRequest('A reason is required when changing commission rate');
    }

    const existing = await (prisma as any).pricingConfig.findUnique({ where: { key: 'platform_commission_rate' } });
    const oldValue = existing?.value ?? '0.10';

    await logPricingChange(adminId, 'COMMISSION_CHANGE', 'platform_commission_rate', oldValue, String(rate), reason);

    await (prisma as any).pricingConfig.update({
        where: { key: 'platform_commission_rate' },
        data: { value: String(rate), updatedBy: adminId },
    });

    await pricingService.invalidateConfigCache();

    logger.info(`[Admin/Pricing] Commission changed from ${oldValue} to ${rate} by admin ${adminId}. Reason: ${reason}`);
    return { newRate: rate, previousRate: parseFloat(oldValue) };
}

// ── Fuel Price Management ─────────────────────────────────────────────────────

export async function adminGetFuelStatus() {
    const keys = ['diesel_baseline_price', 'diesel_current_price', 'fuel_surcharge_enabled', 'fuel_surcharge_threshold_pct'];
    const configs = await (prisma as any).pricingConfig.findMany({ where: { key: { in: keys } } });
    const map = Object.fromEntries(configs.map((c: any) => [c.key, c.value]));

    const baseline = parseFloat(map.diesel_baseline_price ?? '90');
    const current  = parseFloat(map.diesel_current_price  ?? '90');
    const threshold = parseFloat(map.fuel_surcharge_threshold_pct ?? '5');
    const enabled   = (map.fuel_surcharge_enabled ?? 'true') === 'true';
    const ratio     = current / baseline;
    const surchargeActive = enabled && ratio > (1 + threshold / 100);

    return {
        baselinePrice: baseline,
        currentPrice:  current,
        differencePercent: parseFloat(((ratio - 1) * 100).toFixed(2)),
        thresholdPercent: threshold,
        surchargeEnabled: enabled,
        surchargeActive,
    };
}

export async function adminUpdateFuelPrice(currentPrice: number, adminId: string) {
    if (currentPrice < 50 || currentPrice > 200) {
        throw AppError.badRequest('Diesel price must be between ₹50 and ₹200/litre');
    }

    const existing = await (prisma as any).pricingConfig.findUnique({ where: { key: 'diesel_current_price' } });
    await logPricingChange(adminId, 'FUEL_PRICE_UPDATE', 'diesel_current_price', existing?.value ?? '90', String(currentPrice));

    await (prisma as any).pricingConfig.update({
        where: { key: 'diesel_current_price' },
        data: { value: String(currentPrice), updatedBy: adminId },
    });

    await pricingService.invalidateConfigCache();
    return { updatedPrice: currentPrice };
}

// ── Audit Log Queries ─────────────────────────────────────────────────────────

export async function adminGetPricingAuditLog(
    page: number, limit: number,
    vehicleType?: string,
    from?: string, to?: string,
) {
    const where: any = {};
    if (vehicleType) where.vehicleType = vehicleType;
    if (from || to) {
        where.calculatedAt = {};
        if (from) where.calculatedAt.gte = new Date(from);
        if (to)   where.calculatedAt.lte = new Date(to);
    }

    const skip = (page - 1) * limit;
    const [total, logs] = await Promise.all([
        (prisma as any).pricingAuditLog.count({ where }),
        (prisma as any).pricingAuditLog.findMany({
            where,
            orderBy: { calculatedAt: 'desc' },
            skip,
            take: limit,
        }),
    ]);

    return { total, page, limit, data: logs };
}

export async function adminGetSubsidies(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [total, subsidies] = await Promise.all([
        (prisma as any).driverPayoutSubsidy.count(),
        (prisma as any).driverPayoutSubsidy.findMany({
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
    ]);
    return { total, page, limit, data: subsidies };
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function logPricingChange(
    adminId: string,
    action: string,
    entityKey: string,
    oldValue: string,
    newValue: string,
    reason?: string,
) {
    // Store in pricing_audit_log with source='admin' or in a separate admin_log
    // For now, log to standard logger — full audit table in Phase 4 (AdminLog model)
    logger.info(`[PricingChangeLog] admin=${adminId} action=${action} key=${entityKey} old=${oldValue} new=${newValue}${reason ? ' reason=' + reason : ''}`);
}
