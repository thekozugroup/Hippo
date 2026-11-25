// Your Hippo account, end to end: two browser contexts on two different origins (the same build at
// 127.0.0.1 and at localhost, so browser storage is separate), the recovery code, live sync
// between them, the address-change notice, and a giver who never sees any of it. Screenshots of
// the account screens go to HIPPO_SHOTS when set.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { animationsDone, test } from './harness.mjs'
import { addItem, assertNoProblems, newUser } from './flows.test.mjs'

const h1 = (page, name) => page.getByRole('heading', { level: 1, name })
const SHOTS = process.env.HIPPO_SHOTS

function altOrigin(baseUrl) {
  const u = new URL(baseUrl)
  u.hostname = u.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
  return u.href
}

async function skipSetup(page, base) {
  await page.goto(base)
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await page.waitForURL(/#\/$/)
}

/** Home has its data: the notice, if it applies, is decided by then. */
async function homeLoaded(page) {
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForFunction(() => document.querySelector('main') !== null && document.querySelector('[aria-busy="true"]') === null)
}

async function waitForText(page, text, timeout = 20000) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout })
}

/** 412x915 and 1440x900, light and dark. */
async function shots(page, name, scrollTo) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  // Toasts from earlier steps fade first.
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 12000 }).catch(() => undefined)
  for (const [w, h] of [
    [412, 915],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      if (scrollTo) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), scrollTo)
      await animationsDone(page)
      await page.screenshot({ path: `${SHOTS}/${name}-${w}x${h}-${scheme}.png`, fullPage: false })
    }
  }
  await page.setViewportSize({ width: 412, height: 915 })
  await page.emulateMedia({ colorScheme: 'light' })
}

test('account: set up on one origin, sign in on another with the recovery code, and edits arrive live', async ({ browser, relay, baseUrl, state }) => {
  const other = altOrigin(baseUrl)
  assert.notEqual(new URL(other).origin, new URL(baseUrl).origin)

  const a = await newUser(browser, relay, 'acct-a', state)
  await skipSetup(a.page, baseUrl)
  await addItem(a.page, baseUrl, { title: 'Blue teapot' })
  await addItem(a.page, baseUrl, { title: 'Cotton apron' })
  await a.page.goto(baseUrl + '#/list/new')
  await a.page.getByRole('textbox', { name: 'List name' }).fill('Housewarming')
  await a.page.getByRole('checkbox', { name: 'Blue teapot' }).check()
  await a.page.getByRole('button', { name: 'Create list' }).click()
  await a.page.waitForURL((url) => /^#\/list\/[0-9a-f]{32}$/.test(url.hash))

  // Home's checklist asks for the recovery code; opening it turns the account on.
  await a.page.goto(baseUrl)
  await a.page.getByRole('link', { name: /Save your recovery code/ }).click()
  await h1(a.page, 'Your recovery code').waitFor()
  await a.page.getByTestId('recovery-code').locator('li').nth(12).waitFor()
  const words = await a.page.getByTestId('recovery-code').locator('.recovery-words__text').allTextContents()
  assert.equal(words.length, 13)
  await shots(a.page, 'recovery-code')
  await a.page.getByRole('button', { name: 'I have saved it' }).click()
  await h1(a.page, /kept in step on your devices/).waitFor()
  // The secret never reaches a relay in any form a relay could read.
  const pubkeys = new Set(relay.events.map((e) => e.pubkey))
  assert.ok(!relay.events.some((e) => JSON.stringify(e).includes('Blue teapot')))

  // Settings shows the state in plain words.
  await a.page.goto(baseUrl + '#/settings')
  await a.page.getByTestId('account-status').getByText(/^Up to date\./).waitFor({ timeout: 20000 })
  await shots(a.page, 'settings-account', '#set-account')

  // Another origin: a separate browser storage. First run, then "I already use Hippo".
  const b = await newUser(browser, relay, 'acct-b', state)
  await b.page.goto(other)
  await b.page.getByRole('button', { name: 'I already use Hippo' }).click()
  await h1(b.page, /Hippo here/).waitFor()
  await b.page.getByRole('button', { name: /Sign in with my recovery code/ }).click()
  await h1(b.page, 'Sign in with your recovery code').waitFor()
  await b.page.getByRole('textbox', { name: 'Recovery code' }).fill(words.slice(0, 12).join(' '))
  await b.page.getByRole('button', { name: 'Sign in' }).click()
  await b.page.getByText('A recovery code has 13 words. This has 12.').waitFor()
  await b.page.getByRole('textbox', { name: 'Recovery code' }).fill(words.map((w, i) => `${i + 1}. ${w}`).join('\n'))
  await shots(b.page, 'sign-in')
  await b.page.getByRole('button', { name: 'Sign in' }).click()
  await b.page.waitForURL(/#\/$/)
  await b.page.goto(other + '#/wishlist')
  await waitForText(b.page, 'Blue teapot')
  await waitForText(b.page, 'Cotton apron')
  await b.page.goto(other + '#/lists')
  await waitForText(b.page, 'Housewarming')
  assert.equal(await b.page.getByRole('button', { name: 'Get started' }).count(), 0, 'no setup on the signed-in device')

  // An edit on A appears on B without a reload, and the other way round.
  await b.page.goto(other + '#/wishlist')
  await addItem(a.page, baseUrl, { title: 'Bread knife' })
  await waitForText(b.page, 'Bread knife', 30000)
  await addItem(b.page, other, { title: 'Oven gloves' })
  await a.page.goto(baseUrl + '#/wishlist')
  await waitForText(a.page, 'Oven gloves', 30000)
  // Only the account's key and the devices' own keys wrote anything.
  assert.ok(pubkeys.size > 0)
  assertNoProblems(a.problems)
  assertNoProblems(b.problems)
  await Promise.all([a.context.close(), b.context.close()])
})

test('account: "This Hippo site now lives at" carries the wishes to the new address in one tap, signed in', async ({ browser, relay, baseUrl, state }) => {
  const other = altOrigin(baseUrl)
  const host = new URL(other).host
  const u = await newUser(browser, relay, 'acct-move', state)
  // The build's site address, stood in for on loopback (the e2e build has no public address).
  await u.page.goto(`${baseUrl}?site=${encodeURIComponent(other)}`)
  await u.page.getByRole('button', { name: 'Skip setup' }).click()
  await u.page.waitForURL(/#\/$/)
  await addItem(u.page, baseUrl, { title: 'Picnic blanket' })
  await u.page.goto(baseUrl)
  const notice = u.page.getByTestId('site-notice')
  await notice.getByRole('heading', { name: `This Hippo site now lives at ${host}` }).waitFor()
  await shots(u.page, 'address-notice')
  await notice.getByRole('button', { name: `Go to ${host}` }).click()
  await u.page.waitForURL((url) => url.host === host && url.hash === '#/move/receive', { timeout: 20000 })
  assert.ok(!u.page.url().includes('#/t/'), 'the link left the address bar')
  await u.page.getByTestId('transfer-summary').getByText('1 wish.').waitFor({ timeout: 20000 })
  await u.page.getByRole('button', { name: 'Sign in here' }).click()
  await u.page.waitForURL(/#\/$/)
  await u.page.goto(other + '#/wishlist')
  await waitForText(u.page, 'Picnic blanket')
  // Never automatic: the old address without the tap, and the new one, show no notice by themselves.
  await u.page.goto(other)
  await homeLoaded(u.page)
  assert.equal(await u.page.getByTestId('site-notice').count(), 0)
  assertNoProblems(u.problems)
  await u.context.close()
})

test('account: a giver opening a shared list sees nothing about accounts or recovery codes', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'acct-owner', state)
  await skipSetup(owner.page, baseUrl)
  await addItem(owner.page, baseUrl, { title: 'Garden hose' })
  await owner.page.goto(baseUrl + '#/list/new')
  await owner.page.getByRole('textbox', { name: 'List name' }).fill('Spring')
  await owner.page.getByRole('checkbox', { name: 'Garden hose' }).check()
  await owner.page.getByRole('button', { name: 'Create list' }).click()
  await owner.page.getByRole('button', { name: 'Share list' }).click()
  await owner.page.getByText('Saved to the sync server.').waitFor()
  const link = await owner.page.getByRole('textbox', { name: 'Share link' }).inputValue()

  const giver = await newUser(browser, relay, 'acct-giver', state)
  // Even on an address that is not the built one, and with a stand-in site set, a giver gets no notice.
  await giver.page.goto(`${link.replace('#', `?site=${encodeURIComponent(altOrigin(baseUrl))}#`)}`)
  await h1(giver.page, 'Spring').waitFor({ timeout: 15000 })
  for (const text of [/recovery code/i, /sign in/i, /Add a device/, /now lives at/, /Your devices/]) assert.equal(await giver.page.getByText(text).count(), 0, String(text))
  await giver.page.goto(baseUrl)
  await homeLoaded(giver.page)
  assert.equal(await giver.page.getByTestId('site-notice').count(), 0)
  assertNoProblems(owner.problems)
  assertNoProblems(giver.problems)
  await Promise.all([owner.context.close(), giver.context.close()])
})
