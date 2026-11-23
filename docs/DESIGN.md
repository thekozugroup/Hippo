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

Theming uses one token block and one way to pin a scheme.

- `:root` sets `color-scheme: light dark`, so the page follows the system. `[data-theme='light']` and `[data-theme='dark']` pin one scheme on any element, not only `<html>`.
- Every token that depends on the scheme (surfaces, text, accent, hero, frost, status tones, and anything built with `var()` from them) is declared once, with `light-dark(light, dark)`, in the block `:where(:root, [data-theme])`. Constants (primitives, type, space, motion, the primary button) stay in `:root`.
- **Subtree theming.** To show part of a screen in another scheme than the page, put `data-theme="light"` or `data-theme="dark"` on the root element of that part (React: `<div data-theme="dark">`). That element gets `color-scheme` and its own copy of every scheme-dependent token, so everything inside resolves to that scheme. The copy matters because engines may resolve `light-dark()` inside a custom property either where the token is used or where it is declared. Chromium 153 and 157 resolve it where it is used (checked here); declaring the tokens again on the subtree root makes the result the same either way. Never copy token values into a component, and never set `color-scheme` on a subtree without `data-theme`.
- The block has zero specificity (`:where`), so a component can still set a token on its own root (`StepScreen` sets `--focus-ring: white`; `.hero-bg` does the same).
- Who uses it: `HeroBackground variant="dark"` and `"night"` and `StepScreen` set `data-theme="dark"` themselves, so they are dark in either page theme with no rules of their own. The Gallery pins each frame, and each dark field with panels on it, with `data-theme`. A dark field that holds content (frost panels, text) needs `data-theme="dark"` on the element that wraps the content; `HeroBackground` alone only darkens its own background.
- A new scheme-dependent token goes in the block above, never in a component. `light-dark()` is supported in Chrome 123+, Firefox 120+ and Safari 17.5+. Firefox and Safari have not been tested against the subtree case.

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
- Motion: see section 2a.
- Print: hero, nav and toasts are removed and text is dark on white (`src/ui/styles/print.css`).

### 2a. Motion

Motion says where something came from or where it went. It starts from its source, stays short and never delays input; if it explains nothing, it is cut. Only `transform` and `opacity` animate (no layout properties, no blur radius) with one deliberate exception: the bottom navigation animates the `flex-grow` of its four small items (below), nothing runs longer than `--dur-sheet` (one exception: the logo intro below), routine actions never bounce, and nothing animates on first paint (enter effects wait for `html[data-booted]`, set 800ms after start).

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 100ms | Pressed states (buttons scale to 0.97, rows show a tint layer) |
| `--dur` | 180ms | State changes: a pill or confirmation appears, a label fades in, a toast arrives |
| `--dur-exit` | 160ms | What leaves goes a little faster than what arrives |
| `--dur-page` | 280ms | Route transitions, the bottom-navigation switch, rows moving to a new place |
| `--dur-sheet` | 320ms | Sheets and dialogs rising from the bottom |
| `--dur-intro` | 2000ms | The logo intro on the first setup step, once per device: the one deliberate exception to the `--dur-sheet` limit, a brand moment |
| `--dur-intro-travel` | 600ms | The last part of the intro: the logo shrinking and travelling to its place (`--ease-move`) |
| `--dur-blink` | 1400ms | One pass of the blink pattern while the logo is large |
| `--stagger` | 18ms | Delay between dots filling in sequence (a whole sequence is capped at 240ms) |
| `--ease` | ease-out | Fades |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Exits off screen |
| `--ease-move` | `cubic-bezier(.3,0,0,1)` | Moves on screen: fast start, soft landing, no overshoot |
| `--ease-sheet` | `cubic-bezier(.2,.8,.2,1)` | Arrivals from off screen |
| `--shift-page` | 32px | How far page content slides on a route change |
| `--shift-enter` | 8px | How far a new element rises as it fades in |

What moves, and what it explains (`src/ui/styles/motion.css`, driven by `src/app/layout/motionLocation.ts`):

- Route transitions use the View Transitions API from the router; browsers without it, a hidden tab and reduced motion change screens instantly. Every history entry carries an index, so a push, Back and Forward are told apart. Going deeper (a list to a wish, Home to an editor, the next setup step) slides the hero title and the sheet's content in from the end side over `--dur-page` while the old content leaves toward the start in `--dur-exit`; Back (button, link or browser) is the mirror image. Bottom-navigation destinations cross-fade (old out in `--dur-press`, new in over `--dur`); the new hero title waits until the old one is gone, so two headlines are never on screen together. Redirects do not animate.
- Persistent parts carry a `view-transition-name`: the sheet surface (`hippo-sheet`) glides to its new top edge instead of flashing; the nav (`hippo-nav`) stays put between destinations and sinks or rises when a screen has none; the toast (`hippo-toast`) stays above everything; setup keeps its dots and action bar still while the step's content slides. Only full-page screens carry names (previews never do).
- Rapid navigation never queues: a newer transition skips the running one and the screen always ends on the latest address. A quick A to B to A remounts A fresh. `::view-transition` takes no pointer events, so taps reach the new screen while it animates.
- Bottom navigation (`BottomNav remember`): switching destination shrinks the previous one from pill to circle while the new one grows from circle to pill, on one clock (`--dur-page`, `--ease-move`, no bounce). The bar has one fixed width, the active item holds whatever room the circles leave (`flex-grow` 1, the others 0) and the two items' grow values always add up to 1, so the bar never changes size and the items between them slide. Each label sits in a clipped box and fades with the width, the white disc behind the icon fades in or out with the icon's ink following, and icons never move or resize. This is a deliberate exception to "only transform and opacity": it lays out four items of a fixed-size bar for under 300ms, measured at 60fps under 4x CPU throttle, and it replaces the old gliding indicator (there is one nav animation, not two). The animation is started from the new screen's nav as it mounts (each screen renders its own bar), from the destination remembered under `remember`; a switch that interrupts another starts from where the first one was. It only runs when the previous nav left within 120ms (a screen without a nav in between is the sink or rise below), never on first render or reload, and not under reduced motion. `aria-current` and the active class move in the same render, not at the end.
- The nav and route transitions: the nav carries `view-transition-name: hippo-nav` so the page cross-fade never snapshots it. Between destinations the old image is hidden and the new one is the live element, so the grow and shrink play on the real nav, not on a frozen picture (`::view-transition-group(hippo-nav)` has no animation). The bar is sized to the same parity as its container so its left edge sits on a whole pixel, since transitions snap a half pixel.
- Sheets and dialogs: on phones the sheet rises from the bottom edge over `--dur-sheet` and leaves the same way in `--dur-exit`; on wide screens it scales from 0.96 with a fade. The scrim fades with opacity; its blur radius never changes.
- Lists (`List`, on by default): rows that move after a reorder, a filter or a removal glide from their old place (FLIP, `--dur-page`); new rows rise 8px and fade in, a few at a time.
- Giver card: when a claim lands, the funding dots fill column by column once (`DotProgress`), and a new status pill or "You are getting this" line rises in (`.motion-enter`).
- Feedback: pressed states on buttons, chips, rows and nav items; toasts rise in and sink out; content replacing a loading placeholder cross-fades (`.motion-reveal`); skeletons pulse in opacity.
- Logo intro (`LogoIntro`, first step of setup, `src/app/core/logoIntro.ts`): the logo starts large (up to 3.5 times its size, never wider than the viewport less a gutter) and centred in the upper part of the screen, blinks twice (a blink, a pause of about 600 ms, a quicker blink), then shrinks and travels to its place at the top start of the step header. It is one element at its normal place in the layout moved with `transform` only (FLIP between the two measured positions), so nothing shifts when it lands and assistive technology sees one logo, named "Hippo". It never delays input: the headline, dots and controls are there from the first frame, the logo ignores the pointer, and any press, key or scroll snaps it to its place. It plays once per device (a flag in local storage), never on Back, resume or for givers. After landing the logo stays still; a later second blink was tried in the design and left out because it pulls the eye away from the question. Reduced motion: no travel and no blink; the logo is at its place from the first frame.
- Reduced motion: route transitions are not started, the nav switch and list moves are skipped, sheets only fade, and every CSS transition and animation is instant (`base.css`).

## 3. Frost (translucent surfaces)

Modelled on the frosted surfaces reported for Android 17: a uniform background blur with a translucent tint derived from the theme colour, flatter and more restrained than Apple's Liquid Glass.

One utility, `.frost`, with variants:

| Variant | Where | Tint | Blur | Opaque fallback |
|---|---|---|---|---|
| `.frost--on-hero` | Icon buttons and chips over the blue hero | blue-950 at 36% | `blur(14px) saturate(1.4)` | blue-900, white 1.5px border |
| `.frost--panel` | Cards and panels (light: `--surface` at 90%; dark: slate-900 at 55%) | per theme | `blur(14px) saturate(1.3)` | `--surface` / slate-900 |
| `.frost--bar` | Bottom navigation over scrolling content: a heavy frost, so text behind it cannot be read | `--surface` at `--frost-bar-tint-strength` (80%) | `blur(var(--frost-bar-blur))` (14px) `saturate(var(--frost-bar-saturate))` (1.4) | `--surface` |
| `.frost--scrim` | Behind dialogs and bottom sheets | slate-950 at 36% | `blur(12px)` | slate-950 at 80% |

Rules:

- A single 1px inside hairline: white at 14% on dark tints, `var(--hairline)` on light tints. No gradient borders, no inner glow, no highlight streaks.
- Contrast guarantee: text and icons on frost meet 4.5:1 on the backdrops frost is allowed on. `--on-hero` frost sits only on the hero's top zone (white on blue-900 through blue-600 behind the tint: 7.5:1 or better); `--panel` in the dark theme sits on slate-950, the dark hero or `--surface` (text 10:1 or better, `--text-2` 6:1 or better); `--bar` sits on the sheet or page (`--text` 9.8:1 or better over any backdrop). Do not place frost over arbitrary photos or bright fills, and do not lower the tints.
- Fallbacks: without `backdrop-filter` support, and under `prefers-reduced-transparency: reduce` or `prefers-contrast: more`, every `.frost` component becomes fully opaque (its variant's solid colour, no blur) with a 1.5px `--frost-solid-line` border. Under `forced-colors` it is `Canvas` with a `CanvasText` border. Components must not set their own background or `box-shadow` on a frost element: elevation goes through `--frost-elev`, so the hairline and its replacement are never lost.
- Blur radius is 14px or less. Chromium draws a larger backdrop blur at a device pixel ratio of 2 or 3 with a sharp copy of what is behind showing through (measured: text behind the old 28px bar was readable at 2x). Strength comes from the tint.
- `.frost--bleed` (the bottom navigation): only the pixels inside the pill are blurred, and content beside and below it stays sharp. Near the bottom edge of a blurred box Chromium lets a sharp strip through at 2x and 3x, so the blurred box reaches `--frost-bleed` (32px) past the pill above and below (padding in, margin out, so layout does not change) and `clip-path` cuts it back to the rounded pill. The hairline is drawn inside by `::after`; the bar has no outer shadow. Measured with the bar's content hidden, its colour over black, white, the blue hero and bright product colours gives the label and icons 9:1 or better in both themes.
- During a route transition (`html[data-nav-dir]`) the bar is drawn with its opaque colour and no live blur, because a view-transition image cannot carry a live backdrop (Chromium draws it as a square blurred box). At 80% tint the change for those frames is not visible.
- Do not stack frost on frost. Do not animate blur radius. The dialog scrim fades with `opacity` only; its blur stays at 12px.

## 4. Components

All components are React function components in `src/ui/components/`, each with a co-located CSS file, exported from `src/ui/index.ts`. They are presentational: no data access, no routing. They forward `className`, native props and `ref` (React 19 ref-as-prop) to their root or, for form controls, to the native control; they expose correct roles and labels and are keyboard operable. Form fields merge a caller's `aria-describedby` and `aria-invalid` with their own.

| Component | Notes |
|---|---|
| `HeroBackground` | The grainy gradient field. Variants `blue`, `dark`, and `night` (the setup field in both themes: grainy blue at the top falling to slate-950 where the text sits). `dark` and `night` carry `data-theme="dark"` (section 2). |
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
| `List`, `ListRow` | `List` is a `<ul role="list">`; rows glide to a new place when the list changes (`animate`, default on). A row has a leading thumb, title, secondary line, trailing value or control; optional as link/button. Title and secondary text wrap to at most two lines (`lines` = 1, 2 or `full`); the full text stays in the DOM. |
| `Thumb` | Rounded image over a first-letter tile on a tinted background. The tile is always rendered, so a slow, lazy or broken image never leaves a blank square; the letter hides once the image loads. `referrerPolicy="no-referrer"`, `loading="lazy"`. |
| `BigValue` | Display number with a muted secondary part (`$117.450` + `.17` pattern). Used for counts and totals. Shrinks and wraps; never overflows. |
| `MoneyText` | Formats `Money` with `Intl.NumberFormat`. Never throws: an unknown or malformed currency code renders as a plain number followed by the code as text (`5.00 XX`), a non-finite amount renders as a dash. |
| `TwoTone` | Two-tone headline text: a muted part and a bright part (`tone="on-hero"` for use over the hero; the muted part stays at 4.5:1 or better). |
| `DotProgress` | Two rows of 6px dots spanning the full width of its container at any width: it fits as many columns as the width allows (gap at least 4px) and spreads them so the first and last dots touch the edges. `value` 0..1, exposed as a progressbar with a text alternative (`valueText`). It shows no percentage itself; the screen puts one line under it: the whole-number percentage covered at the start, the amount still needed at the end ("20%" and "$199.00 left"; a fully covered wish reads "100%" and "Covered"). The percentage rounds down, never reads 100 unless covered, and reads at least 1 once anything is given. Any progress fills at least one column; anything short of complete leaves one dim. |
| `ImportanceMark` | Three-level indicator (1 to 3 filled dots) with a text label: 1 "Nice to have", 2 "Want", 3 "Would love". |
| `BottomNav` | Floating pill of one fixed width. The active destination is an expanded pill (icon in a white circle + label, nothing after the label); inactive destinations are circles with icons. The active item is told apart by its label and white circle, not by colour alone, and carries `aria-current="page"`. `nav` landmark. Uses `.frost--bar`. Fits four destinations at 320px (spacing tightens under 360px, a label that does not fit ellipsizes). With `remember="<key>"` a switch grows the new destination while the previous one shrinks (section 2a). |
| `StepScreen` | One step of a stepped flow on the `night` field (dark in both themes through `data-theme="dark"` on its root). Logo top start, an optional action top end, the question as the only h1 low on the screen (described by "Step 2 of 5"), optional description and fields, `StepProgress`, then a round Back button and a wide pill (white circle with an arrow, label in the middle) that also submits on Enter; one quiet secondary action under it. Escape goes back. `contained` for previews. |
| `StepProgress` | Small dots for a flow: steps up to the current one are lit, the current one is a short bar, so step 1 already shows progress. Decorative dots plus a text alternative ("Step 2 of 5") to point a heading's `aria-describedby` at. |
| `TextField`, `TextArea`, `Select`, `MoneyField` | Label above, 56px field on `--surface-2`, radius `--r-tile`, visible focus ring, error text. `MoneyField` announces the currency name as a description and tolerates unknown codes. |
| `Switch`, `SegmentedControl`, `Checkbox` | Native inputs underneath. A switch's description is exposed as a description, not run into its name. |
| `BottomSheet` | Modal sheet from the bottom on phones, centred dialog on wide screens. Uses `<dialog>`; focus trap and inert background; Escape closes; `.frost--scrim` backdrop; background scroll is locked while open. React state stays in sync with the native `close` event, and a press that starts inside the sheet never dismisses it. No drag handle (the sheet is not draggable). |
| `Toast` | `role="status"`, auto-dismiss (8 seconds by default; hover and focus pause it), pill shaped, with a dismiss button. Rises in and sinks out. |
| `EmptyState` | Two-tone headline, one sentence, one action. No icon tile. Use it for an empty list, not under a page heading that already says what happened. |
| `Skeleton` | Loading placeholder (opacity pulse). |
| `Logo` | Hippo wordmark and a simple original hippo glyph (inline SVG). The eyes are separate shapes (holes in the glyph's mask), so `blink` can close them with `scaleY`; the still glyph is unchanged. |
| `LogoIntro` | `Logo` with the one-time intro described in section 2a (`play` at mount, `onPlay` to remember it). Used by `StepScreen` (`logoIntro`, `onLogoIntro`) on the first setup step only. |

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
| Home (owner) | Logo, two-tone headline (Settings is in the bottom navigation) (first run: what Hippo is for; later: that the wishlist is kept only on this device) | First run: `ADD A WISH` and three short plain steps. Later: "WISHLIST" label with "See all", big wish count, `ADD A WISH` (primary) and `SHARE A LIST` (secondary), the four newest wishes, then "Get set up" (after setup: put Hippo on the home screen where installing is possible, add three wishes, share your list, save a backup; the install task opens this device's steps in a bottom sheet; tracks real state, hides when done or dismissed, and replaces the steps and the backup reminder while shown), "Your lists" and "Shared with me" rows |
| Wishlist | Title, add button (when there are wishes) | Filter chips, sort, wishes as `ListRow`s with importance and price |
| Item editor | Back button, title | Form. Saving writes only the fields changed in this form onto the wish as stored now, and says so when one was also changed elsewhere. Unsaved typing is kept for the tab (sessionStorage) and comes back with one quiet line and "Start over". Price hints follow the currency's minor units (24.99, 2499, 24.990). A currency from a deep link or share must be a real ISO 4217 code and shows in the picker; it becomes the default for later wishes only when the person picks a currency in the menu by hand and saves the wish. When Link lookup is on, a pasted or handed-over link with an empty title or picture is looked up once: a quiet line under the link field says so while it waits and what it filled in (or that nothing was found), only empty fields are filled, and any edit of the link or leaving the screen drops the answer. When it is off, the first pasted link without a picture gets one hint (once per device) and nothing is sent |
| Lists | Title, add button (when there are lists) | Owned lists (a pill only for "Not shared yet" and "Sharing stopped"); "Shared with me" lists |
| List editor | Back, list name, date | Sharing (the state shows as its content: share button, link, or "Not shared yet" banner), details, what friends see, wishes on the list, manage |
| Setup (first run, `#/welcome/<step>`) | `StepScreen` on the night field: what Hippo is ("Skip setup" ends it), your name, the occasion (creates a draft list), one wish (saved and put on the list), putting Hippo on the home screen, one way to add wishes from this device. The install step (PRD FR-10c) shows this device's steps as a numbered list, a plain decorative lucide icon before each action and the device's own words in bold; its main pill is "Install Hippo" where the browser offers its prompt, "Copy link" inside another app's browser, "I added it" where it comes first (iPhone, iPad, Safari on a Mac, with "Carry on in the browser" under it), else "Continue". On those devices it is step 2, before any question; elsewhere it comes just before the last step; running installed it is left out and not counted. The same `InstallGuide` (in `src/app/pwa/`, steps from the pure `guide.ts`) is used by the Home checklist sheet and Settings. "Skip" on a step clears that step's answer. A first visit is painted on the night field from the first frame (`html[data-boot="setup"]`, set before the first render), so no light placeholder shows first | (no sheet) |
| Giver view | List name, "Ann's list" when the owner gave a name, date, owner message, and the name chip: "Add your name" until a name is set, then the name (the one place to set it) | First open on a device: a dismissible "How this works" card of two short lines, small enough that the first wish starts on the first screen at 390x844. When no sync server answers: "Hippo cannot reach its sync servers" with Try again ("You are offline" only when the browser is offline). Wish cards: thumb, title, price and importance; a pill only for an exception; full-width `DotProgress` with one line under it (percentage covered, amount left); my gifts as a plain line with quiet actions; one main action; notes and the shop link last. Then "Invite others" and one line on what the owner cannot see |
| Settings | Title | You and setup (your name, and "Go through setup again" with one line on what it does), theme, categories, Install Hippo (this device's steps, or that it is installed, and for Home Screen and Dock apps how to move wishes with a backup), backup, capture tools, link lookup (an off-by-default switch with its disclosure), relays, about, and last a collapsed "Deployment checks" row for whoever set up this copy: a plain list with one line per check, a fix only under a check that is not fine, "Needs attention" or "Could not check" on those, and a "Check again" button |

A gallery page at `#/design` renders every component in both themes for visual review.
