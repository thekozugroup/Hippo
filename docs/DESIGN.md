# Hippo — Design System

The contract for `src/ui/`. The visual direction comes from a set of reference images (a blue fintech concept and a dark agent-dashboard concept). Hippo borrows their structure and tone, not their content, logos or names.

## 1. Principles

1. One saturated blue field, one calm sheet. A screen is a deep-blue grainy gradient "hero" with a large rounded sheet rising over it. Content lives on the sheet.
2. Pills and circles. Every control is fully rounded: pill buttons, circular icon buttons, pill chips, a pill bottom navigation.
3. Quiet labels, loud values. Section labels are small, uppercase and grey. Values (counts, prices) are large, tight and near-black. Secondary parts of a value (decimals, units) drop to a lighter grey.
4. Two-tone sentences. Headlines mix muted words with bright words to place emphasis ("3 items *still available*").
5. Frost is restrained. Translucent surfaces use a uniform blur and a flat tint. No refraction, no lensing, no specular edge highlights, no rainbow sheen.
6. Dots for progress. Progress is shown as a two-row dot matrix, filled dots bright and remaining dots dim.

## 2. Tokens

Tokens are CSS custom properties on `:root` in `src/ui/styles/tokens.css`. Components use tokens only; no raw hex values in component CSS.

Theming uses a single block. `:root` sets `color-scheme: light dark`; `[data-theme='light']` and `[data-theme='dark']` pin one scheme. Every semantic token is declared once with `light-dark(light, dark)`, which resolves against the used `color-scheme` of the element that uses it, so the system theme and the `data-theme` override share one definition and cannot drift. `light-dark()` is supported in Chrome 123+, Firefox 120+ and Safari 17.5+.

### Colour

Blue ramp:

| Token | Value | Use |
|---|---|---|
| `--blue-950` | `#060A18` | Dark theme background, dark hero |
| `--blue-900` | `#0A1230` | Dark solid panel (frost fallback) |
| `--blue-800` | `#12297A` | Hero gradient deep end, solid hero-frost fallback |
| `--blue-700` | `#1B3FA8` | Hero gradient, dark glow |
| `--blue-600` | `#2A5BD0` | Primary accent, links, focus ring, hero gradient |
| `--blue-500` | `#3F7BE0` | Hero gradient light end and flat fill |
| `--blue-400` | `#6BA3EC` | Reserved light blue (not used in the hero) |
| `--blue-300` | `#9CC3F5` | Accent on dark |
| `--blue-100` | `#DCEBFC` | Tinted backgrounds |

Semantic tokens (light / dark):

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F7F7F8` | `#060A18` |
| `--surface` (sheet) | `#FFFFFF` | `#0C1226` |
| `--surface-2` (tiles, secondary buttons) | `#F6F6F7` | `rgba(255,255,255,0.05)` |
| `--surface-3` (pressed, inputs) | `#EEEEF0` | `rgba(255,255,255,0.09)` |
| `--text` | `#0B0D14` | `#F4F6FB` |
| `--text-2` | `#5F626C` | `rgba(244,246,251,0.72)` |
| `--text-3` | `#6A6D77` | `rgba(244,246,251,0.58)` |
| `--hairline` | `rgba(11,13,20,0.07)` | `rgba(255,255,255,0.09)` |
| `--control-border` | `#8A8D96` | `rgba(255,255,255,0.42)` |
| `--accent` | `--blue-600` | `--blue-300` |
| `--on-accent` | `#FFFFFF` | `--blue-950` |
| `--danger` | `#C4314B` | `#FF8FA3` |
| `--success` | `#1E7F5C` | `#7FE0B8` |

`--text-2` and `--text-3` meet WCAG AA (4.5:1) on `--surface` and `--surface-2` (`--text-2` also on `--surface-3`); use `--text-3` only on `--surface` and `--surface-2`. `--control-border` is the 3:1 boundary for fields, toggles and segmented controls. The paler greys seen in the references are allowed only for decorative or redundant text (for example the decimals of a price whose integer part is in `--text`).

Hero background (`.hero-bg`, `--hero-bg`): a diagonal blend from `--blue-800` at the top right through `--blue-700` and `--blue-600` to `--blue-500` at the bottom left, plus a film-grain overlay (inline SVG `feTurbulence`, `mix-blend-mode: overlay`, which also dithers the gradient). The light end sits well below the text zone: inside `Screen` the gradient runs 360px below the hero band behind the sheet, and a vertical layer fades every column to the flat `--hero-fill`, with the grain faded alongside, so there is no band and no seam on wide screens. Any text on the hero (including a long two-tone headline) keeps 4.5:1 wherever it lands. Dark theme hero (and `variant="dark"` in any theme): flat `--blue-950` with a soft `--blue-700` glow in the upper third. Do not use photographic or streaked-light backgrounds.

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
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen gutter 24px (20px under 360px). Use logical properties (`margin-inline`, `inset-block-end`, ...) so layouts mirror in RTL.
- Control heights: 56px primary, 48px default, 44px minimum touch target.
- Shadows are soft and rare: sheet `0 -8px 40px rgba(6,10,24,0.18)`; floating nav `0 8px 30px rgba(6,10,24,0.12)`.
- Motion: 180ms ease-out for state changes; 320ms `cubic-bezier(.2,.8,.2,1)` for sheets. With `prefers-reduced-motion: reduce`, transitions are replaced by instant changes or opacity only.
- Print: hero, nav and toasts are removed and text is dark on white (`src/ui/styles/print.css`).

## 3. Frost (translucent surfaces)

Modelled on the frosted surfaces reported for Android 17: a uniform background blur with a translucent tint derived from the theme colour, flatter and more restrained than Apple's Liquid Glass.

One utility, `.frost`, with variants:

| Variant | Where | Tint | Blur | Opaque fallback |
|---|---|---|---|---|
| `.frost--on-hero` | Icon buttons and chips over the blue hero | `rgba(8,16,48,0.36)` | `blur(24px) saturate(1.4)` | `--blue-800`, white 1.5px border |
| `.frost--panel` | Cards and panels (light: `--surface` at 90%; dark: `rgba(16,24,52,0.55)`) | per theme | `blur(28px) saturate(1.3)` | `--surface` / `--blue-900` |
| `.frost--bar` | Bottom navigation, sticky headers over scrolling content | `color-mix(in srgb, var(--surface) 72%, transparent)` | `blur(28px) saturate(1.5)` | `--surface` |
| `.frost--scrim` | Behind dialogs and bottom sheets | `rgba(6,10,24,0.36)` | `blur(12px)` | `--blue-950` at 80% |

Rules:

- A single 1px inside hairline: `rgba(255,255,255,0.14)` on dark tints, `var(--hairline)` on light tints. No gradient borders, no inner glow, no highlight streaks.
- Contrast guarantee: text and icons on frost meet 4.5:1 on the backdrops frost is allowed on. `--on-hero` frost sits only on the hero's top zone (white on blue-800 through blue-500 behind the tint: 7.3:1 or better); `--panel` in the dark theme sits on `--blue-950`, the dark hero or `--surface` (text 10:1 or better, `--text-2` 6:1 or better); `--bar` sits on the sheet or page (`--text` 9.8:1 or better over any backdrop). Do not place frost over arbitrary photos or bright fills, and do not lower the tints.
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
| `Chip` | Pill with optional avatar/emoji and trailing dot; selectable (filter) variant with `aria-pressed`; may be a link. A static chip is plain text and takes no ARIA name. |
| `StatusPill` | Small pill: `available`, `partial`, `funded`, `claimed`, `purchased`, `removed`, `conflict`, `draft`, `published`. Never colour alone: always has a text label. The app passes labels in its own vocabulary ("Partly covered", "Someone is getting this", "Bought", "Not shared yet"). |
| `SectionHeader` | Uppercase label left, optional action right ("SEE ALL"). |
| `List`, `ListRow` | `List` is a `<ul role="list">`. A row has a leading thumb, title, secondary line, trailing value or control; optional as link/button. Title and secondary text wrap to at most two lines (`lines` = 1, 2 or `full`); the full text stays in the DOM. |
| `Thumb` | Rounded image over a first-letter tile on a tinted background. The tile is always rendered, so a slow, lazy or broken image never leaves a blank square; the letter hides once the image loads. `referrerPolicy="no-referrer"`, `loading="lazy"`. |
| `BigValue` | Display number with a muted secondary part (`$117.450` + `.17` pattern). Used for counts and totals. Shrinks and wraps; never overflows. |
| `MoneyText` | Formats `Money` with `Intl.NumberFormat`. Never throws: an unknown or malformed currency code renders as a plain number followed by the code as text (`5.00 XX`), a non-finite amount renders as a dash. |
| `StatCard` | Tile with label, small icon button, a mini bar or dot graphic, value and caption. `panel` makes it a frost panel. |
| `TwoTone` | Two-tone headline text: a muted part and a bright part (`tone="on-hero"` for use over the hero; the muted part stays at 4.5:1 or better). |
| `DotProgress` | Two rows of dots, `value` 0..1, `aria` as a progressbar with a text alternative. |
| `ImportanceMark` | Three-level indicator (1 to 3 filled dots) with a text label: 1 "Nice to have", 2 "Want", 3 "Would love". |
| `BottomNav` | Floating pill. The active destination is an expanded pill (icon in a white circle + label + dot); inactive destinations are circles with icons. `nav` landmark, `aria-current="page"`. Uses `.frost--bar`. Fits four destinations at 320px (items shrink, the label ellipsizes, the dot is hidden under 360px). |
| `TextField`, `TextArea`, `Select`, `MoneyField` | Label above, 56px field on `--surface-2`, radius `--r-tile`, visible focus ring, error text. `MoneyField` announces the currency name as a description and tolerates unknown codes. |
| `Switch`, `SegmentedControl`, `Checkbox` | Native inputs underneath. A switch's description is exposed as a description, not run into its name. |
| `BottomSheet` | Modal sheet from the bottom on phones, centred dialog on wide screens. Uses `<dialog>`; focus trap and inert background; Escape closes; `.frost--scrim` backdrop; background scroll is locked while open. React state stays in sync with the native `close` event, and a press that starts inside the sheet never dismisses it. No drag handle (the sheet is not draggable). |
| `Toast` | `role="status"`, auto-dismiss (8 seconds by default; hover and focus pause it), pill shaped, with a dismiss button. |
| `EmptyState` | Two-tone headline, one sentence, one action. |
| `Skeleton` | Loading placeholder. |
| `Logo` | Hippo wordmark and a simple original hippo glyph (inline SVG). |

Icons: `lucide-react`, 1.75px stroke, 24px.

## 5. Layout and theming

- Mobile first. The app column is at most 480px wide and centred; on wide screens the hero fills the viewport behind it.
- Light theme: blue hero, white sheet. Dark theme: `--blue-950` field, `.frost--panel` cards with hairline borders, dot progress, status pills (the dashboard reference). Theme follows `prefers-color-scheme`; a manual override sets `data-theme="light|dark"` on `<html>`. `index.html` declares `color-scheme` and a `theme-color` per scheme, and `viewport-fit=cover`.
- Safe areas: use `env(safe-area-inset-*)` for the top bar and bottom nav.
- Focus: 2px `--accent` ring with 2px offset on every interactive element, visible on both hero and sheet; the floating nav never covers a focused control (scroll padding).
- Reflow and text size: no horizontal scroll at 320 CSS px, type in rem, content survives WCAG 1.4.12 text-spacing overrides.

## 6. Screen mapping

| Screen | Hero | Sheet |
|---|---|---|
| Home (owner) | Menu button, profile chip, optional two-tone headline (on first run it says what Hippo is) | "WISHLIST" label, big wish count, `ADD` (primary) and, once there are wishes, `SHARE` (secondary) pills, recent wishes list, stat cards for shared lists |
| Wishlist | Title, filter chips | Items as `ListRow`s with importance and price |
| Item editor | Back button, title | Form |
| Lists | Title | Owned lists with `StatusPill`; "Shared with me" lists |
| List editor | Back, list name | Settings, item picker, publish, share link |
| Giver view | List name, date, owner message | Items with `StatusPill`, `DotProgress` for pledges, claim and pledge actions in a `BottomSheet` |
| Settings | Title | Theme, relays, backup, capture tools, about |

A gallery page at `#/design` renders every component in both themes for visual review.
