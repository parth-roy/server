import { Redis } from 'ioredis';
import { env } from './env';

let redisClient: Redis;

// Detect if Upstash (rediss:// = SSL required)
const isUpstash = env.REDIS_URL.startsWith('rediss://');

const baseOptions = {
  maxRetriesPerRequest: null,  // REQUIRED for BullMQ — do not remove
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isUpstash && { tls: {} }),  // Upstash requires TLS
};

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, baseOptions);

    redisClient.on('connect', () => console.log('✅ Redis (Upstash) connected'));
    redisClient.on('error', (err) => console.error('Redis error:', err.message));
    redisClient.on('reconnecting', () => console.warn('Redis reconnecting...'));
  }
  return redisClient;
}

// Separate pub/sub clients (required by Socket.io Redis adapter)
export function createRedisClient(): Redis {
  return new Redis(env.REDIS_URL, baseOptions);
}