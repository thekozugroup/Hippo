// Renders the link preview card (Open Graph image) to public/og-image.png, 1200x630, from the
// project's own design: the blue hero field, the hippo glyph and name in white, and one line of
// text for the person who was sent a link. No people, no product photos. Same approach as
// generate-icons.mjs (an inline SVG and HTML rendered by Playwright's Chromium, needed only when
// the image is regenerated):  node scripts/generate-og-image.mjs
//
// The share link's secret is in the URL fragment, which chat apps never send, so the card is the
// same for every list and says only what is true of all of them.

import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('playwright-core'))
}

// From src/ui/styles/tokens.css: the hero gradient (blue-800 at the top to blue-600) and its glow.
const BLUE_600 = '#2563EB'
const BLUE_700 = '#1D4ED8'
const BLUE_800 = '#1E40AF'
const BLUE_200 = '#BFDBFE'

/** The 48x48 glyph, as in public/favicon.svg and src/ui/components/Logo.tsx. */
const GLYPH = `
  <g fill="#fff">
    <circle cx="5.5" cy="19" r="3.6"/>
    <circle cx="42.5" cy="19" r="3.6"/>
    <circle cx="15.5" cy="14.5" r="6.2"/>
    <circle cx="32.5" cy="14.5" r="6.2"/>
    <path d="M5 28c0-8 8-14 19-14s19 6 19 14v4c0 7-8 11-19 11S5 39 5 32z"/>
  </g>
  <g fill="${BLUE_800}">
    <circle cx="15.5" cy="14.5" r="2.4"/>
    <circle cx="32.5" cy="14.5" r="2.4"/>
    <ellipse cx="17.5" cy="31" rx="2.6" ry="3.2"/>
    <ellipse cx="30.5" cy="31" rx="2.6" ry="3.2"/>
  </g>`

const root = fileURLToPath(new URL('..', import.meta.url))
const font = pathToFileURL(join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).href

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url('${font}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; }
.card {
  position: relative; width: 1200px; height: 630px; overflow: hidden; box-sizing: border-box;
  padding: 88px 96px; display: flex; flex-direction: column; justify-content: space-between;
  font-family: Inter, sans-serif; color: #fff;
  background:
    radial-gradient(ellipse 70% 60% at 18% 12%, color-mix(in srgb, ${BLUE_600} 60%, transparent) 0%, transparent 100%),
    linear-gradient(160deg, ${BLUE_800} 0%, ${BLUE_700} 55%, ${BLUE_600} 100%);
}
.brand { display: flex; align-items: center; gap: 28px; font-size: 76px; font-weight: 700; letter-spacing: -0.02em; }
.brand svg { width: 112px; height: 112px; }
.line { font-size: 64px; font-weight: 600; line-height: 1.12; letter-spacing: -0.02em; max-width: 960px; }
.line span { color: ${BLUE_200}; }
</style></head><body><div class="card">
  <div class="brand"><svg viewBox="0 0 48 48" aria-hidden="true">${GLYPH}</svg>Hippo</div>
  <div class="line"><span>A gift list</span> shared with you</div>
</div></body></html>`

const dir = await mkdtemp(join(tmpdir(), 'hippo-og-'))
const file = join(dir, 'og.html')
await writeFile(file, html)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.card').screenshot({ path: join(root, 'public/og-image.png') })
  console.log('wrote public/og-image.png')
} finally {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
