# ---------- Stage 1: install production dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Copy only manifests first so this layer is cached until dependencies change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Test image (only built with --target test, e.g. by Jenkins) ----------
# Has dev dependencies (vitest). Run: docker run <image>  -> writes reports/junit.xml
FROM node:22-bookworm-slim AS test
ENV NODE_ENV=test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "test:ci"]

# ---------- Stage 2: runtime image ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Run as the unprivileged user that ships with the node image
USER node

EXPOSE 3000

# "/" returns "Hello World" (index.js), used as a liveness check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
