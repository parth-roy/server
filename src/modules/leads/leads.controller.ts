import { Request, Response, NextFunction } from 'express';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';

export const createWorkforceLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, city, role } = req.body;

    const userId = req.user?.id;
    
    const lead = await prisma.workforceLead.create({
      data: { name, phone, city, role }
    });

    res.status(201).json({
      success: true,
      message: 'Workforce lead application submitted successfully',
      data: lead
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkforceLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as any;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    
    const where: any = status ? { status } : {};
    
    const [leads, total] = await Promise.all([
      prisma.workforceLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workforceLead.count({ where })
    ]);

    res.json({
      success: true,
      data: leads,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateWorkforceLeadStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const lead = await prisma.workforceLead.update({
      where: { id: id as string },
      data: { 
        status,
        ...(notes !== undefined && { notes })
      }
    });

    res.json({
      success: true,
      message: 'Lead status updated successfully',
      data: lead
    });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      return next(AppError.notFound('Lead not found'));
    }
    next(error);
  }
};
