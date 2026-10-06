import type { Config } from 'tailwindcss';

/** Kopje tokens → Tailwind. Colours are CSS variables so both themes share one class set. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'on-accent': 'var(--on-accent)',
        gold: 'var(--gold)',
        sage: 'var(--sage)',
        danger: 'var(--danger)',
        scrim: 'var(--scrim)',
        // Legacy aliases — removed once every page is migrated.
        'bg-elev': 'var(--surface)',
        'ink-mute': 'var(--ink-2)',
        'ink-dim': 'var(--ink-3)',
        'accent-hot': 'var(--accent-strong)',
        warn: 'var(--gold)',
        ok: 'var(--sage)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      fontSize: {
        // Compact phone-first scale: [size, line-height]
        xs: ['0.75rem', '1rem'],
        sm: ['0.875rem', '1.25rem'],
        base: ['1rem', '1.5rem'],
        lg: ['1.125rem', '1.625rem'],
        xl: ['1.25rem', '1.75rem'],
        '2xl': ['1.5rem', '2rem'],
        '3xl': ['1.875rem', '2.25rem'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
};

export default config;
