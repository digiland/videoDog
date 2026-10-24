import type { SVGProps } from 'react';

/**
 * The whole icon set: 24px grid, 1.75 stroke, currentColor. Inline paths — no icon font,
 * no sprite request. Add an icon only when a page needs it.
 */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17-5.2-5.2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  studio:
    'M4 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm13 4 4-2.5v9L17 14',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4h3.5v16H7zm6.5 0H17v16h-3.5z',
  lock: 'M6 10h12v10H6zm2.5 0V7.5a3.5 3.5 0 0 1 7 0V10',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'm9 5 7 7-7 7',
  chevronLeft: 'm15 5-7 7 7 7',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zm12.5-.5a4.5 4.5 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zm12 0 5 5m0-5-5 5',
  expand: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5',
  shrink: 'M9 4v5H4m16 0h-5V4m0 16v-5h5M4 15h5v5',
  captions: 'M3.5 6h17v12h-17zM10 10.5a2 2 0 1 0 0 3m6-3a2 2 0 1 0 0 3',
  data: 'M5 20h3v-6H5zm5.5 0h3V9h-3zM16 20h3V4h-3z',
  wallet: 'M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4zm0 0V6a2 2 0 0 1 2-2h11m-1 10h1.5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 15h2',
  card: 'M3 6h18v12H3zm0 4h18M6.5 15h3',
  alert: 'M12 3 2.5 20h19zm0 6.5v5m0 3v.01',
  spinner: 'M12 3a9 9 0 1 0 9 9',
  menu: 'M4 6h16M4 12h16M4 18h16',
  library: 'M4 4h4v16H4zm6 0h4v16h-4zm5.5 1.2 3.9-1 3.6 14.6-3.9 1z',
  history: 'M12 7.5V12l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4',
  course: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zm0 15V5.5M8 7.5h8',
  playlist: 'M4 6h12M4 11h12M4 16h7m5-2 5 3-5 3z',
  education: 'M2.5 9 12 4.5 21.5 9 12 13.5zm4 2v5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5M21.5 9v5',
  comedy: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-4-7.5a4.5 4.5 0 0 0 8 0M9 9.5v.01m6-.01v.01',
  drama: 'M4 4h16v16H4zM8 4v16m8-16v16M4 9h4m-4 6h4m8-6h4m-4 6h4',
  music: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  faith: 'M12 3v18M7 8h10',
  sports: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13 3.5 2.5-1.3 4H9.8l-1.3-4zM12 3v5',
  lifestyle: 'M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zm0 0 7-7',
  other: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  share: 'M12 4v11m-4.5-6.5L12 4l4.5 4.5M5 13v6h14v-6',
  plus: 'M12 5v14M5 12h14',
  arrowUp: 'M12 19V5m-6 6 6-6 6 6',
  arrowDown: 'M12 5v14m-6-6 6 6 6-6',
  trash: 'M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zm9.5-13.5 4 4',
  live: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8.5 8.5a5 5 0 0 0 0 7m7 0a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8m12.8 0a9 9 0 0 0 0-12.8',
  premium: 'm12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6-4.5-4.1 6-.7z',
} as const;

export type IconName = keyof typeof PATHS;

type Props = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  /** Give meaningful icons a label; decorative ones stay hidden from screen readers. */
  label?: string;
};

export function Icon({ name, size = 20, label, className, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${name === 'spinner' ? 'animate-spin ' : ''}${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {label && <title>{label}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
