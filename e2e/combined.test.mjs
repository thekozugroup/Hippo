// The adaptive layout and the Hippo account together: an account made on a computer and signed in
// on a phone, the account screens at 1440 wide and at 390 in both themes (axe, WCAG 2.2 AA), a
// giver on a computer who is never asked to install or to sign in, and Home's notices ranked so at
// most one leads. Self-contained (its own profiles).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { animationsDone, need, test, transitionDone } from './harness.mjs'
import { addItem, assertNoProblems, skipSetup } from './flows.test.mjs'
import { deviceUser } from './install.test.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')
const h1 = (page, name) => page.getByRole('heading', { level: 1, name })
const sidebar = (page) => page.getByRole('navigation', { name: 'Main' })
const MAKER = 'together: an account made on a computer at 1440 wide is signed in on a phone at 390 with the same wishes and list'

async function axe(page, label) {
  await transitionDone(page)
  // At the end of the page the sheet's bottom padding keeps every control clear of the floating
  // navigation (mid-scroll, content passes under it by design, which axe reports as target-size).
  await page.evaluate(() => new Promise((done) => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    window.requestAnimationFrame(() => window.requestAnimationFrame(done))
  }))
  await animationsDone(page)
  // Content that arrived after that (cards, a lazy notice) may still be fading in.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity))
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** Closes the toast (and any message queued behind it): it sits over the page bottom and is not what a scan is for. */
async function clearToasts(page) {
  for (let i = 0; i < 5; i++) {
    const close = page.locator('.toast__close')
    if (!(await close.isVisible())) return
    await close.click()
    await animationsDone(page)
  }
}

/** axe on the screen on display, in light and then dark. */
async function axeBothThemes(page, label) {
  const found = []
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    found.push(...(await axe(page, `${label} (${scheme})`)))
  }
  await page.emulateMedia({ colorScheme: 'light' })
  return found
}

test(MAKER, async ({ browser, relay, baseUrl, state }) => {
  const a = await deviceUser(browser, relay, 'tg-computer', 'computer', state)
  state.tg = { computer: a }
  const { page } = a
  await page.goto(baseUrl)
  await skipSetup(page)
  // A computer is not asked to install: three tasks, the recovery code among them.
  await page.getByRole('heading', { name: 'Get set up · 0 of 3' }).waitFor()
  await addItem(page, baseUrl, { title: 'Walnut cutting board' })
  await addItem(page, baseUrl, { title: 'Linen napkins' })
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('New home')
  await page.getByRole('checkbox', { name: 'Walnut cutting board' }).check()
  await page.getByRole('checkbox', { name: 'Linen napkins' }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.waitForURL((url) => /^#\/list\/[0-9a-f]{32}$/.test(url.hash))
  await page.getByRole('button', { name: 'Share list' }).click()
  await page.getByText('Saved to the sync server.').waitFor()
  state.tg.link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()

  await page.goto(baseUrl)
  await page.getByRole('link', { name: /Save your recovery code/ }).click()
  await h1(page, 'Your recovery code').waitFor()
  // The adaptive shell: the side navigation with Settings marked, the content at a reading measure.
  assert.equal(await sidebar(page).getByRole('link', { name: 'Settings' }).getAttribute('aria-current'), 'page')
  assert.equal(await page.locator('.bottom-nav').count(), 0)
  const code = page.getByTestId('recovery-code')
  await code.locator('li').nth(12).waitFor()
  const box = await code.boundingBox()
  assert.ok(box.width <= 40 * 16 + 1, `the code keeps to the reading measure: ${box.width}`)
  const words = await code.locator('.recovery-words__text').allTextContents()
  assert.equal(words.length, 13)
  const violations = await axeBothThemes(page, 'recovery code at 1440')
  await page.getByRole('button', { name: 'I have saved it' }).click()
  await h1(page, /kept in step on your devices/).waitFor()

  // Settings, the Account section, at 1440.
  await sidebar(page).getByRole('link', { name: 'Settings' }).click()
  await h1(page, 'Settings').waitFor()
  await page.getByTestId('account-status').getByText(/^Up to date\./).waitFor({ timeout: 20000 })
  const section = await page.getByRole('heading', { name: 'Your devices' }).boundingBox()
  const rail = await page.locator('.side-nav').boundingBox()
  assert.ok(section.x > rail.x + rail.width, 'the section sits beside the side navigation')
  violations.push(...(await axeBothThemes(page, 'settings with the account at 1440')))

  // A phone: "I already use Hippo" offers the recovery code first.
  const b = await deviceUser(browser, relay, 'tg-phone', 'iphone', state)
  state.tg.phone = b
  await b.page.goto(baseUrl)
  await b.page.getByRole('button', { name: 'I already use Hippo' }).click()
  await h1(b.page, /Hippo here/).waitFor()
  const options = await b.page.locator('.existing-choices [role="listitem"]').allInnerTexts()
  assert.match(options[0] ?? '', /Sign in with my recovery code/)
  assert.match(options[1] ?? '', /I have a link from my other device/)
  violations.push(...(await axeBothThemes(b.page, 'I already use Hippo at 390')))
  await b.page.getByRole('button', { name: /Sign in with my recovery code/ }).click()
  await h1(b.page, 'Sign in with your recovery code').waitFor()
  // During setup there is no navigation on a phone either.
  assert.equal(await b.page.locator('.bottom-nav, .side-nav').count(), 0)
  await b.page.getByRole('textbox', { name: 'Recovery code' }).pressSequentially(words.join(' '))
  violations.push(...(await axeBothThemes(b.page, 'sign in at 390')))
  await b.page.getByRole('button', { name: 'Sign in' }).click()
  await b.page.waitForURL(/#\/$/)
  await b.page.goto(baseUrl + '#/wishlist')
  await b.page.getByText('Walnut cutting board', { exact: true }).waitFor({ timeout: 20000 })
  await b.page.getByText('Linen napkins', { exact: true }).waitFor()
  await b.page.goto(baseUrl + '#/lists')
  await b.page.getByText('New home', { exact: true }).waitFor({ timeout: 20000 })
  // The phone layout: the bottom navigation, no side navigation.
  assert.equal(await b.page.locator('.side-nav').count(), 0)
  await b.page.locator('.bottom-nav').waitFor()
  await b.page.goto(baseUrl + '#/settings')
  await b.page.getByTestId('account-status').waitFor()
  violations.push(...(await axeBothThemes(b.page, 'settings with the account at 390')))
  await b.page.goto(baseUrl + '#/account/code')
  await b.page.getByTestId('recovery-code').locator('li').nth(12).waitFor()
  assert.deepEqual(await b.page.getByTestId('recovery-code').locator('.recovery-words__text').allTextContents(), words)
  violations.push(...(await axeBothThemes(b.page, 'recovery code at 390')))
  await b.page.goto(baseUrl + '#/move')
  await h1(b.page, 'Add a device').waitFor()
  violations.push(...(await axeBothThemes(b.page, 'add a device at 390')))
  await b.page.goto(baseUrl + '#/move/receive')
  await h1(b.page, 'Sign in with a link').waitFor()
  violations.push(...(await axeBothThemes(b.page, 'sign in with a link at 390')))
  assert.deepEqual(violations, [])
  assertNoProblems(a.problems)
  assertNoProblems(b.problems)
})

test('together: a giver opening a shared list on a computer is asked neither to install nor to sign in', async ({ browser, relay, state }) => {
  const link = need(state, 'tg.link', MAKER)
  const g = await deviceUser(browser, relay, 'tg-giver', 'computer', state)
  const { page } = g
  await page.goto(link)
  await h1(page, 'New home').waitFor({ timeout: 15000 })
  await page.getByRole('article', { name: 'Linen napkins' }).waitFor()
  assert.equal(await sidebar(page).count(), 0, 'no owner navigation')
  assert.equal(await page.getByRole('link', { name: 'Open in the Hippo app' }).count(), 0)
  for (const text of [/install/i, /recovery code/i, /sign in/i, /Add a device/, /now lives at/, /Your devices/]) assert.equal(await page.getByText(text).count(), 0, String(text))
  assert.equal(await page.getByRole('button', { name: /install/i }).count(), 0)
  assert.deepEqual(await axeBothThemes(page, 'giver on a computer'), [])
  assertNoProblems(g.problems)
  await g.context.close()
})

test('together: on Home the address notice leads; the clock note under it is a plain line', async ({ browser, relay, baseUrl, state }) => {
  const other = new URL(baseUrl)
  other.hostname = other.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
  const violations = []
  for (const device of ['iphone', 'computer']) {
    const u = await deviceUser(browser, relay, `tg-notices-${device}`, device, state)
    // A device clock an hour fast, so the clock note shows too.
    await u.context.addInitScript(() => {
      const RealDate = Date
      const off = 3600_000
      function SkewedDate(...args) {
        if (!new.target) return new RealDate(RealDate.now() + off).toString()
        return args.length > 0 ? new RealDate(...args) : new RealDate(RealDate.now() + off)
      }
      SkewedDate.prototype = RealDate.prototype
      SkewedDate.now = () => RealDate.now() + off
      SkewedDate.parse = RealDate.parse
      SkewedDate.UTC = RealDate.UTC
      globalThis.Date = SkewedDate
    })
    // One page load: the clock note is told once per device, and stays until dismissed or reloaded.
    await u.page.goto(`${baseUrl}?site=${encodeURIComponent(other.href)}`)
    await skipSetup(u.page)
    await u.page.evaluate(() => (window.location.hash = '#/item/new'))
    await h1(u.page, 'Add a wish').waitFor()
    await u.page.getByRole('textbox', { name: 'Name' }).fill('Picnic basket')
    await u.page.getByRole('button', { name: 'Add to wishlist' }).click()
    await u.page.waitForURL(/#\/wishlist$/)
    await u.page.evaluate(() => (window.location.hash = '#/'))
    const notice = u.page.getByTestId('site-notice')
    await notice.getByRole('heading', { name: `This Hippo site now lives at ${other.host}` }).waitFor()
    const clock = u.page.getByRole('note', { name: 'Device clock' })
    await clock.waitFor({ timeout: 20000 })
    // One prominent notice: the address change. The clock note is a plain line, not a banner.
    assert.match(await clock.getAttribute('class'), /app-banner--quiet/)
    assert.doesNotMatch(await clock.getAttribute('class'), /app-banner--warn/)
    const quietBanners = await u.page.locator('main .app-banner:not(.app-banner--quiet)').count()
    assert.equal(quietBanners, 0, 'no other banner competes with the address notice')
    await clearToasts(u.page)
    violations.push(...(await axeBothThemes(u.page, `address notice (${device})`)))
    // Dismissed, the clock note leads again.
    await notice.getByRole('button', { name: 'Not now' }).click()
    await notice.waitFor({ state: 'detached' })
    assert.match(await clock.getAttribute('class'), /app-banner--warn/)
    assertNoProblems(u.problems)
    await u.context.close()
  }
  assert.deepEqual(violations, [])
})

test('together cleanup', async ({ state }) => {
  for (const u of [state.tg?.computer, state.tg?.phone]) await u?.context.close()
})
