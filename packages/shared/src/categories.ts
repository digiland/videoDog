/**
 * What a video or collection is about. One per item; drives home-page chips, channel
 * shelves and search filters. `other` is the default for anything uncategorised.
 */
export const CONTENT_CATEGORIES = [
  'education',
  'comedy',
  'drama',
  'music',
  'faith',
  'sports',
  'lifestyle',
  'other',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  education: 'Education',
  comedy: 'Comedy',
  drama: 'Film & drama',
  music: 'Music',
  faith: 'Gospel & faith',
  sports: 'Sports',
  lifestyle: 'Lifestyle',
  other: 'Other',
};

export function isContentCategory(value: unknown): value is ContentCategory {
  return typeof value === 'string' && (CONTENT_CATEGORIES as readonly string[]).includes(value);
}

/** Channel handles: 3–30 of a–z, 0–9, `_` and `.`, starting with a letter or digit. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_.]{2,29}$/;
