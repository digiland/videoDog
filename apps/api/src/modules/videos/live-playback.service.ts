import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { DomainError } from '@streamzw/shared';

/** Grants last at least this long; the player refetches one when it expires. */
const LIVE_GRANT_SECONDS = 3 * 60 * 60;
/** Expiries round up to the hour so every viewer of a stream shares one URL per hour: the
 * CDN caches segments instead of fetching them again per viewer. */
const BUCKET_SECONDS = 60 * 60;

export class ReplayProcessingError extends DomainError {
  constructor() {
    super('REPLAY_PROCESSING', 'The replay of this live stream is still being prepared', 409);
  }
}

export interface LiveGrant {
  url: string;
  kind: 'hls';
  live: true;
  expires_at: string;
}

/**
 * Signed URLs for the live HLS origin (infra/live/nginx.conf). The token sits in the path —
 * `/hls/<md5>/<expires>/<streamId>/master.m3u8` — so the relative rendition and segment
 * URIs inside the playlists inherit it, and nginx's secure_link checks every request with
 * `secure_link_md5 "$expires$stream $secret"`. Access is decided before this is called.
 */
@Injectable()
export class LivePlaybackService {
  private readonly base = (process.env.LIVE_PUBLIC_BASE ?? 'http://localhost:8088').replace(
    /\/+$/,
    '',
  );
  private readonly secret: string;

  constructor() {
    const secret = process.env.LIVE_SIGNING_SECRET ?? '';
    if (process.env.NODE_ENV === 'production' && secret.length < 16) {
      throw new Error('LIVE_SIGNING_SECRET must be set (16+ chars) in production');
    }
    this.secret = secret || 'dev-live-signing-secret';
  }

  grant(streamId: string, now = Date.now()): LiveGrant {
    const expires =
      Math.ceil((Math.floor(now / 1000) + LIVE_GRANT_SECONDS) / BUCKET_SECONDS) * BUCKET_SECONDS;
    const token = this.token(streamId, expires);
    return {
      url: `${this.base}/hls/${token}/${expires}/${streamId}/master.m3u8`,
      kind: 'hls',
      live: true,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  }

  /** nginx secure_link_md5 format: base64url(md5(...)) without padding. */
  token(streamId: string, expires: number): string {
    return createHash('md5').update(`${expires}${streamId} ${this.secret}`).digest('base64url');
  }
}
