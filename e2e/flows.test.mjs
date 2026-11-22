// Main flows, run in order; later tests build on earlier ones through `state`.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from './harness.mjs'

const { AxeBuilder } = createRequire(import.meta.url)('@axe-core/playwright')

const VIEWPORT = { width: 390, height: 844 }

/** A fresh browser profile pointed at the mock relay, with console checks. */
async function newUser(browser, relay, name, state) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true })
  await context.addInitScript((url) => {
    try {
      sessionStorage.setItem('hippo:relays', url)
    } catch {
      // about:blank and downloads have no storage
    }
  }, relay.url)
  const problems = []
  const frames = { sent: [], received: [] }
  context.on('page', (page) => watch(page, name, problems, frames))
  const page = await context.newPage()
  state.problems ??= []
  state.problems.push(problems)
  return { context, page, problems, frames }
}

function watch(page, name, problems, frames) {
  page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e.message}`))
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' && !/Failed to load resource/.test(text)) problems.push(`[${name}] console error: ${text}`)
    if (/Content Security Policy/i.test(text)) problems.push(`[${name}] CSP: ${text}`)
  })
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => frames.sent.push(String(f.payload)))
    ws.on('framereceived', (f) => frames.received.push(String(f.payload)))
  })
}

function assertNoProblems(problems) {
  assert.deepEqual(problems, [], problems.join('\n'))
}

async function addItem(page, baseUrl, { title, price, qty, love, contrib, newCategory }) {
  await page.goto(baseUrl + '#/item/new')
  await page.getByRole('textbox', { name: 'Name' }).fill(title)
  if (price) await page.getByRole('textbox', { name: 'Price' }).fill(price)
  if (qty) await page.getByRole('spinbutton', { name: 'How many?' }).fill(String(qty))
  if (love) await page.getByRole('radio', { name: 'Would love' }).check()
  if (newCategory) {
    await page.getByRole('textbox', { name: 'New category' }).fill(newCategory)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: newCategory, pressed: true }).waitFor()
  }
  if (contrib) await page.getByRole('switch', { name: 'Let friends chip in' }).check()
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await page.waitForURL(/#\/wishlist$/)
}

const card = (page, title) => page.getByRole('article', { name: title })

test('first run: empty home explains what to do, with the strict CSP in place', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'owner', state)
  state.owner = owner
  const { page } = owner
  await page.goto(baseUrl)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.getByText('Nothing here yet.').waitFor()
  await page.getByRole('heading', { name: 'How Hippo works' }).waitFor()
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  assert.match(csp ?? '', /script-src 'self';/)
  assert.doesNotMatch(csp ?? '', /unsafe-inline|unsafe-eval/)
  assertNoProblems(owner.problems)
})

test('add categories and items; filter and sort the wishlist', async ({ baseUrl, state }) => {
  const { page, problems } = state.owner
  await addItem(page, baseUrl, { title: 'Espresso machine', price: '249.00', love: true, contrib: true, newCategory: 'Kitchen' })
  await addItem(page, baseUrl, { title: 'Wool socks', price: '18', qty: 3 })
  await addItem(page, baseUrl, { title: 'Board game night', price: '45.50' })

  // Category management (FR-3) from the wishlist.
  await page.getByRole('button', { name: 'Edit categories' }).click()
  const sheet = page.getByRole('dialog', { name: 'Categories' })
  await sheet.getByRole('textbox', { name: 'New category' }).fill('Games')
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await sheet.getByRole('textbox', { name: 'Category 2' }).waitFor()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await sheet.waitFor({ state: 'hidden' })

  const rows = page.locator('.list-row__title')
  await assert.doesNotReject(rows.nth(2).waitFor())
  assert.equal(await rows.count(), 3)
  await page.getByRole('button', { name: 'Kitchen', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.list-row__title').length === 1)
  assert.equal(await rows.first().textContent(), 'Espresso machine')
  await page.getByRole('button', { name: 'All categories' }).click()
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('price-asc')
  await page.waitForFunction(() => document.querySelector('.list-row__title')?.textContent === 'Wool socks')
  assert.deepEqual(await rows.allTextContents(), ['Wool socks', 'Board game night', 'Espresso machine'])
  assertNoProblems(problems)
})

test('create and publish a list, with per-server feedback', async ({ baseUrl, state }) => {
  const { page, problems } = state.owner
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Birthday 2027')
  await page.getByRole('textbox', { name: 'Message to friends (optional)' }).fill('Thank you!')
  for (const t of ['Espresso machine', 'Wool socks', 'Board game night']) await page.getByRole('checkbox', { name: t }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  await page.getByText('Saved to the sync server.').waitFor()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/hippo\/#\/l\/[A-Za-z0-9_-]+$/)
  state.link = link
  state.listUrl = page.url()
  assertNoProblems(problems)
})

test('a giver sets a nickname, claims one item and pledges on another', async ({ browser, relay, state }) => {
  const giver = await newUser(browser, relay, 'giver', state)
  state.giver = giver
  const { page } = giver
  await page.goto(state.link)
  await page.getByRole('heading', { level: 1, name: 'Birthday 2027' }).waitFor()
  await page.getByText('Thank you!').waitFor()

  await page.getByRole('button', { name: /Your name on this list/ }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Nickname' }).fill('Maya')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: /Your name on this list: Maya/ }).waitFor()

  await card(page, 'Wool socks').getByRole('button', { name: "I'll get this" }).click()
  const dialog = page.getByRole('dialog', { name: 'Get this gift' })
  await dialog.getByRole('spinbutton', { name: 'How many will you get?' }).fill('2')
  await dialog.getByRole('button', { name: "I'll get this" }).click()
  await card(page, 'Wool socks').getByText('You are getting 2 of these').waitFor()

  await card(page, 'Espresso machine').getByRole('button', { name: 'Chip in' }).click()
  const pledge = page.getByRole('dialog', { name: 'Chip in' })
  await pledge.getByRole('textbox', { name: 'Your amount' }).fill('50')
  await pledge.getByRole('button', { name: 'Chip in' }).click()
  await card(page, 'Espresso machine').getByText('You chipped in $50.00').waitFor()
  // Once a pledge exists, a full claim becomes "Cover the rest" (PRD 4.6).
  await card(page, 'Espresso machine').getByRole('button', { name: 'Cover the rest' }).waitFor()
  await page.waitForFunction(() => !document.body.textContent?.includes('not sent yet'))
  assertNoProblems(giver.problems)
})

test('a third person sees the claim, the pledge and the nickname', async ({ browser, relay, state }) => {
  const third = await newUser(browser, relay, 'third', state)
  state.third = third
  const { page } = third
  await page.goto(state.link)
  await card(page, 'Wool socks').getByText('Maya is getting 2 of these').waitFor()
  await card(page, 'Wool socks').getByText('1 of 3 still wanted.').waitFor()
  await card(page, 'Espresso machine').getByText('Maya chipped in $50.00').waitFor()
  await card(page, 'Espresso machine').getByText('Partly funded').waitFor()
  const progress = card(page, 'Espresso machine').getByRole('progressbar')
  assert.equal(await progress.getAttribute('aria-valuetext'), '$50.00 of $249.00 covered')
  await card(page, 'Board game night').getByText('Available').waitFor()
  // Lists shared with me (FR-24)
  await page.goto(state.link.replace(/#.*$/, '#/lists'))
  await page.getByRole('link', { name: /Birthday 2027/ }).waitFor()
  await page.goto(state.link)
  await card(page, 'Wool socks').waitFor()
  assertNoProblems(third.problems)
})

test('no serious accessibility violations on the main screens (axe, WCAG 2.2 AA)', async ({ baseUrl, state }) => {
  const scan = async (page, label) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    assert.deepEqual(
      bad.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      [],
    )
  }
  await scan(state.third.page, 'giver view')
  const { page } = state.owner
  for (const [route, label] of [
    ['#/', 'home'],
    ['#/wishlist', 'wishlist'],
    ['#/item/new', 'item editor'],
    ['#/lists', 'lists'],
    ['#/settings', 'settings'],
  ]) {
    await page.goto(baseUrl + route)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.waitForTimeout(300)
    await scan(page, label)
  }
  await page.goto(state.listUrl)
  await page.getByRole('textbox', { name: 'Share link' }).waitFor()
  await scan(page, 'list editor')
})

test('the owner sees no claim state and never requests claims', async ({ state }) => {
  const { page, frames, problems } = state.owner
  await page.goto(state.listUrl)
  await page.getByRole('heading', { level: 1, name: 'Birthday 2027' }).waitFor()
  await page.waitForTimeout(1500) // let the repair fetch run
  const text = (await page.locator('body').textContent()) ?? ''
  assert.doesNotMatch(text, /Maya|chipped in|getting (this|\d)|Partly funded|Claimed|Funded|\$50/)

  const reqs = frames.sent.map((f) => JSON.parse(f)).filter((m) => m[0] === 'REQ')
  assert.ok(reqs.length > 0, 'owner made no subscriptions at all')
  const authors = new Set()
  for (const [, , ...filters] of reqs) {
    for (const f of filters) {
      assert.ok(Array.isArray(f.authors) && f.authors.length > 0, `owner REQ without authors: ${JSON.stringify(f)}`)
      for (const a of f.authors) authors.add(a)
    }
  }
  const events = frames.received.map((f) => JSON.parse(f)).filter((m) => m[0] === 'EVENT')
  for (const [, , e] of events) assert.ok(authors.has(e.pubkey), 'owner received an event from someone else')
  assertNoProblems(problems)
})

test('an item edit reaches givers live', async ({ state }) => {
  const { page, problems } = state.owner
  await page.goto(state.link.replace(/#.*$/, '#/wishlist'))
  await page.getByRole('link', { name: /Board game night/ }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Board game night (co-op)')
  await page.getByRole('textbox', { name: 'Price' }).fill('40')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL(/#\/wishlist$/)
  const third = state.third.page
  await card(third, 'Board game night (co-op)').getByText('$40.00').waitFor({ timeout: 10_000 })
  assertNoProblems(problems)
})

test('opening your own link is refused with an explanation (FR-25)', async ({ state }) => {
  const { page, problems } = state.owner
  await page.goto(state.link)
  await page.getByRole('heading', { level: 1, name: 'This is your own list' }).waitFor()
  await page.getByRole('link', { name: 'Open list settings' }).waitFor()
  assertNoProblems(problems)
})

test('a broken link shows a helpful error', async ({ state }) => {
  const { page } = state.third
  await page.goto(state.link.replace(/#\/l\/.*$/, '#/l/AAAAnot-a-real-link'))
  await page.getByRole('heading', { level: 1, name: 'This link does not work' }).waitFor()
  await page.goto(state.link.slice(0, -10))
  await page.getByRole('heading', { level: 1, name: 'This link does not work' }).waitFor()
})

test('a link that points at a loopback or private-network relay is refused', async ({ state }) => {
  const { page } = state.third
  const keys = Buffer.from(state.link.split('#/l/')[1], 'base64url').subarray(1, 65)
  for (const relay of ['wss://192.168.1.1', 'ws://127.0.0.1:9222', 'wss://printer.local']) {
    const v2 = Buffer.concat([Buffer.from([2]), keys, Buffer.from(relay)]).toString('base64url')
    await page.goto(state.link.replace(/#\/l\/.*$/, `#/l/${v2}`))
    await page.getByRole('heading', { level: 1, name: 'This link does not work' }).waitFor()
  }
})

test('the ?relays= test override is loopback-only and lasts for one tab', async ({ browser, baseUrl }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    const note = page.getByRole('note').filter({ hasText: 'Test mode' })
    // A non-loopback relay in the parameter is ignored.
    await page.goto(`${baseUrl}?relays=${encodeURIComponent('wss://relay.evil.example')}#/`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(await note.count(), 0)
    // A loopback relay switches this tab into test mode, also after a reload...
    await page.goto(`${baseUrl}?relays=${encodeURIComponent('ws://127.0.0.1:1')}#/`)
    await note.waitFor()
    await page.goto(`${baseUrl}#/`)
    await note.waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('hippo:relays')), null)
    // ...but not another tab.
    const other = await context.newPage()
    await other.goto(`${baseUrl}#/`)
    await other.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(await other.getByRole('note').filter({ hasText: 'Test mode' }).count(), 0)
  } finally {
    await context.close()
  }
})

test('unpublishing tells givers the list is no longer shared', async ({ state }) => {
  const { page, problems } = state.owner
  await page.goto(state.listUrl)
  await page.getByRole('button', { name: 'Stop sharing' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop sharing' }).click()
  await page.getByRole('button', { name: 'Share again with the same link' }).waitFor()
  const third = state.third.page
  await third.goto(state.link)
  await third.getByText('This list is no longer shared.').waitFor({ timeout: 10_000 })
  assertNoProblems(problems)
})

test('share target and deep link prefill the Add form; hostile values are dropped', async ({ browser, relay, baseUrl, state }) => {
  const u = await newUser(browser, relay, 'capture', state)
  const { page } = u
  await page.goto(`${baseUrl}?title=Desk%20lamp&url=https%3A%2F%2Fshop.example%2Flamp&price=39.99&currency=EUR&image=https%3A%2F%2Fimg.example%2Flamp.jpg`)
  await page.getByRole('heading', { level: 1, name: 'Add a wish' }).waitFor()
  assert.equal(new URL(page.url()).search, '')
  assert.equal(new URL(page.url()).hash, '#/item/new')
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Desk lamp')
  assert.equal(await page.getByRole('textbox', { name: 'Shop link' }).inputValue(), 'https://shop.example/lamp')
  assert.equal(await page.getByRole('textbox', { name: 'Price' }).inputValue(), '39.99')
  assert.equal(await page.getByRole('combobox', { name: 'Currency' }).inputValue(), 'EUR')

  // Android share sheets often put the link in `text`.
  await page.goto(`${baseUrl}?text=${encodeURIComponent('Look at this https://shop.example/p/red-wool-scarf-12345.html')}`)
  await page.getByRole('heading', { level: 1, name: 'Add a wish' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Red wool scarf')
  assert.equal(await page.getByRole('textbox', { name: 'Shop link' }).inputValue(), 'https://shop.example/p/red-wool-scarf-12345.html')

  await page.goto(`${baseUrl}?title=${encodeURIComponent('<img src=x onerror=alert(1)>')}&url=javascript%3Aalert(1)&image=javascript%3Aalert(2)`)
  await page.getByRole('heading', { level: 1, name: 'Add a wish' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), '<img src=x onerror=alert(1)>')
  assert.equal(await page.getByRole('textbox', { name: 'Shop link' }).inputValue(), '')
  assert.equal(await page.getByRole('textbox', { name: 'Picture link' }).inputValue(), '')
  assert.equal(await page.locator('img[src="x"]').count(), 0)

  // FR-7: pasting a link suggests a name.
  await page.goto(baseUrl + '#/')
  await page.getByRole('link', { name: 'Add', exact: true }).click()
  await page.getByRole('textbox', { name: 'Shop link' }).fill('https://shop.example/products/linen-duvet-cover')
  await page.getByRole('textbox', { name: 'Shop link' }).blur()
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Linen duvet cover')
  assertNoProblems(u.problems)
  await u.context.close()
})

test('export a backup and import it on another device', async ({ browser, relay, state }) => {
  const { page } = state.owner
  await page.goto(state.link.replace(/#.*$/, '#/settings'))
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()])
  assert.match(download.suggestedFilename(), /^hippo-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const file = await download.path()
  const json = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(json.format, 'hippo-export')
  assert.equal(json.items.length, 3)

  const other = await newUser(browser, relay, 'restore', state)
  await other.page.goto(state.link.replace(/#.*$/, '#/settings'))
  await other.page.getByTestId('import-file').setInputFiles(file)
  const dialog = other.page.getByRole('dialog', { name: 'Import this backup?' })
  await dialog.getByText(/3 wishes, 2 categories, 1 list/).waitFor()
  await dialog.getByRole('button', { name: 'Add to what is here' }).click()
  await other.page.getByText(/Imported 3 wishes/).waitFor()
  await other.page.goto(state.link.replace(/#.*$/, '#/lists'))
  await other.page.getByRole('link', { name: /Birthday 2027/ }).waitFor()

  // A file that is not a backup is rejected with a clear message.
  await other.page.goto(state.link.replace(/#.*$/, '#/settings'))
  await other.page.getByTestId('import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await other.page.getByText('This is not a Hippo backup', { exact: false }).waitFor()
  assertNoProblems(other.problems)
  await other.context.close()
})

test('the app shell reloads offline from the service worker', async ({ state }) => {
  const { page, context, problems } = state.owner
  await page.goto(state.link.replace(/#.*$/, '#/'))
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await context.setOffline(true)
  try {
    await page.reload()
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.getByText('Espresso machine').waitFor()
    await page.goto(state.link.replace(/#.*$/, '#/settings'))
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor() // lazy chunk from the precache
  } finally {
    await context.setOffline(false)
  }
  // Offline relay errors are expected; nothing else should have failed.
  assertNoProblems(problems.filter((p) => !/WebSocket|ERR_INTERNET_DISCONNECTED/.test(p)))
})

test('cleanup', async ({ state }) => {
  for (const u of [state.owner, state.giver, state.third]) await u?.context.close()
})
