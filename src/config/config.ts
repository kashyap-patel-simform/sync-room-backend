import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
  mediasoupAnnouncedIp: string;
  mediasoupMinPort: number;
  mediasoupMaxPort: number;
}

const config: Config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mediasoupAnnouncedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '',
  mediasoupMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
  mediasoupMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 49999,
};

export default config;
