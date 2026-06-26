import { NextFunction, Request, Response } from 'express';
import { extractIdFromYoutubeUrl, generateRoomCode } from '../utils/room';
import { prisma } from '../lib/prisma';
import { warmCache } from '../lib/roomStateCache';

export const createRoom = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { videoUrl, hostId, socketId, roomName, hostname } = req.body;

    // Retry on roomCode collision (extremely rare with nanoid but safe)
    let roomCode = generateRoomCode();
    let attempts = 0;

    const videoId = extractIdFromYoutubeUrl(videoUrl);

    while (
      await prisma.room.findUnique({
        where: {
          roomCode: roomCode,
        },
      })
    ) {
      if (++attempts > 5) throw new Error('ROOM_CODE_GENERATION_FAILED');
      roomCode = generateRoomCode();
    }

    // Room expires after 24h to prevent stale rooms (can be extended on activity)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h

    // create room, initial state, and host participant in a single transaction
    const room = await prisma.room.create({
      data: {
        roomCode,
        roomName,
        videoId: videoId ?? '',
        videoUrl,
        hostId,
        hostName: hostname,
        expiresAt,

        state: {
          create: {
            currentTime: 0,
            playing: false,
            hostId,
          },
        },

        participants: {
          create: {
            userId: hostId,
            userName: hostname,
            socketId: socketId, // will be updated on socket connection
            isHost: true,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // +2h (session expires after 2h of inactivity)
          },
        },
      },
      include: {
        state: true,
        participants: true,
      },
    });

    warmCache(roomCode, {
      roomId: room.id,
      playing: false,
      currentTime: 0,
    });

    return res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

export const getRoomByCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { roomCode } = req.query;

    if (!roomCode) {
      return res.status(400).json({
        message: 'Room code is required',
      });
    }

    const room = await prisma.room.findUnique({
      where: { roomCode: roomCode.toString() },
      include: {
        state: true,
        participants: true,
      },
    });

    if (!room) {
      return res.status(400).json({
        success: false,
        error: 'Room not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: room,
      message: 'Room Details fetched Successfully',
    });
  } catch (error) {
    next(error);
  }
};
