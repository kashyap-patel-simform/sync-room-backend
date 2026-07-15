import type { types } from 'mediasoup';
import { createRoomRouter } from './mediasoupService';

export interface PeerSfuState {
  socketId: string;
  userId: string;
  sendTransport?: types.WebRtcTransport;
  recvTransport?: types.WebRtcTransport;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

export interface RoomSfuState {
  router: types.Router;
  peers: Map<string, PeerSfuState>;
}

/**
 * In-memory SFU state, keyed by roomCode. mediasoup objects (Router,
 * WebRtcTransport, Producer, Consumer) are not serializable, so this must
 * never be persisted to Prisma — mirrors the pattern in roomStateCache.ts.
 */
const roomSfuCache = new Map<string, RoomSfuState>();

export async function getOrCreateRoomSfu(
  roomCode: string,
): Promise<RoomSfuState> {
  let state = roomSfuCache.get(roomCode);
  if (!state) {
    const router = await createRoomRouter();
    state = { router, peers: new Map() };
    roomSfuCache.set(roomCode, state);
  }
  return state;
}

export function getRoomSfu(roomCode: string): RoomSfuState | undefined {
  return roomSfuCache.get(roomCode);
}

export function getOrCreatePeer(
  state: RoomSfuState,
  socketId: string,
  userId: string,
): PeerSfuState {
  let peer = state.peers.get(socketId);
  if (!peer) {
    peer = { socketId, userId, producers: new Map(), consumers: new Map() };
    state.peers.set(socketId, peer);
  }
  return peer;
}

export function findPeer(
  roomCode: string,
  socketId: string,
): PeerSfuState | undefined {
  return roomSfuCache.get(roomCode)?.peers.get(socketId);
}

export function findTransport(
  roomCode: string,
  socketId: string,
  transportId: string,
): types.WebRtcTransport | undefined {
  const peer = findPeer(roomCode, socketId);
  if (!peer) return undefined;
  if (peer.sendTransport?.id === transportId) return peer.sendTransport;
  if (peer.recvTransport?.id === transportId) return peer.recvTransport;
  return undefined;
}

export function findConsumer(
  roomCode: string,
  socketId: string,
  consumerId: string,
): types.Consumer | undefined {
  return findPeer(roomCode, socketId)?.consumers.get(consumerId);
}

/**
 * Closes and removes all transports/producers/consumers for a single peer.
 * Call on explicit leave_room and on socket disconnect.
 */
export function removePeerSfu(roomCode: string, socketId: string): void {
  const state = roomSfuCache.get(roomCode);
  const peer = state?.peers.get(socketId);
  if (!state || !peer) return;

  peer.producers.forEach((p) => p.close());
  peer.consumers.forEach((c) => c.close());
  peer.sendTransport?.close();
  peer.recvTransport?.close();

  state.peers.delete(socketId);
}

/**
 * Closes the room's router (which transitively closes any remaining
 * transports/producers/consumers) and drops the room from the cache.
 * Call when the room's participant list becomes empty.
 */
export function evictRoomSfu(roomCode: string): void {
  const state = roomSfuCache.get(roomCode);
  if (!state) return;

  state.router.close();
  roomSfuCache.delete(roomCode);
}
