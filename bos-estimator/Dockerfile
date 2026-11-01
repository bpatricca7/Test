# Production image for BOS Estimator (Railway, Render, Fly or any Docker host).
# Build context: this folder (bos-estimator/). Runtime env: PORT (set by the host), APP_PASSWORD (required for a
# public deployment), DATA_DIR (projects; mount a persistent volume there), ANTHROPIC_API_KEY (optional, AI reader).
FROM node:22-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
