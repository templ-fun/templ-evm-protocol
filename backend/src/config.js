import { MemoryStore } from 'express-rate-limit';
import { logger } from './logger.js';

/**
 * Create a rate limit store based on environment configuration.
 * Defaults to `MemoryStore` but supports distributed stores when
 * `RATE_LIMIT_STORE` is set.
 *
 * When `RATE_LIMIT_STORE=redis`, this function attempts to use the
 * `rate-limit-redis` store. It requires the optional `redis` and
 * `rate-limit-redis` packages and a `REDIS_URL` environment variable.
 * If initialization fails, the memory store is returned.
 */
export async function createRateLimitStore() {
  const envKind = process.env.RATE_LIMIT_STORE; // 'memory' | 'redis' | undefined
  // Auto-detect: prefer Redis when REDIS_URL is present, else fallback to envKind/memory
  const shouldUseRedis =
    envKind === 'redis' || (!envKind && typeof process.env.REDIS_URL === 'string' && process.env.REDIS_URL.length > 0);

  if (shouldUseRedis) {
    try {
      const redisStoreModuleId = 'rate-limit-redis';
      const redisClientModuleId = 'redis';
      const [storeModule, redisModule] = await Promise.all([
        import(redisStoreModuleId).catch(() => null),
        import(redisClientModuleId).catch(() => null)
      ]);
      if (!storeModule || !redisModule) {
        throw new Error('redis modules unavailable');
      }
      const { default: RedisStore } = storeModule;
      const { createClient } = redisModule;
      const client = createClient({ url: process.env.REDIS_URL });
      await client.connect();
      const store = new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });
      // Annotate for tests/diagnostics
      // @ts-ignore
      store.kind = 'redis';
      store.shutdown = () => client.quit();
      return store;
    } catch (e) {
      logger?.warn?.({ err: String(e?.message || e) }, 'redis rate-limit store unavailable; falling back to memory');
      const store = new MemoryStore();
      // @ts-ignore
      store.kind = 'memory';
      return store;
    }
  }

  const store = new MemoryStore();
  // @ts-ignore
  store.kind = 'memory';
  if (process.env.NODE_ENV === 'production') {
    logger?.warn?.('Using in-memory rate limit store in production; set REDIS_URL or RATE_LIMIT_STORE=redis');
  }
  return store;
}
