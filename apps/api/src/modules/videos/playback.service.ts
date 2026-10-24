import { Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { StorageService } from '../../storage/storage.service';
import { ResourceNotFoundError } from '../auth/errors';

/** How long a playback grant lasts. VOD playlists aren't reloaded, so it must cover a full sitting. */
const PLAYBACK_TTL_SECONDS = Number(process.env.PLAYBACK_TTL_SECONDS) || 6 * 60 * 60;

/** Files a playback token may read under `videos/<id>/`: the master and rendition playlists. */
const PLAYLIST_PATH = /^(master\.m3u8|(\d{3,4})p\/index\.m3u8)$/;

export type PlaybackGrant = {
  url: string;
  kind: 'hls' | 'progressive';
  expires_at: string;
};

/**
 * Turns an access decision into a playable URL.
 *
 * The video bucket is private. A presigned master playlist alone doesn't play: hls.js
 * resolves `240p/index.m3u8` and `seg000.ts` relative to it, and those requests carry no
 * signature. So every file under `videos/<id>/` must be authorised:
 *
 * - **BunnyCDN** (BUNNYCDN_PULLZONE + BUNNYCDN_SIGNING_KEY): one directory token for
 *   `/videos/<id>/`, embedded in the URL path so relative URIs inherit it.
 * - **Otherwise** (dev / MinIO): playlists are served by the API under
 *   `/playback/<id>/<token>/…` (token in the path, same trick), and segment lines are
 *   rewritten to presigned storage URLs, so the API never proxies video bytes.
 */
@Injectable()
export class PlaybackService {
  private readonly secret: string;
  private readonly bunnyHost: string | null;
  private readonly bunnyKey: string | null;

  constructor(private readonly storage: StorageService) {
    const secret = process.env.PLAYBACK_SIGNING_SECRET ?? process.env.JWT_ACCESS_SECRET ?? '';
    if (process.env.NODE_ENV === 'production' && secret.length < 16) {
      throw new Error('PLAYBACK_SIGNING_SECRET (or JWT_ACCESS_SECRET) must be set in production');
    }
    this.secret = secret;
    const zone = process.env.BUNNYCDN_PULLZONE?.trim();
    this.bunnyHost = zone ? zone.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
    this.bunnyKey = process.env.BUNNYCDN_SIGNING_KEY?.trim() || null;
  }

  /** Grant playback of a video whose access has already been checked by AccessService. */
  async grant(videoId: string, playlistKey: string, apiBase: string): Promise<PlaybackGrant> {
    const expires = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_SECONDS;
    const expiresAt = new Date(expires * 1000).toISOString();

    // Seed/test data may store a full URL; pass it through.
    if (/^https?:\/\//i.test(playlistKey)) {
      return { url: playlistKey, kind: kindOf(playlistKey), expires_at: expiresAt };
    }

    // Transcoding disabled (MVP mode): a single progressive MP4, which supports range requests.
    if (kindOf(playlistKey) === 'progressive') {
      const url = this.bunnyConfigured()
        ? this.bunnyFileUrl(`/${playlistKey}`, expires)
        : await this.storage.getPresignedGetUrl(
            this.storage.videoBucketName,
            playlistKey,
            PLAYBACK_TTL_SECONDS,
          );
      return { url, kind: 'progressive', expires_at: expiresAt };
    }

    if (this.bunnyConfigured()) {
      return {
        url: this.bunnyDirectoryUrl(`/videos/${videoId}/`, `/${playlistKey}`, expires),
        kind: 'hls',
        expires_at: expiresAt,
      };
    }

    const token = this.sign(videoId, expires);
    const base = apiBase.replace(/\/+$/, '');
    return {
      url: `${base}/playback/${videoId}/${token}/master.m3u8`,
      kind: 'hls',
      expires_at: expiresAt,
    };
  }

  /** Serve a playlist for the API-delivered (non-CDN) path. */
  async playlist(videoId: string, token: string, path: string): Promise<string> {
    const expires = this.verify(videoId, token);
    const match = PLAYLIST_PATH.exec(path);
    if (!match) throw new ResourceNotFoundError('Playlist');

    const key = `videos/${videoId}/${path}`;
    let body: string;
    try {
      body = (await this.storage.download(this.storage.videoBucketName, key)).toString('utf8');
    } catch {
      throw new ResourceNotFoundError('Playlist');
    }

    // Master: rendition URIs are relative and resolve back here with the token. Done.
    if (path === 'master.m3u8') return body;

    // Rendition: point each segment at a presigned URL valid until the grant expires.
    const ttl = Math.max(60, expires - Math.floor(Date.now() / 1000));
    const dir = `videos/${videoId}/${match[2]}p/`;
    const lines = await Promise.all(
      body.split('\n').map(async (line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        if (!/^[\w.-]+$/.test(trimmed)) return line; // only bare segment filenames
        return this.storage.getPresignedGetUrl(this.storage.videoBucketName, dir + trimmed, ttl);
      }),
    );
    return lines.join('\n');
  }

  /** Presign a caption file for as long as a playback grant lasts. */
  captionUrl(key: string): Promise<string> {
    if (this.bunnyConfigured()) {
      const expires = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_SECONDS;
      return Promise.resolve(this.bunnyFileUrl(`/${key}`, expires));
    }
    return this.storage.getPresignedGetUrl(this.storage.videoBucketName, key, PLAYBACK_TTL_SECONDS);
  }

  // ─── API-delivered tokens ──────────────────────────────────────────────────

  sign(videoId: string, expires: number): string {
    const mac = createHmac('sha256', this.secret)
      .update(`${videoId}.${expires}`)
      .digest('base64url');
    return `${expires}.${mac}`;
  }

  /** Returns the token's expiry (unix seconds) or throws. */
  verify(videoId: string, token: string): number {
    const [expStr, mac] = token.split('.');
    const expires = Number(expStr);
    if (!mac || !Number.isInteger(expires) || expires < Date.now() / 1000) {
      throw new ResourceNotFoundError('Playlist');
    }
    const expected = this.sign(videoId, expires).split('.')[1]!;
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new ResourceNotFoundError('Playlist');
    return expires;
  }

  // ─── BunnyCDN token authentication ─────────────────────────────────────────
  //
  // Per Bunny's "advanced token authentication": token = base64url(sha256(key + signedPath +
  // expires + sortedParams)) with padding stripped. A directory token signs `token_path`
  // and is placed in the URL path, so every file below it is authorised.

  private bunnyConfigured(): boolean {
    return this.bunnyHost !== null && this.bunnyKey !== null;
  }

  private bunnyFileUrl(filePath: string, expires: number): string {
    const token = this.bunnyToken(filePath, expires, '');
    return `https://${this.bunnyHost}${encodePath(filePath)}?token=${token}&expires=${expires}`;
  }

  private bunnyDirectoryUrl(dir: string, filePath: string, expires: number): string {
    const params = `token_path=${dir}`;
    const token = this.bunnyToken(dir, expires, params);
    return (
      `https://${this.bunnyHost}/bcdn_token=${token}` +
      `&expires=${expires}&token_path=${encodeURIComponent(dir)}${encodePath(filePath)}`
    );
  }

  private bunnyToken(signedPath: string, expires: number, params: string): string {
    return createHash('sha256')
      .update(`${this.bunnyKey}${signedPath}${expires}${params}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

function kindOf(keyOrUrl: string): 'hls' | 'progressive' {
  return /\.(mp4|webm|mov)(\?|$)/i.test(keyOrUrl) ? 'progressive' : 'hls';
}

function encodePath(p: string): string {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}
