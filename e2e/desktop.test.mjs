// Tablets and computers: the side navigation, the header band, grids, centred dialogs, keyboard
// use of the shell, resizing across size classes without losing input, scroll restored on Back,
// and axe on every screen at 1440 wide in both themes. Self-contained (its own profiles).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { animationsDone, need, test, transitionDone } from './harness.mjs'
import { assertNoProblems } from './flows.test.mjs'
import { deviceUser } from './install.test.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')
const h1 = (page, name) => page.getByRole('heading', { level: 1, name })
const card = (page, title) => page.getByRole('article', { name: title })
const sidebar = (page) => page.getByRole('navigation', { name: 'Main' })

async function axe(page, label) {
  await transitionDone(page)
  await animationsDone(page)
  // Content that arrived after that (cards, a lazy notice) may still be fading in.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity))
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

async function addWish(page, { title, price, contrib }) {
  await sidebar(page).getByRole('link', { name: 'Add a wish' }).click()
  await h1(page, 'Add a wish').waitFor()
  await page.getByRole('textbox', { name: 'Name' }).fill(title)
  if (price) await page.getByRole('textbox', { name: 'Price' }).fill(price)
  if (contrib) await page.getByRole('switch', { name: 'Let friends chip in' }).check()
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await page.waitForURL(/#\/wishlist$/)
}

test('desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'd-owner', 'computer', state)
  state.d = { owner: u }
  const { page } = u
  await page.goto(baseUrl)
  await h1(page, /Make a wishlist/).waitFor()
  assert.equal(await page.locator('.slide-btn').count(), 1)
  // No navigation during setup: it is its own composition, not a page with a sidebar.
  assert.equal(await sidebar(page).count(), 0)
  await page.getByRole('button', { name: 'Get started' }).click()
  await h1(page, /call you/).waitFor()
  assert.equal(await page.locator('.slide-btn').count(), 0)
  // Typing straight away, while the step is still arriving, is kept (the heading does not take focus
  // from the field), and Enter continues.
  await page.getByRole('textbox', { name: 'Your name' }).click()
  await page.keyboard.type('Maya')
  assert.equal(await page.getByRole('textbox', { name: 'Your name' }).inputValue(), 'Maya')
  // The question and its controls sit in one centred column at a reading measure.
  const form = await page.locator('.step-screen__form').boundingBox()
  assert.ok(form.width <= 41 * 16 && Math.abs(form.x + form.width / 2 - 720) < 4, `setup column ${JSON.stringify(form)}`)
  await page.keyboard.press('Enter')
  await h1(page, /Maya, what is/).waitFor()
  await page.getByRole('radio', { name: 'Christmas' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await h1(page, /one thing/).waitFor()
  await page.getByRole('button', { name: 'Skip' }).click()
  await h1(page, /from anywhere/).waitFor()
  await page.getByRole('button', { name: 'Finish' }).click()
  await page.waitForURL(/#\/$/)

  // Home: the sidebar instead of the bottom navigation; two columns.
  await page.getByRole('heading', { name: /Get set up/ }).waitFor()
  assert.equal(await page.locator('.bottom-nav').count(), 0)
  assert.equal(await sidebar(page).getByRole('link', { name: 'Home', exact: true }).getAttribute('aria-current'), 'page')
  await addWish(page, { title: 'Espresso machine', price: '249', contrib: true })
  await addWish(page, { title: 'Wool socks', price: '18' })
  await addWish(page, { title: 'Board game night', price: '45.50' })
  assert.equal(await sidebar(page).getByRole('link', { name: 'Wishlist' }).getAttribute('aria-current'), 'page')
  // Wishes flow into columns: two rows side by side.
  const rows = page.locator('.list-row')
  const [a, b] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()]
  assert.equal(Math.round(a.y), Math.round(b.y), 'wishes sit in columns')
  // A wish is a real link: it opens in a new tab with the same screen.
  const href = await page.getByRole('link', { name: /Espresso machine/ }).getAttribute('href')
  assert.match(href, /^#\/item\/[0-9a-f]+$/)
  const tab = await u.context.newPage()
  await tab.goto(baseUrl + href)
  await h1(tab, 'Edit wish').waitFor()
  await tab.close()

  await sidebar(page).getByRole('link', { name: 'Lists' }).click()
  await h1(page, 'Lists').waitFor()
  await page.getByRole('link', { name: /Christmas 2026/ }).click()
  await h1(page, 'Christmas 2026').waitFor()
  // A list's page is in the Lists area.
  assert.equal(await sidebar(page).getByRole('link', { name: 'Lists' }).getAttribute('aria-current'), 'page')
  for (const t of ['Espresso machine', 'Wool socks', 'Board game night']) {
    await page.getByRole('checkbox', { name: t }).click()
    await page.waitForFunction((n) => document.querySelectorAll('.list-picker input:checked').length >= n, 1)
  }
  await page.waitForFunction(() => document.querySelectorAll('.list-picker input:checked').length === 3)
  // Sharing and details beside the wish picker.
  const share = await page.getByRole('heading', { name: 'Sharing' }).boundingBox()
  const picker = await page.locator('.list-editor__wishes').boundingBox()
  assert.ok(picker.x > share.x + share.width, 'the picker is beside sharing')
  await page.getByRole('button', { name: 'Share list' }).click()
  state.d.link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  assertNoProblems(u.problems)
})

test('desktop giver: cards in a grid, "I\'ll get this" and chip in through centred dialogs that Escape closes', async ({ browser, relay, state }) => {
  const link = need(state, 'd.link', 'desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are')
  const g = await deviceUser(browser, relay, 'd-giver', 'computer', state)
  state.d.giver = g
  const { page } = g
  await page.goto(link)
  await h1(page, 'Christmas 2026').waitFor()
  await page.getByText('Maya’s list').waitFor()
  // No owner navigation for a giver.
  assert.equal(await sidebar(page).count(), 0)
  const boxes = await Promise.all(['Espresso machine', 'Wool socks', 'Board game night'].map(async (t) => card(page, t).boundingBox()))
  assert.equal(Math.round(boxes[0].y), Math.round(boxes[1].y), 'cards share a row')
  assert.equal(Math.round(boxes[0].height), Math.round(boxes[1].height), 'cards in a row share one height')
  // Nothing about installing or the app on a computer.
  assert.equal(await page.getByRole('link', { name: 'Open in the Hippo app' }).count(), 0)

  await card(page, 'Wool socks').getByRole('button', { name: "I'll get this" }).click()
  const dialog = page.getByRole('dialog', { name: 'Get this gift' })
  await dialog.waitFor()
  const d = await dialog.boundingBox()
  assert.ok(Math.abs(d.x + d.width / 2 - 720) < 4 && d.width <= 520 && d.y > 40, `centred dialog ${JSON.stringify(d)}`)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await card(page, 'Wool socks').getByRole('button', { name: "I'll get this" }).click()
  await dialog.getByRole('button', { name: "I'll get this" }).click()
  await card(page, 'Wool socks').getByText("You're getting this").waitFor()

  await card(page, 'Espresso machine').getByRole('button', { name: 'Chip in' }).click()
  const pledge = page.getByRole('dialog', { name: 'Chip in' })
  await pledge.getByRole('textbox', { name: 'Your amount' }).fill('50')
  await pledge.getByRole('button', { name: 'Chip in' }).click()
  await card(page, 'Espresso machine').getByText('You chipped in $50.00').waitFor()
  assertNoProblems(g.problems)
})

test('desktop: resizing across size classes keeps a half-filled form and an open dialog with what was typed', async ({ state }) => {
  const { page } = need(state, 'd.owner', 'desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are')
  await page.goto(page.url().split('#')[0] + '#/item/new')
  await h1(page, 'Add a wish').waitFor()
  // Typed at once on arrival, key by key: nothing is lost to the heading taking focus.
  await page.getByRole('textbox', { name: 'Name' }).pressSequentially('Half-typed wish')
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Half-typed wish')
  await page.getByRole('textbox', { name: 'Notes' }).fill('Size M, blue')
  for (const width of [390, 768, 1024, 2560, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction((w) => window.innerWidth === w && document.querySelectorAll('.side-nav').length === (w >= 720 ? 1 : 0), width)
    assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Half-typed wish', `name at ${width}`)
    assert.equal(await page.getByRole('textbox', { name: 'Notes' }).inputValue(), 'Size M, blue', `notes at ${width}`)
    assert.equal(await page.locator('.side-nav').count(), width >= 720 ? 1 : 0, `side navigation at ${width}`)
  }
  await page.getByRole('textbox', { name: 'Name' }).fill('')

  const g = need(state, 'd.giver', 'desktop giver: cards in a grid, "I\'ll get this" and chip in through centred dialogs that Escape closes').page
  await card(g, 'Board game night').getByRole('button', { name: "I'll get this" }).click()
  const dialog = g.getByRole('dialog', { name: 'Get this gift' })
  await dialog.waitFor()
  await card(g, 'Espresso machine').waitFor()
  for (const width of [390, 1920, 768, 1440]) {
    await g.setViewportSize({ width, height: 900 })
    await g.waitForFunction((w) => window.innerWidth === w, width)
    assert.ok(await dialog.isVisible(), `dialog still open at ${width}`)
  }
  await g.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
})

test('desktop: keyboard only: skip link, then the sidebar, then the content; Enter navigates and focus lands on the heading', async ({ baseUrl, state }) => {
  const { page } = need(state, 'd.owner', 'desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are')
  await page.goto(baseUrl + '#/wishlist')
  await page.reload()
  await h1(page, 'Wishlist').waitFor()
  await page.keyboard.press('Tab')
  const focused = () => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim())
  assert.equal(await focused(), 'Skip to content')
  // The skip link is visible while focused.
  const skip = await page.getByRole('link', { name: 'Skip to content' }).boundingBox()
  assert.ok(skip.y >= 0, 'skip link on screen when focused')
  const order = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    order.push(await focused())
  }
  assert.deepEqual(order, ['Hippo home', 'Add a wish', 'Home', 'Wishlist', 'Lists', 'Settings'])
  // A visible focus ring on the sidebar item.
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
  assert.notEqual(ring, 'none')
  await page.keyboard.press('Enter')
  await h1(page, 'Settings').waitFor()
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1')
  assert.equal(await sidebar(page).getByRole('link', { name: 'Settings' }).getAttribute('aria-current'), 'page')
  // The skip link takes focus past the sidebar into the content.
  await page.reload()
  await h1(page, 'Settings').waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await focused(), 'Skip to content')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'MAIN')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('main'))), true)
})

test('desktop: Back returns to where a long page was scrolled', async ({ baseUrl, state }) => {
  const { page } = need(state, 'd.owner', 'desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are')
  await page.setViewportSize({ width: 1440, height: 420 })
  await page.goto(baseUrl + '#/wishlist')
  await h1(page, 'Wishlist').waitFor()
  await sidebar(page).getByRole('link', { name: 'Settings' }).click()
  await h1(page, 'Settings').waitFor()
  const link = page.getByRole('link', { name: 'Add a device' })
  await link.waitFor()
  // Scrolled well down with the link still in view, then focused without scrolling.
  await link.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = r.top + window.scrollY
    window.scrollTo(0, Math.min(top - 8, Math.max(250, top + r.height - window.innerHeight + 8)))
    el.focus({ preventScroll: true })
  })
  // Read where the page is just before leaving (a click could scroll the link further into view).
  const y = await page.evaluate(() => window.scrollY)
  assert.ok(y > 200)
  await page.keyboard.press('Enter')
  await h1(page, 'Add a device').waitFor()
  assert.ok((await page.evaluate(() => window.scrollY)) < 5, 'a new screen starts at the top')
  await page.goBack()
  await h1(page, 'Settings').waitFor()
  await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 3, y)
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('desktop: axe on every screen at 1440 wide, light and dark (WCAG 2.2 AA)', async ({ baseUrl, state }) => {
  const { page } = need(state, 'd.owner', 'desktop owner: setup (slide only on step 1), wishes from the sidebar, a list made and shared, with the sidebar marking where you are')
  const giver = need(state, 'd.giver', 'desktop giver: cards in a grid, "I\'ll get this" and chip in through centred dialogs that Escape closes').page
  const listHref = await (async () => {
    await page.goto(baseUrl + '#/lists')
    return page.getByRole('link', { name: /Christmas 2026/ }).getAttribute('href')
  })()
  const routes = [
    ['#/', 'home'],
    ['#/wishlist', 'wishlist'],
    ['#/item/new', 'item editor'],
    ['#/lists', 'lists'],
    [listHref, 'list page'],
    ['#/list/new', 'new list'],
    ['#/settings', 'settings'],
    ['#/move', 'add a device'],
    ['#/move/receive', 'sign in with a link'],
    ['#/account/sign-in', 'sign in with a code'],
    ['#/account/code', 'recovery code'],
    ['#/existing', 'I already use Hippo'],
    ['#/nowhere', 'not found'],
  ]
  const violations = []
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await giver.emulateMedia({ colorScheme: scheme })
    for (const [route, label] of routes) {
      await page.goto(baseUrl + route)
      await page.getByRole('heading', { level: 1 }).waitFor()
      violations.push(...(await axe(page, `${label} (${scheme})`)))
    }
    await giver.reload()
    await card(giver, 'Wool socks').waitFor()
    violations.push(...(await axe(giver, `giver (${scheme})`)))
    await card(giver, 'Board game night').getByRole('button', { name: "I'll get this" }).click()
    await giver.getByRole('dialog', { name: 'Get this gift' }).waitFor()
    violations.push(...(await axe(giver, `claim dialog (${scheme})`)))
    await giver.keyboard.press('Escape')
  }
  await page.emulateMedia({ colorScheme: 'light' })
  assert.deepEqual(violations, [])
})

test('desktop cleanup', async ({ state }) => {
  for (const u of [state.d?.owner, state.d?.giver]) await u?.context.close()
})
