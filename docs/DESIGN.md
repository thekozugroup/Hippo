# Hippo: design system

The contract for `src/ui/`. The visual direction comes from a set of reference images (a blue fintech concept and a dark agent-dashboard concept). Hippo borrows their structure and tone, not their content, logos or names.

## 1. Principles

1. One saturated blue field, one calm sheet. A screen is a deep-blue grainy gradient "hero" with a large rounded sheet rising over it. Content lives on the sheet.
2. Pills and circles. Every control is fully rounded: pill buttons, circular icon buttons, pill chips, a pill bottom navigation.
3. Quiet labels, loud values. Section labels are small, uppercase and grey. Values (counts, prices) are large, tight and near-black. Secondary parts of a value (decimals, units) drop to a lighter grey.
4. Two-tone sentences. Headlines mix muted words with bright words to place emphasis ("3 items *still available*").
5. Frost is restrained. Translucent surfaces use a uniform blur and a flat tint. No refraction, no lensing, no specular edge highlights, no rainbow sheen.
6. Dots for progress. Progress is shown as a two-row dot matrix that spans its container, filled dots bright and remaining dots dim.
7. Every element earns its place. A normal state is plain text or nothing; a pill marks an exception. One surface per group (no card inside a card), one main action per card or screen, and the same action is never offered twice. A fact is said once, where it is needed.

## 2. Tokens

Tokens are CSS custom properties on `:root` in `src/ui/styles/tokens.css`. Components use tokens only; no raw hex values in component CSS.

Theming uses a single block. `:root` sets `color-scheme: light dark`; `[data-theme='light']` and `[data-theme='dark']` pin one scheme. Every semantic token is declared once with `light-dark(light, dark)`, which resolves against the used `color-scheme` of the element that uses it, so the system theme and the `data-theme` override share one definition and cannot drift. `light-dark()` is supported in Chrome 123+, Firefox 120+ and Safari 17.5+.

### Colour

The palette is drawn from the Tailwind CSS colour scales (v3 hex values). Tailwind itself is not a dependency: `tokens.css` declares the steps Hippo uses as primitives named after their scale (`--blue-600`, `--slate-200`), maps semantic tokens onto them, and components use the semantic tokens only. Blue carries the brand, slate (a cool grey that sits with blue) carries every neutral, and emerald, amber and rose appear only where a state needs them.

Primitives in use:

| Scale | Steps | Use |
|---|---|---|
| `blue` | 100, 200, 300, 400, 600, 700, 800, 900, 950 | Hero, primary button, accent, focus, links, blue status tone |
| `slate` | 50 to 700, 900, 950 | Surfaces, text, hairlines, control borders, dark theme field |
| `emerald` | 100, 200, 300, 400, 700, 800 | Success text, "bought" and "covered" tone |
| `amber` | 100, 200, 400, 800 | "Needs attention" tone (a conflict) |
| `rose` | 300, 700 | Danger and errors |

Semantic tokens (light / dark):

| Token | Light | Dark |
|---|---|---|
| `--bg` | slate-50 | slate-950 |
| `--surface` (sheet) | white | slate-900 |
| `--surface-2` (cards, secondary buttons, fields) | slate-50 | slate-50 at 5% over the surface |
| `--surface-3` (pressed, focused fields) | slate-100 | slate-50 at 9% |
| `--text` | slate-900 | slate-50 |
| `--text-2` | slate-600 | slate-300 |
| `--text-3` | slate-500 | slate-400 |
| `--hairline` | slate-900 at 9% | slate-50 at 10% |
| `--control-border` | slate-500 | slate-500 |
| `--accent` (links, focus ring, ghost buttons) | blue-600 | blue-300 |
| `--on-accent` | white | slate-950 |
| `--danger` | rose-700 | rose-300 |
| `--success` | emerald-700 | emerald-300 |
| `--primary-from` / `-mid` / `-to` / `-glow` | blue-800 / 700 / 600 / 400 | same |
| `--ink-on-white` (white control on the hero) | blue-950 | blue-950 |

Status tones use one recipe per scale: light is the scale's 100 step as fill with its 800 step as text (slate uses 700); dark is the scale's 400 step at 16% over the surface with its 200 step as text. Tokens: `--tone-slate-*`, `--tone-blue-*`, `--tone-emerald-*`, `--tone-amber-*` (`-fg`, `-bg`).

Measured contrast (WCAG 2.2, both themes): text on `--surface`, `--surface-2` and `--surface-3` 6.9:1 or better for `--text-2` (light) and 9.5:1 or better (dark); `--text-3` 4.55:1 (light, on `--surface-2`) and 6.2:1 (dark); `--control-border` 4.55:1 (light) and 3.33:1 (dark) as a 3:1 boundary; `--accent` 4.94:1 (light) and 8.78:1 (dark); status pill text 6.4:1 or better (light) and 8.4:1 or better (dark); white on the light hero 5.17:1 at its lightest stop (blue-600). Use `--text-3` only on `--surface` and `--surface-2`.

Hero background (`.hero-bg`, `--hero-bg`): a diagonal blend from blue-900 at the top right through blue-800 and blue-700 to blue-600 at the bottom left, plus a film-grain overlay (inline SVG `feTurbulence`, `mix-blend-mode: overlay`, which also dithers the gradient). The light end sits well below the text zone: inside `Screen` the gradient runs 360px below the hero band behind the sheet, and a vertical layer fades every column to the flat `--hero-fill`, with the grain faded alongside, so there is no band and no seam on wide screens. Any text on the hero (including a long two-tone headline) keeps 4.5:1 wherever it lands: white is 5.17:1 even on blue-600, and the muted half of a two-tone headline (white at 78%) is 4.71:1 on blue-700, the lightest stop the text zone reaches. Dark theme hero (and `variant="dark"` in any theme): flat slate-950 with a soft blue-800 glow in the upper third. Do not use photographic or streaked-light backgrounds.

### Typography

Font: Inter Variable, self-hosted via `@fontsource-variable/inter`. No remote fonts. Fallback `system-ui, sans-serif`.

Sizes are rem tokens (`--fs-*`, `--lh-*`), so they follow the user's text size setting. Below 360px width every role steps down one level through the same tokens.

| Role | Size / line | Narrow (<360px) | Weight | Tracking |
|---|---|---|---|---|
| Display (big value) | 3.5rem / 3.75rem (56 / 60) | 44 / 48 | 500 | -0.04em |
| Headline | 2.5rem / 2.75rem (40 / 44) | 32 / 36 | 500 | -0.03em |
| Headline-sm (empty-state title) | 2rem / 2.25rem (32 / 36) | 28 / 32 | 500 | -0.03em |
| Value (stat card) | 1.75rem / 2rem (28 / 32) | 24 / 28 | 500 | -0.03em |
| Title | 1.375rem / 1.75rem (22 / 28) | 20 / 26 | 500 | -0.02em |
| Body | 1.0625rem / 1.5rem (17 / 24) | 16 / 22 | 400 | -0.01em |
| Secondary | 0.9375rem / 1.25rem (15 / 20) | same | 400 | 0 |
| Label | 0.8125rem / 1rem (13 / 16) | same | 500 | 0.02em, uppercase |
| Caption (hints, errors, descriptions) | 0.8125rem / 1.125rem (13 / 18) | same | 400 | 0 |

Numbers use `font-variant-numeric: tabular-nums`. Long strings wrap (`overflow-wrap: anywhere`) instead of overflowing; `BigValue` also caps its size at 13vw so a total never overflows at 320px or with WCAG 1.4.12 text-spacing overrides.

### Shape, space, elevation, motion

- Radii: `--r-pill: 999px`, `--r-sheet: 40px` (top corners of the main sheet), `--r-card: 28px`, `--r-tile: 20px`, `--r-thumb: 14px` (thumbs scale it to a quarter of their size), `--r-xs: 8px` (checkbox).
- Spacing scale (`--sp-1` to `--sp-9`): 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen gutter 24px (20px under 360px). Use logical properties (`margin-inline`, `inset-block-end`, ...) so layouts mirror in RTL.
- Spacing roles. The same gap means the same thing everywhere, and related things sit closer than unrelated ones:

| Token | Value | Between |
|---|---|---|
| `--space-inline` | 8 | parts of one line (icon and text), steps of a short list |
| `--space-related` | 12 | lines that describe one thing (a bar and its amounts) |
| `--space-group` | 20 | items of a group: fields in a form, parts of a card |
| `--space-card` | 24 | padding inside a card, and between cards |
| `--space-section` | 40 | sections of a screen |

  The sheet has 32px top padding; list rows are at least 72px tall with 12px vertical padding.
- Control heights: 56px primary, 48px default, 44px minimum touch target.
- Shadows are soft and rare: sheet `0 -8px 40px` slate-950 at 18%; floating nav `0 8px 30px` slate-950 at 12%.
- Motion: 180ms ease-out for state changes; 320ms `cubic-bezier(.2,.8,.2,1)` for sheets. With `prefers-reduced-motion: reduce`, transitions are replaced by instant changes or opacity only.
- Print: hero, nav and toasts are removed and text is dark on white (`src/ui/styles/print.css`).

## 3. Frost (translucent surfaces)

Modelled on the frosted surfaces reported for Android 17: a uniform background blur with a translucent tint derived from the theme colour, flatter and more restrained than Apple's Liquid Glass.

One utility, `.frost`, with variants:

| Variant | Where | Tint | Blur | Opaque fallback |
|---|---|---|---|---|
| `.frost--on-hero` | Icon buttons and chips over the blue hero | blue-950 at 36% | `blur(24px) saturate(1.4)` | blue-900, white 1.5px border |
| `.frost--panel` | Cards and panels (light: `--surface` at 90%; dark: slate-900 at 55%) | per theme | `blur(28px) saturate(1.3)` | `--surface` / slate-900 |
| `.frost--bar` | Bottom navigation, sticky headers over scrolling content | `color-mix(in srgb, var(--surface) 72%, transparent)` | `blur(28px) saturate(1.5)` | `--surface` |
| `.frost--scrim` | Behind dialogs and bottom sheets | slate-950 at 36% | `blur(12px)` | slate-950 at 80% |

Rules:

- A single 1px inside hairline: white at 14% on dark tints, `var(--hairline)` on light tints. No gradient borders, no inner glow, no highlight streaks.
- Contrast guarantee: text and icons on frost meet 4.5:1 on the backdrops frost is allowed on. `--on-hero` frost sits only on the hero's top zone (white on blue-900 through blue-600 behind the tint: 7.5:1 or better); `--panel` in the dark theme sits on slate-950, the dark hero or `--surface` (text 10:1 or better, `--text-2` 6:1 or better); `--bar` sits on the sheet or page (`--text` 9.8:1 or better over any backdrop). Do not place frost over arbitrary photos or bright fills, and do not lower the tints.
- Fallbacks: without `backdrop-filter` support, and under `prefers-reduced-transparency: reduce` or `prefers-contrast: more`, every `.frost` component becomes fully opaque (its variant's solid colour, no blur) with a 1.5px `--frost-solid-line` border. Under `forced-colors` it is `Canvas` with a `CanvasText` border. Components must not set their own background or `box-shadow` on a frost element: elevation goes through `--frost-elev`, so the hairline and its replacement are never lost.
- Do not stack frost on frost. Do not animate blur radius (the dialog scrim is not faded for this reason).

## 4. Components

All components are React function components in `src/ui/components/`, each with a co-located CSS file, exported from `src/ui/index.ts`. They are presentational: no data access, no routing. They forward `className`, native props and `ref` (React 19 ref-as-prop) to their root or, for form controls, to the native control; they expose correct roles and labels and are keyboard operable. Form fields merge a caller's `aria-describedby` and `aria-invalid` with their own.

| Component | Notes |
|---|---|
| `HeroBackground` | The grainy gradient field. Variants `blue`, `dark`. |
| `Screen` | Layout: hero area (top bar + optional headline) and the sheet. Handles safe-area insets. With a `nav`, the page reserves scroll padding so a focused control is never hidden behind the floating nav. |
| `Sheet` | The rounded surface over the hero. |
| `TopBar` | Left icon button, centre/right slot (profile chip, actions). Sits on the hero. |
| `Button` | Variants: `primary` (blue gradient pill with a light glow along the bottom edge, white text), `secondary` (`--surface-2` pill, dark text), `ghost`, `frost`, `danger`. Sizes `lg` 56, `md` 48. Optional leading icon. Labels uppercase at label size for `lg` actions, as in the references. Loading (`aria-busy`, activation ignored, focus kept) and disabled states. |
| `LinkButton` | An `<a>` styled as a `Button` (same props, `href` required); `loading` behaves as on `Button`. Use for navigation. |
| `IconButton` | Circle. Variants `frost` (on hero), `neutral` (on sheet), `ghost`. Requires `aria-label`. |
| `IconLink` | An `<a>` styled as an `IconButton` (same variants and sizes, `href` and `aria-label` required). Use for icon-only navigation such as a back link. |
| `Chip` | Pill with an optional avatar or emoji and its label; selectable (filter) variant with `aria-pressed`, shown selected as the blue tone with a 1.5px ring (not the inverse fill, so a default "All" filter does not outrank the content); may be a link. No dots. A static chip is plain text and takes no ARIA name. |
| `StatusPill` | Small tinted pill holding a status word, no dot: `available`, `partial`, `funded`, `claimed`, `purchased`, `removed`, `conflict`, `draft`, `published`. The word carries the status; the tint is a second cue (slate or blue for information, emerald for done, amber for attention). Use it for exceptions only: an ordinary state (an available wish, a shared list) shows no pill. The app passes labels in its own vocabulary ("Ben is getting this", "Bought", "Not counted", "Not shared yet"). |
| `SectionHeader` | Quiet uppercase label left, optional action right ("SEE ALL"). Offer "See all" once per destination on a screen. |
| `List`, `ListRow` | `List` is a `<ul role="list">`. A row has a leading thumb, title, secondary line, trailing value or control; optional as link/button. Title and secondary text wrap to at most two lines (`lines` = 1, 2 or `full`); the full text stays in the DOM. |
| `Thumb` | Rounded image over a first-letter tile on a tinted background. The tile is always rendered, so a slow, lazy or broken image never leaves a blank square; the letter hides once the image loads. `referrerPolicy="no-referrer"`, `loading="lazy"`. |
| `BigValue` | Display number with a muted secondary part (`$117.450` + `.17` pattern). Used for counts and totals. Shrinks and wraps; never overflows. |
| `MoneyText` | Formats `Money` with `Intl.NumberFormat`. Never throws: an unknown or malformed currency code renders as a plain number followed by the code as text (`5.00 XX`), a non-finite amount renders as a dash. |
| `TwoTone` | Two-tone headline text: a muted part and a bright part (`tone="on-hero"` for use over the hero; the muted part stays at 4.5:1 or better). |
| `DotProgress` | Two rows of 6px dots spanning the full width of its container at any width: it fits as many columns as the width allows (gap at least 4px) and spreads them so the first and last dots touch the edges. `value` 0..1, exposed as a progressbar with a text alternative (`valueText`). It shows no percentage; the screen puts one line of amounts under it (covered of price at the start, what is left at the end). Any progress fills at least one column; anything short of complete leaves one dim. |
| `ImportanceMark` | Three-level indicator (1 to 3 filled dots) with a text label: 1 "Nice to have", 2 "Want", 3 "Would love". |
| `BottomNav` | Floating pill. The active destination is an expanded pill (icon in a white circle + label + dot); inactive destinations are circles with icons. `nav` landmark, `aria-current="page"`. Uses `.frost--bar`. Fits four destinations at 320px (items shrink, the label ellipsizes, the dot is hidden under 360px). |
| `TextField`, `TextArea`, `Select`, `MoneyField` | Label above, 56px field on `--surface-2`, radius `--r-tile`, visible focus ring, error text. `MoneyField` announces the currency name as a description and tolerates unknown codes. |
| `Switch`, `SegmentedControl`, `Checkbox` | Native inputs underneath. A switch's description is exposed as a description, not run into its name. |
| `BottomSheet` | Modal sheet from the bottom on phones, centred dialog on wide screens. Uses `<dialog>`; focus trap and inert background; Escape closes; `.frost--scrim` backdrop; background scroll is locked while open. React state stays in sync with the native `close` event, and a press that starts inside the sheet never dismisses it. No drag handle (the sheet is not draggable). |
| `Toast` | `role="status"`, auto-dismiss (8 seconds by default; hover and focus pause it), pill shaped, with a dismiss button. |
| `EmptyState` | Two-tone headline, one sentence, one action. No icon tile. Use it for an empty list, not under a page heading that already says what happened. |
| `Skeleton` | Loading placeholder. |
| `Logo` | Hippo wordmark and a simple original hippo glyph (inline SVG). |

Icons: `lucide-react`, 1.75px stroke, 24px. Icons sit plain beside a fact or on an action; no tinted tiles behind them. A letter thumbnail (`Thumb`) standing in for a missing product image is a recognition aid and stays.

App-level shared pieces (in `src/app`, because they know the data model): `OwnedListRow` and `GuestListRow` (lists on Home and Lists), `ScreenMessage` (what to do under a heading that already says what happened: errors, broken links, storage), `MyGiftLine` (one of my gifts on a wish: a plain line with its quiet actions).

## 5. Layout and theming

- Mobile first. The app column is at most 480px wide and centred; on wide screens the hero fills the viewport behind it.
- Light theme: blue hero, white sheet. Dark theme: slate-950 field with a blue glow, slate-900 sheet, `.frost--panel` cards with hairline borders, dot progress, status pills (the dashboard reference). Theme follows `prefers-color-scheme`; a manual override sets `data-theme="light|dark"` on `<html>`. `index.html` declares `color-scheme` and a `theme-color` per scheme, and `viewport-fit=cover`.
- Safe areas: use `env(safe-area-inset-*)` for the top bar and bottom nav.
- Focus: 2px `--accent` ring with 2px offset on every interactive element, visible on both hero and sheet; the floating nav never covers a focused control (scroll padding).
- Reflow and text size: no horizontal scroll at 320 CSS px, type in rem, content survives WCAG 1.4.12 text-spacing overrides.

## 6. Screen mapping

| Screen | Hero | Sheet |
|---|---|---|
| Home (owner) | Logo, settings button, two-tone headline (first run: what Hippo is for; later: that the wishlist is kept only on this device) | First run: `ADD A WISH` and three short plain steps. Later: "WISHLIST" label with "See all", big wish count, `ADD A WISH` (primary) and `SHARE A LIST` (secondary), the four newest wishes, then "Your lists" and "Shared with me" rows |
| Wishlist | Title, add button (when there are wishes) | Filter chips, sort, wishes as `ListRow`s with importance and price |
| Item editor | Back button, title | Form |
| Lists | Title, add button (when there are lists) | Owned lists (a pill only for "Not shared yet" and "Sharing stopped"); "Shared with me" lists |
| List editor | Back, list name, date | Sharing (the state shows as its content: share button, link, or "Not shared yet" banner), details, what friends see, wishes on the list, manage |
| Giver view | List name, date, owner message, nickname chip | Wish cards: thumb, title, price and importance; a pill only for an exception; full-width `DotProgress` with one line of amounts; my gifts as a plain line with quiet actions; one main action; notes and the shop link last. Then "Invite others" and one line on what the owner cannot see |
| Settings | Title | Theme, categories, backup, capture tools, relays, about |

A gallery page at `#/design` renders every component in both themes for visual review.
