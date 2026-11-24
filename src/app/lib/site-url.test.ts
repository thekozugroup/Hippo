import { describe, expect, it } from 'vitest'
import { resolveSiteUrl, siteInfoJson } from '../../../vite.config.ts'
import { normalizeSiteInput } from './site-check.ts'

describe('resolveSiteUrl: which address a build advertises', () => {
  const vercelProd = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'hippo.example.com', VERCEL_URL: 'hippo-abc123.vercel.app' }

  it('an explicit HIPPO_SITE_URL wins, on Vercel or anywhere else', () => {
    expect(resolveSiteUrl({ HIPPO_SITE_URL: 'https://owner.github.io/Hippo' })).toBe('https://owner.github.io/Hippo/')
    expect(resolveSiteUrl({ ...vercelProd, HIPPO_SITE_URL: 'https://gifts.example.org/' })).toBe('https://gifts.example.org/')
    expect(resolveSiteUrl({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'hippo.example.com', HIPPO_SITE_URL: 'https://gifts.example.org' })).toBe('https://gifts.example.org/')
  })

  it('on a Vercel production build it uses the production address, which includes a custom domain', () => {
    expect(resolveSiteUrl(vercelProd)).toBe('https://hippo.example.com/')
    expect(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'hippo-ab12.vercel.app' })).toBe('https://hippo-ab12.vercel.app/')
  })

  it('a Vercel preview or development build advertises nothing, even though the production address is set there too', () => {
    expect(resolveSiteUrl({ ...vercelProd, VERCEL_ENV: 'preview' })).toBeUndefined()
    expect(resolveSiteUrl({ ...vercelProd, VERCEL_ENV: 'development' })).toBeUndefined()
    expect(resolveSiteUrl({ VERCEL: '1', VERCEL_URL: 'hippo-git-x.vercel.app' })).toBeUndefined()
  })

  it('GitHub Pages passes its address as HIPPO_SITE_URL and nothing else changes', () => {
    expect(resolveSiteUrl({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/Hippo', HIPPO_SITE_URL: 'https://owner.github.io/Hippo/' })).toBe('https://owner.github.io/Hippo/')
    expect(resolveSiteUrl({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/Hippo' })).toBeUndefined()
  })

  it('without any of it, or with unusable values, there is no address', () => {
    expect(resolveSiteUrl({})).toBeUndefined()
    expect(resolveSiteUrl({ HIPPO_SITE_URL: 'http://insecure.example/' })).toBeUndefined()
    expect(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: '' })).toBeUndefined()
    expect(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'not a host' })).toBeUndefined()
    expect(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'host.example/path?x=1' })).toBeUndefined()
  })

  it('hippo.json names the site only when the address is known', () => {
    expect(JSON.parse(siteInfoJson('1.0.0', 'https://hippo.example.com/'))).toMatchObject({ app: 'Hippo', site: 'https://hippo.example.com/' })
    expect(JSON.parse(siteInfoJson('1.0.0'))).not.toHaveProperty('site')
  })
})

describe('normalizeSiteInput: what people type', () => {
  it('takes a bare host, spaces, capitals and a pasted page address', () => {
    for (const typed of ['hippo.example.com', '  hippo.example.com  ', 'HIPPO.example.com', 'https://hippo.example.com', 'https://hippo.example.com/', 'hippo.example.com/#/settings', 'hippo.example.com/index.html?x=1']) {
      expect(normalizeSiteInput(typed), typed).toEqual({ url: 'https://hippo.example.com/' })
    }
  })

  it('keeps the folder of a site under a sub-path, and drops the page name', () => {
    expect(normalizeSiteInput('owner.github.io/Hippo')).toEqual({ url: 'https://owner.github.io/Hippo/' })
    expect(normalizeSiteInput('owner.github.io/Hippo/')).toEqual({ url: 'https://owner.github.io/Hippo/' })
    expect(normalizeSiteInput('owner.github.io/Hippo/index.html')).toEqual({ url: 'https://owner.github.io/Hippo/' })
  })

  it('refuses what cannot be a Hippo website', () => {
    expect(normalizeSiteInput('')).toHaveProperty('problem', 'invalid-address')
    expect(normalizeSiteInput('   ')).toHaveProperty('problem', 'invalid-address')
    expect(normalizeSiteInput('two words.example')).toHaveProperty('problem', 'invalid-address')
    expect(normalizeSiteInput('http://hippo.example.com')).toHaveProperty('problem', 'not-https')
    expect(normalizeSiteInput('hippo.example.com:8080')).toHaveProperty('problem', 'invalid-address')
  })
})
