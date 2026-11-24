// The Android app's web build (vite --mode native) in Chromium. It is built
// here into node_modules/.tmp/e2e-native and served on its own port.
//
// 1. As a plain web page (no Capacitor bridge): it boots with no service
//    worker, no manifest, its own stricter content policy, and no console or
//    policy errors.
// 2. With Capacitor's global saying "native", as inside the app: the app-only
//    parts appear (no install step, "Open a list from a link", "Shop pages" in
//    Settings) and the website-only ones do not. Plugins are not there, so
//    this checks the web side only; the Android workflow runs the real APK.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { freePort, ROOT, test } from './harness.mjs'
import { assertNoProblems, newUser, skipSetup } from './flows.test.mjs'
import { encodeSharePayload } from '../src/core/crypto/link.ts'
import { generateListSecret, generateSigningKey, publicKeyOf } from '../src/core/crypto/keys.ts'

const OUT = 'node_modules/.tmp/e2e-native'
const SITE = 'https://example.org/hippo/'
const env = { ...process.env, HIPPO_SITE_URL: SITE }

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ROOT + 'node_modules/vite/bin/vite.js', ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`vite ${args[0]} failed:\n${output}`))))
  })
}

export async function serveNativeBuild() {
  await run(['build', '--mode', 'native', '--outDir', OUT, '--logLevel', 'warn'])
  const port = await freePort()
  const child = spawn(process.execPath, [ROOT + 'node_modules/vite/bin/vite.js', 'preview', '--mode', 'native', '--outDir', OUT, '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--base', '/app/'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}/app/`
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill('SIGTERM') }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill('SIGTERM')
  throw new Error('vite preview of the app build did not start')
}

/** Collects content policy violations the page reports (on top of the console checks in newUser). */
async function watchPolicy(context) {
  await context.addInitScript(() => {
    window.__violations = []
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
}

test('app build: boots in Chromium with no service worker, no manifest, its own policy, and no errors', async ({ browser, relay, state }) => {
  const server = await serveNativeBuild()
  state.nativeServer = server
  const user = await newUser(browser, relay, 'app-web', state)
  await watchPolicy(user.context)
  const { page } = user
  await page.goto(server.url)
  await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  assert.match(csp ?? '', /script-src 'self';/)
  assert.match(csp ?? '', /worker-src 'none'/)
  assert.match(csp ?? '', /manifest-src 'none'/)
  assert.doesNotMatch(csp ?? '', /microlink|unsafe-inline|unsafe-eval/)
  assert.equal(await page.locator('link[rel="manifest"]').count(), 0)
  assert.equal(await page.locator('meta[property="og:url"]').count(), 0)

  await skipSetup(page)
  await page.waitForTimeout(1500)
  const sw = await page.evaluate(async () => ({ controller: navigator.serviceWorker?.controller ?? null, registrations: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0 }))
  assert.deepEqual(sw, { controller: null, registrations: 0 })
  const swFile = await fetch(`${server.url}sw.js`)
  assert.ok(swFile.status !== 200 || !(await swFile.text()).includes('workbox'), 'the app build has no service worker file')
  // Opened as a web page, it is not the app: no app-only parts.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.native ?? null), null)
  assert.deepEqual(await page.evaluate(() => window.__violations), [])
  assertNoProblems(user.problems)
  await user.context.close()
})

test('app build: inside the app, setup has no install step and the app-only parts show', async ({ browser, relay, state }) => {
  const server = state.nativeServer
  try {
    const user = await newUser(browser, relay, 'app-native', state)
    await watchPolicy(user.context)
    // What the Android shell provides before the page's scripts run (Capacitor's bridge global).
    await user.context.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }
    })
    const { page } = user
    await page.goto(server.url)
    await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.dataset.native), 'android')
    // Setup is five steps, none of them about installing.
    assert.equal(await page.getByText('Step 1 of 5').count(), 1)
    await skipSetup(page)
    assert.equal(await page.getByText(/home screen/i).count(), 0)

    await page.goto(`${server.url}#/lists`)
    const field = page.getByRole('textbox', { name: 'Open a list from a link' })
    await field.fill('https://shop.example/scarf')
    await page.getByRole('button', { name: 'Open list' }).click()
    await page.getByText('This is not a Hippo list link. Paste the whole link you were sent.').first().waitFor()
    const payload = encodeSharePayload({ ownerPubkey: publicKeyOf(generateSigningKey()), listSecret: generateListSecret() })
    await field.fill(`Here is my list: ${SITE}#/l/${payload}`)
    await page.getByRole('button', { name: 'Open list' }).click()
    await page.waitForURL(/#\/(l|g)\//)

    await page.goto(`${server.url}#/settings`)
    await page.getByRole('heading', { level: 2, name: 'Shop pages' }).waitFor()
    await page.getByText('Hippo opens the shop page from your phone to read its name, picture and price; nothing is sent to anyone else.').waitFor()
    for (const gone of ['Install Hippo', 'Link lookup']) assert.equal(await page.getByRole('heading', { level: 2, name: gone }).count(), 0, gone)
    assert.equal(await page.getByText(/Bookmarklet/).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.__violations), [])
    assertNoProblems(user.problems)
    await user.context.close()
  } finally {
    server.stop()
  }
})
