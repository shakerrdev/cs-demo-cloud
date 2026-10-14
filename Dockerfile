# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.28.0
WORKDIR /app

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/map-export/package.json apps/map-export/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/replay/package.json packages/replay/
COPY packages/shared/package.json packages/shared/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @cs-demo-cloud/web build

FROM manifests AS runtime-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bzip2 \
	&& rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
	DATA_DIR=/data \
	DATABASE_PATH=/db/app.db \
	PORT=3000 \
	BODY_SIZE_LIMIT=Infinity
WORKDIR /app
COPY --from=runtime-deps /app ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY --from=build /app/apps/web/build ./apps/web/build
COPY apps/web/server.js ./apps/web/
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /data /db && chown node:node /data /db
VOLUME ["/data", "/db"]
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "node packages/db/src/migrate.ts && exec node apps/web/server.js"]
