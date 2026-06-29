# nginx — minimal official image
# Using the official nginx:alpine image (only ~25MB compressed)
# We only need to copy our custom nginx.conf over the default one
FROM nginx:1.25-alpine

# Remove the default nginx config
RUN rm /etc/nginx/nginx.conf

# Copy our custom config
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
