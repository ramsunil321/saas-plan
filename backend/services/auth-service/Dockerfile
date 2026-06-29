# =============================================================================
# DOCKERFILE — Auth Service (Multi-stage build)
# =============================================================================
#
# WHY MULTI-STAGE BUILD?
#   A single-stage Dockerfile would include ALL development dependencies
#   (TypeScript, ts-node, jest, etc.) in the final image.
#   Result: image size ~800MB vs ~150MB with multi-stage.
#
#   Stage 1 (builder): Install ALL deps + compile TypeScript → JavaScript
#   Stage 2 (production): Copy only compiled JS + production deps
#   The builder stage is discarded — it never makes it into the final image.
#
# INTERVIEW QUESTION:
#   "What is a Docker multi-stage build?"
#   Answer: Multiple FROM statements in one Dockerfile. Each stage can copy
#   artifacts from previous stages. Final image only contains what you
#   explicitly copy in. Reduces attack surface and image size significantly.
#   Also speeds up deploys (smaller images pull faster).
#
# BEST PRACTICES USED:
#   - Official node:alpine base (smaller than node:slim)
#   - Non-root user (security — don't run as root in containers)
#   - .dockerignore prevents sending node_modules to build context
#   - Layer ordering: copy package.json first, then source (Docker cache optimization)
#   - COPY package.json before COPY src/ → npm install is cached unless deps change
# =============================================================================

# =====================================
# STAGE 1: Builder
# =====================================
FROM node:20-alpine AS builder

# Set working directory inside the container
WORKDIR /app

# Install build dependencies (needed for some native npm packages)
# python3, make, g++ are needed for bcrypt compilation
RUN apk add --no-cache python3 make g++

# Copy dependency files first (Docker cache optimization)
# If package.json doesn't change, this layer is cached → npm install is skipped
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies — needed for TypeScript compilation)
RUN npm ci

# Generate Prisma Client (creates TypeScript types from schema.prisma)
RUN npx prisma generate

# Copy TypeScript source files
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript
# Output goes to ./dist/
RUN npm run build

# =====================================
# STAGE 2: Production
# =====================================
FROM node:20-alpine AS production

# Create a non-root user for security
# Running as root in a container is a security risk — if the container is
# compromised, the attacker has root access to the container filesystem
RUN addgroup -g 1001 -S nodejs && adduser -S flowforge -u 1001 -G nodejs

WORKDIR /app

# Copy production dependencies only (not devDependencies)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Set ownership to non-root user
RUN chown -R flowforge:nodejs /app

# Switch to non-root user
USER flowforge

# Expose the service port
# Note: EXPOSE is documentation only — Docker doesn't actually open the port
# The port is opened by docker-compose or the Docker run command
EXPOSE 3001

# Health check — Docker/Kubernetes uses this to know if the container is healthy
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the server
# Using node directly (not npm start) — avoids npm signal handling issues
# npm doesn't forward SIGTERM to the node process properly
CMD ["node", "dist/server.js"]
