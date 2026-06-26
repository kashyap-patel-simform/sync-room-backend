# Sync Room Backend

A real-time room management system built with Node.js, Express, Socket.IO, and MongoDB. This application allows users to create collaborative rooms, manage YouTube video playback synchronization, and track room participants in real-time.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- MongoDB Atlas account or local MongoDB instance
- Environment variables configured

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npx prisma generate

# Start development server
npm run dev
```

## 📋 Environment Variables

Create a `.env` file in the project root:

```env
# Server Configuration
PORT=""
NODE_ENV=development

# Database
DATABASE_URL=mongodb+srv://user:password@cluster.mongodb.net/database-name

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# Logging
LOG_LEVEL=info
```

## 📦 Tech Stack

| Technology | Version | Purpose                   |
| ---------- | ------- | ------------------------- |
| Node.js    | 18+     | Runtime environment       |
| Express    | 5.2+    | Web framework             |
| TypeScript | 6.0+    | Type safety               |
| Socket.IO  | 4.8+    | Real-time communication   |
| Prisma     | 6.19+   | ORM & Database management |
| MongoDB    | -       | NoSQL database            |
| nanoid     | 5.1+    | Room code generation      |
| dotenv     | 17.4+   | Environment configuration |
| CORS       | 2.8+    | Cross-origin requests     |

## 🏗️ Project Structure

```
src/
├── app.ts                      # Express app setup
├── server.ts                   # HTTP & Socket.IO server
├── config/
│   ├── config.ts              # App configuration
│   └── constants.ts           # Constants (to be created)
├── controllers/
│   ├── participantController.ts # Participant management
├── routes/
│   ├── roomRoutes.ts          # Room endpoints
├── socket/
│   └── handlers/
│       └── roomHandler.ts      # Socket.IO event handlers
├── models/
│   ├── models.ts              # Data models
│   └── item.ts                # Item model
├── lib/
│   ├── prisma.ts              # Prisma client
│   └── participant.ts         # Participant utilities
├── middlewares/
│   └── errorHandlers.ts       # Error handling middleware
├── utils/
│   ├── roomCode.ts            # Room code generation
│   └── events.ts              # Socket event definitions
└── types/
    └── socket.d.ts            # Socket.IO type extensions

prisma/
└── schema.prisma              # Database schema

```

## 🔌 API Endpoints

### Room Management

#### Create Room

```http
POST /api/room
Content-Type: application/json

{
  "videoUrl": "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "roomName": "Movie Night",
  "hostId": "user123",
  "hostname": "John Doe",
  "socketId": "socket-id"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Room created successfully",
  "data": {
    "id": "room-id",
    "roomCode": "ABC123",
    "roomName": "Movie Night",
    "videoId": "dQw4w9WgXcQ",
    "hostId": "user123",
    "hostName": "John Doe",
    "createdAt": "2026-06-25T10:00:00Z",
    "expiresAt": "2026-06-26T10:00:00Z",
    "state": { ... },
    "participants": [ ... ]
  }
}
```

#### Get Room by Code

```http
GET /api/room?roomCode=ABC123
```

**Response:**

```json
{
  "success": true,
  "message": "Room Details fetched Successfully",
  "data": { ... }
}
```

## 🔌 WebSocket Events

### Client → Server

#### Join Room

```javascript
socket.emit(
  'JOIN_ROOM',
  {
    roomCode: 'ABC123',
    userName: 'John Doe',
    userId: 'user123',
  },
  (response) => {
    if (response.success) {
      console.log('Joined room:', response.data);
    }
  },
);
```

#### Leave Room

```javascript
socket.emit(
  'LEAVE_ROOM',
  {
    roomCode: 'ABC123',
    userId: 'user123',
  },
  (response) => {
    console.log(response);
  },
);
```

#### Play Video

```javascript
socket.emit(
  'VIDEO_PLAY_IN',
  {
    roomCode: 'ABC123',
    timestamp: 45.5, // seconds
  },
  (response) => {
    console.log(response);
  },
);
```

#### Pause Video

```javascript
socket.emit(
  'VIDEO_PAUSE_IN',
  {
    roomCode: 'ABC123',
    timestamp: 45.5,
  },
  (response) => {
    console.log(response);
  },
);
```

#### Seek Video

```javascript
socket.emit(
  'VIDEO_SEEK_IN',
  {
    roomCode: 'ABC123',
    timestamp: 120.0,
  },
  (response) => {
    console.log(response);
  },
);
```

### Server → Client

#### Connected

```javascript
socket.on('connected', (data) => {
  console.log(data.message); // 'a new client connected'
});
```

#### User Joined

```javascript
socket.on('USER_JOINED', (data) => {
  console.log(`${data.userName} joined`);
  console.log('Participants:', data.participants);
});
```

#### User Left

```javascript
socket.on('USER_LEFT', (data) => {
  console.log(`${data.userName} left`);
  console.log('Participants:', data.participants);
});
```

#### Video Play

```javascript
socket.on('VIDEO_PLAY', (data) => {
  console.log('Play at:', data.timestamp);
});
```

#### Video Pause

```javascript
socket.on('VIDEO_PAUSE', (data) => {
  console.log('Pause at:', data.timestamp);
});
```

#### Video Seek

```javascript
socket.on('VIDEO_SEEK', (data) => {
  console.log('Seek to:', data.timestamp);
});
```

## 💾 Database Schema

### Room

Represents a collaborative room for watching videos together.

| Field     | Type     | Description                              |
| --------- | -------- | ---------------------------------------- |
| id        | ObjectId | Unique identifier                        |
| roomCode  | String   | 6-character unique code (e.g., "ABC123") |
| roomName  | String   | Display name of the room                 |
| videoId   | String   | YouTube video ID                         |
| videoUrl  | String   | Full YouTube URL (optional)              |
| hostId    | String   | User ID of room creator                  |
| hostName  | String   | Name of room host                        |
| createdAt | DateTime | Creation timestamp                       |
| expiresAt | DateTime | Expiry timestamp (24h after creation)    |

### RoomState

Stores the current playback state of a room, updated every 5 seconds.

| Field        | Type     | Description                         |
| ------------ | -------- | ----------------------------------- |
| id           | ObjectId | Unique identifier                   |
| roomId       | ObjectId | Reference to Room                   |
| currentTime  | Float    | Playback position in seconds        |
| playing      | Boolean  | Is video currently playing?         |
| playbackRate | Float    | Video playback speed (default: 1.0) |
| hostId       | String   | Current host user ID                |
| updatedAt    | DateTime | Last update timestamp               |

### Participant

Tracks active session presence in a room.

| Field     | Type     | Description                       |
| --------- | -------- | --------------------------------- |
| id        | ObjectId | Unique identifier                 |
| roomId    | ObjectId | Reference to Room                 |
| userId    | String   | User ID                           |
| userName  | String   | Display name                      |
| socketId  | String   | Socket.IO socket ID (unique)      |
| joinedAt  | DateTime | Join timestamp                    |
| isHost    | Boolean  | Is this the room host?            |
| expiresAt | DateTime | Session expiry (2h of inactivity) |

### HostTransferLog

Audit trail for host changes and synchronization debugging.

| Field         | Type     | Description                                      |
| ------------- | -------- | ------------------------------------------------ |
| id            | ObjectId | Unique identifier                                |
| roomId        | ObjectId | Reference to Room                                |
| prevHostId    | String   | Previous host ID (nullable)                      |
| newHostId     | String   | New host ID                                      |
| reason        | Enum     | Transfer reason (DISCONNECT, MANUAL, INACTIVITY) |
| snapshotTime  | Float    | Video timestamp at transfer                      |
| transferredAt | DateTime | Transfer timestamp                               |

## 🔐 Security Considerations

⚠️ **IMPORTANT**: This application currently lacks authentication and authorization mechanisms. **DO NOT DEPLOY TO PRODUCTION** without implementing the following:

### Critical Security Requirements

1. **Authentication (JWT Tokens)**
   - All API endpoints require Bearer token authentication
   - All Socket.IO connections require token verification
   - See [SECURITY.md](./SECURITY.md) for implementation details

2. **Input Validation**
   - All request bodies must be validated
   - Implement using express-validator
   - Validate all Socket.IO event parameters

3. **Security Headers**
   - Implement helmet.js for security headers
   - Set proper CORS restrictions
   - Enable HTTPS in production

4. **Rate Limiting**
   - Implement express-rate-limit
   - Protect against brute force and DoS

5. **Error Handling**
   - Never expose stack traces or sensitive data
   - Use structured logging (Winston)
   - Sanitize error messages in responses

See the [Backend Code Review Report](./BACKEND_REVIEW.md) for detailed security findings.

## 🚀 Development

### Running Development Server

```bash
npm run dev
```

The server starts on `http://localhost:3000` with hot-reload enabled via nodemon.

### Building for Production

```bash
npm run build
npm start
```

### Code Quality

```bash
# Linting
npm run lint

# Code formatting
npm run format
```

## 📊 Database Migrations

### Generate Prisma Client

```bash
npx prisma generate
```

### Apply Schema Changes

```bash
npx prisma db push
```

### View Database with Prisma Studio

```bash
npx prisma studio
```

This opens an interactive UI to view and modify your database at `http://localhost:5555`.

## 🧪 Testing

Currently no test suite is configured. Consider adding:

- Jest for unit tests
- Supertest for API endpoint testing
- Socket.IO client for WebSocket testing

## 📝 Logging

The application currently uses `console.log()`. For production, configure Winston logging:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
```

## 🚢 Deployment

### Environment-Specific Configuration

**Development:**

```env
NODE_ENV=development
PORT=3000
```

**Production:**

```env
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://yourdomain.com
JWT_SECRET=<secure-random-key>
DATABASE_URL=<production-mongodb-uri>
```

### Deployment Platforms

#### Heroku

```bash
heroku create your-app-name
heroku config:set JWT_SECRET=<secret>
git push heroku main
```

#### Railway

```bash
railway link
railway up
```

#### Vercel (Serverless)

Requires Prisma Accelerate for serverless compatibility.

#### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 📄 License

ISC

## 👤 Author

Developed as part of the 2026 System Design Project.

## 🤝 Contributing

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Commit changes (`git commit -m 'Add amazing feature'`)
3. Push to branch (`git push origin feature/amazing-feature`)
4. Open a Pull Request

## 🐛 Known Issues

- [ ] No authentication/authorization implemented
- [ ] No rate limiting
- [ ] No input validation
- [ ] Missing security headers
- [ ] No pagination in participant queries
- [ ] No database cleanup jobs
- [ ] No caching layer
- [ ] Inconsistent error responses

See [BACKEND_REVIEW.md](./BACKEND_REVIEW.md) for complete list of findings and fixes.

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Express.js Guide](https://expressjs.com/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [OWASP Security Guidelines](https://owasp.org/)

## 📞 Support

For issues or questions, please create a GitHub issue or contact the development team.

---

**Last Updated:** 2026-06-25  
**Status:** ⚠️ Development (Not production-ready - security hardening required)
