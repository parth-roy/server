import { Request, Response, NextFunction } from 'express';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { sendSuccess } from '@shared/utils/response';
import { z } from 'zod';

const workforceQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ON_JOB']).optional(),
  isDocVerified: z.coerce.boolean().optional(),
});

export const listWorkforce = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = workforceQuerySchema.parse(req.query);
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.isDocVerified !== undefined) where.isDocVerified = q.isDocVerified;
    if (q.search) {
      where.OR = [
        { user: { name: { contains: q.search, mode: 'insensitive' } } },
        { user: { phone: { contains: q.search } } },
      ];
    }

    const [total, workers] = await Promise.all([
      prisma.worker.count({ where }),
      prisma.worker.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          user: { select: { name: true, phone: true, email: true, profileImageUrl: true } },
          documents: { select: { status: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    sendSuccess(res, {
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
      data: workers,
    });
  } catch (err) { next(err); }
};

export const getWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const worker = await prisma.worker.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, phone: true, email: true, profileImageUrl: true } },
        documents: true,
      },
    });
    if (!worker) throw AppError.notFound('Worker not found');
    sendSuccess(res, worker);
  } catch (err) { next(err); }
};

export const updateWorkerBankDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const schema = z.object({
      bankAccountNo: z.string().min(5).max(30),
      bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
      bankName: z.string().min(2),
      bankAccountHolderName: z.string().min(2),
      bankVerified: z.boolean().optional(),
    });
    const body = schema.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) throw AppError.notFound('Worker not found');

    const updated = await prisma.worker.update({
      where: { id },
      data: {
        bankAccountNo: body.bankAccountNo,
        bankIfsc: body.bankIfsc.toUpperCase(),
        bankName: body.bankName,
        bankAccountHolderName: body.bankAccountHolderName,
        bankVerified: body.bankVerified !== undefined ? body.bankVerified : worker.bankVerified,
      },
    });

    sendSuccess(res, updated);
  } catch (err) { next(err); }
};

export const suspendWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { isActive } = req.body;
    
    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) throw AppError.notFound('Worker not found');

    const updated = await prisma.worker.update({
      where: { id },
      data: { isActive: !!isActive },
    });
    sendSuccess(res, updated);
  } catch (err) { next(err); }
};

export const revokeVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) throw AppError.notFound('Worker not found');

    // Revoke verification and set documents to pending so they can be re-evaluated
    const updated = await prisma.worker.update({
      where: { id },
      data: { isDocVerified: false },
    });

    await prisma.workerDocument.updateMany({
      where: { workerId: id },
      data: { status: 'PENDING' },
    });

    sendSuccess(res, updated);
  } catch (err) { next(err); }
};
