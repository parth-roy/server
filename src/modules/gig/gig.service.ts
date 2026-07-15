import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { GigJobStatus, WorkerJobStatus } from '@prisma/client';
import { getSocketInstance } from '@shared/socket/socket.instance';

export async function createGig(customerId: string, data: any) {
    // Determine fare based on gig type (mock logic for now, should be from pricing engine or fixed)
    const totalFare = data.workersNeeded * 500; // Base rate 500 per worker for now

    const gig = await prisma.gigJob.create({
        data: {
            jobNumber: `GIG-${Math.floor(100000 + Math.random() * 900000)}`,
            customerId,
            gigType: data.gigType,
            description: data.description,
            locationLat: data.locationLat,
            locationLng: data.locationLng,
            locationAddress: data.locationAddress,
            workersNeeded: data.workersNeeded,
            totalFare: totalFare,
            status: 'PENDING',
        },
    });

    // Notify nearby workforce
    const io = getSocketInstance();
    if (io) io.of('/workforce').emit('new_gig_job', gig);

    return gig;
}

export async function getCustomerGigs(customerId: string) {
    return prisma.gigJob.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        include: { assignments: true },
    });
}

export async function getNearbyGigs(lat: number, lng: number, radiusKm: number) {
    // Mock nearby query for now, return all PENDING gigs
    return prisma.gigJob.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
    });
}

export async function getGigById(id: string) {
    const gig = await prisma.gigJob.findUnique({
        where: { id },
        include: { customer: true, assignments: { include: { worker: { include: { user: true } } } } },
    });
    if (!gig) throw AppError.notFound('Gig job not found');
    return gig;
}

export async function getAllGigs() {
    return prisma.gigJob.findMany({
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { id: true, name: true, phone: true } } },
    });
}

export async function acceptGig(workerUserId: string, gigId: string) {
    const worker = await prisma.worker.findUnique({
        where: { userId: workerUserId },
    });
    if (!worker) throw AppError.notFound('Worker profile not found');

    const gig = await prisma.gigJob.findUnique({
        where: { id: gigId },
        include: { assignments: true },
    });
    if (!gig) throw AppError.notFound('Gig job not found');
    if (gig.status !== 'PENDING' && gig.status !== 'ASSIGNED') {
        throw AppError.badRequest('Gig job is no longer available');
    }

    if (gig.assignments.length >= gig.workersNeeded) {
        throw AppError.badRequest('Gig job has already reached required workforce');
    }

    const existingAssignment = gig.assignments.find((a: any) => a.workerId === worker.id);
    if (existingAssignment) {
        throw AppError.badRequest('You have already accepted this job');
    }

    const assignment = await prisma.gigAssignment.create({
        data: {
            gigId,
            workerId: worker.id,
            status: 'PENDING_ACCEPTANCE',
            payoutAmount: gig.totalFare / gig.workersNeeded,
        },
    });

    if (gig.assignments.length + 1 >= gig.workersNeeded) {
        await prisma.gigJob.update({
            where: { id: gigId },
            data: { status: 'ASSIGNED' },
        });
    }

    return assignment;
}
