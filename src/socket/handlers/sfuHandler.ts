import { Socket } from 'socket.io';
import type { types } from 'mediasoup';
import { events } from '../../utils/events';
import { webRtcTransportOptions } from '../../lib/mediasoupService';
import {
  findConsumer,
  findPeer,
  findTransport,
  getOrCreatePeer,
  getOrCreateRoomSfu,
  getRoomSfu,
} from '../../lib/sfuState';

export function registerSfuHandlers(socket: Socket) {
  socket.on(
    events.GET_RTP_CAPABILITIES,
    async (
      { roomCode }: { roomCode: string },
      callback: (
        res:
          | { success: true; rtpCapabilities: types.RtpCapabilities }
          | { success: false; error: string },
      ) => void,
    ) => {
      try {
        const { router } = await getOrCreateRoomSfu(roomCode);
        callback({ success: true, rtpCapabilities: router.rtpCapabilities });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to get RTP capabilities' });
      }
    },
  );

  socket.on(
    events.GET_PRODUCERS,
    (
      { roomCode }: { roomCode: string },
      callback: (
        res:
          | {
              success: true;
              producers: {
                producerId: string;
                fromUserId: string;
                fromSocketId: string;
                kind: types.MediaKind;
              }[];
            }
          | { success: false; error: string },
      ) => void,
    ) => {
      try {
        const state = getRoomSfu(roomCode);
        if (!state) {
          return callback({ success: true, producers: [] });
        }

        const producers: {
          producerId: string;
          fromUserId: string;
          fromSocketId: string;
          kind: types.MediaKind;
        }[] = [];

        for (const peer of state.peers.values()) {
          // Skip our own producers — a peer never consumes itself.
          if (peer.socketId === socket.id) continue;
          for (const producer of peer.producers.values()) {
            producers.push({
              producerId: producer.id,
              fromUserId: peer.userId,
              fromSocketId: peer.socketId,
              kind: producer.kind,
            });
          }
        }

        callback({ success: true, producers });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to get producers' });
      }
    },
  );

  socket.on(
    events.CREATE_TRANSPORT,
    async (
      {
        roomCode,
        direction,
        userId,
      }: { roomCode: string; direction: 'send' | 'recv'; userId: string },
      callback: (
        res:
          | {
              success: true;
              transportId: string;
              iceParameters: types.IceParameters;
              iceCandidates: types.IceCandidate[];
              dtlsParameters: types.DtlsParameters;
            }
          | { success: false; error: string },
      ) => void,
    ) => {
      try {
        const state = await getOrCreateRoomSfu(roomCode);
        const transport = await state.router.createWebRtcTransport(
          webRtcTransportOptions,
        );
        const peer = getOrCreatePeer(state, socket.id, userId);

        if (direction === 'send') peer.sendTransport = transport;
        else peer.recvTransport = transport;

        transport.on('dtlsstatechange', (dtlsState) => {
          if (dtlsState === 'closed') transport.close();
        });

        callback({
          success: true,
          transportId: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to create transport' });
      }
    },
  );

  socket.on(
    events.CONNECT_TRANSPORT,
    async (
      {
        roomCode,
        transportId,
        dtlsParameters,
      }: {
        roomCode: string;
        transportId: string;
        dtlsParameters: types.DtlsParameters;
      },
      callback: (res: { success: boolean; error?: string }) => void,
    ) => {
      try {
        const transport = findTransport(roomCode, socket.id, transportId);
        if (!transport) {
          return callback({ success: false, error: 'Transport not found' });
        }
        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to connect transport' });
      }
    },
  );

  socket.on(
    events.PRODUCE,
    async (
      {
        roomCode,
        transportId,
        kind,
        rtpParameters,
      }: {
        roomCode: string;
        transportId: string;
        kind: types.MediaKind;
        rtpParameters: types.RtpParameters;
      },
      callback: (
        res:
          | { success: true; producerId: string }
          | { success: false; error: string },
      ) => void,
    ) => {
      try {
        const peer = findPeer(roomCode, socket.id);
        const transport = peer?.sendTransport;
        if (!peer || !transport || transport.id !== transportId) {
          return callback({
            success: false,
            error: 'Send transport not found',
          });
        }

        const producer = await transport.produce({ kind, rtpParameters });
        peer.producers.set(producer.id, producer);

        socket.to(roomCode).emit(events.NEW_PRODUCER, {
          producerId: producer.id,
          fromUserId: peer.userId,
          fromSocketId: socket.id,
          kind,
        });

        callback({ success: true, producerId: producer.id });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to produce' });
      }
    },
  );

  socket.on(
    events.CONSUME,
    async (
      {
        roomCode,
        producerId,
        rtpCapabilities,
      }: {
        roomCode: string;
        producerId: string;
        rtpCapabilities: types.RtpCapabilities;
      },
      callback: (
        res:
          | {
              success: true;
              id: string;
              producerId: string;
              kind: types.MediaKind;
              rtpParameters: types.RtpParameters;
            }
          | { success: false; error: string },
      ) => void,
    ) => {
      try {
        const state = getRoomSfu(roomCode);
        const peer = findPeer(roomCode, socket.id);
        const recvTransport = peer?.recvTransport;
        if (!state || !recvTransport) {
          return callback({ success: false, error: 'Not ready' });
        }
        if (!state.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ success: false, error: 'Cannot consume' });
        }

        const consumer = await recvTransport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });
        peer.consumers.set(consumer.id, consumer);

        consumer.on('producerclose', () => {
          peer.consumers.delete(consumer.id);
        });

        callback({
          success: true,
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to consume' });
      }
    },
  );

  socket.on(
    events.RESUME_CONSUMER,
    async (
      { roomCode, consumerId }: { roomCode: string; consumerId: string },
      callback: (res: { success: boolean; error?: string }) => void,
    ) => {
      try {
        const consumer = findConsumer(roomCode, socket.id, consumerId);
        if (!consumer) {
          return callback({ success: false, error: 'Consumer not found' });
        }
        await consumer.resume();
        callback({ success: true });
      } catch (err) {
        console.error(err);
        callback({ success: false, error: 'Failed to resume consumer' });
      }
    },
  );

  socket.on(
    events.CLOSE_PRODUCER,
    async (
      { roomCode, kind }: { roomCode: string; kind: types.MediaKind },
      callback: (res: { success: boolean }) => void,
    ) => {
      const peer = findPeer(roomCode, socket.id);
      const producer = peer
        ? [...peer.producers.values()].find((p) => p.kind === kind)
        : undefined;

      if (peer && producer) {
        producer.close();
        peer.producers.delete(producer.id);

        socket.to(roomCode).emit(events.PRODUCER_CLOSED, {
          producerId: producer.id,
          fromUserId: peer.userId,
          fromSocketId: socket.id,
          kind,
        });
      }

      callback({ success: true });
    },
  );
}
