# ── Build stage ─────────────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── Production stage ───────────────────────────────────────────────────
FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/platfone-com/mcp"
LABEL org.opencontainers.image.description="Platfone MCP server for SMS Activation"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist/ dist/

# Default: stdio transport. Override CMD for HTTP:
#   docker run -p 3000:3000 -e PLATFONE_API_KEY=… <image> node dist/index.js --transport=http

USER node

CMD ["node", "dist/index.js"]
