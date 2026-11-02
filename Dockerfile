# DriveStream server with ffmpeg. See README → "Docker".
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# Library index, profiles, watch progress and keys live here: mount a volume.
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 HOST=0.0.0.0
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "--env-file-if-exists=.env", "server.js"]
