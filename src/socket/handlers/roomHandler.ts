/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { Socket } from 'socket.io';
import { fetchParticipants } from '../../lib/participant';
import { prisma } from '../../lib/prisma';
import { events } from '../../utils/events';

export function registerRoomHandlers(socket: Socket) {
  // JOIN ROOM
  socket.on(
    events.JOIN_ROOM,
    async (
      {
        roomCode,
        userName,
        userId,
      }: {
        roomCode: string;
        userName: string;
        userId: string;
      },
      callback: Function,
    ) => {
      try {
        // find the room with the given roomCode
        const room = await prisma.room.findUnique({
          where: {
            roomCode,
          },
          include: {
            state: true,
            participants: true,
          },
        });

        if (!room) {
          return callback({ success: false, error: 'Room not found' });
        }

        if (room.expiresAt < new Date()) {
          return callback({ success: false, error: 'Room experies' });
        }

        // join the socket room
        socket.join(roomCode);

        // upsert the joining participant so they appear in the list
        await prisma.participant.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          update: { socketId: socket.id, userName },
          create: {
            roomId: room.id,
            userId,
            userName,
            socketId: socket.id,
            isHost: userId === room?.hostId,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          },
        });

        const updatedRoom = await prisma.room.findUnique({
          where: { roomCode },
          include: {
            state: true,
            participants: true,
          },
        });
        // fetch the updated participant list (now includes the new user)
        const participants = await fetchParticipants(room.id);

        // broadcast USER_JOINED to everyone else
        socket.to(roomCode).emit(events.USER_JOINED, {
          userId,
          userName,
          participants,
        });

        callback({
          success: true,
          data: updatedRoom,
        });
      } catch (err) {
        console.error(err);
        callback({ sucess: false, error: 'Failed to join the room' });
      }
    },
  );

  // LEAVE ROOM
  socket.on(
    events.LEAVE_ROOM,
    async (
      { roomCode, userId }: { roomCode: string; userId: string },
      callback: Function,
    ) => {
      if (!roomCode)
        return callback({
          success: false,
          error: 'Room Code not found.',
        });

      if (!userId)
        return callback({
          success: false,
          error: 'User not found.',
        });

      const room = await prisma.room.findUnique({
        where: { roomCode },
      });

      if (!room) {
        return callback({
          success: false,
          error: 'Room not found.',
        });
      }

      const deletedParticipant = await prisma.participant.delete({
        where: {
          roomId_userId: {
            roomId: room?.id,
            userId: userId,
          },
        },
      });

      const participants = await fetchParticipants(room?.id);

      socket.to(roomCode).emit(events.USER_LEFT, {
        userId,
        userName: deletedParticipant.userName,
        participants,
      });

      return callback({
        success: false,
        error: 'User Leaved Successfully',
      });
    },
  );

  // VIDEO PLAY
  socket.on(
    events.VIDEO_PLAY_IN,
    async (
      {
        roomCode,
        timestamp,
      }: {
        roomCode: string;
        timestamp: number;
      },
      callback: Function,
    ) => {
      if (!roomCode) {
        return callback({
          success: false,
          error: 'Room Code not found.',
        });
      }

      if (timestamp === undefined) {
        return callback({
          success: false,
          error: 'Timestamp not provided.',
        });
      }
      const room = await prisma.room.findUnique({
        where: { roomCode },
      });

      if (!room) {
        return callback({
          success: false,
          error: 'Wrong room code',
        });
      }

      await prisma.roomState.update({
        where: { roomId: room.id },
        data: {
          playing: true,
          currentTime: timestamp,
          updatedAt: new Date(),
        },
      });

      socket.to(roomCode).emit(events.VIDEO_PLAY, {
        roomCode,
        timestamp,
      });
      return true;
    },
  );

  // VIDEO PAUSE
  socket.on(
    events.VIDEO_PAUSE_IN,
    async (
      {
        roomCode,
        timestamp,
      }: {
        roomCode: string;
        timestamp: number;
      },
      callback: Function,
    ) => {
      if (!roomCode) {
        return callback({
          success: false,
          error: 'Room Code not found.',
        });
      }

      if (timestamp === undefined) {
        return callback({
          success: false,
          error: 'Timestamp not provided.',
        });
      }

      const room = await prisma.room.findUnique({
        where: { roomCode },
      });

      if (!room) {
        return callback({
          success: false,
          error: 'Wrong room code',
        });
      }

      await prisma.roomState.update({
        where: { roomId: room.id },
        data: {
          playing: false,
          currentTime: timestamp,
          updatedAt: new Date(),
        },
      });

      socket.to(roomCode).emit(events.VIDEO_PAUSE, {
        roomCode,
        timestamp,
      });
      return true;
    },
  );

  // VIDEO SEEK
  socket.on(
    events.VIDEO_SEEK_IN,
    async (
      {
        roomCode,
        timestamp,
      }: {
        roomCode: string;
        timestamp: number;
      },
      callback: Function,
    ) => {
      if (!roomCode) {
        return callback({
          success: false,
          error: 'Room Code not found.',
        });
      }

      if (timestamp === undefined) {
        return callback({
          success: false,
          error: 'Timestamp not provided.',
        });
      }

      const room = await prisma.room.findUnique({
        where: { roomCode },
      });

      if (!room) {
        return callback({
          success: false,
          error: 'Wrong room code',
        });
      }

      await prisma.roomState.update({
        where: { roomId: room.id },
        data: {
          playing: false,
          currentTime: timestamp,
          updatedAt: new Date(),
        },
      });

      socket.to(roomCode).emit(events.VIDEO_SEEK, {
        roomCode,
        timestamp,
      });
      return true;
    },
  );
}
