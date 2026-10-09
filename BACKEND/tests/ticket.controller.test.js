import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRes } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  create: vi.fn(),
  inngestSend: vi.fn(),
  publishTicketEvent: vi.fn(),
}));

vi.mock("../models/ticket.model.js", () => ({
  default: { findById: mocks.findById, create: mocks.create },
}));
vi.mock("../inngest/client.js", () => ({ inngest: { send: mocks.inngestSend } }));
vi.mock("../kafka/producer.js", () => ({ publishTicketEvent: mocks.publishTicketEvent }));

const { createTicket, updateTicketStatus } = await import("../controllers/ticket.js");

const users = {
  admin: { _id: "admin1", role: "admin" },
  moderator: { _id: "mod1", role: "moderator" },
  user: { _id: "user1", role: "user" },
};

const ticketDoc = (overrides = {}) => ({
  _id: "t1",
  title: "API slow",
  status: "IN_PROGRESS",
  assignedTo: "mod1",
  save: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const statusRequest = (user, body) => ({ params: { id: "t1" }, body, user });

describe("createTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when title or description is missing", async () => {
    const res = mockRes();
    await createTicket({ body: { title: "No description" }, user: users.user }, res);

    expect(res.statusCode).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("saves the ticket, fires the Inngest event and publishes to Kafka", async () => {
    const saved = { _id: "t1", title: "API slow", description: "10s responses" };
    mocks.create.mockResolvedValue(saved);
    const res = mockRes();

    await createTicket({ body: { title: "API slow", description: "10s responses" }, user: users.user }, res);

    expect(res.statusCode).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "API slow", priority: "low", createdBy: "user1" })
    );
    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ticket/created", data: expect.objectContaining({ ticketId: "t1" }) })
    );
    expect(mocks.publishTicketEvent).toHaveBeenCalledWith("ticket.created", saved);
  });
});

describe("updateTicketStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when status is missing", async () => {
    const res = mockRes();
    await updateTicketStatus(statusRequest(users.admin, {}), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a status outside the allow-list", async () => {
    const res = mockRes();
    await updateTicketStatus(statusRequest(users.admin, { status: "DONE" }), res);
    expect(res.statusCode).toBe(400);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the ticket does not exist", async () => {
    mocks.findById.mockResolvedValue(null);
    const res = mockRes();
    await updateTicketStatus(statusRequest(users.admin, { status: "RESOLVED" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for a regular user who is not the assignee", async () => {
    const ticket = ticketDoc();
    mocks.findById.mockResolvedValue(ticket);
    const res = mockRes();

    await updateTicketStatus(statusRequest(users.user, { status: "RESOLVED" }), res);

    expect(res.statusCode).toBe(403);
    expect(ticket.save).not.toHaveBeenCalled();
  });

  it("updates status and message, then publishes ticket.status_changed", async () => {
    const ticket = ticketDoc();
    mocks.findById.mockResolvedValue(ticket);
    const res = mockRes();

    await updateTicketStatus(
      statusRequest(users.moderator, { status: "RESOLVED", moderatorMessage: "Fixed the index" }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.moderatorMessage).toBe("Fixed the index");
    expect(ticket.save).toHaveBeenCalledOnce();
    expect(mocks.publishTicketEvent).toHaveBeenCalledWith(
      "ticket.status_changed",
      ticket,
      expect.objectContaining({ previousStatus: "IN_PROGRESS", changedBy: "mod1" })
    );
  });
});
