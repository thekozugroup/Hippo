// Installing: the setup step in each device's words and order, the Home checklist item, and
// nothing for givers. Devices are emulated by user agent (and touch), so these check Hippo's
// choices, not the browsers' own install dialogs. Runs after onboarding.test.mjs (uses its link).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from './harness.mjs'
import { assertNoProblems } from './flows.test.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')

export const DEVICES = {
  iphone: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  desktop: { viewport: { width: 390, height: 844 } },
}

const h1 = (page, name) => page.getByRole('heading', { level: 1, name })

export async function deviceUser(browser, relay, name, device, state) {
  const context = await browser.newContext({ ...DEVICES[device], deviceScaleFactor: 1 })
  await context.addInitScript((url) => {
    try {
      sessionStorage.setItem('hippo:relays', url)
    } catch {
      // no storage on about:blank
    }
  }, relay.url)
  const problems = []
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[${name}] console error: ${m.text()}`)
  })
  state.problems ??= []
  state.problems.push(problems)
  return { context, page, problems }
}

/** Fires a synthetic `beforeinstallprompt`, as Chromium does when a site can be installed; counts calls to prompt(). */
export async function offerInstallPrompt(page, outcome = 'accepted') {
  await page.evaluate((o) => {
    const e = new Event('beforeinstallprompt', { cancelable: true })
    window.__prompted = 0
    Object.assign(e, {
      prompt: () => {
        window.__prompted++
        return Promise.resolve()
      },
      userChoice: Promise.resolve({ outcome: o }),
    })
    window.dispatchEvent(e)
  }, outcome)
}

/**
 * Answers `(display-mode: standalone)` as an installed app's window does. Chromium's media
 * emulation does not cover display-mode, so matchMedia is wrapped before any page script runs.
 */
export async function emulateStandalone(context) {
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      if (!/display-mode:\s*standalone/.test(query)) return real(query)
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }
    }
  })
}

async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test('install: on iPhone Safari the Home Screen step comes before the name question; carrying on in the browser continues setup', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'i-iphone', 'iphone', state)
  const { page } = u
  try {
    await page.goto(baseUrl)
    await h1(page, /Make a wishlist/).waitFor()
    assert.equal(await page.getByText('Step 1 of 6').count(), 1)
    await page.getByRole('button', { name: 'Get started' }).click()

    await h1(page, /Put Hippo on\s*your Home Screen/).waitFor()
    await page.waitForFunction(() => document.activeElement?.tagName === 'H1')
    assert.equal(await page.title(), 'Install Hippo, step 2 of 6 - Hippo')
    await page.getByText('On iPhone, the Home Screen app keeps its own copy of your wishes, so it is best to add it before you start.').waitFor()
    const steps = page.getByRole('list').getByRole('listitem')
    assert.equal(await steps.count(), 3)
    assert.match(await steps.nth(0).innerText(), /Tap Share/)
    assert.match(await steps.nth(1).innerText(), /Add to Home Screen/)
    assert.match(await steps.nth(2).innerText(), /Open as Web App on and tap Add/)
    const violations = await axe(page, 'iphone install')

    await page.getByRole('button', { name: 'I added it' }).click()
    await page.getByRole('status').filter({ hasText: 'Now open Hippo from your Home Screen' }).waitFor()

    await page.getByRole('button', { name: 'Carry on in the browser' }).click()
    await h1(page, /call you/).waitFor()
    assert.equal(await page.getByText('Step 3 of 6').count(), 1)
    await page.getByRole('textbox', { name: 'Your name' }).fill('Ivy')
    await page.getByRole('button', { name: 'Continue' }).click()
    await h1(page, /Ivy, what is/).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /one thing/).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    // No second install step: the last step is the Shortcut.
    await h1(page, /from anywhere/).waitFor()
    await page.getByText(/a Shortcut adds the page/).waitFor()
    assert.equal(await page.getByText('Step 6 of 6').count(), 1)
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.waitForURL(/#\/$/)
    await page.getByRole('heading', { name: 'Get set up · 0 of 4' }).waitFor()
    await page.getByRole('button', { name: /Put Hippo on your Home Screen/ }).waitFor()
    assert.deepEqual(violations, [])
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('install: on Android Chrome the step comes late; when the browser offers its prompt, Install Hippo calls it', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'i-android', 'android', state)
  const { page } = u
  try {
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Get started' }).click()
    await h1(page, /call you/).waitFor()
    assert.equal(await page.getByText('Step 2 of 6').count(), 1)
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /what is/i).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /one thing/).waitFor()
    await page.getByRole('textbox', { name: 'Your wish, or a link to it' }).fill('Kettle')
    await page.getByRole('button', { name: 'Save wish' }).click()

    await h1(page, /Put Hippo on\s*your home screen/).waitFor()
    assert.equal(await page.getByText('Step 5 of 6').count(), 1)
    await page.getByText('shows up when you tap Share in other apps', { exact: false }).waitFor()
    // No prompt yet: the browser menu route.
    await page.getByRole('list').getByText('Add to home screen').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Install Hippo' }).count(), 0)

    await offerInstallPrompt(page, 'accepted')
    const install = page.getByRole('button', { name: 'Install Hippo' })
    await install.waitFor()
    assert.equal(await page.getByRole('list').count(), 0, 'one button instead of steps')
    await install.click()
    await page.getByText('Hippo is installed. Open it from your home screen.').first().waitFor()
    assert.equal(await page.evaluate(() => window.__prompted), 1)
    // The same control now says Continue, and a press on it at once is a new decision.
    await page.getByRole('button', { name: 'Continue' }).click()

    await h1(page, /from anywhere/).waitFor()
    await page.getByText('Use Share in any shop or browser and pick Hippo.').waitFor()
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.waitForURL(/#\/$/)
    // Installed from this page: ticked on the checklist.
    await page.getByRole('heading', { name: 'Get set up · 1 of 4' }).waitFor()
    await page.getByRole('listitem').filter({ hasText: 'Put Hippo on your home screen' }).getByText('(done)').waitFor()
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('install: a dismissed prompt leaves the button and says nothing', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'i-dismiss', 'android', state)
  const { page } = u
  try {
    await page.goto(baseUrl + '#/welcome/install')
    await h1(page, /your home screen/).waitFor()
    await offerInstallPrompt(page, 'dismissed')
    await page.getByRole('button', { name: 'Install Hippo' }).click()
    await page.waitForFunction(() => window.__prompted === 1)
    await page.waitForTimeout(300)
    assert.equal(await page.getByText(/Hippo is installed/).count(), 0)
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('install: running installed (display-mode standalone) skips the step and leaves it out of the progress', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'i-standalone', 'android', state)
  const { page } = u
  try {
    await emulateStandalone(u.context)
    await page.goto(baseUrl)
    assert.equal(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches), true)
    await h1(page, /Make a wishlist/).waitFor()
    assert.equal(await page.getByText('Step 1 of 5').count(), 1)
    await page.getByRole('button', { name: 'Get started' }).click()
    await h1(page, /call you/).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /what is/i).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /one thing/).waitFor()
    await page.getByRole('button', { name: 'Skip' }).click()
    await h1(page, /from anywhere/).waitFor()
    assert.equal(await page.getByText('Step 5 of 5').count(), 1)
    await page.getByText('Use Share in any shop or browser and pick Hippo.').waitFor()
    // An old address for the install step goes on to the next step.
    await page.goto(baseUrl + '#/welcome/install')
    await h1(page, /from anywhere/).waitFor()
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.waitForURL(/#\/$/)
    await page.getByRole('listitem').filter({ hasText: 'Put Hippo on your home screen' }).getByText('(done)').waitFor()
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('install: after skipping setup, the checklist offers installing and opens the same steps', async ({ browser, relay, baseUrl, state }) => {
  const u = await deviceUser(browser, relay, 'i-checklist', 'desktop', state)
  const { page } = u
  try {
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Skip setup' }).click()
    await page.getByRole('heading', { name: 'Get set up · 0 of 4' }).waitFor()
    const row = page.getByRole('button', { name: /Install Hippo/ })
    await row.click()
    const sheet = page.getByRole('dialog', { name: 'Install Hippo' })
    await sheet.waitFor()
    await sheet.getByText('Installed, Hippo opens in its own window like an app.').waitFor()
    await sheet.getByRole('list').getByText('Cast, save, and share').waitFor()
    const violations = await axe(page, 'checklist sheet')
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('Install Hippo'))
    // Settings has the same guidance.
    await page.goto(baseUrl + '#/settings')
    const section = page.getByRole('region', { name: 'Install Hippo' })
    await section.getByRole('list').getByText('Cast, save, and share').waitFor()
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')) // contrast is measured at rest
    violations.push(...(await axe(page, 'settings')))
    assert.deepEqual(violations, [])
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})

test('install: a giver opening a share link sees nothing about installing, even when the browser offers it', async ({ browser, relay, state }) => {
  assert.ok(state.o?.link, 'needs the shared list from onboarding.test.mjs')
  const u = await deviceUser(browser, relay, 'i-giver', 'android', state)
  const { page } = u
  try {
    await page.goto(state.o.link)
    await h1(page, 'Birthday 2027').waitFor()
    await offerInstallPrompt(page)
    await page.getByRole('article', { name: 'Wool scarf' }).waitFor()
    await page.waitForTimeout(300)
    assert.equal(await page.getByText(/home screen|Install Hippo/i).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Install Hippo' }).count(), 0)
    // Home on a giver's device: no setup and no checklist, so no install item.
    await page.goto(state.o.link.split('#')[0] + '#/')
    await page.getByRole('heading', { name: 'Shared with me' }).waitFor()
    assert.equal(await page.getByText(/home screen|Install Hippo/i).count(), 0)
    assertNoProblems(u.problems)
  } finally {
    await u.context.close()
  }
})
