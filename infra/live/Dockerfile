# Live server image: MediaMTX (RTMP/SRT ingest) + FFmpeg 7.1 + the live worker.
# One image for CPU and GPU boxes: the static FFmpeg includes NVENC, which works when the
# container runs with the NVIDIA runtime (docker-compose.live.yml, LIVE_ENCODER=h264_nvenc).
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @streamzw/shared build && pnpm --filter api build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG MEDIAMTX_VERSION=v1.11.3
ARG FFMPEG_BUILD=ffmpeg-n7.1-latest-linux64-gpl-7.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && curl -fsSL "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${FFMPEG_BUILD}.tar.xz" \
    | tar -xJ -C /opt \
 && ln -s /opt/${FFMPEG_BUILD}/bin/ffmpeg /usr/local/bin/ffmpeg \
 && ln -s /opt/${FFMPEG_BUILD}/bin/ffprobe /usr/local/bin/ffprobe \
 && curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin mediamtx \
 && apt-get purge -y xz-utils && rm -rf /var/lib/apt/lists/* \
 && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY infra/live/mediamtx.yml /etc/mediamtx.yml
ENV NODE_ENV=production LIVE_HLS_DIR=/var/hls
VOLUME /var/hls
# 1935 RTMP, 8890/udp SRT. RTSP (8554) stays inside the container for the transcoder.
EXPOSE 1935 8890/udp
CMD ["mediamtx", "/etc/mediamtx.yml"]
