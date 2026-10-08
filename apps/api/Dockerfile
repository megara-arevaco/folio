FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends calibre poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./
RUN pnpm build
ENV HOST=0.0.0.0 PORT=3001 FOLIO_DATA_DIR=/data
EXPOSE 3001
CMD ["node", "dist/api/start.js"]
