// The hippo glyph shared by the icon scripts (the same shapes as
// public/favicon.svg and src/ui/components/Logo.tsx): a white head with eyes
// and nostrils in the hero blue, drawn on a 48x48 grid.

// Tailwind blue-700, blue-800 and blue-900, as in src/ui/styles/tokens.css.
export const BLUE_700 = '#1D4ED8'
export const BLUE_800 = '#1E40AF'
export const BLUE_900 = '#1E3A8A'
/** Tailwind slate-950: the dark theme's field. */
export const SLATE_950 = '#020617'

/** White shapes of the head, then the features drawn over them in blue. */
export const HEAD = [
  { kind: 'circle', cx: 5.5, cy: 19, r: 3.6 },
  { kind: 'circle', cx: 42.5, cy: 19, r: 3.6 },
  { kind: 'circle', cx: 15.5, cy: 14.5, r: 6.2 },
  { kind: 'circle', cx: 32.5, cy: 14.5, r: 6.2 },
  { kind: 'path', d: 'M5 28c0-8 8-14 19-14s19 6 19 14v4c0 7-8 11-19 11S5 39 5 32z' },
]
export const FEATURES = [
  { kind: 'circle', cx: 15.5, cy: 14.5, r: 2.4 },
  { kind: 'circle', cx: 32.5, cy: 14.5, r: 2.4 },
  { kind: 'ellipse', cx: 17.5, cy: 31, rx: 2.6, ry: 3.2 },
  { kind: 'ellipse', cx: 30.5, cy: 31, rx: 2.6, ry: 3.2 },
]

function svgShape(s) {
  if (s.kind === 'circle') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`
  if (s.kind === 'ellipse') return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"/>`
  return `<path d="${s.d}"/>`
}

/** The glyph as SVG elements (for an `<svg viewBox="0 0 48 48">` or a scaled group). */
export const GLYPH = `
  <g fill="#fff">
    ${HEAD.map(svgShape).join('\n    ')}
  </g>
  <g fill="${BLUE_800}">
    ${FEATURES.map(svgShape).join('\n    ')}
  </g>`

/** A shape as Android VectorDrawable path data (circles and ellipses become two arcs). */
export function pathData(s) {
  if (s.kind === 'path') return s.d
  const rx = s.kind === 'circle' ? s.r : s.rx
  const ry = s.kind === 'circle' ? s.r : s.ry
  return `M${s.cx - rx},${s.cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0z`
}
