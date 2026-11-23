// End-to-end runner: node e2e/run.mjs [name filter, a regular expression]
// Expects a production build in dist/ (`npm run test:e2e` builds first).

import { existsSync } from 'node:fs'
import { startMockRelay } from '../src/core/testing/mock-relay.ts'
import { freePort, loadPlaywright, ROOT, startPreview, tests } from './harness.mjs'
import './flows.test.mjs'
import './review.test.mjs'
import './onboarding.test.mjs'
import './install.test.mjs'
import './wire.test.mjs'
import './clock.test.mjs'
import './fixes.test.mjs'
import './native.test.mjs'

if (!existsSync(ROOT + 'dist/index.html')) {
  console.error('dist/ is missing: run `npm run build` first (npm run test:e2e does this).')
  process.exit(1)
}

const filter = process.argv[2]
const selected = filter ? tests.filter((t) => new RegExp(filter).test(t.name)) : tests
const { chromium } = loadPlaywright()

const relay = await startMockRelay(0)
const preview = await startPreview(await freePort())
const browser = await chromium.launch()
const state = {}

let failed = 0
const started = Date.now()
try {
  for (const t of selected) {
    const t0 = Date.now()
    try {
      await t.fn({ browser, relay, baseUrl: preview.url, state })
      console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`)
    } catch (e) {
      failed++
      console.log(`  FAIL ${t.name} (${Date.now() - t0} ms)`)
      console.log(String(e instanceof Error ? (e.stack ?? e.message) : e).replace(/^/gm, '       '))
    }
  }
} finally {
  await browser.close()
  preview.stop()
  await relay.close()
}

console.log(`\n${selected.length - failed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)} s)`)
process.exit(failed > 0 ? 1 : 0)
