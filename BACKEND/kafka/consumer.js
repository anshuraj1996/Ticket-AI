// Standalone Kafka consumer: `node kafka/consumer.js`
// Reads ticket events and stores them as an audit log in MongoDB.
import "dotenv/config";
import mongoose from "mongoose";
import { kafka, isKafkaEnabled, ensureTopic, TICKET_EVENTS_TOPIC } from "./client.js";
import TicketEvent from "../models/ticketEvent.model.js";

if (!isKafkaEnabled) {
  console.error("KAFKA_BROKERS is not set, consumer cannot start");
  process.exit(1);
}

const consumer = kafka.consumer({
  groupId: process.env.KAFKA_CONSUMER_GROUP || "ticket-audit",
});

const handleMessage = async ({ topic, partition, message }) => {
  let event;
  try {
    event = JSON.parse(message.value.toString());
  } catch {
    console.warn(`Skipping malformed message at ${topic}[${partition}]@${message.offset}`);
    return;
  }

  try {
    await TicketEvent.create({
      eventId: event.eventId,
      type: event.type,
      ticketId: event.ticketId,
      occurredAt: event.occurredAt,
      data: event.data,
      kafka: { topic, partition, offset: message.offset },
    });
    console.log(`Audit: ${event.type} ticket=${event.ticketId}`);
  } catch (error) {
    // Duplicate eventId = already processed (at-least-once delivery), safe to skip
    if (error.code === 11000) return;
    throw error; // other errors: let kafkajs retry this message
  }
};

const start = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Consumer: MongoDB connected");

  await ensureTopic();
  await consumer.connect();
  await consumer.subscribe({ topic: TICKET_EVENTS_TOPIC, fromBeginning: true });
  await consumer.run({ eachMessage: handleMessage });
  console.log(`Consumer: listening on ${TICKET_EVENTS_TOPIC}`);
};

const shutdown = async (signal) => {
  console.log(`Consumer: ${signal} received, shutting down`);
  try {
    await consumer.disconnect();
    await mongoose.disconnect();
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((error) => {
  console.error("Consumer failed to start:", error);
  process.exit(1);
});
