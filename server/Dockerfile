# Dashboard API image (Railway). Build from the REPO ROOT — the API imports ../lib, ../adapters and
# ../config:   docker build -f server/Dockerfile .
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY server server
COPY lib lib
COPY adapters adapters
COPY config config

ENV NODE_ENV=production
# node (not npm) as PID 1, so SIGTERM on redeploy reaches the handler in server/index.ts.
CMD ["node", "--import", "tsx", "server/index.ts"]
