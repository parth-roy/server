import { Request, Response, NextFunction } from 'express';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';

export const createLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, companyName, phone, city, role } = req.body;

    const lead = await prisma.lead.create({
      data: {
        name,
        companyName,
        phone,
        city,
        role
      }
    });

    res.status(201).json({
      success: true,
      message: 'Lead application submitted successfully',
      data: lead
    });
  } catch (error) {
    next(error);
  }
};

export const getLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as any;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    
    const where: any = status ? { status } : {};
    
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.lead.count({ where })
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

export const updateLeadStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const lead = await prisma.lead.update({
      where: { id: id as string },
      data: { 
        status,
        ...(notes !== undefined && { notes })
      }
    });

    if (status === 'SUITABLE') {
      const roleStr = lead.role.toLowerCase();
      const isDriver = roleStr.includes('driver') || roleStr.includes('fleet') || roleStr.includes('truck');
      const assignedRole = isDriver ? 'DRIVER' : 'WORKER';

      // Create User if not exists
      let user = await prisma.user.findUnique({ where: { phone: lead.phone } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            phone: lead.phone,
            name: lead.name,
            role: assignedRole,
          }
        });
      }

      if (isDriver) {
        // Create Driver Profile
        const existingDriver = await prisma.driver.findUnique({ where: { userId: user.id } });
        if (!existingDriver) {
          await prisma.driver.create({
            data: {
              userId: user.id,
              licenseNumber: `PENDING_${user.id}`,
            }
          });
        }
      } else {
        // Create Worker Profile
        const existingWorker = await prisma.worker.findUnique({ where: { userId: user.id } });
        if (!existingWorker) {
          await prisma.worker.create({
            data: {
              userId: user.id,
              isActive: true,
              isDocVerified: false
            }
          });
        }
      }
    }

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
