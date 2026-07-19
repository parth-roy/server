import { prisma } from '@shared/db/prisma';
import { WebContactMessageStatus } from '@prisma/client';

export const createContactMessage = async (data: { name: string; phone: string; message: string }) => {
  return prisma.webContactMessage.create({
    data,
  });
};

export const getContactMessages = async () => {
  return prisma.webContactMessage.findMany({
    orderBy: { createdAt: 'desc' },
  });
};

export const updateContactMessageStatus = async (id: string, status: WebContactMessageStatus) => {
  return prisma.webContactMessage.update({
    where: { id },
    data: { status },
  });
};
