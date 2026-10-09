import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import userRoutes from './routes/users.js';
import ticketRoutes from './routes/tickets.js';
import { inngest } from "./inngest/client.js";
import { onSignup } from "./inngest/functions/on-signup.js";
import { onTicketCreated } from "./inngest/functions/on-ticket-create.js";
import { serve } from "inngest/express";
import { disconnectProducer } from "./kafka/producer.js";
import { getRedis, disconnectRedis } from "./utils/redis.js";


dotenv.config();
const PORT = process.env.PORT || 3000;

const app = express();
// Behind nginx / a Kubernetes Service: take the client IP from X-Forwarded-For
// (otherwise the rate limiter would see every user as the proxy's IP)
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", userRoutes)
app.use("/api/tickets", ticketRoutes)

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [onSignup, onTicketCreated],
  })
);

mongoose.connect(process.env.MONGO_URI)
.then(() => {
  console.log("MongoDB connected");
})
.catch(err => {
  console.error("MongoDB connection error: ", err);
});

app.get('/', (req, res) => {
  res.send('Hello World');
});

// Readiness: only accept traffic once MongoDB is connected (used by Kubernetes)
app.get('/readyz', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ mongo: ready ? "connected" : "disconnected" });
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  getRedis(); // start connecting now instead of on the first request
});

// Graceful shutdown (docker stop / Kubernetes sends SIGTERM)
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectProducer().catch(() => {});
    await disconnectRedis().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
