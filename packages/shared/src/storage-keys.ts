export const originalKey = (videoId: string): string => `videos/${videoId}/original.mp4`;
export const masterPlaylistKey = (videoId: string): string => `videos/${videoId}/master.m3u8`;
export const renditionPlaylistKey = (videoId: string, height: number): string =>
  `videos/${videoId}/${height}p/index.m3u8`;
export const renditionSegmentKey = (videoId: string, height: number, idx: number): string =>
  `videos/${videoId}/${height}p/seg${idx}.ts`;
export const thumbnailKey = (videoId: string): string => `thumbs/${videoId}.jpg`;
