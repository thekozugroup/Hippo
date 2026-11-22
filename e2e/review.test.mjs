// Flows from the review fixes: link hygiene, keyboard focus, conflicts,
// price and contribution changes, owner retries while a relay is down,
// forgetting a list, and link rotation. Run after flows.test.mjs, with
// their own owner, list and givers.
import assert from 'node:assert/strict'
import { test } from './harness.mjs'
import { addItem, assertNoProblems, card, newUser } from './flows.test.mjs'

/** Console noise expected while the relay is deliberately down. */
const relayNoise = (p) => !/WebSocket|ERR_CONNECTION|connection/i.test(p)

async function openGiver(page, link) {
  await page.goto(link)
  await page.waitForURL(/#\/g\/[0-9a-f]{64}$/)
  await page.getByRole('heading', { level: 2, name: 'Wishes' }).waitFor()
}

test('review setup: an owner publishes a list with three wishes', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'r-owner', state)
  state.r = { owner }
  const { page } = owner
  await addItem(page, baseUrl, { title: 'Kite', price: '30' })
  await addItem(page, baseUrl, { title: 'Reading lamp', price: '100', contrib: true })
  await addItem(page, baseUrl, { title: 'Mug', price: '12' })
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Holiday')
  for (const t of ['Kite', 'Reading lamp', 'Mug']) await page.getByRole('checkbox', { name: t }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  state.r.link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  state.r.listUrl = page.url()
  assert.equal(await page.title(), 'Your list - Hippo')
  assertNoProblems(owner.problems)
})

test('opening a share link takes its secret out of the address bar and history', async ({ browser, relay, baseUrl, state }) => {
  const a = await newUser(browser, relay, 'r-ann', state)
  state.r.ann = a
  const { page } = a
  await page.goto(baseUrl + '#/')
  await page.getByRole('heading', { level: 1 }).waitFor()
  await openGiver(page, state.r.link)
  const payload = state.r.link.split('#/l/')[1]
  assert.ok(!page.url().includes(payload), 'payload still in the address bar')
  assert.equal(await page.title(), 'Shared list - Hippo')
  assert.ok(!(await page.title()).includes('Holiday'))
  // Reload and back/forward still work, and never bring the payload back.
  await page.reload()
  await page.getByRole('heading', { level: 1, name: 'Holiday' }).waitFor()
  await page.goBack()
  await page.waitForURL(/#\/$/)
  await page.goForward()
  await page.waitForURL(/#\/g\/[0-9a-f]{64}$/)
  await page.getByRole('heading', { level: 1, name: 'Holiday' }).waitFor()
  // Others can be invited from the giver view; the copied link opens the same list.
  await a.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy link' }).click()
  await page.getByText('Link copied.', { exact: false }).waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(copied.split('#/l/')[1], payload)
  assertNoProblems(a.problems)
})

test('keyboard-only: claim a wish and land on its card', async ({ state }) => {
  const { page, problems } = state.r.ann
  await page.getByRole('heading', { level: 1, name: 'Holiday' }).focus()
  const target = card(page, 'Kite').getByRole('button', { name: "I'll get this" })
  for (let i = 0; i < 60 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  assert.ok(await target.evaluate((el) => el === document.activeElement), 'Tab never reached the button')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Get this gift' })
  await dialog.waitFor()
  const submit = dialog.getByRole('button', { name: "I'll get this" })
  assert.ok(await submit.evaluate((el) => el === document.activeElement), 'focus did not move into the sheet')
  await page.keyboard.press('Enter')
  await card(page, 'Kite').getByText("You're getting this").waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent === 'Kite' && document.activeElement.tagName === 'H3')
  await page.getByRole('status').filter({ hasText: 'Thank you!' }).waitFor()
  assertNoProblems(problems)
})

test('two givers claim the same wish at once; the later one sees the conflict', async ({ browser, relay, state }) => {
  const b = await newUser(browser, relay, 'r-ben', state)
  const c = await newUser(browser, relay, 'r-cat', state)
  state.r.ben = b
  state.r.cat = c
  await Promise.all([openGiver(b.page, state.r.link), openGiver(c.page, state.r.link)])
  // Neither can see the other's claim before making their own: both claim while the relay is unreachable,
  // and both claims go out when it is back (each giver's view retries unsent claims).
  relay.pause()
  try {
    for (const u of [b, c]) {
      await card(u.page, 'Mug').getByRole('button', { name: "I'll get this" }).click()
      await u.page.getByRole('dialog', { name: 'Get this gift' }).getByRole('button', { name: "I'll get this" }).click()
      await card(u.page, 'Mug').getByText('not sent yet', { exact: false }).waitFor()
    }
  } finally {
    relay.resume()
  }
  const conflictText = 'Someone else said they would get this first'
  const seen = () => Promise.all([b, c].map((u) => card(u.page, 'Mug').getByText(conflictText).count()))
  let counts = [0, 0]
  for (let i = 0; i < 90 && counts[0] + counts[1] === 0; i++) {
    await b.page.waitForTimeout(500)
    counts = await seen()
  }
  assert.deepEqual(counts.toSorted(), [0, 1], 'exactly one giver should see the conflict notice')
  const loser = counts[0] === 1 ? b : c
  await card(loser.page, 'Mug').getByText('Not counted', { exact: true }).waitFor()
  await card(loser.page, 'Mug').getByRole('button', { name: 'Take back' }).waitFor()
  assertNoProblems(b.problems.filter(relayNoise))
  assertNoProblems(c.problems.filter(relayNoise))
})

test('a price change after pledges recomputes the progress', async ({ baseUrl, state }) => {
  const { page } = state.r.ann
  await card(page, 'Reading lamp').getByRole('button', { name: 'Chip in' }).click()
  const pledge = page.getByRole('dialog', { name: 'Chip in' })
  await pledge.getByRole('textbox', { name: 'Your amount' }).fill('25')
  await pledge.getByRole('button', { name: 'Chip in' }).click()
  await card(page, 'Reading lamp').getByText('You chipped in $25.00').waitFor()

  const owner = state.r.owner.page
  await owner.goto(baseUrl + '#/wishlist')
  await owner.getByRole('link', { name: /Reading lamp/ }).click()
  await owner.getByRole('textbox', { name: 'Price' }).fill('50')
  await owner.getByRole('button', { name: 'Save changes' }).click()
  await owner.waitForURL(/#\/wishlist$/)
  await page.waitForFunction(
    () => document.querySelector('[aria-valuetext="$25.00 of $50.00 covered"]') !== null,
    undefined,
    { timeout: 15_000 },
  )
})

test('contributions switched off after a pledge: no new pledges, mine can only go down', async ({ baseUrl, state }) => {
  const owner = state.r.owner.page
  await owner.goto(baseUrl + '#/wishlist')
  await owner.getByRole('link', { name: /Reading lamp/ }).click()
  await owner.getByRole('switch', { name: 'Let friends chip in' }).uncheck()
  await owner.getByRole('button', { name: 'Save changes' }).click()
  await owner.waitForURL(/#\/wishlist$/)

  const { page, problems } = state.r.ann
  const lamp = card(page, 'Reading lamp')
  await lamp.getByText(/Closed to new contributions/).waitFor({ timeout: 15_000 })
  assert.equal(await lamp.getByRole('button', { name: 'Chip in' }).count(), 0)
  assert.equal(await lamp.getByRole('button', { name: 'Cover the rest' }).count(), 0)
  await lamp.getByRole('button', { name: 'Change' }).click()
  const sheet = page.getByRole('dialog', { name: 'Change your amount' })
  await sheet.getByRole('textbox', { name: 'Your amount' }).fill('40')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await sheet.getByText('you can only lower your amount', { exact: false }).waitFor()
  await sheet.getByRole('textbox', { name: 'Your amount' }).fill('10')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await lamp.getByText('You chipped in $10.00').waitFor()
  assertNoProblems(problems)
})

test('an owner edit made while the relay is down reaches givers once it is back, without opening the list', async ({ relay, baseUrl, state }) => {
  const owner = state.r.owner
  relay.pause()
  try {
    await owner.page.goto(baseUrl + '#/wishlist')
    await owner.page.getByRole('link', { name: /Kite/ }).click()
    await owner.page.getByRole('textbox', { name: 'Name' }).fill('Stunt kite')
    await owner.page.getByRole('button', { name: 'Save changes' }).click()
    await owner.page.waitForURL(/#\/wishlist$/)
    await owner.page.getByText('Hippo will update your shared lists when it can reach the sync servers.').waitFor({ timeout: 20_000 })
  } finally {
    relay.resume()
  }
  // The owner stays on the wishlist; the background retry sends the change.
  const { page } = state.r.ben
  let seen = false
  for (let i = 0; i < 12 && !seen; i++) {
    await page.reload()
    await page.getByRole('heading', { level: 2, name: 'Wishes' }).waitFor()
    seen = await card(page, 'Stunt kite')
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  }
  assert.ok(seen, 'the edit never reached the giver')
  assert.match(owner.page.url(), /#\/wishlist$/)
  assertNoProblems(owner.problems.filter(relayNoise))
})

test('removing a list from this device and opening the link again keeps my gifts mine', async ({ state }) => {
  const { page, problems } = state.r.ann
  await openGiver(page, state.r.link)
  await card(page, 'Stunt kite').getByText("You're getting this").waitFor()
  await page.getByRole('button', { name: 'Remove from this device' }).click()
  const sheet = page.getByRole('dialog', { name: 'Remove this list from this device?' })
  await sheet.getByText(/You are getting or chipping in on 2 wishes here/).waitFor()
  await sheet.getByRole('button', { name: 'Remove from this device' }).click()
  await page.waitForURL(/#\/lists$/)
  assert.equal(await page.getByRole('link', { name: /Holiday/ }).count(), 0)

  await openGiver(page, state.r.link)
  const kite = card(page, 'Stunt kite')
  await kite.getByText("You're getting this").waitFor()
  await kite.getByRole('button', { name: 'Take back' }).waitFor()
  await card(page, 'Reading lamp').getByText('You chipped in $10.00').waitFor()
  assertNoProblems(problems.filter(relayNoise))
})

test('a new link cuts off the old one and starts clean', async ({ state }) => {
  const owner = state.r.owner.page
  await owner.goto(state.r.listUrl)
  await owner.getByRole('button', { name: 'Make a new link' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Make a new link' }).click()
  const box = owner.getByRole('textbox', { name: 'Share link' })
  await owner.waitForFunction((old) => document.querySelector('[data-testid="share-link"]')?.value !== old, state.r.link)
  const fresh = await box.inputValue()
  assert.notEqual(fresh, state.r.link)

  const { page, problems } = state.r.ann
  await page.goto(state.r.link)
  await page.waitForURL(/#\/g\/[0-9a-f]{64}$/)
  await page.getByText('This list is no longer shared.').waitFor({ timeout: 15_000 })
  await page.getByRole('heading', { name: 'Your gifts from this list' }).waitFor()
  await card(page, 'Stunt kite').getByText('You are getting this').waitFor()
  assert.equal(await page.getByText(/Removed by the owner|A removed wish/).count(), 0)

  await openGiver(page, fresh)
  for (const t of ['Stunt kite', 'Reading lamp', 'Mug']) {
    await card(page, t).getByRole('button', { name: "I'll get this" }).waitFor()
    assert.equal(await card(page, t).locator('.status-pill, .giver-line').count(), 0, `${t} should start clean`)
  }
  assert.equal(await page.getByText(/You are getting this|You're getting this/).count(), 0)
  assertNoProblems(problems.filter(relayNoise))
})

test('review cleanup', async ({ state }) => {
  for (const u of [state.r?.owner, state.r?.ann, state.r?.ben, state.r?.cat]) await u?.context.close()
})
