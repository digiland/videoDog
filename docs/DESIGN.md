# Kopje — the StreamZW design system

Kopje is named after the granite hills found across Zimbabwe. It exists for one viewer: someone on an Android phone, on prepaid data, often in bright light or a dark room, paying with EcoCash. Every rule here serves that person first. Code lives in `apps/web/src/ui` (components) and `apps/web/app/globals.css` + `tailwind.config.ts` (tokens).

## Principles

1. **Respect the bundle.** Data is the real price of video. Show what playback costs in MB before play (`DataCost`), offer Data Saver (240p cap), default to low renditions on weak networks, and never autoplay video in lists.
2. **Price before tap.** Every video shows what it costs to watch (`AccessChip`) wherever it appears. Nobody should hit a paywall by surprise.
3. **Two taps to pay.** Buying is: tap the price, approve on the phone. Prefill the EcoCash number, remember the last currency, never ask for anything the server already knows.
4. **Thumb first.** Phones are the primary device. Primary navigation sits in the bottom tab bar; touch targets are at least 44px tall; primary actions are full-width on phones.
5. **Ship less.** No web fonts, no icon fonts, no animation libraries, no shimmer loops. Each page's own JS should stay small; anything heavy (the HLS player) loads only when needed.
6. **Say what happened.** Copy is plain and specific: "Payment failed: EcoCash declined it. Try again or use another number." No apologies, no jargon (people pay with _EcoCash_, they don't _initiate a payment intent_).

## Tokens

All colour comes from CSS variables. Dark is the default; light follows the OS or `data-theme="light"`. **Never use literal colours** (`#16213e`, `text-gray-400`, `bg-white`) in components; use the token classes below.

| Token         | Tailwind                    | Dark      | Light     | Use                                                                                       |
| ------------- | --------------------------- | --------- | --------- | ----------------------------------------------------------------------------------------- |
| `--bg`        | `bg-bg`                     | `#121110` | `#ffffff` | Page ground                                                                               |
| `--surface`   | `bg-surface`                | `#1b1917` | `#f4f3f1` | Panels, inputs, cards that must stand apart                                               |
| `--surface-2` | `bg-surface-2`              | `#25221f` | `#e9e7e3` | Hover, selected, chips, placeholders                                                      |
| `--line`      | `border-line`               | `#38332d` | `#d6d2cc` | Hairlines, input borders                                                                  |
| `--ink`       | `text-ink`                  | `#f3efe9` | `#16130f` | Primary text                                                                              |
| `--ink-2`     | `text-ink-2`                | `#bdb4a8` | `#4f4840` | Secondary text                                                                            |
| `--ink-3`     | `text-ink-3`                | `#9a9084` | `#6e655b` | Captions, hints, metadata                                                                 |
| `--accent`    | `bg-accent` / `text-accent` | `#e8834f` | `#a0461a` | **The** action colour (msasa copper). Primary buttons, focus, active state, prices to pay |
| `--on-accent` | `text-on-accent`            | `#1a0d05` | `#ffffff` | Text on accent                                                                            |
| `--gold`      | `text-gold`                 | `#e6b84a` | `#875f00` | Premium (semantic only)                                                                   |
| `--sage`      | `text-sage`                 | `#93b98d` | `#3b6a36` | Free, success (semantic only)                                                             |
| `--danger`    | `text-danger`               | `#f06b5a` | `#b42318` | Errors, destructive actions                                                               |

The video player is an always-dark island: wrap it in `.theme-dark` (redefines every token to its dark value) so video chrome and letterboxing stay dark in the light theme.

Every text/background pair above passes WCAG AA (4.5:1) on `bg`, `surface` and `surface-2` in both themes. Accent is for action; gold and sage carry meaning, not decoration.

**Type.** System font stack (Roboto on Android, SF on iOS), zero bytes. Scale: `xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30`. Body text is 16px on phones. Weights: 400 body, 600 labels/buttons, 700 headings. Use the `num` class (tabular figures) for prices, durations and counts.

**Space.** Tailwind's 4px scale; lay out siblings with `gap`, not margins. Page gutter: `px-4`. Max content width: `max-w-screen-xl`; reading width for forms: `max-w-md`.

**Shape.** `rounded` (6px) for controls, `rounded-md` (8px) for thumbnails, `rounded-lg` (12px) only for sheets/dialogs, `rounded-full` for chips and avatars. Borders separate things; no drop shadows.

**Motion.** 150ms colour transitions only. No infinite animations except a spinner while something is actually loading. `prefers-reduced-motion` turns transitions off.

## Components (`apps/web/src/ui`)

| Component                             | What it's for                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Icon`                                | The only icon set: inline SVG paths, `currentColor`. Decorative by default; pass `label` when the icon is the only content of a control.          |
| `Button`, `LinkButton`, `buttonClass` | `primary` (one per view), `secondary`, `ghost`, `danger`; `sm/md/lg`; `block` for full width; `loading` disables repeat taps (no double charges). |
| `AccessChip`                          | Free / price / Premium on every video tile and page.                                                                                              |
| `Price`, `PriceWithLocal`             | Money from the API (`{ amount_minor, currency }`), formatted at the leaf; local-currency approximation shown with "≈".                            |
| `DataCost`                            | "≈ 27 MB at 240p" from duration, using the shared rendition ladder (`@streamzw/shared`).                                                          |
| `Field`                               | Label, input, hint or error. Errors are announced.                                                                                                |
| `Segmented`                           | One-of-few choices (currency, payment method) on native radios.                                                                                   |
| `Notice`                              | Inline status: info, success, warning, error.                                                                                                     |
| `EmptyState`, `Skeleton`              | Calm empty/error states with one next step; static placeholders that match final layout.                                                          |
| `useDataSaver`                        | Data Saver preference: the viewer's choice, else the browser's Save-Data/2G signal.                                                               |

## Patterns

- **Video tile:** 16:9 thumbnail (`loading="lazy"`, `decoding="async"`, explicit size), title (2 lines max), creator, duration, `AccessChip`. No hover-preview video.
- **Video page:** player first; title, creator, `AccessChip` and `DataCost` directly under it; paywall replaces the player in the same box, so nothing jumps.
- **Quality menu:** each option shows MB per minute; Data Saver locks to 240p.
- **Checkout:** one column, `max-w-md`; amount at top; currency and method as `Segmented`; number prefilled; one primary button; then a waiting state that says exactly what to do ("Approve the EcoCash prompt on +263 77 …").
- **Studio:** numbers first (`num`), then lists. Tables scroll inside their own container on phones.

## Checklist for any new screen

- Uses only token colours and `src/ui` components; no literal colours.
- Works at 360px wide with the bottom tab bar visible; nothing scrolls sideways.
- Every control is at least 44px tall on touch, labelled, and has a visible focus ring.
- Loading, empty and error states are designed, not left blank.
- Prices show before the tap; data cost shows before play.
- No new dependency or web font without a size justification.
