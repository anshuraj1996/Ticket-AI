import { randomUUID } from "crypto";
import { Partitioners } from "kafkajs";
import { kafka, isKafkaEnabled, ensureTopic, TICKET_EVENTS_TOPIC } from "./client.js";

let producer = null;
let connecting = null;

const getProducer = async () => {
  if (producer) return producer;
  if (!connecting) {
    connecting = (async () => {
      await ensureTopic();
      // Consumer dedupes by eventId, so plain at-least-once delivery is enough here
      const p = kafka.producer({
        allowAutoTopicCreation: false,
        createPartitioner: Partitioners.DefaultPartitioner,
      });
      await p.connect();
      producer = p;
      console.log(`Kafka producer connected (topic: ${TICKET_EVENTS_TOPIC})`);
      return p;
    })().catch((err) => {
      connecting = null; // allow a retry on the next publish
      throw err;
    });
  }
  return connecting;
};

/**
 * Publish a ticket lifecycle event. Never throws: Kafka being down must not
 * break the API request or the Inngest workflow that triggered it.
 * Messages are keyed by ticketId so all events of one ticket stay in order
 * (same partition).
 */
export const publishTicketEvent = async (type, ticket, extra = {}) => {
  if (!isKafkaEnabled || !ticket) return;

  const ticketId = (ticket._id || ticket.id).toString();
  const event = {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    ticketId,
    data: {
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      relatedSkills: ticket.relatedSkills,
      assignedTo: ticket.assignedTo?._id?.toString() || ticket.assignedTo?.toString() || null,
      createdBy: ticket.createdBy?.toString() || null,
      ...extra,
    },
  };

  try {
    const p = await getProducer();
    await p.send({
      topic: TICKET_EVENTS_TOPIC,
      messages: [{ key: ticketId, value: JSON.stringify(event), headers: { type } }],
    });
  } catch (error) {
    console.error(`Kafka publish failed (${type}):`, error.message);
  }
};

export const disconnectProducer = async () => {
  if (producer) {
    await producer.disconnect();
    producer = null;
    connecting = null;
  }
};
