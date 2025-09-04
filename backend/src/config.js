import { MemoryStore } from 'express-rate-limit';

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
  const kind = process.env.RATE_LIMIT_STORE;
  if (kind === 'redis') {
    try {
      const [{ default: RedisStore }, { createClient }] = await Promise.all([
        import('rate-limit-redis'),
        import('redis')
      ]);
      const client = createClient({ url: process.env.REDIS_URL });
      await client.connect();
      const store = new RedisStore({
        sendCommand: (...args) => client.sendCommand(args)
      });
      store.shutdown = () => client.quit();
      return store;
    } catch {
      // Fallback to memory store when redis dependencies are unavailable
      return new MemoryStore();
    }
  }
  return new MemoryStore();
}
