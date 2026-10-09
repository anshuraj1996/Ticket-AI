import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // Set before any module loads, and dotenv never overrides existing vars,
    // so a local .env can't make unit tests talk to real Kafka/Redis/Gemini.
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret",
      GEMINI_API_KEY: "test-key",
      KAFKA_BROKERS: "",
      REDIS_URL: "",
    },
  },
});
