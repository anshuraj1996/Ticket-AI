import mongoose from "mongoose";

// Audit log of ticket lifecycle events, written by the Kafka consumer
const ticketEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true }, // dedupe on redelivery
  type: { type: String, required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", index: true },
  occurredAt: Date,
  data: mongoose.Schema.Types.Mixed,
  kafka: {
    topic: String,
    partition: Number,
    offset: String,
  },
  createdAt: { type: Date, default: Date.now },
});

const TicketEvent = mongoose.model("TicketEvent", ticketEventSchema);
export default TicketEvent;
