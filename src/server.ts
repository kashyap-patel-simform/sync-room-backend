import { Server, Socket } from 'socket.io';
import app from './app';
import config from './config/config';
import { createServer } from 'node:http';
import { registerRoomHandlers } from './socket/handlers/roomHandler';

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
  },
});

io.on('connection', (socket: Socket) => {
  socket.emit('connected', { message: 'a new client connected' });
  registerRoomHandlers(socket);
});

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
