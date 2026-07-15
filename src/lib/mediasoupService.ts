import mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import config from '../config/config';

const mediaCodecs: types.RouterOptions['mediaCodecs'] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/vp8',
    clockRate: 90000,
    parameters: {},
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
    ],
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// mediasoup binds to 0.0.0.0 but advertises `announcedIp` in its ICE
// candidates — that's the address the browser actually tries to reach. If it's
// left as 0.0.0.0 (the bind address), the browser gets an unroutable candidate,
// ICE never connects, and no media flows even though signaling succeeds. So we
// must always announce a reachable IP: the configured one, or 127.0.0.1 for
// same-machine local dev. For testing across devices, set
// MEDIASOUP_ANNOUNCED_IP to this host's LAN IP.
const announcedIp = config.mediasoupAnnouncedIp || '127.0.0.1';

export const webRtcTransportOptions: types.WebRtcTransportOptions = {
  listenIps: [
    {
      ip: '0.0.0.0',
      announcedIp,
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 800000,
};

let worker: types.Worker;

export async function initMediasoupWorker(): Promise<types.Worker> {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: ['ice', 'dtls', 'rtp', 'rtcp'],
    rtcMinPort: config.mediasoupMinPort,
    rtcMaxPort: config.mediasoupMaxPort,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting process (pid:%d)', worker.pid);
    process.exit(1);
  });

  console.log('mediasoup worker created [pid:%d]', worker.pid);

  return worker;
}

export async function createRoomRouter(): Promise<types.Router> {
  const router = await worker.createRouter({ mediaCodecs });
  console.log('mediasoup router created [id:%s]', router.id);
  return router;
}
