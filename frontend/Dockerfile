# =============================================================================
# frontend/Dockerfile
# Stage 1 – builder: npm install + vite build
# Stage 2 – runner:  nginx:alpine, non-root, port 8080
# =============================================================================

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# VITE_API_URL must be a path the browser can reach.
# nginx proxies /api/* → backend:3001 at runtime.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build


# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Remove default nginx site
RUN rm /etc/nginx/conf.d/default.conf

# Our hardened config (listen 8080 is set inside nginx.conf directly)
COPY nginx.conf /etc/nginx/conf.d/app.conf

# SPA static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Give nginx user ownership of all paths it needs to write
RUN chown -R nginx:nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx \
    && chown -R nginx:nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
