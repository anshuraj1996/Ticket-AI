import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRes } from "./helpers.js";

const { getRedis } = vi.hoisted(() => ({ getRedis: vi.fn() }));
vi.mock("../utils/redis.js", () => ({ getRedis }));

const { rateLimit } = await import("../middlewares/rateLimit.js");

// In-memory stand-in for the Redis commands the limiter uses
const fakeRedis = () => {
  const counts = new Map();
  return {
    counts,
    multi() {
      let key;
      const chain = {
        incr(k) {
          key = k;
          return chain;
        },
        expire: vi.fn(() => chain),
        exec: async () => {
          const value = (counts.get(key) || 0) + 1;
          counts.set(key, value);
          return [value, 1];
        },
      };
      return chain;
    },
    ttl: vi.fn(async () => 42),
  };
};

const limiter = rateLimit({ keyPrefix: "test", windowSeconds: 60, max: 2 });
const call = async (ip = "10.0.0.1") => {
  const res = mockRes();
  const next = vi.fn();
  await limiter({ ip }, res, next);
  return { res, next };
};

describe("rateLimit middleware", () => {
  beforeEach(() => getRedis.mockReset());

  it("allows requests up to the limit and sets RateLimit headers", async () => {
    getRedis.mockReturnValue(fakeRedis());

    const first = await call();
    const second = await call();

    expect(first.next).toHaveBeenCalledOnce();
    expect(second.next).toHaveBeenCalledOnce();
    expect(first.res.headers["RateLimit-Limit"]).toBe(2);
    expect(first.res.headers["RateLimit-Remaining"]).toBe(1);
    expect(second.res.headers["RateLimit-Remaining"]).toBe(0);
  });

  it("blocks with 429 and Retry-After once the limit is exceeded", async () => {
    getRedis.mockReturnValue(fakeRedis());

    await call();
    await call();
    const third = await call();

    expect(third.next).not.toHaveBeenCalled();
    expect(third.res.statusCode).toBe(429);
    expect(third.res.headers["Retry-After"]).toBe(42);
  });

  it("counts each client IP separately", async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    await call("10.0.0.1");
    await call("10.0.0.1");
    const otherIp = await call("10.0.0.2");

    expect(otherIp.next).toHaveBeenCalledOnce();
    expect(redis.counts.get("rl:test:10.0.0.1")).toBe(2);
    expect(redis.counts.get("rl:test:10.0.0.2")).toBe(1);
  });

  it("fails open when Redis is not available", async () => {
    getRedis.mockReturnValue(null);
    const { res, next } = await call();
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails open when a Redis command throws", async () => {
    const redis = fakeRedis();
    redis.multi = () => ({
      incr() {
        return this;
      },
      expire() {
        return this;
      },
      exec: async () => {
        throw new Error("connection reset");
      },
    });
    getRedis.mockReturnValue(redis);

    const { next } = await call();
    expect(next).toHaveBeenCalledOnce();
  });
});
