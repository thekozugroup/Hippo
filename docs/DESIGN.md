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

### Colour

Blue ramp:

| Token | Value | Use |
|---|---|---|
| `--blue-950` | `#060A18` | Dark theme background |
| `--blue-900` | `#0A1230` | Dark panels base |
| `--blue-800` | `#12297A` | Hero gradient deep end |
| `--blue-700` | `#1B3FA8` | Hero gradient |
| `--blue-600` | `#2A5BD0` | Primary accent, links, focus ring |
| `--blue-500` | `#3F7BE0` | Primary button glow |
| `--blue-400` | `#6BA3EC` | Hero gradient light end |
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
| `--text-2` | `#6B6E78` | `rgba(244,246,251,0.66)` |
| `--text-3` | `#8E919A` | `rgba(244,246,251,0.46)` |
| `--hairline` | `rgba(11,13,20,0.07)` | `rgba(255,255,255,0.09)` |
| `--accent` | `--blue-600` | `--blue-300` |
| `--danger` | `#C4314B` | `#FF8FA3` |
| `--success` | `#1E7F5C` | `#7FE0B8` |

`--text-2` and `--text-3` must meet WCAG AA (4.5:1) on `--surface` wherever they carry information. The paler greys seen in the references are allowed only for decorative or redundant text (for example the decimals of a price whose integer part is in `--text`).

Hero background (`.hero-bg`): layered gradients from `--blue-800` (top right) through `--blue-700` to `--blue-400` (bottom left), plus a film-grain overlay (inline SVG `feTurbulence`, about 10% opacity, `mix-blend-mode: overlay`). Dark theme hero: `--blue-950` with a soft `--blue-700` glow in the upper third. Do not use photographic or streaked-light backgrounds.

### Typography

Font: Inter Variable, self-hosted via `@fontsource-variable/inter`. No remote fonts. Fallback `system-ui, sans-serif`.

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Display (big value) | 56 / 60 | 500 | -0.04em |
| Headline | 40 / 44 | 500 | -0.03em |
| Title | 22 / 28 | 500 | -0.02em |
| Body | 17 / 24 | 400 | -0.01em |
| Secondary | 15 / 20 | 400 | 0 |
| Label | 13 / 16 | 500 | 0.02em, uppercase |

Numbers use `font-variant-numeric: tabular-nums`. Sizes scale down one step below 360px width.

### Shape, space, elevation, motion

- Radii: `--r-pill: 999px`, `--r-sheet: 40px` (top corners of the main sheet), `--r-card: 28px`, `--r-tile: 20px`, `--r-thumb: 14px`.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen gutter 24px (20px under 360px).
- Control heights: 56px primary, 48px default, 44px minimum touch target.
- Shadows are soft and rare: sheet `0 -8px 40px rgba(6,10,24,0.18)`; floating nav `0 8px 30px rgba(6,10,24,0.12)`.
- Motion: 180ms ease-out for state changes; 320ms `cubic-bezier(.2,.8,.2,1)` for sheets. With `prefers-reduced-motion: reduce`, transitions are replaced by instant changes or opacity only.

## 3. Frost (translucent surfaces)

Modelled on the frosted surfaces reported for Android 17: a uniform background blur with a translucent tint derived from the theme colour, flatter and more restrained than Apple's Liquid Glass.

One utility, `.frost`, with variants:

| Variant | Where | Tint | Blur |
|---|---|---|---|
| `.frost--on-hero` | Icon buttons and chips over the blue hero | `rgba(8,16,48,0.28)` | `blur(24px) saturate(1.4)` |
| `.frost--panel` | Dark-theme cards and panels | `rgba(16,24,52,0.55)` | `blur(28px) saturate(1.3)` |
| `.frost--bar` | Bottom navigation, sticky headers over scrolling content | `color-mix(in srgb, var(--surface) 72%, transparent)` | `blur(28px) saturate(1.5)` |
| `.frost--scrim` | Behind dialogs and bottom sheets | `rgba(6,10,24,0.36)` | `blur(12px)` |

Rules:

- A single 1px inside hairline: `rgba(255,255,255,0.14)` on dark tints, `var(--hairline)` on light tints. No gradient borders, no inner glow, no highlight streaks.
- Text and icons on frost must meet 4.5:1 against the worst-case backdrop. The tint is chosen to guarantee this; do not lower it.
- Fallbacks: without `backdrop-filter` support, and under `prefers-reduced-transparency: reduce` or `prefers-contrast: more`, frost becomes an opaque surface in the nearest solid colour with a stronger border.
- Do not stack frost on frost. Do not animate blur radius.

## 4. Components

All components are React function components in `src/ui/components/`, each with a co-located CSS file, exported from `src/ui/index.ts`. They are presentational: no data access, no routing. They forward `className` and native props, expose correct roles and labels, and are keyboard operable.

| Component | Notes |
|---|---|
| `HeroBackground` | The grainy gradient field. Variants `blue`, `dark`. |
| `Screen` | Layout: hero area (top bar + optional headline) and the sheet. Handles safe-area insets. |
| `Sheet` | The rounded surface over the hero. |
| `TopBar` | Left icon button, centre/right slot (profile chip, actions). Sits on the hero. |
| `Button` | Variants: `primary` (blue gradient pill with a light glow along the bottom edge, white text), `secondary` (`--surface-2` pill, dark text), `ghost`, `frost`, `danger`. Sizes `lg` 56, `md` 48. Optional leading icon. Labels uppercase at label size for `lg` actions, as in the references. Loading and disabled states. |
| `IconButton` | Circle. Variants `frost` (on hero), `neutral` (on sheet), `ghost`. Requires `aria-label`. |
| `Chip` | Pill with optional avatar/emoji and trailing dot; selectable (filter) variant with `aria-pressed`. |
| `StatusPill` | Small pill: `available`, `partial`, `funded`, `claimed`, `purchased`, `removed`, `conflict`, `draft`, `published`. Never colour alone: always has a text label. |
| `SectionHeader` | Uppercase label left, optional action right ("SEE ALL"). |
| `ListRow` | Leading thumb, title, secondary line, trailing value or control; optional as link/button. |
| `Thumb` | Rounded image with graceful fallback (first letter on a tinted tile). `referrerPolicy="no-referrer"`, `loading="lazy"`. |
| `BigValue` | Display number with a muted secondary part (`$117.450` + `.17` pattern). Used for counts and totals. |
| `MoneyText` | Formats `Money` with `Intl.NumberFormat`. |
| `StatCard` | Tile with label, small icon button, a mini bar or dot graphic, value and caption. |
| `DotProgress` | Two rows of dots, `value` 0..1, `aria` as a progressbar with a text alternative. |
| `ImportanceMark` | Three-level indicator (1 to 3 filled dots) with a text label. |
| `BottomNav` | Floating pill. The active destination is an expanded pill (icon in a white circle + label + dot); inactive destinations are circles with icons. `nav` landmark, `aria-current="page"`. Uses `.frost--bar`. |
| `TextField`, `TextArea`, `Select`, `MoneyField` | Label above, 56px field on `--surface-2`, radius `--r-tile`, visible focus ring, error text. |
| `Switch`, `SegmentedControl`, `Checkbox` | Native inputs underneath. |
| `BottomSheet` | Modal sheet from the bottom on phones, centred dialog on wide screens. Uses `<dialog>`; focus trap; Escape closes; `.frost--scrim` backdrop. |
| `Toast` | `role="status"`, auto-dismiss, pill shaped. |
| `EmptyState` | Two-tone headline, one sentence, one action. |
| `Skeleton` | Loading placeholder. |
| `Logo` | Hippo wordmark and a simple original hippo glyph (inline SVG). |

Icons: `lucide-react`, 1.75px stroke, 24px.

## 5. Layout and theming

- Mobile first. The app column is at most 480px wide and centred; on wide screens the hero fills the viewport behind it.
- Light theme: blue hero, white sheet. Dark theme: `--blue-950` field, `.frost--panel` cards with hairline borders, dot progress, status pills (the dashboard reference). Theme follows `prefers-color-scheme`; a manual override sets `data-theme="light|dark"` on `<html>`.
- Safe areas: use `env(safe-area-inset-*)` for the top bar and bottom nav.
- Focus: 2px `--accent` ring with 2px offset on every interactive element, visible on both hero and sheet.

## 6. Screen mapping

| Screen | Hero | Sheet |
|---|---|---|
| Home (owner) | Menu button, profile chip, optional two-tone headline | "WISHLIST" label, big item count, `ADD` (primary) and `SHARE` (secondary) pills, recent items list, stat cards for shared lists |
| Wishlist | Title, filter chips | Items as `ListRow`s with importance and price |
| Item editor | Back button, title | Form |
| Lists | Title | Owned lists with `StatusPill`; "Shared with me" lists |
| List editor | Back, list name | Settings, item picker, publish, share link |
| Giver view | List name, date, owner message | Items with `StatusPill`, `DotProgress` for pledges, claim and pledge actions in a `BottomSheet` |
| Settings | Title | Theme, relays, backup, capture tools, about |

A gallery page at `#/design` renders every component in both themes for visual review.
