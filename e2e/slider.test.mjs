// The setup slide control with real touch input in a mobile context (website and app builds),
// "I already use Hippo" with a backup file, and moving to another device with a transfer link.
// Runs after onboarding.test.mjs (it uses state.o.link, a shared list, for the giver check).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { animationsDone, test, transitionDone } from './harness.mjs'
import { assertNoProblems, newUser } from './flows.test.mjs'
import { serveNativeBuild } from './native.test.mjs'
import { encodeTransferPayload } from '../src/core/protocol/transfer.ts'
import { generateSigningKey, publicKeyOf } from '../src/core/crypto/keys.ts'
import { parseShareLink } from '../src/core/crypto/link.ts'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')
const h1 = (page, name) => page.getByRole('heading', { level: 1, name })
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

async function axe(page, label) {
  await animationsDone(page)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** A phone: touch, mobile viewport, Android user agent. `app` adds the Capacitor global, as inside the APK. */
async function phone(browser, relay, name, state, { size = { width: 412, height: 915 }, app = false } = {}) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: true, userAgent: ANDROID_UA })
  await context.addInitScript((url) => {
    try {
      sessionStorage.setItem('hippo:relays', url)
    } catch {
      // no storage here
    }
  }, relay.url)
  if (app) await context.addInitScript(() => (window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }))
  const problems = []
  state.problems ??= []
  state.problems.push(problems)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[${name}] console error: ${m.text()}`)
  })
  return { context, page, problems, cdp: await context.newCDPSession(page) }
}

/** A finger drag through CDP touch events (what Android sends), from one point to another. */
async function touchDrag(page, cdp, from, to, steps = 14) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function control(page, name) {
  const btn = page.getByRole('button', { name, exact: true })
  const box = await btn.boundingBox()
  assert.ok(box, `${name} is on screen`)
  return { btn, box, knob: { x: box.x + 4 + 24, y: box.y + box.height / 2 }, end: { x: box.x + box.width - 20, y: box.y + box.height / 2 } }
}

async function sliderChecks(browser, relay, state, baseUrl, label, app) {
  for (const size of [
    { width: 412, height: 915 },
    { width: 360, height: 740 },
  ]) {
    // Tap during the logo intro.
    let u = await phone(browser, relay, `${label}-tap-${size.width}`, state, { size, app })
    await u.page.goto(baseUrl)
    await h1(u.page, /Make a wishlist/).waitFor()
    // In the app the intro waits for the splash screen to go, which can be after the first step shows.
    await u.page.locator('.logo[data-intro]').waitFor()
    let c = await control(u.page, 'Get started')
    await u.page.touchscreen.tap(c.box.x + c.box.width / 2, c.box.y + c.box.height / 2)
    await h1(u.page, /call you/).waitFor({ timeout: 3000 })
    // A later step: no slide control there, an ordinary button. A tap on Continue, then Back, Skip
    // and an occasion with touch.
    await transitionDone(u.page)
    assert.equal(await u.page.locator('.slide-btn').count(), 0, 'only the first step has the slide control')
    c = await control(u.page, 'Continue')
    await u.page.touchscreen.tap(c.box.x + c.box.width / 2, c.box.y + c.box.height / 2)
    await h1(u.page, /the occasion/).waitFor({ timeout: 3000 })
    await transitionDone(u.page)
    const choice = await u.page.locator('.setup-choice', { hasText: 'Birthday' }).boundingBox()
    await u.page.touchscreen.tap(choice.x + choice.width / 2, choice.y + choice.height / 2)
    assert.equal(await u.page.getByRole('radio', { name: 'Birthday' }).isChecked(), true)
    const back = await u.page.getByRole('button', { name: 'Back', exact: true }).boundingBox()
    await u.page.touchscreen.tap(back.x + back.width / 2, back.y + back.height / 2)
    await h1(u.page, /call you/).waitFor({ timeout: 3000 })
    await transitionDone(u.page)
    const field = await u.page.getByRole('textbox', { name: 'Your name' }).boundingBox()
    await u.page.touchscreen.tap(field.x + 20, field.y + field.height / 2)
    assert.equal(await u.page.evaluate(() => document.activeElement?.getAttribute('autocomplete')), 'given-name')
    const skip = await u.page.getByRole('button', { name: 'Skip', exact: true }).boundingBox()
    await u.page.touchscreen.tap(skip.x + skip.width / 2, skip.y + skip.height / 2)
    await h1(u.page, /the occasion/).waitFor({ timeout: 3000 })
    await transitionDone(u.page)
    const close = await u.page.getByRole('button', { name: 'Close setup' }).boundingBox()
    await u.page.touchscreen.tap(close.x + close.width / 2, close.y + close.height / 2)
    await u.page.waitForURL(/#\/$/)
    assertNoProblems(u.problems)
    await u.context.close()

    // Drag during the intro, a short drag that springs back, and a drag after the intro.
    u = await phone(browser, relay, `${label}-drag-${size.width}`, state, { size, app })
    await u.page.goto(baseUrl)
    await h1(u.page, /Make a wishlist/).waitFor()
    c = await control(u.page, 'Get started')
    await touchDrag(u.page, u.cdp, c.knob, { x: c.knob.x + (c.end.x - c.knob.x) * 0.35, y: c.knob.y })
    await u.page.waitForTimeout(400)
    assert.ok(await h1(u.page, /Make a wishlist/).isVisible(), 'a short drag does not continue')
    assert.equal(await u.page.locator('.slide-btn__knob').evaluate((k) => k.style.transform), '')
    await touchDrag(u.page, u.cdp, c.knob, c.end)
    await h1(u.page, /call you/).waitFor({ timeout: 3000 })
    await transitionDone(u.page)
    await u.page.goBack()
    await h1(u.page, /Make a wishlist/).waitFor()
    await u.page.waitForTimeout(2500)
    assert.equal(await u.page.locator('.logo[data-intro]').count(), 0, 'the logo is at rest')
    c = await control(u.page, 'Get started')
    await touchDrag(u.page, u.cdp, c.knob, c.end)
    await h1(u.page, /call you/).waitFor({ timeout: 3000 })
    await transitionDone(u.page)
    // Exactly one step on: a drag never sends a second activation.
    await u.page.waitForTimeout(500)
    assert.ok(await h1(u.page, /call you/).isVisible())
    assertNoProblems(u.problems)
    await u.context.close()
  }
}

test('slide control: touch taps and drags work on the first setup step, later steps use a button, during and after the intro (website build)', async ({ browser, relay, baseUrl, state }) => {
  await sliderChecks(browser, relay, state, baseUrl, 'web', false)
})

test('slide control: touch taps and drags work in the app build with the app global', async ({ browser, relay, state }) => {
  const server = await serveNativeBuild()
  try {
    await sliderChecks(browser, relay, state, server.url, 'app', true)
    // "I already use Hippo" in the app also offers its own site; the site screen is the app's only.
    const u = await phone(browser, relay, 'app-existing', state, { app: true })
    await u.page.goto(server.url)
    await h1(u.page, /Make a wishlist/).waitFor()
    await u.page.getByRole('button', { name: 'I already use Hippo' }).click()
    await h1(u.page, /Hippo here/).waitFor()
    for (const name of [/From a backup file/, /From another device/, /Use my own Hippo site/]) await u.page.getByRole('button', { name }).waitFor()
    assert.deepEqual(await axe(u.page, 'existing (app)'), [])
    await u.page.getByRole('button', { name: /Use my own Hippo site/ }).click()
    await h1(u.page, 'Your Hippo site').waitFor()
    await u.page.getByTestId('site-host').getByText('example.org/hippo').waitFor()
    assert.deepEqual(await axe(u.page, 'site'), [])
    assertNoProblems(u.problems)
    await u.context.close()
  } finally {
    server.stop()
  }
})

test('setup: "I already use Hippo" brings wishes in from a backup file and lands on Home, not in setup', async ({ browser, relay, baseUrl, state }) => {
  // A backup made on another device.
  const src = await newUser(browser, relay, 'ex-src', state)
  await src.page.goto(baseUrl)
  await src.page.getByRole('button', { name: 'Skip setup' }).click()
  await src.page.waitForURL(/#\/$/)
  for (const title of ['Teapot', 'Bike bell']) {
    await src.page.goto(baseUrl + '#/item/new')
    await src.page.getByRole('textbox', { name: 'Name' }).fill(title)
    await src.page.getByRole('button', { name: 'Add to wishlist' }).click()
    await src.page.waitForURL(/#\/wishlist$/)
  }
  await src.page.goto(baseUrl + '#/settings')
  const [download] = await Promise.all([src.page.waitForEvent('download'), src.page.getByRole('button', { name: 'Export backup' }).click()])
  const file = { name: 'hippo-backup.json', mimeType: 'application/json', buffer: await readFile(await download.path()) }
  await src.context.close()

  const u = await phone(browser, relay, 'ex-new', state)
  await u.page.goto(baseUrl)
  await h1(u.page, /Make a wishlist/).waitFor()
  // One primary control, one quiet link for existing users, Skip setup.
  await u.page.getByRole('button', { name: 'I already use Hippo' }).click()
  await h1(u.page, /Hippo here/).waitFor()
  assert.equal(await u.page.getByRole('button', { name: /Use my own Hippo site/ }).count(), 0, 'the website has no site setting')
  assert.deepEqual(await axe(u.page, 'existing (web)'), [])
  await u.page.getByTestId('import-file').setInputFiles(file)
  const dialog = u.page.getByRole('dialog', { name: 'Import this backup?' })
  await dialog.getByText(/2 wishes/).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Replace everything' }).count(), 0)
  await dialog.getByRole('button', { name: 'Bring them in' }).click()
  await u.page.waitForURL(/#\/$/)
  await u.page.getByText('Imported 2 wishes.').waitFor()
  await u.page.reload()
  await u.page.waitForTimeout(500)
  assert.equal(await u.page.getByRole('button', { name: 'Get started' }).count(), 0, 'setup does not start again')
  await u.page.goto(baseUrl + '#/wishlist')
  await u.page.getByText('Teapot').waitFor()
  // No first list was made.
  assert.equal(JSON.parse(file.buffer.toString('utf8')).sharedLists.length, 0)
  await u.page.goto(baseUrl + '#/lists')
  await u.page.waitForTimeout(300)
  assert.equal(await u.page.locator('a[href^="#/list/"]:not([href="#/list/new"])').count(), 0)
  assertNoProblems(u.problems)
  await u.context.close()
})

test('transfer: moves wishes and a shared list to another browser, which can publish it again; the source sees "Moved"', async ({ browser, relay, baseUrl, state }) => {
  const src = await newUser(browser, relay, 'tr-src', state)
  const { page } = src
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await page.waitForURL(/#\/$/)
  await page.goto(baseUrl + '#/item/new')
  await page.getByRole('textbox', { name: 'Name' }).fill('Red wool scarf')
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await page.waitForURL(/#\/wishlist$/)
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Winter 2026')
  await page.getByRole('checkbox', { name: 'Red wool scarf' }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  await page.getByText('Saved to the sync server.').waitFor()
  const shareLink = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  const listUrl = page.url()
  const ownerPubkey = parseShareLink(shareLink).ownerPubkey

  await page.goto(baseUrl + '#/settings')
  await page.getByRole('link', { name: 'Move Hippo to another device' }).click()
  await h1(page, 'Move to another device').waitFor()
  await page.getByRole('button', { name: 'Make a transfer link' }).click()
  const linkField = page.getByTestId('transfer-link')
  await linkField.waitFor()
  const link = await linkField.inputValue()
  assert.match(link, /#\/t\/[A-Za-z0-9_-]{90,}$/)
  await page.getByText(/Works for 1[45] more minutes\./).waitFor()
  await page.getByText('Anyone who gets this link in the next 15 minutes can copy your wishlist and lists. Send it only to yourself.').waitFor()
  assert.deepEqual(await axe(page, 'move source'), [])
  // The secret never reaches a relay: only derived values do.
  const payload = link.split('#/t/')[1]
  assert.ok(!relay.events.some((e) => JSON.stringify(e).includes(payload)))

  const dst = await newUser(browser, relay, 'tr-dst', state)
  await dst.page.goto(link)
  // The payload leaves the address bar at once, and is never in the title.
  assert.equal(new URL(dst.page.url()).hash, '#/move/receive')
  assert.ok(!(await dst.page.title()).includes(payload.slice(0, 12)))
  await h1(dst.page, 'Receive from another device').waitFor()
  await dst.page.getByTestId('transfer-summary').getByText('1 wish and 1 list.').waitFor({ timeout: 15000 })
  assert.deepEqual(await axe(dst.page, 'receive'), [])
  await dst.page.getByRole('button', { name: 'Bring them in' }).click()
  await dst.page.waitForURL(/#\/$/)
  await dst.page.getByText(/1 wish and 1 list came in/).waitFor()
  await dst.page.goto(baseUrl + '#/wishlist')
  await dst.page.getByText('Red wool scarf').waitFor()

  // The source sees the move.
  await page.getByText(/^Moved\./).waitFor({ timeout: 15000 })

  // The receiving device holds working list keys: it changes the moved list, the change is signed
  // with the same owner key, and a giver with the original link sees it.
  const before = relay.events.filter((e) => e.pubkey === ownerPubkey).map((e) => e.id)
  await dst.page.goto(listUrl)
  await dst.page.getByRole('textbox', { name: 'List name' }).fill('Winter 2026, moved')
  await dst.page.getByRole('button', { name: 'Save details' }).click()
  const deadline = Date.now() + 15000
  while (!relay.events.some((e) => e.pubkey === ownerPubkey && !before.includes(e.id)) && Date.now() < deadline) await dst.page.waitForTimeout(200)
  assert.ok(relay.events.some((e) => e.pubkey === ownerPubkey && !before.includes(e.id)), 'the receiver republished with the moved owner key')
  const giver = await newUser(browser, relay, 'tr-giver', state)
  await giver.page.goto(shareLink)
  await h1(giver.page, 'Winter 2026, moved').waitFor({ timeout: 15000 })
  await giver.context.close()

  // A second use of the same link fails plainly.
  const third = await newUser(browser, relay, 'tr-third', state)
  await third.page.goto(link)
  await third.page.getByText('This link was already used to move Hippo to a device. Make a new one if you need it again.').waitFor()
  assertNoProblems(src.problems)
  assertNoProblems(dst.problems)
  assertNoProblems(third.problems)
  await Promise.all([src.context.close(), dst.context.close(), third.context.close()])
})

test('transfer: a cancelled link and an expired link are refused with their own message; pasted links work in Settings', async ({ browser, relay, baseUrl, state }) => {
  const src = await newUser(browser, relay, 'tc-src', state)
  await src.page.goto(baseUrl)
  await src.page.getByRole('button', { name: 'Skip setup' }).click()
  await src.page.waitForURL(/#\/$/)
  await src.page.goto(baseUrl + '#/move')
  await src.page.getByRole('button', { name: 'Make a transfer link' }).click()
  const link = await src.page.getByTestId('transfer-link').inputValue()
  await src.page.getByRole('button', { name: 'Cancel transfer' }).click()
  await src.page.getByText('Transfer cancelled. The link no longer works.').waitFor()

  const dst = await newUser(browser, relay, 'tc-dst', state)
  await dst.page.goto(baseUrl + '#/settings')
  await dst.page.getByRole('link', { name: 'Enter a transfer link' }).click()
  await h1(dst.page, 'Receive from another device').waitFor()
  await dst.page.getByRole('textbox', { name: 'Transfer link' }).fill(`Here it is: ${link}`)
  await dst.page.getByRole('button', { name: 'Open link' }).click()
  await dst.page.getByText('This transfer was cancelled on the other device.').waitFor()

  const expired = `${baseUrl}#/t/${encodeTransferPayload({ secret: '11'.repeat(32), pubkey: publicKeyOf(generateSigningKey()), expiresAt: Math.floor(Date.now() / 1000) - 60 })}`
  await dst.page.getByRole('textbox', { name: 'Transfer link' }).fill(expired)
  await dst.page.getByRole('button', { name: 'Open link' }).click()
  await dst.page.getByText('This link has expired. Make a new one on the other device.').waitFor()
  await dst.page.getByRole('textbox', { name: 'Transfer link' }).fill(`${baseUrl}#/t/Ag${'A'.repeat(100)}`)
  await dst.page.getByRole('button', { name: 'Open link' }).click()
  await dst.page.getByText('This link comes from a newer version of Hippo', { exact: false }).waitFor()
  assertNoProblems(src.problems)
  assertNoProblems(dst.problems)
  await Promise.all([src.context.close(), dst.context.close()])
})

test('a giver opening a shared list link sees no setup and no "I already use Hippo"', async ({ browser, relay, state }) => {
  assert.ok(state.o?.link, 'needs the shared list from onboarding.test.mjs')
  const u = await phone(browser, relay, 'giver-nosetup', state)
  await u.page.goto(state.o.link)
  await h1(u.page, 'Birthday 2027').waitFor()
  for (const text of ['I already use Hippo', 'Get started', 'Skip setup']) assert.equal(await u.page.getByText(text).count(), 0, text)
  assertNoProblems(u.problems)
  await u.context.close()
})
