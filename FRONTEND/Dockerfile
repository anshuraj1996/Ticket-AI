# ---------- Stage 1: build the static bundle ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at build time.
# Default "/api" = same origin; nginx below proxies it to the backend.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ---------- Stage 2: serve with nginx (non-root, uid 101, port 8080) ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Where nginx forwards /api requests. Overridable at runtime
# (docker-compose service name now, Kubernetes Service name later).
ENV BACKEND_URL=http://backend:3000

# The nginx image runs envsubst on /etc/nginx/templates/*.template at startup
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Unprivileged users can't bind ports below 1024
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
