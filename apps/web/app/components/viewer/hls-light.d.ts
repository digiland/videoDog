/**
 * Types for hls.js's light build (no EME/DRM, alternate audio or in-stream subtitles —
 * ~108 KB gz instead of ~163 KB). Same API as the full build for what the player uses.
 */
declare module 'hls.js/dist/hls.light.min.js' {
  import Hls from 'hls.js';
  export default Hls;
}
