# Kup / Nekup server – container image for Fly.io, Railway, Render or any Docker host.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY data/additives.json data/unwanted.json data/allergens.json ./data/
# health effects shown when an ingredient is tapped (static texts, no AI cost)
COPY data/health ./data/health

# cache lives on a mounted volume so it survives restarts
ENV DB_PATH=/data/cache.sqlite
ENV PORT=8080
EXPOSE 8080

# node runs directly (no npx wrapper) so it receives SIGINT/SIGTERM and shuts down cleanly
CMD ["node", "--import", "tsx", "src/index.ts"]
