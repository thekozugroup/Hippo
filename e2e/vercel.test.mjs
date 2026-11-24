// The website as Vercel serves it: dist/ at the root of its own address (not a sub-path), with the
// response headers from vercel.json. Vercel itself is not involved: a small static server applies
// the same header rules (path patterns, in order) and answers 404 for unknown paths.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { freePort, ROOT, test } from './harness.mjs'
import { assertNoProblems, newUser, skipSetup } from './flows.test.mjs'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/** The headers vercel.json gives a path: every matching rule, in order. */
export function headersFromConfig(config, path) {
  const out = {}
  for (const rule of config.headers) {
    if (new RegExp(`^${rule.source}$`).test(path)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value
  }
  return out
}

export async function serveLikeVercel() {
  const config = JSON.parse(await readFile(ROOT + 'vercel.json', 'utf8'))
  const dist = join(ROOT, config.outputDirectory)
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = normalize(join(dist, path === '/' ? 'index.html' : path))
    let body
    if (file.startsWith(dist)) {
      try {
        if ((await stat(file)).isFile()) body = await readFile(file)
      } catch {
        // not a file
      }
    }
    const headers = headersFromConfig(config, path)
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain', ...headers })
      res.end('The page could not be found')
      return
    }
    // Static files from the host come with a validator and, without a rule, must be revalidated.
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate', ...headers })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  const port = await freePort()
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${port}/`, config, stop: () => server.close() }
}

async function watchPolicy(context) {
  await context.addInitScript(() => {
    window.__violations = []
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
}

test('vercel: at a domain root, the page loads under the header policy with no console or policy errors, and hash routes work', async ({ browser, relay, state }) => {
  const site = await serveLikeVercel()
  state.vercel = site
  const user = await newUser(browser, relay, 'vercel', state)
  await watchPolicy(user.context)
  const { page } = user
  const response = await page.goto(site.url)
  const header = response.headers()['content-security-policy']
  assert.match(header, /frame-ancestors 'none'/)
  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  assert.equal(header, `${meta}; frame-ancestors 'none'`, 'the header is the meta policy plus frame-ancestors')
  assert.equal(response.headers()['x-content-type-options'], 'nosniff')
  assert.equal(response.headers()['referrer-policy'], 'no-referrer')
  assert.match(response.headers()['permissions-policy'], /camera=\(\)/)

  await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
  await skipSetup(page)
  for (const [hash, heading] of [['#/settings', 'Settings'], ['#/wishlist', 'Wishlist'], ['#/lists', 'Lists']]) {
    await page.goto(site.url + hash)
    await page.getByRole('heading', { level: 1, name: heading }).waitFor()
  }
  // The manifest's share target opens the root with the shared text in the query.
  await page.goto(`${site.url}?title=Scarf&url=https%3A%2F%2Fshop.example%2Fscarf`)
  await page.getByRole('textbox', { name: 'Name' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Scarf')
  assert.deepEqual(await page.evaluate(() => window.__violations), [])
  assertNoProblems(user.problems)
  await user.context.close()
})

test('vercel: files and caching', async ({ state }) => {
  const { url } = state.vercel
  const info = await fetch(`${url}hippo.json`)
  assert.equal(info.status, 200)
  assert.match(info.headers.get('content-type'), /json/)
  assert.equal(info.headers.get('cache-control'), 'public, max-age=0, must-revalidate')
  const body = await info.json()
  assert.equal(body.app, 'Hippo')
  for (const file of ['sw.js', 'manifest.webmanifest']) {
    const res = await fetch(url + file)
    assert.equal(res.status, 200, file)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate', file)
  }
  const html = await (await fetch(url)).text()
  const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1]
  assert.ok(asset, 'the entry script is under assets/')
  const hashed = await fetch(url + asset)
  assert.equal(hashed.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.match(hashed.headers.get('content-type'), /javascript/)
  const unknown = await fetch(`${url}no/such/page`)
  assert.equal(unknown.status, 404)
  assert.equal(unknown.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await fetch(url)).status, 200, 'the app is unaffected')
})

test('vercel: the service worker registers and the page reloads offline', async ({ browser, relay, state }) => {
  const { url } = state.vercel
  const user = await newUser(browser, relay, 'vercel-sw', state)
  const { page } = user
  await page.goto(url)
  await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
  await skipSetup(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)
  assert.equal(scope, url, 'scope is the domain root')
  await user.context.setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: /Get set up/ }).waitFor()
  await page.goto(`${url}#/settings`)
  await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
  await user.context.setOffline(false)
  assertNoProblems(user.problems)
  await user.context.close()
})

test('vercel: another site cannot show Hippo in a frame, and Deployment checks says the host forbids it', async ({ browser, relay, state }) => {
  const { url } = state.vercel
  const user = await newUser(browser, relay, 'vercel-frame', state)
  const { page, context } = user
  await context.route('http://framer.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>framer</title><iframe src="${url}" width="300" height="300"></iframe>` }),
  )
  await page.goto('http://framer.test/')
  await page.waitForFunction(() => document.querySelector('iframe') !== null)
  await page.waitForTimeout(1500)
  const inner = page.frames().filter((f) => f !== page.mainFrame())
  assert.ok(inner.length === 1)
  assert.equal(inner[0].url(), 'chrome-error://chromewebdata/', 'the browser refused to show Hippo in the frame')

  await page.goto(url)
  await page.getByRole('heading', { level: 1, name: /Make a wishlist/ }).waitFor()
  await skipSetup(page)
  await page.goto(`${url}#/settings`)
  await page.getByText('Deployment checks').click()
  await page.getByText('this host tells browsers never to show it in a frame', { exact: false }).waitFor()
  await user.context.close()
  state.vercel.stop()
})
