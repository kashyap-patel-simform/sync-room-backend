# Sync Room Backend

A real-time backend that lets a group of people watch a YouTube video together, perfectly in sync. One person creates a **room** and becomes the **host**; others join with a room code. As the host plays, pauses, or seeks the video, every participant's player is updated over WebSockets in real time.

Think "watch party" server: REST endpoints to create/look up a room, and Socket.IO events to keep everyone's video position in lockstep.

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

## Tech stack

| Technology     | Version | Purpose                                             |
| -------------- | ------- | ---------------------------------------------------- |
| Node.js        | 18+     | Runtime                                              |
| TypeScript     | ^6.0    | Type safety                                          |
| Express        | ^5.2    | REST API framework                                   |
| Socket.IO      | ^4.8    | Real-time bidirectional events                       |
| Prisma         | ^6.19   | ORM / MongoDB client (new `prisma-client` generator) |
| MongoDB        | -       | Document database                                    |
| nanoid         | ^5.1    | Short, collision-safe room code generation           |
| cors           | ^2.8    | CORS middleware                                      |
| dotenv         | ^17.4   | Environment variable loading                         |
| tsup / tsx     | -       | Build (tsup) and dev-mode execution (tsx + nodemon)  |

## Project structure

```
src/
├── app.ts                        # Express app: JSON body parsing, CORS, routes, error handler
├── server.ts                     # Entry point: HTTP server + Socket.IO server + socket connection wiring
├── config/
│   └── config.ts                 # Reads PORT / NODE_ENV from process.env
├── controllers/
│   └── roomController.ts         # createRoom, getRoomByCode (REST handlers)
├── routes/
│   └── roomRoutes.ts             # POST / and GET / mounted at /api/room
├── socket/
│   └── handlers/
│       └── roomHandler.ts        # All Socket.IO event handlers — the real-time sync engine
├── lib/
│   ├── prisma.ts                 # Singleton PrismaClient instance
│   ├── participant.ts            # fetchParticipants(roomId) helper
│   └── roomStateCache.ts         # In-memory Map cache + debounced (400ms) DB persistence
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

Only these four are actually read by the code today (`src/config/config.ts`, `src/app.ts`, `src/server.ts`):

| Variable       | Required | Default       | Used for                                  |
| -------------- | -------- | ------------- | ------------------------------------------ |
| `PORT`         | No       | `3000`        | HTTP/Socket.IO server port                 |
| `NODE_ENV`     | No       | `development` | Environment mode                           |
| `DATABASE_URL` | Yes      | -             | MongoDB connection string (Prisma)         |
| `FRONTEND_URL` | Yes      | -             | Allowed CORS origin for REST + Socket.IO   |

`.env.example` also lists `JWT_SECRET`, `LOG_LEVEL`, `ROOM_EXPIRY_HOURS`, `SESSION_EXPIRY_HOURS`, `RATE_LIMIT_*`, and `HTTPS_ENABLED`. These are placeholders for features that don't exist yet — nothing in `src/` reads them. Room expiry (24h) and participant session expiry (2h) are currently hardcoded in `roomController.ts` / `roomHandler.ts`.

### Scripts

| Command         | What it does                                                          |
| --------------- | ---------------------------------------------------------------------- |
| `npm run dev`   | Runs the server with nodemon + tsx, restarting on any `src/**/*.ts` change |
| `npm run build` | `prisma generate` then bundles `src/server.ts` into `dist/` with tsup   |
| `npm start`     | Runs the built server: `node dist/server.js`                          |
| `npm run lint`  | ESLint over `src/**/*.ts`                                              |
| `npm run format`| Prettier `--write` over `src/**/*.ts`                                  |

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
    "state": { "currentTime": 0, "playing": false, "playbackRate": 1, "hostId": "user123" },
    "participants": [{ "userId": "user123", "userName": "John Doe", "isHost": true }]
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

| Event         | Payload                                       | Ack response                                                     |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `join_room`   | `{ roomCode, userName, userId }`               | `{ success, data: room }` or `{ success: false, error }`          |
| `leave_room`  | `{ roomCode, userId }`                         | `{ success, message }` or `{ success: false, error }`             |
| `video_play`  | `{ roomCode, timestamp }`                      | `{ success }` or `{ success: false, error }`                      |
| `video_pause` | `{ roomCode, timestamp }`                      | `{ success }` or `{ success: false, error }`                      |
| `video_seek`  | `{ roomCode, timestamp }`                      | `{ success }` or `{ success: false, error }`                      |
| `host_heartbeat` | `{ roomCode, currentTimestamp, playing }`   | *(no ack)* — rebroadcasts `sync_tick` to the rest of the room       |

Example:

```js
socket.emit('join_room', { roomCode: 'aB3xY9', userName: 'John Doe', userId: 'user123' }, (res) => {
  if (res.success) console.log('joined', res.data);
});

socket.emit('video_play', { roomCode: 'aB3xY9', timestamp: 45.5 }, (res) => console.log(res));
```

### Server → Client (broadcast to the room, excluding sender)

| Event          | Payload                                  | When                                                      |
| -------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `user_joined`  | `{ userId, userName, participants }`      | Someone joins the room                                      |
| `user_left`    | `{ userId, userName, participants }`      | A non-host participant leaves                                |
| `video_played` | `{ roomCode, timestamp }`                 | Host (or any client) plays the video                         |
| `video_paused` | `{ roomCode, timestamp }`                 | Host pauses the video, or is broadcast when the host leaves   |
| `video_seeked` | `{ roomCode, timestamp }`                 | Host seeks                                                   |
| `sync_tick`    | `{ playing, currentTime }`                | Sent to a joining client with current position; also rebroadcast on every `host_heartbeat` |
| `host_changed` | `{ hostId, hostName }`                    | The host left and a new host was promoted                    |

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

Deployed via [Render](https://render.com) — see [`render.yaml`](render.yaml):

```yaml
services:
  - type: web
    name: backend
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
```

`DATABASE_URL`, `FRONTEND_URL`, and `PORT` must be set separately in the Render dashboard — they're not in `render.yaml`.

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

If you're extending this project, treat the four env vars above as the real configuration surface — the extra ones in `.env.example` are aspirational.

## License

ISC
