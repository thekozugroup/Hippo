// Minimal end-to-end harness: a test registry, the mock relay (in process,
// so tests can inspect the filters it received), the built app served by
// `vite preview` under a sub-path, and Playwright's Chromium.
//
// `@playwright/test` is not installed, so tests are plain async functions
// using node:assert. `playwright` is resolved like `require` would (a global
// install works), falling back to `playwright-core`.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    return require('playwright-core')
  }
}

/** @type {{ name: string, fn: (ctx: any) => Promise<void> }[]} */
export const tests = []
export function test(name, fn) {
  tests.push({ name, fn })
}

/**
 * Reads state an earlier test made (`key` may be dotted, like 'fx.link'). When that test failed or
 * was filtered out, this fails at once and says what is missing, instead of a TypeError later.
 */
export function need(state, key, maker) {
  const value = key.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), state)
  if (value === undefined || value === null) throw new Error(`missing prerequisite: state.${key}, made by the test "${maker}", which failed or did not run`)
  return value
}

/**
 * Resolves once no route transition is playing (the app clears html[data-nav-dir] when the latest
 * one ends). While one plays, the browser hit-tests its snapshot: a tap is replayed on the real
 * control, but a drag that starts then has nothing to drag.
 */
export function transitionDone(page) {
  return page.waitForFunction(() => document.documentElement.dataset.navDir === undefined)
}

/**
 * Resolves once finite animations (a note rising in, a toast fading) have finished: axe measures
 * contrast on the frame it sees, and a half-faded line is not what people read.
 */
export function animationsDone(page) {
  return page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const SUBPATH = '/hippo/'

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Timing stress for finding races (never set in CI): every page the tests open gets
 *   HIPPO_E2E_CPU=<n>         CPU throttling by a factor of n (Chromium, through CDP),
 *   HIPPO_E2E_NET_MS=<ms>     that much extra latency on each of the page's own HTTP requests,
 * and HIPPO_E2E_RELAY_MS=<ms> (read in run.mjs) delays every mock relay answer by that much.
 */
export function stressFromEnv(env = process.env) {
  const num = (v) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
  return { cpu: num(env.HIPPO_E2E_CPU), netMs: num(env.HIPPO_E2E_NET_MS), relayMs: num(env.HIPPO_E2E_RELAY_MS) }
}

/** Applies `stressFromEnv` CPU and network settings to every page of every context `browser` makes. */
export function applyStress(browser, { cpu, netMs }) {
  if (!cpu && !netMs) return
  const slow = async (page) => {
    try {
      const cdp = await page.context().newCDPSession(page)
      if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
      if (netMs) {
        await cdp.send('Network.enable')
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: netMs, downloadThroughput: -1, uploadThroughput: -1 })
      }
    } catch {
      // A page that closed at once (a download) needs no throttling.
    }
  }
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => {
    const context = await newContext(...args)
    const newPage = context.newPage.bind(context)
    const done = new WeakSet()
    context.newPage = async () => {
      const page = await newPage()
      done.add(page)
      await slow(page)
      return page
    }
    context.on('page', (page) => {
      if (!done.has(page)) void slow(page)
    })
    return context
  }
}

/** Starts `vite preview` for dist/ under SUBPATH; resolves once it answers. */
export async function startPreview(port) {
  const child = spawn(process.execPath, [ROOT + 'node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--base', SUBPATH], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  process.once('exit', () => child.kill('SIGTERM'))
  const url = `http://127.0.0.1:${port}${SUBPATH}`
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return { url, stop: () => child.kill('SIGTERM') }
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`vite preview exited:\n${output}`)
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill('SIGTERM')
  throw new Error(`vite preview did not start:\n${output}`)
}
