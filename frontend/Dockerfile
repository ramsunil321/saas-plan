# =============================================================================
# FRONTEND DOCKERFILE — Next.js 15 (standalone output, multi-stage)
# =============================================================================
#
# NEXT_PUBLIC_* vars are inlined at BUILD TIME into the JS bundle.
# They are passed as Docker ARGs so docker-compose can override them.
# Default values point to nginx on localhost:80 (the production setup).
#
# INTERVIEW QUESTION: "Why can't you set NEXT_PUBLIC_ vars at container runtime?"
# Answer: Unlike server env vars, NEXT_PUBLIC_* variables are statically inlined
# into the JavaScript bundle during `next build`. The browser downloads this JS
# directly — it can't read server environment variables. So they MUST be known
# at build time (as Docker build args), not at container start time.
# =============================================================================

# =====================================
# STAGE 1: Dependencies
# =====================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install only production + dev deps for the build
COPY package*.json ./
RUN npm ci

# =====================================
# STAGE 2: Builder
# =====================================
FROM node:20-alpine AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Accept API base URLs as build args (baked into the client bundle)
# All point to the same nginx origin — nginx routes by path prefix
ARG NEXT_PUBLIC_AUTH_API_URL=http://localhost/api/v1
ARG NEXT_PUBLIC_WORKSPACE_API_URL=http://localhost/api/v1
ARG NEXT_PUBLIC_TASK_API_URL=http://localhost/api/v1
ARG NEXT_PUBLIC_NOTIFICATION_API_URL=http://localhost/api/v1

ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
ENV NEXT_PUBLIC_WORKSPACE_API_URL=$NEXT_PUBLIC_WORKSPACE_API_URL
ENV NEXT_PUBLIC_TASK_API_URL=$NEXT_PUBLIC_TASK_API_URL
ENV NEXT_PUBLIC_NOTIFICATION_API_URL=$NEXT_PUBLIC_NOTIFICATION_API_URL

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application (output: 'standalone' is set in next.config.ts)
RUN npm run build

# =====================================
# STAGE 3: Production runner
# =====================================
FROM node:20-alpine AS production

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy only the standalone output (minimal server + traced dependencies)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets (CSS, JS chunks) served separately from the standalone server
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Public directory (favicon, images)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode < 500 ? process.exit(0) : process.exit(1))" || exit 1

# next start generates server.js in standalone mode
CMD ["node", "server.js"]
