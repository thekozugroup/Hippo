// Renders Hippo's PWA icons from an inline SVG of the hippo glyph
// (scripts/hippo-glyph.mjs, the same shapes as public/favicon.svg and
// src/ui/components/Logo.tsx) to PNG files
// in public/. Uses Playwright's Chromium, which only needs to be present when
// the icons are regenerated:  npm run icons
//
// Outputs:
//   public/icon-192.png, public/icon-512.png  rounded tile, purpose "any"
//   public/icon-maskable-512.png              full-bleed, glyph inside the 80% safe zone
//   public/apple-touch-icon.png (180)         full-bleed; iOS rounds the corners
//
// The Android app's icons and splash come from scripts/generate-android-icons.mjs.

import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BLUE_700, BLUE_900, GLYPH } from './hippo-glyph.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('playwright-core'))
}


/**
 * @param {number} size output pixels
 * @param {{ radius: number, glyph: number }} o radius as a share of size; glyph width as a share of size
 */
function svg(size, o) {
  const g = o.glyph * 64
  const offset = (64 - g) / 2
  const scale = g / 48
  // The glyph's visual centre sits slightly below its box centre; nudge it up.
  const dy = offset - 1.5 * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BLUE_700}"/>
      <stop offset="1" stop-color="${BLUE_900}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="${o.radius * 64}" fill="url(#bg)"/>
  <g transform="translate(${offset} ${dy}) scale(${scale})">${GLYPH}</g>
</svg>`
}

const OUT = [
  { file: 'icon-192.png', size: 192, radius: 0.25, glyph: 0.72 },
  { file: 'icon-512.png', size: 512, radius: 0.25, glyph: 0.72 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, glyph: 0.56 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, glyph: 0.66 },
]

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const o of OUT) {
    await page.setViewportSize({ width: o.size, height: o.size })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg(o.size, o)}</body></html>`,
    )
    const png = await page.locator('svg').screenshot({ omitBackground: true })
    await writeFile(publicDir + o.file, png)
    console.log(`wrote public/${o.file}`)
  }
} finally {
  await browser.close()
}
