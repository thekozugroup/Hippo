// The Android app's guided screen before a first share, in the app build (vite --mode native) opened in
// Chromium with a stubbed native bridge: the page-fetch plugin is answered from here. The built-in
// site (https://example.org/hippo/) does not answer; a fake Hippo site, with a hippo.json served by
// this harness, does.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from './harness.mjs'
import { addItem, assertNoProblems, newUser, skipSetup } from './flows.test.mjs'
import { serveNativeBuild } from './native.test.mjs'
import { DEFAULT_RELAYS } from '../src/core/config.ts'

const FAKE_HOST = 'hippo.e2e.test'
const NOT_HIPPO_HOST = 'plain.e2e.test'

/** A fake Hippo site: only /hippo.json, as a Hippo website publishes it. */
function startFakeSite() {
  const asked = []
  const server = createServer((req, res) => {
    asked.push(req.url)
    if (req.url === '/hippo.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ app: 'Hippo', name: 'Hippo', version: '0.1.1', protocol: 1, site: `https://${FAKE_HOST}/`, relays: [...DEFAULT_RELAYS] }))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ port, asked, stop: () => server.close() })
    })
  })
}

/** What the Android shell provides: Capacitor says "native", and the page-fetch plugin answers through the harness. */
async function stubNativeBridge(context, fake) {
  await context.exposeFunction('__hippoPageFetch', async ({ url }) => {
    const u = new URL(url)
    if (u.host === FAKE_HOST) {
      const res = await fetch(`http://127.0.0.1:${fake.port}${u.pathname}`)
      return { status: res.status, url, contentType: res.headers.get('content-type') ?? '', body: await res.text() }
    }
    if (u.host === NOT_HIPPO_HOST) return { status: 404, url, contentType: 'text/html', body: 'nope' }
    throw new Error('network')
  })
  await context.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      PluginHeaders: [{ name: 'PageFetch', methods: [{ name: 'fetch', rtype: 'promise' }] }],
      nativePromise: (plugin, method, options) => {
        if (plugin === 'PageFetch' && method === 'fetch') return window.__hippoPageFetch(options)
        return Promise.reject(new Error(`${plugin}.${method} is not stubbed`))
      },
    }
  })
}

async function newList(page, baseUrl, name) {
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill(name)
  await page.getByRole('checkbox', { name: 'Site setup scarf' }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
}

test('app build: sharing with an unreachable built-in site shows the guided screen; a valid address connects and the link uses it', async ({ browser, relay, state }) => {
  const server = await serveNativeBuild()
  const fake = await startFakeSite()
  try {
    const user = await newUser(browser, relay, 'site-guide', state)
    await stubNativeBridge(user.context, fake)
    const { page } = user
    await page.goto(server.url)
    await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.dataset.native), 'android')
    await skipSetup(page)
    // Adding wishes is never blocked.
    await addItem(page, server.url, { title: 'Site setup scarf' })
    await newList(page, server.url, 'Site setup list')
    await page.getByRole('button', { name: 'Share list' }).click()

    const sheet = page.getByRole('dialog', { name: 'Where will your list open?' })
    await sheet.waitFor()
    await sheet.getByText('open your list in a web browser').waitFor()
    // Nothing was shared yet: there is no link.
    assert.equal(await page.getByRole('textbox', { name: 'Share link' }).count(), 0)

    // Choice two: three steps and a button that opens the setup page in the browser.
    await sheet.getByRole('radio', { name: 'Set one up, free, about two minutes' }).check()
    assert.equal(await sheet.getByRole('listitem').count(), 3)
    const setup = sheet.getByRole('link', { name: /Open the setup page/ })
    const href = new URL(await setup.getAttribute('href'))
    assert.equal(href.origin + href.pathname, 'https://vercel.com/new/clone')
    assert.equal(href.searchParams.get('repository-url'), 'https://github.com/thekozugroup/Hippo')
    assert.equal(await setup.getAttribute('target'), '_blank')

    // Choice one, with an address that is not a Hippo site, then one nobody answers, then the real one.
    await sheet.getByRole('radio', { name: 'I have a Hippo site' }).check()
    const field = sheet.getByRole('textbox', { name: 'Hippo website address' })
    await field.fill(NOT_HIPPO_HOST)
    await sheet.getByRole('button', { name: 'Check and use' }).click()
    await sheet.getByText('That address answers, but it is not a Hippo website.').waitFor()
    assert.equal(await field.getAttribute('aria-invalid'), 'true')
    await field.fill('nobody.e2e.test')
    await sheet.getByRole('button', { name: 'Check and use' }).click()
    await sheet.getByText('Hippo could not reach that address. Check it, or try again when you are online.').waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Share link' }).count(), 0)

    await field.fill(`  ${FAKE_HOST}  `)
    await sheet.getByRole('button', { name: 'Check and use' }).click()
    await sheet.waitFor({ state: 'hidden' })
    // On to sharing, straight away, with the host named.
    await page.getByText(`Connected to ${FAKE_HOST}.`, { exact: false }).first().waitFor()
    const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
    assert.match(link, new RegExp(`^https://${FAKE_HOST.replaceAll('.', '\\.')}/#/l/[A-Za-z0-9_-]+$`))
    assert.ok(fake.asked.includes('/hippo.json'), 'hippo.json was read from the fake site')
    // The site answers, so no "not reachable yet" note.
    assert.equal(await page.getByTestId('site-unreachable').count(), 0)

    // The choice is kept: Settings names the host.
    await page.goto(`${server.url}#/settings`)
    await page.getByText(`Links you share open on ${FAKE_HOST}.`).waitFor()
    assertNoProblems(user.problems)
    await user.context.close()
  } finally {
    fake.stop()
    server.stop()
  }
})

test('app build: "Share anyway" shares with the built-in address and keeps the not-reachable note; closing the screen does not share', async ({ browser, relay, state }) => {
  const server = await serveNativeBuild()
  const fake = await startFakeSite()
  try {
    const user = await newUser(browser, relay, 'site-anyway', state)
    await stubNativeBridge(user.context, fake)
    const { page } = user
    await page.goto(server.url)
    await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
    await skipSetup(page)
    await addItem(page, server.url, { title: 'Site setup scarf' })
    await newList(page, server.url, 'Anyway list')
    const share = page.getByRole('button', { name: 'Share list' })
    await share.click()
    const sheet = page.getByRole('dialog', { name: 'Where will your list open?' })
    await sheet.waitFor()
    // Closing cancels: still a draft.
    await sheet.getByRole('button', { name: 'Close' }).click()
    await sheet.waitFor({ state: 'hidden' })
    await share.waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Share link' }).count(), 0)

    await share.click()
    await sheet.waitFor()
    await sheet.getByRole('button', { name: 'Share anyway' }).click()
    const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
    assert.match(link, /^https:\/\/example\.org\/hippo\/#\/l\//)
    await page.getByTestId('site-unreachable').waitFor()
    assertNoProblems(user.problems)
    await user.context.close()
  } finally {
    fake.stop()
    server.stop()
  }
})

test('app build: "I already use Hippo", "Use my own Hippo site" has the same two choices', async ({ browser, relay, state }) => {
  const server = await serveNativeBuild()
  const fake = await startFakeSite()
  try {
    const user = await newUser(browser, relay, 'site-existing', state)
    await stubNativeBridge(user.context, fake)
    const { page } = user
    await page.goto(server.url)
    await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
    await page.getByRole('button', { name: 'I already use Hippo' }).click()
    await page.getByRole('button', { name: /Use my own Hippo site/ }).click()
    await page.getByRole('heading', { level: 1, name: 'Your Hippo site' }).waitFor()
    await page.getByRole('radio', { name: 'I have a Hippo site' }).waitFor()
    await page.getByRole('radio', { name: 'Set one up, free, about two minutes' }).waitFor()
    await page.getByRole('textbox', { name: 'Hippo website address' }).fill(FAKE_HOST)
    await page.getByRole('button', { name: 'Check and use' }).click()
    await page.getByTestId('site-host').getByText(FAKE_HOST).waitFor()
    assertNoProblems(user.problems)
    await user.context.close()
  } finally {
    fake.stop()
    server.stop()
  }
})
