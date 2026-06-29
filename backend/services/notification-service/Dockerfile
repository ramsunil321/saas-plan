# Multi-stage Dockerfile — see auth-service/Dockerfile for full documentation.

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S flowforge -u 1001 -G nodejs
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
RUN chown -R flowforge:nodejs /app
USER flowforge
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3004/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"
CMD ["node", "dist/server.js"]
