import { describe, it, expect } from "vitest";

// vitest.config.js sets KAFKA_BROKERS and REDIS_URL to "": the app must keep
// working when these optional services are not configured.

describe("Kafka producer without KAFKA_BROKERS", () => {
  it("is disabled and publishing is a silent no-op", async () => {
    const { isKafkaEnabled } = await import("../kafka/client.js");
    const { publishTicketEvent } = await import("../kafka/producer.js");

    expect(isKafkaEnabled).toBe(false);
    await expect(publishTicketEvent("ticket.created", { _id: "t1", title: "x" })).resolves.toBeUndefined();
  });
});

describe("Redis without REDIS_URL", () => {
  it("is disabled and cache helpers fall back without errors", async () => {
    const { isRedisEnabled, getRedis } = await import("../utils/redis.js");
    const { cacheGetJSON, cacheSetJSON, cacheDel } = await import("../utils/cache.js");

    expect(isRedisEnabled).toBe(false);
    expect(getRedis()).toBeNull();
    await expect(cacheGetJSON("user:1")).resolves.toBeNull();
    await expect(cacheSetJSON("user:1", { a: 1 }, 60)).resolves.toBeUndefined();
    await expect(cacheDel("user:1")).resolves.toBeUndefined();
  });
});
