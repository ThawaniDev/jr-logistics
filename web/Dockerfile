# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# lockfile is produced by npm 11; match it so `npm ci` is reproducible
RUN npm i -g npm@11 && npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# `COPY --chown` instead of a later `RUN chown -R /app`: the recursive chown rewrote every file into a second 1 GB layer (image 3.15 GB -> about half).
RUN addgroup -S jr && adduser -S jr -G jr && mkdir -p /app /data/uploads && chown jr:jr /app /data/uploads
COPY --from=build --chown=jr:jr /app ./
USER jr
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
