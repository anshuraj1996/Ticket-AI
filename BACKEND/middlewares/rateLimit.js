import { getRedis } from "../utils/redis.js";

/**
 * Fixed-window rate limiter backed by Redis, shared by all backend replicas.
 * Fails open: if Redis is unavailable, requests are allowed through.
 * Only mount it on the routes that need it (never on health checks).
 */
export const rateLimit = ({ keyPrefix, windowSeconds, max }) => async (req, res, next) => {
  const redis = getRedis();
  if (!redis) return next();

  const key = `rl:${keyPrefix}:${req.ip}`;

  try {
    // INCR + EXPIRE NX in one round trip: the TTL is set only when the window starts
    const [count] = await redis
      .multi()
      .incr(key)
      .expire(key, windowSeconds, "NX")
      .exec();

    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - count));

    if (count > max) {
      const ttl = await redis.ttl(key);
      res.setHeader("Retry-After", Math.max(ttl, 1));
      return res.status(429).json({ message: "Too many requests, please try again later" });
    }

    return next();
  } catch (error) {
    console.error("Rate limiter error:", error.message);
    return next();
  }
};

// Login/signup: 10 attempts per IP per 15 minutes by default
export const authRateLimit = rateLimit({
  keyPrefix: "auth",
  windowSeconds: Number(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS || 900),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
});
