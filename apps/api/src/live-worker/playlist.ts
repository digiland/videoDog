/**
 * Turn a live event playlist into a VOD one for the replay: playlist type VOD and an
 * ENDLIST tag, so players show a seek bar from 0:00 and stop at the end.
 */
export function finalizePlaylist(text: string): string {
  let out = text.replace(/#EXT-X-PLAYLIST-TYPE:EVENT/g, '#EXT-X-PLAYLIST-TYPE:VOD');
  if (!/#EXT-X-PLAYLIST-TYPE:/.test(out)) {
    out = out.replace('#EXTM3U', '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD');
  }
  // The replay plays from storage via the API's playlist rewriter, which signs bare segment
  // names; wall-clock tags are noise there.
  out = out
    .split('\n')
    .filter((l) => !l.startsWith('#EXT-X-PROGRAM-DATE-TIME'))
    .join('\n')
    .trimEnd();
  if (!out.includes('#EXT-X-ENDLIST')) out += '\n#EXT-X-ENDLIST';
  return `${out}\n`;
}

/** Total running time of a media playlist, from its EXTINF durations, in whole seconds. */
export function playlistDuration(text: string): number {
  let total = 0;
  for (const m of text.matchAll(/^#EXTINF:([\d.]+)/gm)) total += Number(m[1]);
  return Math.round(total);
}

/** Bare segment file names in a media playlist. */
export function segmentNames(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * ffmpeg can't know the bitrate of a copied (passthrough) rendition, so the master playlist
 * advertises it at the audio bitrate alone — and players would pick 4K as the *cheapest*
 * option. Rewrite each variant's BANDWIDTH to at least the ladder's budget for its height.
 */
export function fixMasterBandwidth(
  master: string,
  ladder: readonly { height: number; videoKbps: number; audioKbps: number }[],
): string {
  const lines = master.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const inf = lines[i]!;
    if (!inf.startsWith('#EXT-X-STREAM-INF:')) continue;
    const m = /^(\d{3,4})p\//.exec(lines[i + 1]!.trim());
    const rung = m ? ladder.find((r) => r.height === Number(m[1])) : undefined;
    if (!rung) continue;
    // Peak budget: maxrate is 1.1× the target bitrate in the encoded renditions.
    const budget = Math.round((rung.videoKbps * 1.1 + rung.audioKbps) * 1000);
    lines[i] = inf.replace(
      /BANDWIDTH=(\d+)/,
      (_, bw: string) => `BANDWIDTH=${Math.max(Number(bw), budget)}`,
    );
  }
  return lines.join('\n');
}
