// Final review fixes that need the real built app: silent sync servers, focus after sharing,
// 200% text size, and the first paint of a first visit.

import assert from 'node:assert/strict'
import { addItem, assertNoProblems, card, newUser, skipSetup } from './flows.test.mjs'
import { need, test } from './harness.mjs'

test('fixes: a first visit paints the setup background before anything renders, with a render-blocking entry', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'fx-first', state)
  // Record, when React first puts anything on the page, whether the boot state was already set.
  await u.context.addInitScript(() => {
    const seen = []
    window.__firstRender = seen
    new MutationObserver((_, obs) => {
      const root = document.getElementById('root')
      if (root && root.childElementCount > 0) {
        seen.push(document.documentElement.dataset.boot ?? 'none')
        obs.disconnect()
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const html = await (await fetch(baseUrl)).text()
  assert.match(html, /<script type="module" crossorigin blocking="render" src=/)
  await u.page.goto(baseUrl)
  await u.page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
  assert.deepEqual(await u.page.evaluate(() => window.__firstRender), ['setup'])
  // Once setup shows, the page background is normal again.
  await u.page.waitForFunction(() => document.documentElement.dataset.boot === undefined)
  await skipSetup(u.page)
  // A returning visit has the hint: no boot state at all.
  await u.page.reload()
  await u.page.getByRole('heading', { name: /Get set up/ }).waitFor()
  assert.deepEqual(await u.page.evaluate(() => window.__firstRender), ['none'])
  assertNoProblems(u.problems)
  state.fx = { owner: u }
})

test('fixes: after "Share list" with the keyboard, focus is on Copy link and the result is announced', async ({ baseUrl, state }) => {
  const { page, problems } = need(state, 'fx.owner', 'fixes: a first visit paints the setup background')
  await addItem(page, baseUrl, { title: 'Focus kettle' })
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Focus list')
  await page.getByRole('checkbox', { name: 'Focus kettle' }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent?.includes('Copy link'))
  const trail = []
  for (let i = 0; i < 10; i++) {
    trail.push(await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.textContent?.slice(0, 20)}`))
    await page.waitForTimeout(100)
  }
  assert.ok(trail.every((t) => t.includes('Copy link')), trail.join(' | '))
  await page.getByRole('status').filter({ hasText: 'Your list is shared.' }).first().waitFor()
  state.fx.link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  assertNoProblems(problems)
})

test('fixes: when the sync servers accept the connection but never answer, a giver is told so and can try again', async ({ browser, relay, state }) => {
  const g = await newUser(browser, relay, 'fx-silent', state)
  relay.silence()
  try {
    await g.page.goto(need(state, 'fx.link', 'fixes: after "Share list" with the keyboard'))
    await g.page.getByText('Hippo cannot reach its sync servers').waitFor({ timeout: 20_000 })
    assert.equal(await g.page.getByText('We could not find this list.').count(), 0)
    assert.equal(await g.page.getByText('You are offline').count(), 0)
  } finally {
    relay.speak()
  }
  await g.page.getByRole('button', { name: 'Try again' }).click()
  await card(g.page, 'Focus kettle').waitFor()
  assertNoProblems(g.problems)
  await g.context.close()
})

test('fixes: at 200% text size the main screens keep everything readable, with no sideways scrolling', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'fx-zoom', state)
  const { page } = u
  await page.setViewportSize({ width: 320, height: 800 })
  const big = () => page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
  const noSideScroll = async (where) => {
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    assert.ok(sw <= w, `${where}: page is ${sw}px wide in a ${w}px window`)
  }
  await page.goto(baseUrl)
  await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
  await big()
  await noSideScroll('setup')
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await page.getByRole('heading', { name: /Get set up/ }).waitFor()
  await noSideScroll('home')
  // The bottom navigation fits.
  const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox()
  assert.ok(nav && nav.x >= 0 && nav.x + nav.width <= 320, 'bottom navigation fits at 320px')
  await page.goto(baseUrl + '#/item/new')
  await page.getByRole('heading', { level: 1, name: 'Add a wish' }).waitFor()
  await noSideScroll('wish editor')
  // The importance choices stack instead of overlapping.
  const boxes = await Promise.all(['Nice to have', 'Want', 'Would love'].map((n) => page.getByText(n, { exact: true }).boundingBox()))
  assert.ok(boxes[0] && boxes[1] && boxes[2] && boxes[0].y + boxes[0].height <= boxes[1].y + 1 && boxes[1].y + boxes[1].height <= boxes[2].y + 1, 'importance options stack')
  // The giver view and its name chip: the label wraps instead of being cut off.
  await page.goto(need(state, 'fx.link', 'fixes: after "Share list" with the keyboard'))
  await page.getByRole('heading', { level: 1, name: 'Focus list' }).waitFor()
  await noSideScroll('giver view')
  const chip = page.getByRole('button', { name: /^Add your name/ })
  assert.equal(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
  assertNoProblems(u.problems)
  await u.context.close()
})
