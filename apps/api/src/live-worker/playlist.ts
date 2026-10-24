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
