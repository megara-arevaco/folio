FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends calibre poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
