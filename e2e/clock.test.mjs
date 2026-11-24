// Givers whose device clocks are wrong (one hour fast, one hour slow, one day fast), against the
// real built app: everyone agrees on who is getting what, and a wrong clock is mentioned once.
// The wrong clock is an injected Date override in that browser context only; performance.now and
// the server's Date header stay true, as on a real device whose clock was set wrong.

import assert from 'node:assert/strict'
import { addItem, assertNoProblems, card, newUser, skipSetup } from './flows.test.mjs'
import { test } from './harness.mjs'

const HOUR = 3600_000

async function skewedUser(browser, relay, name, state, offsetMs) {
  const u = await newUser(browser, relay, name, state)
  await u.context.addInitScript((off) => {
    const RealDate = Date
    function SkewedDate(...args) {
      if (!new.target) return new RealDate(RealDate.now() + off).toString()
      return args.length > 0 ? new RealDate(...args) : new RealDate(RealDate.now() + off)
    }
    SkewedDate.prototype = RealDate.prototype
    SkewedDate.now = () => RealDate.now() + off
    SkewedDate.parse = RealDate.parse
    SkewedDate.UTC = RealDate.UTC
    globalThis.Date = SkewedDate
  }, offsetMs)
  return u
}

const clockNote = (page) => page.getByRole('note', { name: 'Device clock' })
const taken = (page, title, who) => card(page, title).getByText(who === 'me' ? "You're getting this" : 'Someone is getting this')

test('clock: givers with clocks an hour fast, an hour slow and a day fast agree on who is getting what', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'clock-owner', state)
  const { page } = owner
  await page.goto(baseUrl)
  await skipSetup(page)
  await addItem(page, baseUrl, { title: 'Clock scarf' })
  await addItem(page, baseUrl, { title: 'Clock lamp' })
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Clock test')
  for (const t of ['Clock scarf', 'Clock lamp']) await page.getByRole('checkbox', { name: t }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()

  // An hour fast: told once, and its claim counts for everyone.
  const fast = await skewedUser(browser, relay, 'clock-fast', state, HOUR)
  await fast.page.goto(link)
  await fast.page.getByRole('heading', { level: 1, name: 'Clock test' }).waitFor()
  // Told on the screen, where it stays until dismissed (the toast that also says it is soon replaced).
  await clockNote(fast.page).getByText('The clock on this device is about 1 hour ahead.', { exact: false }).waitFor()
  assert.equal(await fast.page.evaluate(() => Math.round((Date.now() - performance.timeOrigin - performance.now()) / 60_000)), 60)
  await card(fast.page, 'Clock scarf').getByRole('button', { name: "I'll get this" }).click()
  await fast.page.getByRole('dialog', { name: 'Get this gift' }).getByRole('button', { name: "I'll get this" }).click()
  await fast.page.getByText('Thank you! Others now see that you are getting Clock scarf.').waitFor()
  await taken(fast.page, 'Clock scarf', 'me').waitFor()

  // An hour slow: sees the fast giver's claim (it is not dropped as dated in the future), and gets the lamp.
  const slow = await skewedUser(browser, relay, 'clock-slow', state, -HOUR)
  await slow.page.goto(link)
  await slow.page.getByRole('heading', { level: 1, name: 'Clock test' }).waitFor()
  await clockNote(slow.page).getByText('The clock on this device is about 1 hour behind.', { exact: false }).waitFor()
  await taken(slow.page, 'Clock scarf', 'someone').waitFor()
  await card(slow.page, 'Clock lamp').getByRole('button', { name: "I'll get this" }).click()
  await slow.page.getByRole('dialog', { name: 'Get this gift' }).getByRole('button', { name: "I'll get this" }).click()
  await slow.page.getByText('Thank you! Others now see that you are getting Clock lamp.').waitFor()

  // A day fast and a correct clock: the same picture everywhere.
  const dayFast = await skewedUser(browser, relay, 'clock-day', state, 24 * HOUR)
  await dayFast.page.goto(link)
  await dayFast.page.getByRole('heading', { level: 1, name: 'Clock test' }).waitFor()
  const right = await newUser(browser, relay, 'clock-right', state)
  await right.page.goto(link)
  await right.page.getByRole('heading', { level: 1, name: 'Clock test' }).waitFor()
  for (const p of [dayFast.page, right.page]) {
    await taken(p, 'Clock scarf', 'someone').waitFor()
    await taken(p, 'Clock lamp', 'someone').waitFor()
  }
  await taken(fast.page, 'Clock lamp', 'someone').waitFor()
  await taken(slow.page, 'Clock lamp', 'me').waitFor()
  // A correct clock is never mentioned.
  assert.equal(await right.page.getByText('The clock on this device', { exact: false }).count(), 0)

  for (const u of [owner, fast, slow, dayFast, right]) {
    assertNoProblems(u.problems)
    await u.context.close()
  }
})

test('link previews: the page carries a title, description and type for chat apps; absolute URLs only when the site address is known', async ({ baseUrl }) => {
  const html = await (await fetch(baseUrl)).text()
  const meta = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1]
  assert.equal(meta('property', 'og:title'), 'A gift list shared with you')
  assert.equal(meta('property', 'og:type'), 'website')
  assert.equal(meta('property', 'og:description'), meta('name', 'description'))
  const image = meta('property', 'og:image')
  if (process.env.HIPPO_SITE_URL) assert.match(image ?? '', /^https:\/\/.+\/og-image\.png$/)
  else assert.equal(image, undefined)
  const png = await fetch(new URL('og-image.png', baseUrl))
  assert.equal(png.status, 200)
  const bytes = new Uint8Array(await png.arrayBuffer())
  const view = new DataView(bytes.buffer)
  assert.deepEqual([view.getUint32(16), view.getUint32(20)], [1200, 630])
})
