import { customAlphabet } from 'nanoid';

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
