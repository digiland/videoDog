import { CATEGORY_LABELS, CONTENT_CATEGORIES, type ContentCategory } from '@streamzw/shared';

/** What the video or course is about: drives home chips, the guide and search filters. */
export function CategorySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ContentCategory;
  onChange: (c: ContentCategory) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        Category
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as ContentCategory)}
        className="h-11 rounded border border-line bg-surface px-3 text-base text-ink outline-none focus:border-accent sm:max-w-xs"
      >
        {CONTENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-3">Helps viewers find it under the right topic.</p>
    </div>
  );
}
