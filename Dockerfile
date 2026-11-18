# Stage 1: build the Astro UI into web/dist.
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY shared/ /app/shared/
RUN npm run build

# Stage 2: Node runtime (TypeScript runs through Node type stripping).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=web /app/web/dist ./web/dist
EXPOSE 8080
CMD ["node", "server/src/index.ts"]
