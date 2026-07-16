# Sync Room Backend

A real-time backend that lets a group of people watch a YouTube video together, perfectly in sync, while also being able to see and hear each other over live audio/video. One person creates a **room** and becomes the **host**; others join with a room code. As the host plays, pauses, or seeks the video, every participant's player is updated over WebSockets in real time. Independently, every participant can stream their camera/mic into the room through a **mediasoup SFU**, so the "watch party" also works like a video call.

Think "watch party + video call" server: REST endpoints to create/look up a room, Socket.IO events to keep everyone's video position in lockstep, and a set of Socket.IO signaling events that negotiate WebRTC media streams through mediasoup.

## How it works (mental model)

- **Room** — a watch session, identified by a short, human-readable `roomCode` (e.g. `aB3xY9`). Created via a REST call, holds the YouTube video, the host's identity, and an expiry (24h after creation).
- **Participant** — one user's presence in a room, tied to their current Socket.IO connection (`socketId`). A user can only have one active participant record per room (`roomId + userId` is unique). One participant is flagged `isHost`.
- **RoomState** — the single source of truth for "what's playing right now": `currentTime`, `playing`, `playbackRate`. Kept in an **in-memory cache** for fast reads/writes and persisted to MongoDB on a 400ms debounce so rapid seek/play/pause events don't hammer the database.
- **Host** — the participant whose play/pause/seek/heartbeat actions drive playback for the whole room. If the host disconnects (leaves), the oldest remaining participant is automatically promoted to host and a `host_changed` event is broadcast.
- **HostTransferLog** — a Prisma model for auditing host handoffs. It exists in the schema but nothing currently writes to it (see [Known gaps](#known-gaps-honest-status)).

Flow at a glance:

```
1. Host calls  POST /api/room             → Room + RoomState + host Participant created
2. Client opens a Socket.IO connection    → server emits "connected"
3. Everyone emits "join_room"             → joins the Socket.IO room, gets a "sync_tick" with current playback position
4. Host emits video_play / video_pause / video_seek
                                           → server updates cache, broadcasts video_played/video_paused/video_seeked
                                           → debounced write to MongoDB
5. Host periodically emits host_heartbeat → server rebroadcasts sync_tick to keep late joiners / drifted clients aligned
6. A participant emits leave_room (or disconnects)
                                           → removed from room; if they were host, next-oldest participant is promoted
                                           → if room is now empty, it's deleted from cache + DB
```

## Mediasoup: how the video-call layer works

The playback-sync layer above (Room/RoomState/Participant) only ever exchanges small JSON messages — "play at 45.5s". Camera and microphone data is a completely different beast: continuous, high-bitrate, latency-sensitive audio/video, and it never touches Socket.IO or MongoDB. It flows peer-to-server-to-peer over WebRTC, and **mediasoup** is the server-side piece that makes that possible.

### Why an SFU instead of peer-to-peer?

With N participants, plain WebRTC (mesh) would require every browser to open a direct connection to every other browser — N·(N-1) connections, each uploading its own video once per peer. That collapses fast as the room grows. An **SFU (Selective Forwarding Unit)** flips this: every participant sends their media **once**, to the server, and the server forwards (routes) it to whoever wants to receive it. Upload cost per participant stays constant; the server absorbs the fan-out.

Mediasoup is a library for building exactly this kind of SFU — it doesn't decode/encode/mix media (that would be an MCU), it just forwards RTP packets between WebRTC connections it terminates on the server.

### The core objects

| mediasoup object    | What it is                                                                                                                                                                                                                                                               | Where in this codebase                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Worker**          | One OS process (mediasoup spins up a native C++ subprocess) that does the actual media routing. One per server instance here.                                                                                                                                            | `initMediasoupWorker()` in [`src/lib/mediasoupService.ts`](src/lib/mediasoupService.ts), started once in `start()` in [`src/server.ts`](src/server.ts) before the HTTP server listens |
| **Router**          | A virtual space where peers can connect to each other's media — the mediasoup-level equivalent of a "room". One per Socket.IO room (`roomCode`).                                                                                                                         | `createRoomRouter()`; created lazily per room in `getOrCreateRoomSfu()` in [`src/lib/sfuState.ts`](src/lib/sfuState.ts)                                                               |
| **WebRtcTransport** | A single ICE/DTLS/SRTP connection between one browser and the server. Each peer opens **two** — one to _send_ media up (`sendTransport`), one to _receive_ media down (`recvTransport`) — because sending and receiving are negotiated and paused/resumed independently. | Created in the `CREATE_TRANSPORT` handler, stored on `PeerSfuState`                                                                                                                   |
| **Producer**        | A single outbound media track (one mic, one camera) flowing from a peer's `sendTransport` into the router.                                                                                                                                                               | Created in the `PRODUCE` handler                                                                                                                                                      |
| **Consumer**        | A single inbound copy of _someone else's_ Producer, flowing from the router down a peer's `recvTransport`. One Consumer per (viewer, remote track) pair.                                                                                                                 | Created in the `CONSUME` handler                                                                                                                                                      |

All of this state is **in-memory only** (`roomSfuCache` in `sfuState.ts`) — mediasoup's native objects aren't serializable, so unlike `RoomState` there is no MongoDB persistence layer for it; if the server restarts, every call drops and has to be renegotiated.

### Overall signaling flow

The client never talks WebRTC directly to another client. Every step below is a Socket.IO round-trip to the server, which is really just relaying WebRTC negotiation parameters (SDP-equivalent info: ICE candidates, DTLS certs, RTP codecs) between the browser's `mediasoup-client` and the server's mediasoup Router. The actual audio/video _bytes_, once connected, flow over UDP/SRTP straight between browser and server — Socket.IO is only used for signaling, never for the media itself.

```
1. Peer calls GET_RTP_CAPABILITIES  → server lazily creates the Router for this room (if not already there)
                                       → returns the Router's supported codecs (VP8/H264 video, Opus audio)
2. Peer calls CREATE_TRANSPORT (x2) → one "send" transport, one "recv" transport
                                       → server returns ICE/DTLS parameters
                                       → mediasoup-client on the browser opens the actual WebRTC connections
3. Peer calls CONNECT_TRANSPORT     → completes DTLS handshake on each transport with the browser's parameters
4. Peer calls PRODUCE (per track)   → mic/camera track starts flowing into the send transport
                                       → server creates a Producer, broadcasts NEW_PRODUCER to everyone else in the room
5. Peer calls GET_PRODUCERS         → (on join) lists every existing Producer in the room, so a late joiner
                                       can catch up on people who were already streaming
6. For each Producer of interest,
   peer calls CONSUME               → server checks router.canConsume() (codec compatibility check)
                                       → creates a Consumer on the peer's recv transport, paused
7. Peer calls RESUME_CONSUMER       → server unpauses the Consumer, media starts flowing down to that peer
8. Peer stops sharing (mute camera,
   leave, disconnect)               → CLOSE_PRODUCER or removePeerSfu() closes Producers/Consumers/Transports
                                       → PRODUCER_CLOSED broadcast tells everyone else to tear down their Consumer
```

Consumers start `paused: true` deliberately — the client needs a moment to set up its `<video>`/`<audio>` element and register event handlers before packets start arriving, so it explicitly calls `RESUME_CONSUMER` when it's ready.

### Real-world analogy

Think of the mediasoup Router as a **conference room with a central AV switchboard**, and each `WebRtcTransport` as a **cable running from one person's laptop to that switchboard**:

- **Worker** = the building's AV equipment room — one per office (server), shared by every conference room (mediasoup Router) inside it.
- **Router** (one per `roomCode`) = a specific conference room's switchboard. Everyone in _this_ meeting plugs into _this_ switchboard; a different meeting down the hall has its own.
- **WebRtcTransport** = the physical cable from your laptop to the switchboard. You actually plug in _two_ cables: one carries your outgoing camera/mic feed up to the switchboard (`sendTransport`), the other carries whatever the switchboard sends back down to your screen/speakers (`recvTransport`).
- **Producer** = your webcam or microphone, plugged into your outgoing cable. If you turn on your camera _and_ unmute your mic, that's two Producers, each a separate signal on the same cable.
- **Consumer** = a labeled output jack on the switchboard, one per person-you're-watching, wired to your incoming cable. If four other people are in the meeting, you have four Consumers (or eight, if you're receiving both video and audio from each) — the switchboard doesn't mix them into one feed, it just fans out a separate copy of each source to everyone who asked for it. That's the "S" in SFU: **Selective Forwarding**, not mixing.
- **NEW_PRODUCER / PRODUCER_CLOSED** = the switchboard's PA announcement: "Alice just turned on her camera" or "Bob just left" — so everyone else knows to plug in (or unplug) a Consumer for that feed.
- **GET_PRODUCERS** = walking into a meeting that's already in progress and asking the receptionist "who's already presenting, so I can tune in?"

This is exactly why an SFU scales better than everyone calling everyone directly (mesh WebRTC): in a mesh, each laptop would need a separate cable run to _every other_ laptop in the building. With the switchboard, each laptop needs exactly two cables — one in, one out — no matter how many people are in the meeting; the switchboard (and the server's bandwidth) absorbs the fan-out cost.

## Tech stack

| Technology | Version | Purpose                                                        |
| ---------- | ------- | -------------------------------------------------------------- |
| Node.js    | 18+     | Runtime                                                        |
| TypeScript | ^6.0    | Type safety                                                    |
| Express    | ^5.2    | REST API framework                                             |
| Socket.IO  | ^4.8    | Real-time bidirectional events (playback sync + SFU signaling) |
| mediasoup  | ^3.21   | WebRTC SFU — routes audio/video between participants           |
| Prisma     | ^6.19   | ORM / MongoDB client (new `prisma-client` generator)           |
| MongoDB    | -       | Document database                                              |
| nanoid     | ^5.1    | Short, collision-safe room code generation                     |
| cors       | ^2.8    | CORS middleware                                                |
| dotenv     | ^17.4   | Environment variable loading                                   |
| tsup / tsx | -       | Build (tsup) and dev-mode execution (tsx + nodemon)            |

## Project structure

```
src/
├── app.ts                        # Express app: JSON body parsing, CORS, routes, error handler
├── server.ts                     # Entry point: HTTP server + Socket.IO server + socket connection wiring
├── config/
│   └── config.ts                 # Reads PORT / NODE_ENV / mediasoup port range + announced IP from process.env
├── controllers/
│   └── roomController.ts         # createRoom, getRoomByCode (REST handlers)
├── routes/
│   └── roomRoutes.ts             # POST / and GET / mounted at /api/room
├── socket/
│   └── handlers/
│       ├── roomHandler.ts        # Playback-sync Socket.IO event handlers — the real-time sync engine
│       └── sfuHandler.ts         # mediasoup signaling handlers (transports, producers, consumers)
├── lib/
│   ├── prisma.ts                 # Singleton PrismaClient instance
│   ├── participant.ts            # fetchParticipants(roomId) helper
│   ├── roomStateCache.ts         # In-memory Map cache + debounced (400ms) DB persistence
│   ├── mediasoupService.ts       # mediasoup Worker/Router setup, codec + WebRtcTransport config
│   └── sfuState.ts               # In-memory per-room SFU state (Router, peers, transports/producers/consumers) — never persisted
├── middlewares/
│   └── errorHandlers.ts          # Global Express error handler
├── models/
│   ├── models.ts                 # Plain TS interfaces mirroring Prisma models (legacy/duplicate, unused)
│   └── item.ts                   # Leftover scaffolding, not wired into the app — safe to ignore/remove
├── utils/
│   ├── events.ts                 # Socket.IO event name constants (single source of truth)
│   └── room.ts                   # generateRoomCode, extractIdFromYoutubeUrl, getCurrentPlaybackPosition
├── types/
│   └── socket.d.ts               # Type augmentation adding `userId` to Socket.IO's Socket (declared, not yet populated anywhere)
└── generated/prisma/             # Prisma-generated client (git-ignored, regenerated by `prisma generate`)

prisma/
├── schema.prisma                 # MongoDB schema: Room, RoomState, Participant, HostTransferLog
└── prisma.config.ts              # Prisma CLI config (schema path, engine)
```

## Getting started

### Prerequisites

- Node.js 18+
- A MongoDB database (Atlas or local) — Prisma is configured for the `mongodb` provider
- npm

### Setup

```bash
git clone <repository-url>
cd backend

npm install

cp .env.example .env
# edit .env — see Environment variables below

npx prisma generate   # generates the client into src/generated/prisma
npx prisma db push    # syncs the schema to your MongoDB database (no migrations for MongoDB)

npm run dev            # starts on http://localhost:3000 with hot-reload (nodemon + tsx)
```

### Environment variables

These are actually read by the code today (`src/config/config.ts`, `src/app.ts`, `src/server.ts`):

| Variable                 | Required | Default       | Used for                                                                                                                             |
| ------------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                   | No       | `3000`        | HTTP/Socket.IO server port                                                                                                           |
| `NODE_ENV`               | No       | `development` | Environment mode                                                                                                                     |
| `DATABASE_URL`           | Yes      | -             | MongoDB connection string (Prisma)                                                                                                   |
| `FRONTEND_URL`           | Yes      | -             | Allowed CORS origin for REST + Socket.IO                                                                                             |
| `MEDIASOUP_ANNOUNCED_IP` | No       | `127.0.0.1`   | Public/LAN IP mediasoup advertises in ICE candidates — must be reachable by clients; `127.0.0.1` only works for same-machine testing |
| `MEDIASOUP_MIN_PORT`     | No       | `40000`       | Start of the UDP/TCP port range mediasoup uses for WebRTC media                                                                      |
| `MEDIASOUP_MAX_PORT`     | No       | `49999`       | End of that port range — must be open/forwarded on the host/firewall                                                                 |

`.env.example` also lists `JWT_SECRET`, `LOG_LEVEL`, `ROOM_EXPIRY_HOURS`, `SESSION_EXPIRY_HOURS`, `RATE_LIMIT_*`, and `HTTPS_ENABLED`. These are placeholders for features that don't exist yet — nothing in `src/` reads them. Room expiry (24h) and participant session expiry (2h) are currently hardcoded in `roomController.ts` / `roomHandler.ts`.

### Scripts

| Command          | What it does                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| `npm run dev`    | Runs the server with nodemon + tsx, restarting on any `src/**/*.ts` change |
| `npm run build`  | `prisma generate` then bundles `src/server.ts` into `dist/` with tsup      |
| `npm start`      | Runs the built server: `node dist/server.js`                               |
| `npm run lint`   | ESLint over `src/**/*.ts`                                                  |
| `npm run format` | Prettier `--write` over `src/**/*.ts`                                      |

There is no test script configured — no test suite currently exists in this repo.

## REST API

Base path: `/api/room`

### Create a room

```http
POST /api/room
Content-Type: application/json

{
  "videoUrl": "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "roomName": "Movie Night",
  "hostId": "user123",
  "hostname": "John Doe",
  "socketId": "socket-id-from-client"
}
```

`videoUrl` must be a recognizable YouTube URL (`youtube.com/watch`, `/embed/`, `/v/`, `/shorts/`, or `youtu.be/`) — the video ID is extracted server-side. On success, a `Room`, its initial `RoomState` (paused, `currentTime: 0`), and the host's `Participant` record are created in one write, and the room's playback state is warmed into the in-memory cache.

**201 Created**

```json
{
  "success": true,
  "message": "Room created successfully",
  "data": {
    "id": "…",
    "roomCode": "aB3xY9",
    "roomName": "Movie Night",
    "videoId": "dQw4w9WgXcQ",
    "hostId": "user123",
    "hostName": "John Doe",
    "createdAt": "2026-07-03T10:00:00.000Z",
    "expiresAt": "2026-07-04T10:00:00.000Z",
    "state": {
      "currentTime": 0,
      "playing": false,
      "playbackRate": 1,
      "hostId": "user123"
    },
    "participants": [
      { "userId": "user123", "userName": "John Doe", "isHost": true }
    ]
  }
}
```

Errors: `400` if the YouTube URL can't be parsed, `409` if a generated room code collides on write (retried internally up to 5 times first).

### Get a room by code

```http
GET /api/room?roomCode=aB3xY9
```

Returns the room with its current `state` and `participants`. `404` if not found, `400` if `roomCode` is missing.

## WebSocket API (Socket.IO)

Event name constants live in [`src/utils/events.ts`](src/utils/events.ts) — import from there rather than hardcoding strings on the client.

On connection, the server immediately emits:

```js
socket.on('connected', (data) => {
  console.log(data.message); // "a new client connected"
});
```

### Client → Server

| Event            | Payload                                   | Ack response                                                  |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `join_room`      | `{ roomCode, userName, userId }`          | `{ success, data: room }` or `{ success: false, error }`      |
| `leave_room`     | `{ roomCode, userId }`                    | `{ success, message }` or `{ success: false, error }`         |
| `video_play`     | `{ roomCode, timestamp }`                 | `{ success }` or `{ success: false, error }`                  |
| `video_pause`    | `{ roomCode, timestamp }`                 | `{ success }` or `{ success: false, error }`                  |
| `video_seek`     | `{ roomCode, timestamp }`                 | `{ success }` or `{ success: false, error }`                  |
| `host_heartbeat` | `{ roomCode, currentTimestamp, playing }` | _(no ack)_ — rebroadcasts `sync_tick` to the rest of the room |

Example:

```js
socket.emit(
  'join_room',
  { roomCode: 'aB3xY9', userName: 'John Doe', userId: 'user123' },
  (res) => {
    if (res.success) console.log('joined', res.data);
  },
);

socket.emit('video_play', { roomCode: 'aB3xY9', timestamp: 45.5 }, (res) =>
  console.log(res),
);
```

### Server → Client (broadcast to the room, excluding sender)

| Event          | Payload                              | When                                                                                       |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `user_joined`  | `{ userId, userName, participants }` | Someone joins the room                                                                     |
| `user_left`    | `{ userId, userName, participants }` | A non-host participant leaves                                                              |
| `video_played` | `{ roomCode, timestamp }`            | Host (or any client) plays the video                                                       |
| `video_paused` | `{ roomCode, timestamp }`            | Host pauses the video, or is broadcast when the host leaves                                |
| `video_seeked` | `{ roomCode, timestamp }`            | Host seeks                                                                                 |
| `sync_tick`    | `{ playing, currentTime }`           | Sent to a joining client with current position; also rebroadcast on every `host_heartbeat` |
| `host_changed` | `{ hostId, hostName }`               | The host left and a new host was promoted                                                  |

### SFU (mediasoup) signaling events

All ack-callback style — see [Mediasoup: how the video-call layer works](#mediasoup-how-the-video-call-layer-works) for the full negotiation sequence.

| Event                  | Direction                   | Payload                                             | Ack response                                                                                                    |
| ---------------------- | --------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `get_rtp_capabilities` | Client → Server             | `{ roomCode }`                                      | `{ success, rtpCapabilities }` — creates the room's Router if it doesn't exist yet                              |
| `get_producers`        | Client → Server             | `{ roomCode }`                                      | `{ success, producers: [{ producerId, fromUserId, fromSocketId, kind }] }` — everyone else's existing Producers |
| `create_transport`     | Client → Server             | `{ roomCode, direction: 'send' \| 'recv', userId }` | `{ success, transportId, iceParameters, iceCandidates, dtlsParameters }`                                        |
| `connect_transport`    | Client → Server             | `{ roomCode, transportId, dtlsParameters }`         | `{ success }` or `{ success: false, error }`                                                                    |
| `produce`              | Client → Server             | `{ roomCode, transportId, kind, rtpParameters }`    | `{ success, producerId }` — also broadcasts `new_producer` to the rest of the room                              |
| `consume`              | Client → Server             | `{ roomCode, producerId, rtpCapabilities }`         | `{ success, id, producerId, kind, rtpParameters }` — Consumer created paused                                    |
| `resume_consumer`      | Client → Server             | `{ roomCode, consumerId }`                          | `{ success }` — unpauses the Consumer, media starts flowing                                                     |
| `close_producer`       | Client → Server             | `{ roomCode, kind }`                                | `{ success }` — closes this peer's Producer of that kind, broadcasts `producer_closed`                          |
| `new_producer`         | Server → Client (broadcast) | `{ producerId, fromUserId, fromSocketId, kind }`    | Sent when another peer starts producing a track — client should `consume` it                                    |
| `producer_closed`      | Server → Client (broadcast) | `{ producerId, fromUserId, fromSocketId, kind }`    | Sent when another peer's Producer closes — client should tear down its Consumer                                 |

## Data model

MongoDB via Prisma (`prisma/schema.prisma`). No migrations — schema changes are applied with `prisma db push`.

**Room** — one watch session.
| Field | Type | Notes |
|---|---|---|
| roomCode | String | unique, short human-readable code |
| roomName, videoId, videoUrl | String | videoUrl optional |
| hostId, hostName | String | current host |
| createdAt / expiresAt | DateTime | expiresAt = createdAt + 24h |

**RoomState** — 1:1 with Room, cascade-deleted with it.
| Field | Type | Notes |
|---|---|---|
| currentTime | Float | playback position in seconds |
| playing | Boolean | |
| playbackRate | Float | default 1.0, not currently changed anywhere in the code |
| hostId | String | |
| updatedAt | DateTime | drives "elapsed time since last update" calculation for late joiners |

**Participant** — one row per user per room, cascade-deleted with the room.
| Field | Type | Notes |
|---|---|---|
| userId, userName | String | |
| socketId | String | unique, current Socket.IO connection |
| isHost | Boolean | |
| joinedAt / expiresAt | DateTime | expiresAt is a 2h safety net for orphaned records; nothing currently sweeps expired rows |

Unique on `[roomId, userId]` (one active session per user per room); indexed for host lookup and oldest-participant-becomes-host promotion.

**HostTransferLog** — modeled for auditing host handoffs (`prevHostId`, `newHostId`, `reason`, `snapshotTime`), but **no code currently writes to it** — see [Known gaps](#known-gaps-honest-status).

## Deployment

Deployed via [Render](https://render.com)

## Known gaps (honest status)

This project has no authentication layer and is not hardened for production. Worth knowing before you build on it:

- **No auth** — anyone who knows a room code can join it; no token/session verification on REST or Socket.IO connections.
- **No input validation** beyond manual null checks in handlers — no schema validation library.
- **No rate limiting**, no `helmet`, no HTTPS enforcement.
- **No test suite.**
- **No cleanup job** for expired rooms/participants — `expiresAt` fields exist but nothing sweeps them.
- `HostTransferLog` is fully modeled in Prisma but never written to.
- `src/models/models.ts` and `src/models/item.ts` are unused leftovers.
- `src/types/socket.d.ts` declares a `userId` field on `Socket` that nothing currently assigns.
- **Single mediasoup Worker, no TURN server, no NAT-friendly deployment story.** One Worker per process means one server core does all media routing — there's no scaling across cores/machines. `MEDIASOUP_ANNOUNCED_IP` must be a real, reachable IP for clients not on the same machine; behind most PaaS containers (including the `render.yaml` config below) the required UDP port range typically isn't exposed, so the SFU is effectively local-dev/self-hosted-only as shipped.
- SFU state (`roomSfuCache` in `sfuState.ts`) is in-memory only and lost on restart — mid-call media state can't survive a redeploy the way `RoomState` playback position can (it's debounce-persisted to MongoDB).

If you're extending this project, treat the seven env vars above as the real configuration surface — the extra ones in `.env.example` are aspirational.

## License

ISC
