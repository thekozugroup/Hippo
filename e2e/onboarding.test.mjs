// First-run setup, the giver's first open, and motion. Runs after review.test.mjs with its own
// profiles; later tests build on earlier ones through `state.o`.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { animationsDone, need, test, transitionDone } from './harness.mjs'
import { assertNoProblems, newUser } from './flows.test.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')

const h1 = (page, name) => page.getByRole('heading', { level: 1, name })

/** Waits until setup's saved progress (in the app's database) holds `text`. */
async function savedProgressHas(page, text) {
  const read = async (want) => {
    const ask = (req) => new Promise((resolve, reject) => ((req.onsuccess = () => resolve(req.result)), (req.onerror = () => reject(req.error))))
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue
      const db = await ask(indexedDB.open(info.name))
      try {
        if (!db.objectStoreNames.contains('settings')) continue
        const row = await ask(db.transaction('settings').objectStore('settings').get('onboarding'))
        if (JSON.stringify(row ?? null).includes(want)) return true
      } finally {
        db.close()
      }
    }
    return false
  }
  const deadline = Date.now() + 30_000
  // page.waitForFunction does not wait for a promise, so poll with evaluate (which does).
  while (!(await page.evaluate(read, text))) {
    assert.ok(Date.now() < deadline, `setup's saved progress never held "${text}"`)
    await page.waitForTimeout(50)
  }
}

async function axe(page, label) {
  await animationsDone(page)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test('setup: a new owner answers each step with the keyboard and lands on Home with a draft list holding their wish', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'o-owner', state)
  state.o = { owner }
  const { page } = owner
  const violations = []
  await page.goto(baseUrl)

  // 1. What Hippo is, one button. The heading has focus after each step and says which step it is.
  await h1(page, /Make a wishlist/).waitFor()
  assert.equal(await h1(page, /Make a wishlist/).getAttribute('aria-describedby') !== null, true)
  // A computer (Chromium's desktop user agent): five steps, no install step.
  assert.equal(await page.getByText('Step 1 of 5').count(), 1)
  // The slide control is on this first step only.
  assert.equal(await page.locator('.slide-btn').count(), 1)
  violations.push(...(await axe(page, 'step 1')))
  await page.getByRole('button', { name: 'Get started' }).focus()
  await page.keyboard.press('Enter')

  // 2. Name: typed, shown back in the hint, Enter continues.
  await h1(page, /call you/).waitFor()
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1')
  assert.equal(await page.title(), 'Your name, step 2 of 5 - Hippo')
  assert.equal(await page.locator('.slide-btn').count(), 0, 'later steps continue with an ordinary button')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Ann')
  await page.getByText('“Ann’s list”', { exact: false }).waitFor()
  violations.push(...(await axe(page, 'step 2')))
  await page.keyboard.press('Enter')

  // 3. Occasion: their name in the question; arrow keys pick; the date follows the choice.
  await h1(page, /Ann, what is/).waitFor()
  violations.push(...(await axe(page, 'step 3')))
  await page.getByRole('radio', { name: 'Birthday' }).focus()
  await page.keyboard.press('ArrowRight') // Wedding
  await page.keyboard.press('ArrowLeft') // back to Birthday
  assert.equal(await page.getByRole('radio', { name: 'Birthday' }).isChecked(), true)
  await page.getByRole('textbox', { name: 'Date (optional)' }).fill('2027-04-02')
  await page.getByRole('button', { name: 'Continue' }).focus()
  await page.keyboard.press('Enter')

  // 4. Wish: an empty answer gets an inline error; a pasted shop link is cleaned.
  await h1(page, /for your birthday/).waitFor()
  violations.push(...(await axe(page, 'step 4')))
  await page.getByRole('button', { name: 'Save wish' }).click()
  const field = page.getByRole('textbox', { name: 'Your wish, or a link to it' })
  await page.getByText('Type a wish or paste a link, or skip this step.').waitFor()
  assert.equal(await field.getAttribute('aria-invalid'), 'true')
  await field.fill('Wool scarf https://shop.example/scarf?utm_source=ad')
  await page.getByText('Saves the link from shop.example', { exact: false }).waitFor()
  await field.press('Enter')

  // 5. No install step on a computer: one capture method for this device, then Finish.
  await h1(page, /from anywhere/).waitFor()
  assert.equal(await page.getByText('Step 5 of 5').count(), 1)
  await page.getByText('“Wool scarf” is on your list Birthday 2027.').waitFor()
  violations.push(...(await axe(page, 'step 6')))
  await page.getByRole('button', { name: 'Finish' }).click()

  await page.waitForURL(/#\/$/)
  // No install task on a computer either.
  await page.getByRole('heading', { name: 'Get set up · 0 of 3' }).waitFor()
  await page.getByText('All set, Ann.').waitFor()
  await page.getByRole('link', { name: /Wool scarf/ }).waitFor()
  await page.getByRole('link', { name: /Birthday 2027/ }).click()
  await h1(page, 'Birthday 2027').waitFor()
  await page.getByRole('button', { name: 'Share list' }).waitFor() // a draft
  assert.equal(await page.getByRole('checkbox', { name: 'Wool scarf' }).isChecked(), true)
  // Back from Home never returns into setup.
  await page.goBack()
  await page.waitForURL(/#\/$/)
  await page.goBack()
  assert.doesNotMatch(page.url(), /welcome/)

  // Share it for the giver tests.
  await page.goto(baseUrl + '#/lists')
  await page.getByRole('link', { name: /Birthday 2027/ }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  state.o.link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()

  // Dark theme scan of the steps, through the replay in Settings.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(baseUrl + '#/settings')
  await page.getByRole('button', { name: 'Go through setup again' }).click()
  await h1(page, /Make a wishlist/).waitFor()
  violations.push(...(await axe(page, 'dark step 1')))
  await page.getByRole('button', { name: 'Get started' }).click()
  await h1(page, /call you/).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Your name' }).inputValue(), 'Ann') // prefilled
  violations.push(...(await axe(page, 'dark step 2')))
  await page.getByRole('button', { name: 'Continue' }).click()
  await h1(page, /what is/i).waitFor()
  violations.push(...(await axe(page, 'dark step 3')))
  await page.getByRole('button', { name: 'Skip' }).click()
  await h1(page, /one thing/).waitFor()
  violations.push(...(await axe(page, 'dark step 4')))
  await page.getByRole('button', { name: 'Skip' }).click()
  await h1(page, /from anywhere/).waitFor()
  violations.push(...(await axe(page, 'dark step 5')))
  // Closing a replay goes to Home, and Back from there returns to Settings.
  await page.getByRole('button', { name: 'Close setup' }).click()
  await page.waitForURL(/#\/$/)
  await page.goBack()
  await page.waitForURL(/#\/settings$/)
  await page.emulateMedia({ colorScheme: 'light' })
  assert.deepEqual(violations, [])
  assertNoProblems(owner.problems)
})

test('setup: skipping the occasion still saves the wish, with no list', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'o-skip', state)
  const { page } = u
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'Get started' }).click()
  await h1(page, /call you/).waitFor()
  await page.getByRole('button', { name: 'Skip' }).click()
  await h1(page, /what is/i).waitFor()
  await page.getByRole('button', { name: 'Skip' }).click()
  await h1(page, /one thing/).waitFor()
  await page.getByRole('button', { name: 'A good book' }).click()
  await page.getByRole('button', { name: 'Save wish' }).click()
  await page.getByText('“A good book” is in your wishlist.').waitFor()
  await page.getByRole('button', { name: 'Finish' }).click()
  await page.waitForURL(/#\/$/)
  await page.getByRole('link', { name: /A good book/ }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Your lists' }).count(), 0)
  assertNoProblems(u.problems)
  await u.context.close()
})

test('setup: closing the app mid-flow resumes at the same step with the answers kept; Back and Escape keep them too', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'o-resume', state)
  let page = u.page
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('textbox', { name: 'Your name' }).fill('Sam')
  await page.getByRole('button', { name: 'Continue' }).click()
  await h1(page, /Sam, what is/).waitFor()
  await page.getByRole('radio', { name: 'Something else' }).check()
  await page.getByRole('textbox', { name: 'What is the occasion?' }).fill('Moving house')
  await savedProgressHas(page, 'Moving house') // typing is saved shortly after it stops
  await page.close()

  page = await u.context.newPage()
  await page.goto(baseUrl)
  await h1(page, /Sam, what is/).waitFor()
  assert.equal(await page.getByRole('radio', { name: 'Something else' }).isChecked(), true)
  assert.equal(await page.getByRole('textbox', { name: 'What is the occasion?' }).inputValue(), 'Moving house')

  // Continue, then browser Back: the step and its answers are as they were.
  await page.getByRole('button', { name: 'Continue' }).click()
  await h1(page, /for Moving house/).waitFor()
  await page.goBack()
  await h1(page, /Sam, what is/).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'What is the occasion?' }).inputValue(), 'Moving house')
  // Escape goes back a step (here past where this tab started, so the entry is replaced).
  await page.locator('body').press('Escape')
  await h1(page, /call you/).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Your name' }).inputValue(), 'Sam')
  // Going forward again edits the list it made instead of adding another.
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await h1(page, /for Moving house/).waitFor()
  await page.getByRole('button', { name: 'Close setup' }).click()
  await page.waitForURL(/#\/$/)
  await page.goto(baseUrl + '#/lists')
  await page.getByRole('link', { name: /Moving house/ }).waitFor()
  assert.equal(await page.getByRole('link', { name: /Moving house/ }).count(), 1)
  // Closed: Home shows Home from now on.
  await page.goto(baseUrl + '#/')
  await page.getByRole('heading', { name: /Get set up/ }).waitFor()
  assertNoProblems(u.problems)
  await u.context.close()
})

test('a giver on a fresh device goes straight to the list: owner name in the header, the intro once', async ({ browser, relay, baseUrl, state }) => {
  const g = await newUser(browser, relay, 'o-giver', state)
  const { page } = g
  await page.goto(need(state, 'o.link', 'setup: a new owner answers each step with the keyboard'))
  await h1(page, 'Birthday 2027').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Get started' }).count(), 0)
  await page.getByText('Ann’s list').waitFor()
  const intro = page.getByRole('region', { name: 'How this works' })
  await intro.waitFor()
  await intro.getByText('Hippo hides this from Ann.').waitFor()
  // Two short lines, and the first wish is at least partly on the first screen (390x844).
  const firstWish = await page.getByRole('article').first().boundingBox()
  assert.ok(firstWish && firstWish.y < (page.viewportSize()?.height ?? 844) - 40, `first wish starts at ${firstWish?.y}`)
  const scan = await axe(page, 'giver intro')
  // One place to set the name: the chip at the top, labelled until a name is set.
  assert.equal(await intro.getByRole('textbox').count(), 0)
  await page.getByRole('button', { name: /^Add your name/ }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Nickname' }).fill('Ben')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: /Your name on this list: Ben/ }).waitFor()
  await intro.getByRole('button', { name: 'Dismiss how this works' }).click()
  await intro.waitFor({ state: 'detached' })
  await page.reload()
  await h1(page, 'Birthday 2027').waitFor()
  await page.getByRole('article', { name: 'Wool scarf' }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'How this works' }).count(), 0)
  // Home on this device does not push the giver into owner setup either.
  await page.goto(baseUrl + '#/')
  await page.getByRole('heading', { name: 'Shared with me' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Get started' }).count(), 0)
  assert.deepEqual(scan, [])
  assertNoProblems(g.problems)
  state.o.giver = g
})

test('motion: route changes animate by direction; with reduced motion nothing animates', async ({ browser, relay, baseUrl, state }) => {
  const { page } = need(state, 'o.owner', 'setup: a new owner answers each step with the keyboard')
  // Record the direction each transition was started with.
  await page.goto(baseUrl + '#/wishlist')
  await h1(page, 'Wishlist').waitFor()
  await page.evaluate(() => {
    window.__dirs = []
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = (cb) => {
      window.__dirs.push(document.documentElement.dataset.navDir)
      return start(cb)
    }
  })
  await page.getByRole('link', { name: /Wool scarf/ }).click()
  await h1(page, 'Edit wish').waitFor()
  await transitionDone(page)
  await page.goBack()
  await h1(page, 'Wishlist').waitFor()
  await transitionDone(page)
  const box = await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lists' }).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await h1(page, 'Lists').waitFor()
  assert.deepEqual(await page.evaluate(() => window.__dirs), ['forward', 'back', 'lateral'])
  // Rapid taps and Back mid-transition end on the latest address, with a working screen.
  await page.getByRole('link', { name: /Birthday 2027/ }).click()
  await page.goBack()
  await page.goForward()
  await h1(page, 'Birthday 2027').waitFor()
  // The direction goes once the last transition ends (it must never stay behind on the page).
  await transitionDone(page)
  assert.equal(new URL(page.url()).hash.startsWith('#/list/'), true)

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  try {
    const p = await ctx.newPage()
    await p.addInitScript((url) => sessionStorage.setItem('hippo:relays', url), relay.url)
    await p.goto(baseUrl)
    await p.getByRole('button', { name: 'Skip setup' }).click()
    await p.getByRole('heading', { name: /Get set up/ }).waitFor()
    await p.waitForTimeout(900) // past the boot delay, so enter effects would run if allowed
    const nav = await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Wishlist' }).boundingBox()
    await p.mouse.click(nav.x + nav.width / 2, nav.y + nav.height / 2)
    await h1(p, 'Wishlist').waitFor()
    const running = await p.evaluate(() => ({
      animations: document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration) > 1).length,
      transition: document.documentElement.dataset.navDir ?? null,
    }))
    assert.deepEqual(running, { animations: 0, transition: null })
  } finally {
    await ctx.close()
  }
})

test('onboarding cleanup', async ({ state }) => {
  for (const u of [state.o?.owner, state.o?.giver]) await u?.context.close()
})
