import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ connection options from a `redis://[user:pass@]host:port[/db]` URL.
 *
 * ioredis has no `url` option, so passing `{ url }` silently connects to localhost:6379.
 * `maxRetriesPerRequest: null` is required by BullMQ workers.
 */
export function bullmqConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isInteger(db) ? db : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
