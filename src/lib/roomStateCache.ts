import { prisma } from './prisma';

/**
 * Represents the in-memory state of a room.
 */
interface CachedRoomState {
  /** Database UUID of the room */
  roomId: string;

  /** Whether the video is currently playing */
  playing: boolean;

  /** Current playback position in seconds */
  currentTime: number;
}

/**
 * In-memory cache storing the latest state for each room.
 *
 * Key: roomCode
 * Value: CachedRoomState
 */
export const roomStateCache = new Map<string, CachedRoomState>();

/**
 * Stores debounce timers for each room.
 * Used to prevent excessive database writes during frequent seek events.
 *
 * Key: roomCode
 * Value: setTimeout handle
 */
const seekDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Delay before persisting room state to the database.
 * Any updates within this period will reset the timer.
 */
const SEEK_DEBOUNCE_MS = 400;

/**
 * Resolves a room's database ID using its room code.
 *
 * The function first checks the in-memory cache to avoid an unnecessary
 * database query. If the room is not cached, it falls back to Prisma.
 *
 * @param roomCode - Human-readable room code.
 * @returns The room's database ID, or null if the room does not exist.
 */
export async function resolveRoomId(roomCode: string): Promise<string | null> {
  const cached = roomStateCache.get(roomCode);
  if (cached) return cached.roomId;

  const room = await prisma.room.findUnique({
    where: { roomCode },
  });

  return room?.id ?? null;
}

/**
 * Adds a room's initial state to the in-memory cache.
 *
 * Typically called when a room is created or loaded from the database.
 *
 * @param roomCode - Human-readable room code.
 * @param state - Initial room state.
 */
export function warmCache(roomCode: string, state: CachedRoomState): void {
  roomStateCache.set(roomCode, state);
}

/**
 * Updates the cached state for a room.
 *
 * Only the provided fields are updated while preserving
 * the existing cached values.
 *
 * @param roomCode - Human-readable room code.
 * @param patch - Partial room state to merge into the cache.
 */
export function updateCache(
  roomCode: string,
  patch: Partial<CachedRoomState> & { roomId: string },
): void {
  const existing = roomStateCache.get(roomCode);

  roomStateCache.set(roomCode, {
    ...existing,
    ...patch,
  } as CachedRoomState);
}

/**
 * Returns whether the video is currently playing.
 *
 * If the room is not cached, false is returned.
 *
 * @param roomCode - Human-readable room code.
 * @returns True if playing, otherwise false.
 */
export function getPlayingState(roomCode: string): boolean {
  return roomStateCache.get(roomCode)?.playing ?? false;
}

/**
 * Returns the current timestamp of video.
 *
 * If the room is not cached, 0 is returned.
 *
 * @param roomCode - Human-readable room code.
 * @returns timestamp if video exists, otherwise 0.
 */
export function getCurrentTimestamp(roomCode: string): number {
  return roomStateCache.get(roomCode)?.currentTime ?? 0;
}

/**
 * Removes all in-memory data associated with a room.
 *
 * This clears both:
 * - Cached room state
 * - Any pending database persistence timer
 *
 * Should be called when a room is deleted or becomes inactive.
 *
 * @param roomCode - Human-readable room code.
 */
export function evictRoom(roomCode: string): void {
  roomStateCache.delete(roomCode);

  const timer = seekDebounceTimers.get(roomCode);

  if (timer) {
    clearTimeout(timer);
    seekDebounceTimers.delete(roomCode);
  }
}

/**
 * Persists the latest playback state to the database.
 *
 * This function is intentionally separated from scheduling logic
 * so it can be reused or called directly if immediate persistence
 * is required.
 *
 * @param roomId - Database UUID of the room.
 * @param data - Latest playback state.
 */
export async function persistRoomState(
  roomId: string,
  data: {
    playing: boolean;
    currentTime: number;
  },
): Promise<void> {
  try {
    await prisma.roomState.update({
      where: { roomId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[RoomState] DB write failed for roomId=%s: %o', roomId, err);
  }
}

/**
 * Schedules a debounced database write for the room state.
 *
 * If another update is received before the debounce interval
 * expires, the previous timer is cancelled and a new one is created.
 *
 * This dramatically reduces database writes while users are
 * dragging the seek bar or rapidly changing playback state.
 *
 * @param roomCode - Human-readable room code.
 * @param roomId - Database UUID of the room.
 * @param data - Latest playback state to persist.
 */
export function schedulePersist(
  roomCode: string,
  roomId: string,
  data: {
    playing: boolean;
    currentTime: number;
  },
): void {
  const existing = seekDebounceTimers.get(roomCode);

  if (existing) {
    clearTimeout(existing);
  }

  seekDebounceTimers.set(
    roomCode,
    setTimeout(() => {
      seekDebounceTimers.delete(roomCode);
      void persistRoomState(roomId, data);
    }, SEEK_DEBOUNCE_MS),
  );
}
