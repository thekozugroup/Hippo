import { DEFAULT_RELAYS } from '../../core/index.ts'
import { TransferError } from '../../core/protocol/transfer.ts'
import { timeLeftText, transferErrorText, transferStartError } from '../screens/move/move-text.ts'
import { cameIn } from './format.ts'
import { checkSite, normalizeSiteInput, parseSiteInfo, relaysAfterSiteChange, siteProblemText, type FetchedFile } from './site-check.ts'
import { clearTransferPayload, heldTransferPayload, takeTransferFromLocation, transferPayloadInText } from './transfer-inbox.ts'

const INFO = JSON.stringify({ app: 'Hippo', name: 'Hippo', version: '0.1.1', protocol: 1, relays: [...DEFAULT_RELAYS] })

describe('what came in', () => {
  it('names what is there, never a zero', () => {
    expect(cameIn(12, 2)).toBe('12 wishes and 2 lists')
    expect(cameIn(1, 0)).toBe('1 wish')
    expect(cameIn(0, 3)).toBe('3 lists')
  })
})

describe('transfer wording', () => {
  it('has one plain sentence per failure, and the time left', () => {
    for (const r of ['expired', 'cancelled', 'used', 'missing', 'tampered', 'unsupported-version', 'offline'] as const) {
      const text = transferErrorText(new TransferError(r))
      expect(text).toMatch(/\.$/)
      expect(text).not.toMatch(/relay|event|key|—/i)
    }
    expect(transferErrorText(new TransferError('used'))).toContain('already used')
    expect(transferStartError(new TransferError('too-large'))).toContain('Export backup')
    expect(timeLeftText(14 * 60_000 + 5)).toBe('Works for 15 more minutes.')
    expect(timeLeftText(30_000)).toBe('Works for less than a minute more.')
  })
})

describe('transfer inbox', () => {
  it('takes the payload out of the address bar before anything renders', () => {
    const replace = vi.fn()
    const loc = { hash: '#/t/AbcDEF_-123', href: 'https://h.example/app/#/t/AbcDEF_-123' } as unknown as Location
    expect(takeTransferFromLocation(loc, { state: null, replaceState: replace } as unknown as History)).toBe(true)
    expect(replace).toHaveBeenCalledWith(null, '', 'https://h.example/app/#/move/receive')
    expect(heldTransferPayload()).toBe('AbcDEF_-123')
    clearTransferPayload()
    expect(heldTransferPayload()).toBeUndefined()
    expect(takeTransferFromLocation({ hash: '#/l/abc', href: 'https://h.example/#/l/abc' } as unknown as Location, { replaceState: replace } as unknown as History)).toBe(false)
  })

  it('finds a transfer link in shared text, and nothing in a list link', () => {
    const p = 'A'.repeat(92)
    expect(transferPayloadInText(`Open this on your phone: https://h.example/#/t/${p}`)).toBe(p)
    expect(transferPayloadInText(`https://h.example/#/l/${p}`)).toBeUndefined()
  })
})

describe('Hippo site check', () => {
  const file = (over: Partial<FetchedFile> = {}): FetchedFile => ({ status: 200, url: 'https://gifts.example.org/hippo.json', contentType: 'application/json', body: INFO, ...over })

  it('normalises what people type', () => {
    expect(normalizeSiteInput('gifts.example.org')).toEqual({ url: 'https://gifts.example.org/' })
    expect(normalizeSiteInput('https://owner.github.io/Hippo/#/l/secret')).toEqual({ url: 'https://owner.github.io/Hippo/' })
    expect(normalizeSiteInput('https://owner.github.io/Hippo/index.html?x=1')).toEqual({ url: 'https://owner.github.io/Hippo/' })
    expect(normalizeSiteInput('http://gifts.example.org')).toEqual({ problem: 'not-https' })
    for (const bad of ['', 'not a site', 'https://localhost/', 'https://192.168.1.2/', 'https://u:p@x.example/', 'ftp://x.example/']) expect(normalizeSiteInput(bad)).toHaveProperty('problem')
  })

  it('reads hippo.json strictly', () => {
    expect(parseSiteInfo(INFO)).toMatchObject({ app: 'Hippo', protocol: 1 })
    expect(parseSiteInfo(JSON.stringify({ app: 'Hippo', protocol: 2, relays: ['wss://a.example'] }))).toBe('incompatible')
    expect(parseSiteInfo(JSON.stringify({ app: 'Other', protocol: 1, relays: ['wss://a.example'] }))).toBeUndefined()
    expect(parseSiteInfo(JSON.stringify({ app: 'Hippo', protocol: 1, relays: ['ws://127.0.0.1:7447'] }))).toBeUndefined()
    expect(parseSiteInfo('<html>')).toBeUndefined()
  })

  it('accepts a Hippo site and refuses the rest with a specific reason', async () => {
    const ok = await checkSite('gifts.example.org', async (u) => {
      expect(u).toBe('https://gifts.example.org/hippo.json')
      return file()
    })
    expect(ok).toMatchObject({ ok: true, url: 'https://gifts.example.org/', host: 'gifts.example.org' })
    expect(await checkSite('gifts.example.org', async () => file({ status: 404 }))).toEqual({ ok: false, problem: 'not-hippo' })
    expect(await checkSite('gifts.example.org', async () => file({ body: '{"app":"Hippo","protocol":9,"relays":[]}' }))).toEqual({ ok: false, problem: 'incompatible' })
    expect(await checkSite('gifts.example.org', () => Promise.reject(new Error('timeout')))).toEqual({ ok: false, problem: 'unreachable' })
    expect(await checkSite('gifts.example.org', async () => file({ url: 'https://10.0.0.1/hippo.json' }))).toEqual({ ok: false, problem: 'unreachable' })
    expect(siteProblemText('not-hippo')).toBe('That address answers, but it is not a Hippo website.')
  })

  it("adopts a site's relays unless the person set their own", () => {
    const site = ['wss://relay.gifts.example.org']
    expect(relaysAfterSiteChange(undefined, undefined, site, DEFAULT_RELAYS)).toEqual({ relays: site, adopted: site })
    expect(relaysAfterSiteChange(site, site, [...DEFAULT_RELAYS], DEFAULT_RELAYS)).toEqual({ relays: undefined, adopted: undefined })
    expect(relaysAfterSiteChange(['wss://mine.example'], undefined, site, DEFAULT_RELAYS)).toBe('keep')
  })
})
