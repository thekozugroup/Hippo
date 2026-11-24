import { addItem, card, newUser, skipSetup } from './flows.test.mjs'
import { test } from './harness.mjs'
const HOUR = 3600_000
test('dbg clock', async ({ browser, relay, baseUrl, state }) => {
  const owner = await newUser(browser, relay, 'clock-owner', state)
  const { page } = owner
  await page.goto(baseUrl)
  await skipSetup(page)
  await addItem(page, baseUrl, { title: 'Clock scarf' })
  await page.goto(baseUrl + '#/list/new')
  await page.getByRole('textbox', { name: 'List name' }).fill('Clock test')
  await page.getByRole('checkbox', { name: 'Clock scarf' }).check()
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('button', { name: 'Share list' }).click()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  for (let i = 0; i < Number(process.env.N || 5); i++) {
    const u = await newUser(browser, relay, 'fast' + i, state)
    await u.context.addInitScript((off) => {
      const RealDate = Date
      function SkewedDate(...args) { if (!new.target) return new RealDate(RealDate.now() + off).toString(); return args.length > 0 ? new RealDate(...args) : new RealDate(RealDate.now() + off) }
      SkewedDate.prototype = RealDate.prototype
      SkewedDate.now = () => RealDate.now() + off
      SkewedDate.parse = RealDate.parse
      SkewedDate.UTC = RealDate.UTC
      globalThis.Date = SkewedDate
      const t0 = performance.now()
      window.__log = []
      const log = (m) => window.__log.push(`${Math.round(performance.now() - t0)} ${m}`)
      new MutationObserver(() => {
        const t = document.querySelector('.toast__message')?.textContent ?? ''
        const h = document.querySelector('h1')?.textContent ?? ''
        const k = t + '|' + h
        if (k !== window.__last) { window.__last = k; log(`toast=${t.slice(0, 50)} h1=${h}`) }
      }).observe(document, { childList: true, subtree: true, characterData: true })
      const f = window.fetch
      window.fetch = async (...a) => { const s = performance.now(); try { const r = await f(...a); log(`fetch ${String(a[0]).slice(-30)} ${Math.round(performance.now() - s)}ms date=${r.headers.get('date')}`); return r } catch (e) { log('fetch err ' + e); throw e } }
    }, HOUR)
    const t0 = Date.now()
    await u.page.goto(link)
    await u.page.getByRole('heading', { level: 1, name: 'Clock test' }).waitFor()
    let ok = true
    try { await u.page.getByText('The clock on this device is about 1 hour ahead.', { exact: false }).waitFor({ timeout: 5000 }) } catch { ok = false }
    console.log(i, ok, Date.now() - t0, JSON.stringify(await u.page.evaluate(() => window.__log)))
    await u.context.close()
  }
})
