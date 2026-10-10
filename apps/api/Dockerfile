FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.0.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends calibre poppler-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY eng.traineddata spa.traineddata ./tessdata/
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 FOLIO_DATA_DIR=/data TESSDATA_PREFIX=/app/tessdata
USER node
EXPOSE 3001
CMD ["node", "dist/api/start.js"]

FROM scratch AS web
COPY --from=build /app/apps/web/dist /
