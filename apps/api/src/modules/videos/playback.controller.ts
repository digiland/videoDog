import { Controller, Get, Header, Param } from '@nestjs/common';
import { PlaybackService } from './playback.service';

/**
 * Token-gated HLS playlists for deployments without BunnyCDN. Public on purpose: hls.js
 * can't send an Authorization header, so the short-lived token in the path is the
 * credential (issued by GET /videos/:id/playlist after AccessService.checkAccess).
 */
@Controller('playback')
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Get(':videoId/:token/master.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'private, no-store')
  master(@Param('videoId') videoId: string, @Param('token') token: string) {
    return this.playback.playlist(videoId, token, 'master.m3u8');
  }

  @Get(':videoId/:token/:rendition/index.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'private, no-store')
  rendition(
    @Param('videoId') videoId: string,
    @Param('token') token: string,
    @Param('rendition') rendition: string,
  ) {
    return this.playback.playlist(videoId, token, `${rendition}/index.m3u8`);
  }
}
