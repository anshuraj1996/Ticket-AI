import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { mockRes } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  cacheGetJSON: vi.fn(),
  cacheSetJSON: vi.fn(),
}));

vi.mock("../models/user.model.js", () => ({ default: { findById: mocks.findById } }));
vi.mock("../utils/cache.js", () => ({
  cacheGetJSON: mocks.cacheGetJSON,
  cacheSetJSON: mocks.cacheSetJSON,
  userCacheKey: (id) => `user:${id}`,
}));

const { authenticate } = await import("../middlewares/auth.js");

const user = { _id: "u1", name: "Asha", email: "asha@example.com", role: "moderator" };
const tokenFor = (id) => jwt.sign({ id, role: "moderator" }, process.env.JWT_SECRET);

// User.findById(id).select(...).lean()
const dbReturns = (value) =>
  mocks.findById.mockReturnValue({ select: () => ({ lean: async () => value }) });

const run = async (authorization) => {
  const req = { headers: authorization ? { authorization } : {} };
  const res = mockRes();
  const next = vi.fn();
  await authenticate(req, res, next);
  return { req, res, next };
};

describe("authenticate middleware", () => {
  beforeEach(() => {
    mocks.findById.mockReset();
    mocks.cacheGetJSON.mockReset().mockResolvedValue(null);
    mocks.cacheSetJSON.mockReset().mockResolvedValue(undefined);
  });

  it("rejects requests without a token (401)", async () => {
    const { res, next } = await run();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token (403)", async () => {
    const { res, next } = await run("Bearer not-a-real-token");
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a token signed with another secret (403)", async () => {
    const forged = jwt.sign({ id: "u1" }, "attacker-secret");
    const { res } = await run(`Bearer ${forged}`);
    expect(res.statusCode).toBe(403);
  });

  it("loads the user from MongoDB on a cache miss and caches it", async () => {
    dbReturns(user);
    const { req, next } = await run(`Bearer ${tokenFor("u1")}`);

    expect(mocks.findById).toHaveBeenCalledWith("u1");
    expect(mocks.cacheSetJSON).toHaveBeenCalledWith("user:u1", user, expect.any(Number));
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses the cached user and skips MongoDB on a cache hit", async () => {
    mocks.cacheGetJSON.mockResolvedValue(user);
    const { req, next } = await run(`Bearer ${tokenFor("u1")}`);

    expect(mocks.findById).not.toHaveBeenCalled();
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when the user no longer exists", async () => {
    dbReturns(null);
    const { res, next } = await run(`Bearer ${tokenFor("deleted")}`);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.cacheSetJSON).not.toHaveBeenCalled();
  });
});
