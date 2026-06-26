export interface Room {
  id: string;
  hostId: string;
  videoId: string;
  createdAt: Date;
}

export interface RoomState {
  roomId: string;
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  updatedAt: Date;
}

export interface Participant {
  roomId: string;
  userId: string;
  socketId: Date;
}
