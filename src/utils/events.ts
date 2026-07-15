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

  HOST_HEARTBEAT: 'host_heartbeat',
  HOST_CHANGED: 'host_changed',

  SYNC_TICK: 'sync_tick',

  // SFU (mediasoup) signaling — request/response, ack-callback style
  GET_RTP_CAPABILITIES: 'get_rtp_capabilities',
  GET_PRODUCERS: 'get_producers',
  CREATE_TRANSPORT: 'create_transport',
  CONNECT_TRANSPORT: 'connect_transport',
  PRODUCE: 'produce',
  CONSUME: 'consume',
  RESUME_CONSUMER: 'resume_consumer',
  CLOSE_PRODUCER: 'close_producer',

  // SFU (mediasoup) notifications — broadcast to the rest of the room
  NEW_PRODUCER: 'new_producer',
  PRODUCER_CLOSED: 'producer_closed',
};
