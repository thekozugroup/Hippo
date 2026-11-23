import { describe, expect, it } from 'vitest'
import { DEFAULT_RELAYS } from '../../core/index.ts'
import { generateListSecret, generateSigningKey, publicKeyOf } from '../../core/crypto/keys.ts'
import { encodeSharePayload, shareLinkFor } from '../../core/crypto/link.ts'
import { siteUrlFromEnv } from '../../../vite.config.ts'
import { payloadFromPastedLink, payloadFromSiteLink, PUBLIC_SITE_URL, shareBaseFor, shareBaseUrl } from './site-address.ts'

const SITE = 'https://owner.github.io/Hippo/'
const keys = { ownerPubkey: publicKeyOf(generateSigningKey()), listSecret: generateListSecret() }
const payload = encodeSharePayload(keys)

describe('the site address', () => {
  it('is one constant from the build: HIPPO_SITE_URL, normalised, or empty without it', () => {
    expect(PUBLIC_SITE_URL).toBe(siteUrlFromEnv(process.env.HIPPO_SITE_URL) ?? '')
  })

  it('HIPPO_SITE_URL must be an https address without credentials, query or fragment; a slash is added', () => {
    expect(siteUrlFromEnv('https://owner.github.io/Hippo')).toBe(SITE)
    expect(siteUrlFromEnv(SITE)).toBe(SITE)
    expect(siteUrlFromEnv('https://gifts.example.org')).toBe('https://gifts.example.org/')
    for (const bad of [undefined, '', 'http://owner.github.io/Hippo/', 'https://u:p@x.example/', 'https://x.example/?a=1', 'https://x.example/#h', 'nonsense']) {
      expect(siteUrlFromEnv(bad), String(bad)).toBeUndefined()
    }
  })

  it('share links use the public website in the app and the page address on the website', () => {
    const loc = { origin: 'https://localhost', pathname: '/' }
    expect(shareBaseFor(true, SITE, loc)).toBe(SITE)
    expect(shareBaseFor(false, SITE, { origin: 'https://gifts.example', pathname: '/hippo/' })).toBe('https://gifts.example/hippo/')
    // The app build refuses to start without a site, but never fall back to an empty base.
    expect(shareBaseFor(true, '', loc)).toBe('https://localhost/')
    // The website build is never native.
    expect(shareBaseUrl({ origin: 'https://gifts.example', pathname: '/x/' })).toBe('https://gifts.example/x/')
  })

  it('a share link made in the app points at the site, with the secret only after #', () => {
    const link = shareLinkFor({ ...keys, relays: DEFAULT_RELAYS }, shareBaseFor(true, SITE, { origin: 'https://localhost', pathname: '/' }))
    expect(link).toBe(`${SITE}#/l/${payload}`)
    expect(new URL(link).search).toBe('')
  })
})

describe('links Android hands to the app', () => {
  it('accepts share links of the public website only', () => {
    expect(payloadFromSiteLink(`${SITE}#/l/${payload}`, SITE)).toBe(payload)
    expect(payloadFromSiteLink(`https://owner.github.io/Hippo#/l/${payload}`, SITE)).toBe(payload)
    expect(payloadFromSiteLink(`https://owner.github.io/Hippo/index.html#/l/${payload}`, SITE)).toBe(payload)
    for (const bad of [
      `https://evil.example/Hippo/#/l/${payload}`,
      `http://owner.github.io/Hippo/#/l/${payload}`,
      `https://owner.github.io/Other/#/l/${payload}`,
      `https://owner.github.io/Hippo/x/#/l/${payload}`,
      `https://user@owner.github.io/Hippo/#/l/${payload}`,
      `${SITE}#/settings`,
      `${SITE}#/l/<script>`,
      `${SITE}#/l/${payload}/extra`,
      'not a link',
    ]) {
      expect(payloadFromSiteLink(bad, SITE), bad).toBeUndefined()
    }
    expect(payloadFromSiteLink(`${SITE}#/l/${payload}`, '')).toBeUndefined()
  })
})

describe('Open a list from a link', () => {
  it('finds a share link in pasted text, from any Hippo address', () => {
    expect(payloadFromPastedLink(`${SITE}#/l/${payload}`)).toBe(payload)
    expect(payloadFromPastedLink(`Here is my list: https://gifts.example/#/l/${payload}. Thanks!`)).toBe(payload)
    expect(payloadFromPastedLink(`  #/l/${payload}  `)).toBe(payload)
  })

  it('refuses anything that does not decode as a share link', () => {
    for (const bad of ['', 'https://shop.example/scarf', `${SITE}#/l/AAAA`, `${SITE}#/l/${payload.slice(0, 20)}`, 'x'.repeat(9000)]) {
      expect(payloadFromPastedLink(bad), bad.slice(0, 40)).toBeUndefined()
    }
  })
})
