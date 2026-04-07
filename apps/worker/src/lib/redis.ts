import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Conexão Redis para BullMQ. `maxRetriesPerRequest: null` é exigido pelo BullMQ.
 */
export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
