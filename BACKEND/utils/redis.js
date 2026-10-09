// Load .env here: ES module imports run before index.js calls dotenv.config()
import "dotenv/config";
import { createClient } from "redis";

// Redis is optional: without REDIS_URL, caching and rate limiting are skipped
export const isRedisEnabled = Boolean(process.env.REDIS_URL);

let client = null;

/**
 * Returns a ready Redis client, or null if Redis is disabled or not connected.
 * Never waits for a connection, so a Redis outage can't slow down requests
 * (callers fail open). The first call starts connecting in the background.
 */
export const getRedis = () => {
  if (!isRedisEnabled) return null;

  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
      // Fail fast instead of queueing commands while disconnected
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });
    client.on("ready", () => console.log("Redis connected"));
    client.on("error", (err) => console.error("Redis error:", err.message));
    client.connect().catch(() => {}); // errors are reported by the "error" handler
  }

  return client.isReady ? client : null;
};

export const disconnectRedis = async () => {
  if (client) {
    const c = client;
    client = null;
    await c.quit().catch(() => c.disconnect());
  }
};
