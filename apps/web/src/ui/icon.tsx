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
