/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { Socket } from 'socket.io';
import { fetchParticipants } from '../../lib/participant';
import { prisma } from '../../lib/prisma';
import {
  evictRoom,
  getPlayingState,
  resolveRoomId,
  schedulePersist,
  updateCache,
  warmCache,
} from '../../lib/roomStateCache';
import { events } from '../../utils/events';
import { getCurrentPlaybackPosition } from '../../utils/room';

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
        const room = await prisma.room.findUnique({
          where: { roomCode },
          include: {
            state: true,
            participants: true,
          },
        });

        if (!room) {
          return callback({ success: false, error: 'Room not found' });
        }

        if (room.expiresAt < new Date()) {
          return callback({ success: false, error: 'Room has expired' });
        }

        socket.join(roomCode);

        await prisma.participant.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          update: { socketId: socket.id, userName },
          create: {
            roomId: room.id,
            userId,
            userName,
            socketId: socket.id,
            isHost: userId === room.hostId,
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

        if (!updatedRoom?.state) {
          return callback({ success: false, error: 'Room state unavailable' });
        }

        // Compute once and reuse to keep cache and callback in sync
        const currentTime = getCurrentPlaybackPosition(updatedRoom.state);

        warmCache(roomCode, {
          roomId: room.id,
          playing: updatedRoom.state.playing,
          currentTime,
        });

        socket.emit(events.SYNC_TICK, {
          playing: updatedRoom.state.playing,
          currentTime,
        });

        socket.to(roomCode).emit(events.USER_JOINED, {
          userId,
          userName,
          participants: updatedRoom.participants,
        });

        callback({
          success: true,
          data: {
            ...updatedRoom,
            state: {
              ...updatedRoom.state,
              currentTime,
            },
          },
        });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to join the room' });
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
      try {
        if (!roomCode) {
          return callback({ success: false, error: 'Room Code not found.' });
        }

        if (!userId) {
          return callback({ success: false, error: 'User not found.' });
        }

        const room = await prisma.room.findUnique({
          where: { roomCode },
        });

        if (!room) {
          return callback({ success: false, error: 'Room not found.' });
        }

        const deletedParticipant = await prisma.participant.delete({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId,
            },
          },
        });

        const participants = await fetchParticipants(room.id);

        if (participants.length === 0) {
          evictRoom(roomCode);
        }

        socket.leave(roomCode);

        socket.to(roomCode).emit(events.USER_LEFT, {
          userId,
          userName: deletedParticipant.userName,
          participants,
        });

        return callback({ success: true, message: 'User left successfully' });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to leave the room' });
      }
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
      callback: (res: { success: boolean; error?: string }) => void,
    ) => {
      if (!roomCode) {
        return callback?.({ success: false, error: 'Room Code not found.' });
      }

      if (timestamp === undefined) {
        return callback?.({ success: false, error: 'Timestamp not provided.' });
      }

      const roomId = await resolveRoomId(roomCode);
      if (!roomId) {
        return callback?.({ success: false, error: 'Wrong room code' });
      }

      updateCache(roomCode, { roomId, playing: true, currentTime: timestamp });
      socket.to(roomCode).emit(events.VIDEO_PLAY, { roomCode, timestamp });

      schedulePersist(roomCode, roomId, {
        playing: true,
        currentTime: timestamp,
      });

      return callback?.({ success: true });
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
      callback: (res: { success: boolean; error?: string }) => void,
    ) => {
      if (!roomCode) {
        return callback?.({ success: false, error: 'Room Code not found.' });
      }

      if (timestamp === undefined) {
        return callback?.({ success: false, error: 'Timestamp not provided.' });
      }

      const roomId = await resolveRoomId(roomCode);
      if (!roomId) {
        return callback?.({ success: false, error: 'Wrong room code' });
      }

      updateCache(roomCode, { roomId, playing: false, currentTime: timestamp });
      socket.to(roomCode).emit(events.VIDEO_PAUSE, { roomCode, timestamp });

      schedulePersist(roomCode, roomId, {
        playing: false,
        currentTime: timestamp,
      });

      return callback?.({ success: true });
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
      callback: (res: { success: boolean; error?: string }) => void,
    ) => {
      if (!roomCode) {
        return callback?.({ success: false, error: 'Room Code not found.' });
      }

      if (timestamp === undefined) {
        return callback?.({ success: false, error: 'Timestamp not provided.' });
      }

      const roomId = await resolveRoomId(roomCode);
      if (!roomId) {
        return callback?.({ success: false, error: 'Wrong room code' });
      }

      const playing = getPlayingState(roomCode);
      updateCache(roomCode, { roomId, playing, currentTime: timestamp });
      socket.to(roomCode).emit(events.VIDEO_SEEK, { roomCode, timestamp });
      schedulePersist(roomCode, roomId, { playing, currentTime: timestamp });

      return callback?.({ success: true });
    },
  );

  // HEARTBEAT
  socket.on(
    events.HOST_HEARTBEAT,
    async ({
      roomCode,
      currentTimestamp,
      playing,
      sync_all,
    }: {
      roomCode: string;
      currentTimestamp: number;
      playing: boolean;
      sync_all: boolean;
    }) => {
      const roomId = await resolveRoomId(roomCode);

      if (!roomId) {
        return;
      }

      if (sync_all) {
        socket.to(roomCode).emit(events.SYNC_TICK, {
          playing,
          currentTime: currentTimestamp,
        });
      }

      updateCache(roomCode, {
        roomId,
        currentTime: currentTimestamp,
        playing,
      });
    },
  );
}
