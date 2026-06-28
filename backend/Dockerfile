# ---- build stage ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Non-root user for least-privilege execution
RUN addgroup -S lumiere && adduser -S lumiere -G lumiere

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# db/ directory is expected to be mounted at runtime as a read-only volume;
# this directory just ensures the mount point exists in the image.
RUN mkdir -p /app/db && chown -R lumiere:lumiere /app

USER lumiere

EXPOSE 3000
CMD ["node", "server.js"]
