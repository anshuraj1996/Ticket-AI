import { getRedis } from "./redis.js";

// Small JSON cache on top of Redis. Every helper fails open:
// on a miss, a disabled cache or a Redis error, callers fall back to MongoDB.

export const cacheGetJSON = async (key) => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`Cache get failed (${key}):`, error.message);
    return null;
  }
};

export const cacheSetJSON = async (key, value, ttlSeconds) => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (error) {
    console.error(`Cache set failed (${key}):`, error.message);
  }
};

export const cacheDel = async (key) => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (error) {
    console.error(`Cache delete failed (${key}):`, error.message);
  }
};

export const userCacheKey = (userId) => `user:${userId}`;
