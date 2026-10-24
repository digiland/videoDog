import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded transition-colors select-none ' +
  'disabled:opacity-50 disabled:pointer-events-none';

/** Heights keep a 44px+ touch target at md/lg (phones are the primary device). */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'bg-surface-2 text-ink hover:bg-line border border-line',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-danger text-bg hover:opacity-90',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', block = false) {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}${block ? ' w-full' : ''}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: IconName;
  /** Shows a spinner, keeps the width, and blocks repeat taps (double-charging guard). */
  loading?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  icon,
  loading,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant, size, block)} ${className ?? ''}`}
      {...rest}
    >
      {loading ? <Icon name="spinner" size={18} /> : icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

type LinkButtonProps = {
  href: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: IconName;
  className?: string;
  children: ReactNode;
};

export function LinkButton({
  href,
  variant,
  size,
  block,
  icon,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link href={href} className={`${buttonClass(variant, size, block)} ${className ?? ''}`}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  );
}
