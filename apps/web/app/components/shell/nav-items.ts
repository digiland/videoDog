import { CATEGORY_LABELS, CONTENT_CATEGORIES, type ContentCategory } from '@streamzw/shared';
import type { IconName } from '../../../src/ui/icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  match: (pathname: string, search: URLSearchParams) => boolean;
}

export const HOME: NavItem = {
  href: '/',
  label: 'Home',
  icon: 'home',
  match: (p, s) => p === '/' && !s.get('category'),
};
export const COURSES: NavItem = {
  href: '/courses',
  label: 'Courses',
  icon: 'course',
  match: (p) => p.startsWith('/courses'),
};
export const PREMIUM: NavItem = {
  href: '/pricing',
  label: 'Premium',
  icon: 'premium',
  match: (p) => p.startsWith('/pricing'),
};
export const LIBRARY: NavItem = {
  href: '/library',
  label: 'Library',
  icon: 'library',
  match: (p) => p.startsWith('/library'),
};
export const STUDIO: NavItem = {
  href: '/studio',
  label: 'Studio',
  icon: 'studio',
  match: (p) =>
    p.startsWith('/studio') &&
    !p.startsWith('/studio/collections') &&
    !p.startsWith('/studio/live'),
};

export const LIVE: NavItem = {
  href: '/live',
  label: 'Live',
  icon: 'live',
  match: (p) => p.startsWith('/live'),
};

export const PRIMARY: NavItem[] = [HOME, LIVE, COURSES, PREMIUM];

export const YOU: NavItem[] = [
  LIBRARY,
  { href: '/me', label: 'Your account', icon: 'user', match: (p) => p.startsWith('/me') },
];

export const CREATOR: NavItem[] = [
  STUDIO,
  {
    href: '/studio/live',
    label: 'Go live',
    icon: 'live',
    match: (p) => p.startsWith('/studio/live'),
  },
  {
    href: '/studio/collections',
    label: 'Your courses',
    icon: 'playlist',
    match: (p) => p.startsWith('/studio/collections'),
  },
];

/** Every category except the catch-all, as sidebar/explore links. */
export const EXPLORE: NavItem[] = CONTENT_CATEGORIES.filter((c) => c !== 'other').map(
  (c: ContentCategory) => ({
    href: `/?category=${c}`,
    label: CATEGORY_LABELS[c],
    icon: c as IconName,
    match: (p, s) => p === '/' && s.get('category') === c,
  }),
);
