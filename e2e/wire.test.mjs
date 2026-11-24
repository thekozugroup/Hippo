// Deployment checks in Settings, and the opt-in link lookup. Own profiles; nothing is shared with other files.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { animationsDone, test } from './harness.mjs'
import { assertNoProblems, newUser } from './flows.test.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')

const PREVIEW_HOST = 'api.microlink.io'
const LINK = 'https://shop.example/p/steel-kettle'

test('settings: the deployment checks are collapsed at the bottom, open on demand and show results without errors', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'w-checks', state)
  try {
    const { page } = u
    await page.goto(baseUrl + '#/settings')
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
    const row = page.getByText('Deployment checks', { exact: true })
    await row.scrollIntoViewIfNeeded()
    assert.equal(await page.getByRole('button', { name: 'Check again' }).isVisible(), false, 'closed until opened')
    // It is the last thing on the screen.
    const lastHeading = await page.getByRole('heading', { level: 2 }).last().innerText()
    assert.equal(lastHeading, 'About and privacy')

    await row.click()
    const status = page.locator('.settings-deploy__status')
    await page.waitForFunction(() => /checks passed|need attention|could not be checked/.test(document.querySelector('.settings-deploy__status')?.textContent ?? ''), null, { timeout: 15000 })
    assert.equal(await page.locator('.settings-check').count(), 7, 'one line per check')
    // The test relay is the only one in use, and it answers: a plain line with no mark.
    const relayLine = page.locator('.settings-check', { hasText: '1 of 1 relay answered.' })
    assert.equal(await relayLine.count(), 1)
    assert.equal(await relayLine.locator('.status-pill').count(), 0)
    assert.doesNotMatch(await page.locator('.settings-checks').innerText(), /could not run/i)
    for (const pill of await page.locator('.settings-check .status-pill').allInnerTexts()) assert.match(pill, /^(Needs attention|Could not check)$/)

    await page.getByRole('button', { name: 'Check again' }).click()
    await page.waitForFunction(() => document.querySelector('.settings-deploy__status')?.textContent !== 'Checking…', null, { timeout: 15000 })
    assert.notEqual((await status.innerText()).trim(), '')

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(100)
    await animationsDone(page)
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    assert.deepEqual(bad.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), [])
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('updates: the version check asks GitHub only when pressed, the policy allows it, and the helper opens the prefilled new-file page', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'w-updates', state)
  try {
    const { page, context } = u
    const toGitHub = []
    context.on('request', (req) => {
      if (/(^|\.)github(usercontent)?\.com$/.test(new URL(req.url()).hostname)) toGitHub.push(req.url())
    })
    await context.route('https://raw.githubusercontent.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ version: '99.0.0' }) }),
    )
    await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>GitHub</title>' }))

    await page.goto(baseUrl + '#/settings')
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
    const row = page.getByText('Deployment checks', { exact: true })
    await row.scrollIntoViewIfNeeded()
    await row.click()
    const check = page.getByRole('button', { name: 'Check for a newer version' })
    await check.waitFor()
    const version = JSON.parse(await (await page.request.get(baseUrl + 'hippo.json')).text()).version
    assert.ok(await page.getByText(version, { exact: true }).isVisible(), 'shows the version from hippo.json')
    await page.waitForTimeout(300)
    assert.deepEqual(toGitHub, [], 'nothing goes to GitHub until asked')

    await check.click()
    await page.getByText('Version 99.0.0 is available.', { exact: false }).waitFor()
    assert.deepEqual(toGitHub, ['https://raw.githubusercontent.com/thekozugroup/Hippo/stable/package.json'])

    const field = page.getByRole('textbox', { name: 'Your repository' })
    await field.fill('not a repository')
    await page.getByRole('button', { name: /Open GitHub to add the file/ }).click()
    assert.equal(await field.getAttribute('aria-invalid'), 'true')
    await field.fill('ada/hippo')
    const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: /Open GitHub to add the file/ }).click()])
    await popup.waitForLoadState()
    const opened = new URL(popup.url())
    assert.equal(opened.origin + opened.pathname, 'https://github.com/ada/hippo/new/main')
    assert.equal(opened.searchParams.get('filename'), '.github/workflows/hippo-update.yml')
    assert.match(opened.searchParams.get('value') ?? '', /^# Keeps this copy of Hippo up to date/)
    assert.equal(await popup.evaluate(() => window.opener), null, 'opened without a link back to Hippo')
    await page.getByText('GitHub opened in a new tab for ada/hippo.', { exact: false }).waitFor()

    await animationsDone(page)

    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    assert.deepEqual(bad.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), [])
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('link lookup: while the setting is off no request ever goes to the preview host; once on, exactly one does', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'w-lookup', state)
  try {
    const { page, context } = u
    const toPreviewHost = []
    context.on('request', (req) => {
      if (new URL(req.url()).hostname === PREVIEW_HOST) toPreviewHost.push(req.url())
    })
    await context.route(`https://${PREVIEW_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: { title: 'Steel kettle 1.7 L', image: { url: 'https://img.example/kettle.jpg' } } }),
      }),
    )
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseUrl).origin })

    const paste = async (link) => {
      await page.evaluate((l) => navigator.clipboard.writeText(l), link)
      await page.getByRole('textbox', { name: 'Shop link' }).click()
      await page.keyboard.press('Control+V')
    }

    // Off by default: Settings shows the switch unchecked.
    await page.goto(baseUrl + '#/settings')
    const sw = page.getByRole('switch', { name: 'Look up the title and picture of links' })
    await sw.waitFor()
    assert.equal(await sw.isChecked(), false)

    // A pasted link: the name is guessed from the address, one hint appears, nothing is sent.
    await page.goto(baseUrl + '#/item/new')
    await paste(LINK)
    await page.waitForFunction(() => document.querySelector('.field__hint')?.textContent?.includes('bookmarklet'))
    assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Steel kettle')
    // A share-target link (prefilled) is not looked up either.
    await page.goto(baseUrl + `?title=&url=${encodeURIComponent(LINK)}`)
    await page.getByRole('heading', { level: 1, name: 'Add a wish' }).waitFor()
    await page.waitForTimeout(800)
    assert.deepEqual(toPreviewHost, [], 'no request while the setting is off')

    // Switch it on: now a pasted link asks once and fills the empty fields.
    await page.goto(baseUrl + '#/settings')
    await sw.click()
    await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].some((el) => el.checked))
    await page.goto(baseUrl + '#/item/new')
    await paste(LINK)
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Steel kettle 1.7 L'))
    assert.equal(await page.getByRole('textbox', { name: 'Picture link' }).inputValue(), 'https://img.example/kettle.jpg')
    assert.equal(toPreviewHost.length, 1, 'one request for one pasted link')
    assert.ok(toPreviewHost[0].includes(encodeURIComponent(LINK)))
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('setup: "Get started" works within 200 ms of the first step, while the large logo is still playing, and a press snaps the logo to its place', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'w-intro', state)
  try {
    const { page } = u
    await page.goto(baseUrl + '#/welcome/start')
    const start = page.getByRole('button', { name: 'Get started' })
    await start.waitFor()
    assert.equal(await page.locator('.logo--intro').count(), 1, 'the intro is playing when the control appears')
    // Whether the intro was still playing at the moment the press arrived: measured in the page, so a
    // slow machine cannot make the press late (Playwright waits for a moving control to stand still,
    // so a control that moved with the intro would be pressed only after it).
    await page.evaluate(() => {
      window.__introAtPress = []
      // The pointer arriving on the control, just before the press (which itself ends the intro).
      window.addEventListener('pointermove', () => window.__introAtPress.push(document.querySelector('.logo--intro') !== null), { capture: true, once: true })
    })
    await start.click()
    await page.getByRole('heading', { level: 1, name: /What should we\s*call you\?/ }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.__introAtPress), [true], 'the press came while the intro played, and the step changed without waiting for it')
    assert.equal(await page.locator('.logo--intro').count(), 0, 'the press ended the intro')
    // One logo in the accessibility tree, always.
    assert.equal(await page.getByText('Hippo', { exact: true }).count(), 1)
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('setup: the logo intro plays once; going back to step 1 and reloading show the logo at rest', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'w-intro-once', state)
  try {
    const { page } = u
    await page.goto(baseUrl + '#/welcome/start')
    await page.getByRole('button', { name: 'Get started' }).waitFor()
    assert.equal(await page.locator('.logo--intro').count(), 1)
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByRole('heading', { level: 1, name: /What should we\s*call you\?/ }).waitFor()
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Get started' }).waitFor()
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.logo--intro').count(), 0, 'no intro on Back')
    await page.reload()
    await page.getByRole('button', { name: 'Get started' }).waitFor()
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.logo--intro').count(), 0, 'no intro after a reload')
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})
