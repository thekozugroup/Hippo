#!/usr/bin/env node
// Measurements inside the Android app's real WebView on a running emulator, for
// scripts/android-emulator-smoke.sh (the Android workflow's emulator job).
//
//   node scripts/android-webview-checks.mjs <phase> <output folder>
//
// Playwright attaches to the app's WebView over adb (debug builds allow WebView
// debugging; release builds do not), so no browser is downloaded. Phases:
//
//   launch    Starts Hippo and samples the logo glyph from launch: it must end small
//             in its header within a deadline (whether a large phase was seen is
//             reported, not required). Then the edge-to-edge checks on setup.
//   keyboard  On the name step: taps the field (real touch), and with the keyboard
//             open checks the WebView ends at the keyboard and the field and the
//             step's actions are above it; then closes it and checks the insets
//             come back.
//   home      Leaves setup, runs the edge-to-edge checks on Home, scrolls the light
//             sheet under the status bar and checks the fade layer and the status
//             bar icon colour.
//
// Each check appends "PASS|FAIL|INFO <name>: <numbers>" to <output>/checks.txt and
// leaves screenshots in the output folder. The exit code is 1 if any check failed.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const PKG = 'io.github.thekozugroup.hippo'
const [phase, out = 'emulator-smoke'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
let failed = false

// ------------------------------------------------------------------ reporting

function record(status, name, detail) {
  if (status === 'FAIL') failed = true
  const line = `${status} ${name}: ${detail}`
  console.log(line)
  appendFileSync(join(out, 'checks.txt'), `${line}\n`)
}

const check = (ok, name, detail) => record(ok ? 'PASS' : 'FAIL', name, detail)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n)

// ------------------------------------------------------------------ adb

function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 << 20 })
}

function screenshot(name) {
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })
  writeFileSync(join(out, `${name}.png`), png)
  return png
}

function screenSize() {
  const sizes = [...adb('shell', 'wm', 'size').matchAll(/(\d+)x(\d+)/g)]
  const last = sizes.at(-1)
  if (!last) throw new Error('no screen size from wm size')
  return { w: Number(last[1]), h: Number(last[2]) }
}

/** System bar frames (device pixels) from the window manager, saved as dumpsys-<tag>.txt. */
function systemBars(tag) {
  const text = adb('shell', 'dumpsys', 'window')
  writeFileSync(join(out, `dumpsys-${tag}.txt`), text)
  const { h } = screenSize()
  const frames = (type) =>
    // Android 15: "InsetsSource id=… type=statusBars frame=[0,0][320,24] visible=true …"
    [...text.matchAll(new RegExp(`\\btype=${type} frame=\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\][^\\n]*? visible=(true|false)`, 'g'))].map((m) => ({
      top: Number(m[2]),
      bottom: Number(m[4]),
      visible: m[5] === 'true',
    }))
  const tallest = (list) => list.reduce((best, f) => Math.max(best, f.bottom - f.top), 0)
  const status = tallest(frames('statusBars').filter((f) => f.top === 0 && f.visible))
  const nav = tallest(frames('navigationBars').filter((f) => f.bottom === h && f.visible))
  const imeFrames = frames('ime').filter((f) => f.visible && f.bottom === h)
  const ime = tallest(imeFrames)
  return { status, nav, ime }
}

/** Whether the app's window asks for dark status bar icons (APPEARANCE_LIGHT_STATUS_BARS). */
function statusIconsFromWindowManager(tag) {
  const text = adb('shell', 'dumpsys', 'window', 'windows')
  writeFileSync(join(out, `dumpsys-windows-${tag}.txt`), text)
  const blocks = text.split(/\n(?=\s*Window #\d+)/).filter((b) => b.includes(`${PKG}/${PKG}.MainActivity`))
  if (blocks.length === 0) return { icons: 'unknown', evidence: 'no window block for MainActivity' }
  const block = blocks[0]
  const line = block.split('\n').find((l) => /apr=|appearance=|LIGHT_STATUS_BARS/.test(l))?.trim() ?? '(no appearance flags)'
  return { icons: /LIGHT_STATUS_BARS/.test(block) ? 'dark' : 'light', evidence: line.slice(0, 160) }
}

function imeShown() {
  return /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))
}

// ------------------------------------------------------------------ PNG (8-bit RGB or RGBA, not interlaced)

function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let bpp = 4
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 6 && data[9] !== 2)) throw new Error('unsupported PNG')
      bpp = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + i] : 0
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + i] = v & 255
    }
  }
  const at = (x, y) => {
    const o = y * stride + x * bpp
    return [px[o], px[o + 1], px[o + 2]]
  }
  return { width, height, at }
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
const diff = (p, q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))

/** Largest colour step across a bar's edge, comparing a pixel just inside the bar with one just outside it. */
export function stripStep(img, { inside, outside, columns }) {
  return columns.map((fx) => {
    const x = Math.round(fx * (img.width - 1))
    const a = img.at(x, inside)
    const b = img.at(x, outside)
    return { x, inside: hex(a), outside: hex(b), step: diff(a, b) }
  })
}

// A hard colour step at the bar's edge means a flat strip (a window colour) instead of the page.
const MAX_STEP = 20

function pixelChecks(label, png, bars) {
  const img = decodePng(png)
  // Status bar: just above and just below its lower edge, in the middle (clear of clock and icons).
  if (bars.status > 3) {
    const cols = stripStep(img, { inside: bars.status - 2, outside: bars.status + 1, columns: [0.4, 0.5, 0.6] })
    const worst = Math.max(...cols.map((c) => c.step))
    check(worst <= MAX_STEP, `${label}: page drawn under the status bar (pixels)`, `largest colour step at the bar edge y=${bars.status} is ${worst} (limit ${MAX_STEP}); ${cols.map((c) => `x=${c.x} ${c.inside} above / ${c.outside} below`).join('; ')}`)
  } else check(false, `${label}: page drawn under the status bar (pixels)`, `no status bar frame found (${bars.status}px)`)
  // Navigation bar: either side of the gesture handle.
  if (bars.nav > 3) {
    const edge = img.height - bars.nav
    const cols = stripStep(img, { inside: edge + 2, outside: edge - 2, columns: [0.06, 0.2, 0.8, 0.94] })
    const worst = Math.max(...cols.map((c) => c.step))
    check(worst <= MAX_STEP, `${label}: page drawn under the navigation bar (pixels)`, `largest colour step at the bar edge y=${edge} is ${worst} (limit ${MAX_STEP}); ${cols.map((c) => `x=${c.x} ${c.inside} inside / ${c.outside} above`).join('; ')}`)
  } else check(false, `${label}: page drawn under the navigation bar (pixels)`, `no navigation bar frame found (${bars.nav}px)`)
}

// ------------------------------------------------------------------ in the page

/** Layout numbers the page is using, in CSS pixels. */
function pageMetrics() {
  const probe = (value) => {
    const el = document.createElement('div')
    el.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:${value}`
    document.body.append(el)
    const h = el.getBoundingClientRect().height
    el.remove()
    return h
  }
  const corner = document.elementFromPoint(1, 1)
  const rect = corner?.getBoundingClientRect()
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    insetTop: probe('var(--inset-top)'),
    insetBottom: probe('var(--inset-bottom)'),
    envTop: probe('env(safe-area-inset-top, 0px)'),
    envBottom: probe('env(safe-area-inset-bottom, 0px)'),
    nativeTop: document.documentElement.style.getPropertyValue('--safe-area-inset-top'),
    nativeBottom: document.documentElement.style.getPropertyValue('--safe-area-inset-bottom'),
    corner: corner ? `${corner.tagName.toLowerCase()}${corner.className && typeof corner.className === 'string' ? `.${corner.className.trim().split(/\s+/).join('.')}` : ''}` : 'none',
    cornerTop: rect ? rect.top : null,
    cornerLeft: rect ? rect.left : null,
    topInsetAttr: document.documentElement.hasAttribute('data-top-inset'),
    under: document.documentElement.dataset.under ?? '',
    statusIcons: document.documentElement.dataset.statusIcons ?? '',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

async function edgeChecks(page, label, expectIcons) {
  await sleep(800)
  const m = await page.evaluate(pageMetrics)
  const { w, h } = screenSize()
  const bars = systemBars(label)
  const png = screenshot(label)
  const cssW = w / m.dpr
  const cssH = h / m.dpr
  check(Math.abs(m.innerWidth - cssW) <= 2 && Math.abs(m.innerHeight - cssH) <= 2, `${label}: WebView covers the whole window`, `window.innerWidth x innerHeight = ${m.innerWidth}x${m.innerHeight} CSS px; screen ${w}x${h} px / dpr ${m.dpr} = ${r1(cssW)}x${r1(cssH)}`)
  const sb = bars.status / m.dpr
  const nb = bars.nav / m.dpr
  check(m.insetTop > 0 && Math.abs(m.insetTop - sb) <= 2, `${label}: top inset matches the status bar`, `--inset-top ${r1(m.insetTop)} CSS px; status bar ${bars.status} px = ${r1(sb)} CSS px (native --safe-area-inset-top "${m.nativeTop}", WebView env() ${r1(m.envTop)})`)
  check(m.insetBottom > 0 && Math.abs(m.insetBottom - nb) <= 2, `${label}: bottom inset matches the navigation bar`, `--inset-bottom ${r1(m.insetBottom)} CSS px; navigation bar ${bars.nav} px = ${r1(nb)} CSS px (native --safe-area-inset-bottom "${m.nativeBottom}", WebView env() ${r1(m.envBottom)})`)
  check(m.cornerTop !== null && m.cornerTop <= 0 && m.cornerLeft <= 0, `${label}: the page is at the very top-left`, `elementFromPoint(1,1) = ${m.corner}, its box starts at (${r1(m.cornerLeft)}, ${r1(m.cornerTop)})`)
  check(m.topInsetAttr, `${label}: status area active`, `html[data-top-inset] ${m.topInsetAttr ? 'set' : 'missing'}`)
  pixelChecks(label, png, bars)
  if (expectIcons) iconChecks(label, m, expectIcons)
  return m
}

function iconChecks(label, m, expect) {
  const wm = statusIconsFromWindowManager(label)
  check(wm.icons === expect, `${label}: status bar icons ${expect}`, `window manager: ${wm.icons} icons (${wm.evidence}); app asked for ${m.statusIcons || 'nothing yet'}`)
}

// ------------------------------------------------------------------ connection

async function connect() {
  const { _android } = await import('playwright')
  const devices = await _android.devices({ omitDriverInstall: true })
  if (devices.length === 0) throw new Error('no adb device')
  const device = devices[0]
  const webView = await device.webView({ pkg: PKG }, { timeout: 120_000 })
  const page = await webView.page()
  return { device, page }
}

// ------------------------------------------------------------------ phases

function logoSample() {
  const svg = document.querySelector('.step-screen__top .logo > svg') ?? document.querySelector('.logo > svg')
  if (!svg) return null
  const r = svg.getBoundingClientRect()
  const header = document.querySelector('.step-screen__top')?.getBoundingClientRect()
  const logo = svg.parentElement
  return {
    t: performance.now(),
    w: r.width,
    x: r.left,
    y: r.top,
    cy: r.top + r.height / 2,
    rest: Number(svg.getAttribute('width')) || r.width,
    phase: logo?.getAttribute('data-intro') ?? 'rest',
    splash: document.documentElement.hasAttribute('data-splash'),
    headerTop: header ? header.top : null,
    headerBottom: header ? header.bottom : null,
  }
}

/** Samples the logo until it has been at rest for a while after the intro, or until the deadline. */
async function sampleIntro(page, deadlineMs) {
  const start = Date.now()
  const samples = []
  let restSince = 0
  while (Date.now() - start < deadlineMs) {
    let s = null
    try {
      s = await page.evaluate(logoSample)
    } catch {
      // Navigating (a reload): try again.
    }
    if (s) {
      s.at = Date.now() - start
      samples.push(s)
      const atRest = s.phase === 'rest' && s.w <= s.rest * 1.15 && !s.splash
      restSince = atRest ? restSince || s.at : 0
      const sawIntro = samples.some((x) => x.phase !== 'rest')
      // Done once at rest for 1.5 s after the intro, or for 8 s when no intro was seen.
      if (restSince && s.at - restSince >= (sawIntro ? 1500 : 8000)) break
    }
    await sleep(50)
  }
  return samples
}

function introReport(label, samples, launchedAt, required) {
  const last = samples.at(-1)
  const large = samples.filter((s) => s.phase === 'large' || s.w > s.rest * 1.5)
  const maxRatio = samples.reduce((m, s) => Math.max(m, s.w / s.rest), 0)
  if (!last) {
    check(false, `${label}: logo intro ends at rest`, 'the logo was never found in the page')
    return false
  }
  const inHeader = last.headerTop !== null && last.cy >= last.headerTop - 1 && last.cy <= last.headerBottom + 1
  const ok = last.phase === 'rest' && last.w <= last.rest * 1.15 && inHeader
  const firstRest = samples.findIndex((s, i) => i > 0 && s.phase === 'rest' && samples[i - 1].phase !== 'rest')
  const landedAt = firstRest > 0 ? `${samples[firstRest].at} ms after attaching` : 'n/a'
  const detail = `${samples.length} samples over ${last.at} ms (attached ${launchedAt} ms after launch); final glyph ${r1(last.w)} px wide (rest size ${last.rest}) at (${r1(last.x)}, ${r1(last.y)}), header ${r1(last.headerTop)}..${r1(last.headerBottom)}; phase ${last.phase}; landed ${landedAt}`
  if (required) check(ok, `${label}: logo intro ends small in its header`, detail)
  else record(ok ? 'INFO' : 'FAIL', `${label}: logo intro ends small in its header`, detail)
  record('INFO', `${label}: large phase observed`, large.length > 0 ? `yes, ${large.length} samples, up to ${r1(maxRatio)}x the rest size` : `no (largest ${r1(maxRatio)}x the rest size)`)
  return large.length > 0
}

async function launch() {
  adb('shell', 'am', 'force-stop', PKG)
  const t0 = Date.now()
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`)
  const { device, page } = await connect()
  const attachedAfter = Date.now() - t0
  try {
    const motion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    const scales = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'].map((k) => `${k}=${adb('shell', 'settings', 'get', 'global', k).trim()}`).join(', ')
    record('INFO', 'reduced motion in the WebView', `matchMedia('(prefers-reduced-motion: reduce)').matches = ${motion}; ${scales}`)
    const samples = await sampleIntro(page, 20_000)
    writeFileSync(join(out, 'logo-samples.json'), JSON.stringify(samples, null, 1))
    screenshot('logo')
    const seen = introReport('launch', samples, attachedAfter, true)
    if (!seen) {
      // Attached too late to see it: play it once more (the intro plays once per device) and watch from the reload.
      await page.evaluate(() => {
        localStorage.removeItem('hippo:logoIntro')
        location.reload()
      })
      const again = await sampleIntro(page, 20_000)
      writeFileSync(join(out, 'logo-samples-replay.json'), JSON.stringify(again, null, 1))
      introReport('replay after reload', again, 0, false)
    }
    screenshot('logo-at-rest')
    await edgeChecks(page, 'setup', 'light')
  } finally {
    await device.close()
  }
}

async function keyboard() {
  const { device, page } = await connect()
  try {
    adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
    const field = await page.evaluate(() => {
      const el = document.querySelector('.step-screen input')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: window.devicePixelRatio, h: window.innerHeight }
    })
    if (!field) {
      check(false, 'keyboard', 'no field on the name step')
      return
    }
    adb('shell', 'input', 'tap', String(Math.round(field.x * field.dpr)), String(Math.round(field.y * field.dpr)))
    let shown = false
    for (let i = 0; i < 40 && !shown; i++) {
      await sleep(250)
      shown = imeShown() && (await page.evaluate(() => window.innerHeight)) < field.h - 50
    }
    if (!shown) {
      record('INFO', 'keyboard', `the on-screen keyboard did not open within 10 s (shown: ${imeShown()}); not measured`)
      screenshot('keyboard-not-shown')
      return
    }
    await sleep(800)
    const { h } = screenSize()
    const bars = systemBars('keyboard')
    const m = await page.evaluate(() => {
      const input = document.activeElement
      const ir = input?.getBoundingClientRect()
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;top:0;height:var(--inset-bottom);width:0;visibility:hidden'
      document.body.append(probe)
      const insetBottom = probe.getBoundingClientRect().height
      probe.remove()
      return { innerHeight: window.innerHeight, dpr: window.devicePixelRatio, focused: input?.tagName ?? '', inputBottom: ir ? ir.bottom : null, insetBottom }
    })
    screenshot('keyboard')
    const keyboardTop = (h - bars.ime) / m.dpr
    check(bars.ime > 0 && Math.abs(m.innerHeight - keyboardTop) <= 3, 'keyboard: the WebView ends at the top of the keyboard', `innerHeight ${m.innerHeight} CSS px; keyboard ${bars.ime} px tall, its top at ${r1(keyboardTop)} CSS px`)
    check(m.focused === 'INPUT' && m.inputBottom !== null && m.inputBottom <= m.innerHeight, 'keyboard: the focused field is above the keyboard', `focused ${m.focused}, its bottom at ${r1(m.inputBottom)} of ${m.innerHeight}`)
    check(m.insetBottom <= 1, 'keyboard: no navigation bar inset left while the keyboard covers it', `--inset-bottom ${r1(m.insetBottom)} CSS px`)
    const actions = await page.evaluate(() => {
      window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0)
      const r = document.querySelector('.step-screen__actions')?.getBoundingClientRect()
      return r ? { top: r.top, bottom: r.bottom, innerHeight: window.innerHeight } : null
    })
    await sleep(300)
    screenshot('keyboard-actions')
    check(actions !== null && actions.bottom <= actions.innerHeight + 0.5, 'keyboard: the setup actions can be reached above the keyboard', actions ? `actions ${r1(actions.top)}..${r1(actions.bottom)} within ${actions.innerHeight}` : 'no actions row')
    // Close the keyboard: the insets come back.
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    let closed = false
    for (let i = 0; i < 40 && !closed; i++) {
      await sleep(250)
      closed = !imeShown() && (await page.evaluate(() => window.innerHeight)) >= field.h - 1
    }
    await sleep(500)
    const after = await page.evaluate(pageMetrics)
    const nb = systemBars('keyboard-closed').nav / after.dpr
    check(closed && Math.abs(after.insetBottom - nb) <= 2, 'keyboard: closed again, the full window and bottom inset return', `innerHeight ${after.innerHeight}, --inset-bottom ${r1(after.insetBottom)} CSS px (navigation bar ${r1(nb)})`)
    screenshot('keyboard-closed')
  } finally {
    await device.close()
  }
}

async function home() {
  const { device, page } = await connect()
  try {
    // Leave setup: back to its first step, then Skip setup.
    let left = false
    for (let i = 0; i < 8 && !left; i++) {
      const skip = page.getByRole('button', { name: 'Skip setup' })
      if (await skip.isVisible().catch(() => false)) {
        await skip.click()
        left = true
      } else {
        await page.evaluate(() => history.back())
        await sleep(1000)
      }
    }
    await page.waitForSelector('.screen:not(.screen--contained) .screen__sheet', { timeout: 15_000 })
    await sleep(1200)
    await page.evaluate(() => window.scrollTo(0, 0))
    const top = await edgeChecks(page, 'home', 'light')

    // The floating navigation: inside the screen's width and above the navigation bar.
    const nav = await page.evaluate(() => {
      const r = document.querySelector('.bottom-nav')?.getBoundingClientRect()
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;top:0;height:var(--inset-bottom);width:0;visibility:hidden'
      document.body.append(probe)
      const insetBottom = probe.getBoundingClientRect().height
      probe.remove()
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, innerWidth: window.innerWidth, innerHeight: window.innerHeight, insetBottom } : null
    })
    check(
      nav !== null && nav.left >= 0 && nav.right <= nav.innerWidth && nav.bottom <= nav.innerHeight - nav.insetBottom,
      'home: floating navigation inside the screen and above the navigation bar',
      nav ? `nav ${r1(nav.left)}..${r1(nav.right)} of ${nav.innerWidth} wide, bottom ${r1(nav.bottom)}; navigation bar starts at ${r1(nav.innerHeight - nav.insetBottom)}` : 'no .bottom-nav',
    )

    // Scroll the light sheet up under the status bar. A first-run Home can be too short to scroll
    // that far on a small screen; then a blank block is added at the end of the sheet for this
    // check only (reported), so the real scroll, fade and icon switch can still be measured.
    const scroll = await page.evaluate(() => {
      const sheet = document.querySelector('.screen:not(.screen--contained) > .screen__body .screen__sheet')
      const want = sheet ? sheet.getBoundingClientRect().top + window.scrollY + 40 : 0
      const room = () => (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight
      let spacer = 0
      if (sheet && room() < want) {
        spacer = Math.ceil(want - room() + 80)
        const block = document.createElement('div')
        block.setAttribute('aria-hidden', 'true')
        block.style.height = `${spacer}px`
        sheet.append(block)
      }
      window.scrollTo(0, want)
      return { want, max: room(), at: window.scrollY, spacer }
    })
    if (scroll.spacer) record('INFO', 'home scrolled', `the first-run Home was too short to scroll the sheet under the status bar; a ${scroll.spacer} px blank block was added to the sheet for this check`)
    let under = ''
    for (let i = 0; i < 30 && under !== 'sheet'; i++) {
      await sleep(100)
      under = await page.evaluate(() => document.documentElement.dataset.under ?? '')
    }
    await sleep(700)
    const fade = await page.evaluate(() => {
      const before = getComputedStyle(document.body, '::before')
      const after = getComputedStyle(document.body, '::after')
      const sheetTop = document.querySelector('.screen:not(.screen--contained) > .screen__body .screen__sheet')?.getBoundingClientRect().top ?? null
      return {
        under: document.documentElement.dataset.under ?? '',
        sheetTop,
        beforePosition: before.position,
        beforeHeight: before.height,
        beforeBackdrop: before.backdropFilter || before.getPropertyValue('-webkit-backdrop-filter'),
        beforeMask: before.maskImage || before.getPropertyValue('-webkit-mask-image'),
        beforeZ: before.zIndex,
        afterOpacity: after.opacity,
        afterBackground: after.backgroundColor,
        pointer: before.pointerEvents,
        statusIcons: document.documentElement.dataset.statusIcons ?? '',
      }
    })
    screenshot('home-scrolled')
    check(fade.under === 'sheet', 'home scrolled: the sheet is under the status bar', `scrolled to ${r1(scroll.at)} of ${r1(scroll.max)} (wanted ${r1(scroll.want)}); sheet top ${r1(fade.sheetTop)}; html[data-under]="${fade.under}"`)
    const fadeHeight = parseFloat(fade.beforeHeight)
    check(
      fade.beforePosition === 'fixed' && /blur\(/.test(fade.beforeBackdrop) && /gradient/.test(fade.beforeMask) && fadeHeight > top.insetTop && fade.pointer === 'none' && Number(fade.afterOpacity) > 0.95,
      'home scrolled: fade layer over the status bar',
      `body::before ${fade.beforePosition}, height ${fade.beforeHeight} (inset ${r1(top.insetTop)}), backdrop-filter ${fade.beforeBackdrop}, mask ${fade.beforeMask.slice(0, 60)}, z-index ${fade.beforeZ}, pointer-events ${fade.pointer}; body::after (sheet tint ${fade.afterBackground}) opacity ${fade.afterOpacity}`,
    )
    const m = await page.evaluate(pageMetrics)
    iconChecks('home scrolled', m, 'dark')
    // And back: light icons over the hero again.
    await page.evaluate(() => window.scrollTo(0, 0))
    await sleep(1000)
    const back = await page.evaluate(pageMetrics)
    iconChecks('home back at the top', back, 'light')
    screenshot('home-back-at-top')
  } finally {
    await device.close()
  }
}

// A local check of the pixel analysis on saved screenshots: node scripts/android-webview-checks.mjs pixels <out> <png> <statusPx> <navPx>
async function pixels() {
  const { readFileSync } = await import('node:fs')
  const [file, status, nav] = process.argv.slice(4)
  pixelChecks(file, readFileSync(file), { status: Number(status), nav: Number(nav) })
}

const phases = { launch, keyboard, home, pixels }
if (!phases[phase]) {
  console.error(`Unknown phase "${phase}". Use one of: ${Object.keys(phases).join(', ')}`)
  process.exit(2)
}
try {
  await phases[phase]()
} catch (error) {
  record('FAIL', `${phase}`, `the check could not run: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  try {
    screenshot(`${phase}-error`)
  } catch {
    // No screenshot either.
  }
}
process.exit(failed ? 1 : 0)
