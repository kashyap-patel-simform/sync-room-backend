import { customAlphabet } from 'nanoid';
import { RoomState } from '../generated/prisma/client';

const nanoid = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  6,
);

export function generateRoomCode(): string {
  return nanoid();
}

export function extractIdFromYoutubeUrl(url: string): string | null {
  const regExp =
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([^"&?/\s]{11})/;

  const match = url.match(regExp);

  return match ? match[1] : null;
}

export function getCurrentPlaybackPosition(state: RoomState): number {
  if (!state.playing) {
    return state.currentTime;
  }

  const elapsed = (Date.now() - state.updatedAt.getMilliseconds()) / 1000;

  return state.currentTime + elapsed;
}
