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

    const videoId = extractIdFromYoutubeUrl(videoUrl);

    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL. Could not extract video ID.',
      });
    }

    // Retry on roomCode collision (extremely rare with nanoid but safe)
    let roomCode = generateRoomCode();
    let attempts = 0;

    while (
      await prisma.room.findUnique({
        where: { roomCode },
      })
    ) {
      if (++attempts > 5) throw new Error('ROOM_CODE_GENERATION_FAILED');
      roomCode = generateRoomCode();
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let room;
    try {
      room = await prisma.room.create({
        data: {
          roomCode,
          roomName,
          videoId,
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
              socketId,
              isHost: true,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            },
          },
        },
        include: {
          state: true,
          participants: true,
        },
      });
    } catch (err: unknown) {
      // P2002: unique constraint — room code was claimed between check and create
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        return res.status(409).json({
          success: false,
          error: 'Room code collision. Please retry.',
        });
      }
      throw err;
    }

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
        success: false,
        error: 'Room code is required',
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
      return res.status(404).json({
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
