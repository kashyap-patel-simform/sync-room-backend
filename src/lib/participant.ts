import { prisma } from './prisma';

export const fetchParticipants = async (roomId: string) => {
  return await prisma.participant.findMany({
    where: { roomId },
  });
};
