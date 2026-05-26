'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.thumbnailKey =
  exports.renditionSegmentKey =
  exports.renditionPlaylistKey =
  exports.masterPlaylistKey =
  exports.originalKey =
    void 0;
const originalKey = (videoId) => `videos/${videoId}/original.mp4`;
exports.originalKey = originalKey;
const masterPlaylistKey = (videoId) => `videos/${videoId}/master.m3u8`;
exports.masterPlaylistKey = masterPlaylistKey;
const renditionPlaylistKey = (videoId, height) => `videos/${videoId}/${height}p/index.m3u8`;
exports.renditionPlaylistKey = renditionPlaylistKey;
const renditionSegmentKey = (videoId, height, idx) => `videos/${videoId}/${height}p/seg${idx}.ts`;
exports.renditionSegmentKey = renditionSegmentKey;
const thumbnailKey = (videoId) => `thumbs/${videoId}.jpg`;
exports.thumbnailKey = thumbnailKey;
//# sourceMappingURL=storage-keys.js.map
