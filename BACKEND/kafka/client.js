// Load .env here: ES module imports run before index.js calls dotenv.config()
import "dotenv/config";
import { Kafka, logLevel } from "kafkajs";

export const TICKET_EVENTS_TOPIC = process.env.KAFKA_TICKET_TOPIC || "ticket-events";

const brokers = (process.env.KAFKA_BROKERS || "")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);

// Kafka is optional: without KAFKA_BROKERS the app runs exactly as before
export const isKafkaEnabled = brokers.length > 0;

export const kafka = isKafkaEnabled
  ? new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || "smartticket-backend",
      brokers,
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 8 },
    })
  : null;

// Idempotent: creates the topic only if it does not exist yet
export const ensureTopic = async () => {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    if (existing.includes(TICKET_EVENTS_TOPIC)) return;

    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        {
          topic: TICKET_EVENTS_TOPIC,
          numPartitions: Number(process.env.KAFKA_TOPIC_PARTITIONS || 3),
          replicationFactor: Number(process.env.KAFKA_REPLICATION_FACTOR || 1),
        },
      ],
    });
  } finally {
    await admin.disconnect();
  }
};
