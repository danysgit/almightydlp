FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ARG YTDLP_MIN_VERSION=2026.02.21

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip tini ca-certificates gosu \
  && python3 -m pip install --upgrade --no-cache-dir --break-system-packages "yt-dlp>=${YTDLP_MIN_VERSION}" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /config /config/cookies /config/tmp \
  && chown -R node:node /config \
  && chmod +x /app/docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
