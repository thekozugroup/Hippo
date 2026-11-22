// Renders Hippo's PWA icons from an inline SVG of the hippo glyph (the same
// shapes as public/favicon.svg and src/ui/components/Logo.tsx) to PNG files
// in public/. Uses Playwright's Chromium, which only needs to be present when
// the icons are regenerated:  npm run icons
//
// Outputs:
//   public/icon-192.png, public/icon-512.png  rounded tile, purpose "any"
//   public/icon-maskable-512.png              full-bleed, glyph inside the 80% safe zone
//   public/apple-touch-icon.png (180)         full-bleed; iOS rounds the corners

import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('playwright-core'))
}

const BLUE_600 = '#2A5BD0'
const BLUE_700 = '#1B3FA8'
const BLUE_800 = '#12297A'

/** The 48x48 glyph: white head with eyes and nostrils in the hero blue. */
const GLYPH = `
  <g fill="#fff">
    <circle cx="5.5" cy="19" r="3.6"/>
    <circle cx="42.5" cy="19" r="3.6"/>
    <circle cx="15.5" cy="14.5" r="6.2"/>
    <circle cx="32.5" cy="14.5" r="6.2"/>
    <path d="M5 28c0-8 8-14 19-14s19 6 19 14v4c0 7-8 11-19 11S5 39 5 32z"/>
  </g>
  <g fill="${BLUE_700}">
    <circle cx="15.5" cy="14.5" r="2.4"/>
    <circle cx="32.5" cy="14.5" r="2.4"/>
    <ellipse cx="17.5" cy="31" rx="2.6" ry="3.2"/>
    <ellipse cx="30.5" cy="31" rx="2.6" ry="3.2"/>
  </g>`

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
      <stop offset="0" stop-color="${BLUE_600}"/>
      <stop offset="1" stop-color="${BLUE_800}"/>
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
