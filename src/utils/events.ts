export const events = {
  JOIN_ROOM: 'join_room',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  LEAVE_ROOM: 'leave_room',

  // Client → Server (incoming)
  VIDEO_PLAY_IN: 'video_play',
  VIDEO_PAUSE_IN: 'video_pause',
  VIDEO_SEEK_IN: 'video_seek',

  // Server → Client (outgoing/broadcast)
  VIDEO_PLAY: 'video_played',
  VIDEO_PAUSE: 'video_paused',
  VIDEO_SEEK: 'video_seeked',
};
