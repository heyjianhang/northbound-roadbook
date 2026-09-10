FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
COPY agent/requirements.txt ./agent/requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN python3 -m venv /app/.venv && /app/.venv/bin/pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r agent/requirements.txt
COPY --from=build --chown=node:node /app/dist/client ./dist/client
COPY --from=build --chown=node:node /app/scripts/serve.mjs /app/scripts/amap-proxy.mjs /app/scripts/accounts.mjs /app/scripts/accounts-store.mjs ./scripts/
COPY --from=build --chown=node:node /app/scripts/agent.mjs /app/scripts/agent-store.mjs /app/scripts/agent-worker.mjs /app/scripts/speech.mjs ./scripts/
COPY --from=build --chown=node:node /app/scripts/mcp-config.mjs /app/scripts/mcp-gateway.mjs ./scripts/
COPY --from=build --chown=node:node /app/agent ./agent
COPY --from=build --chown=node:node /app/data/roadbook.json ./data/roadbook.json
COPY --from=build --chown=node:node /app/data/mcp-presets.json ./data/mcp-presets.json
RUN mkdir -p /app/.runtime && chown node:node /app/.runtime
VOLUME ["/app/.runtime"]
USER node
EXPOSE 4173
CMD ["node", "scripts/serve.mjs"]
