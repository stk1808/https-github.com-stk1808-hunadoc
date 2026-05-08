# ---------- Build stage ----------
FROM node:20-bookworm-slim AS build

# Build deps for better-sqlite3 (native module)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including dev) so we can run the build script
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build client + server bundle
COPY . .
RUN npm run build

# Drop dev deps for the runtime stage
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:20-bookworm-slim AS runtime

# Tini is a minimal init that handles signals correctly in containers
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
# Render's persistent disk will be mounted here (see render.yaml)
ENV DATA_DIR=/var/data

# Copy production node_modules + built artifacts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Make sure the data dir exists even if no disk is attached
RUN mkdir -p /var/data

EXPOSE 5000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.cjs"]
