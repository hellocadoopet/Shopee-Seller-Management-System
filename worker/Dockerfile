# WhatsApp worker image (Railway, or any container host). Build from the REPO ROOT — the worker
# imports ../lib and ../adapters:   docker build -f worker/Dockerfile .
FROM node:22-slim

# git: Baileys pulls libsignal straight from GitHub.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root deps first (hono, @hono/node-server, supabase-js, tsx), then the worker's own (Baileys) —
# separate layers so a code change doesn't reinstall everything.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY worker/package.json worker/package-lock.json worker/
RUN cd worker && npm ci --no-audit --no-fund

COPY lib lib
COPY adapters adapters
COPY worker worker

ENV NODE_ENV=production
WORKDIR /app/worker
# node (not npm) as PID 1, so SIGTERM on redeploy reaches the graceful shutdown in index.ts.
CMD ["node", "--import", "tsx", "index.ts"]
