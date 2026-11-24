// vercel.json is read by Vercel, which this repository cannot run. These tests check what can be
// checked here: it is valid, it names only commands and folders that exist, and the policy it sends
// as a header is the policy the build puts in the page, plus frame-ancestors.

import { describe, expect, it } from 'vitest'
import { CSP, CSP_HEADER } from '../../../vite.config.ts'
import vercelRaw from '../../../vercel.json?raw'
import packageRaw from '../../../package.json?raw'
import lockRaw from '../../../package-lock.json?raw'
import readme from '../../../README.md?raw'
import { DEPLOY_URL, UPSTREAM_REPO_URL } from './hosting.ts'

interface HeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}
interface VercelConfig {
  framework?: string
  installCommand?: string
  buildCommand?: string
  outputDirectory?: string
  rewrites?: unknown
  redirects?: unknown
  headers: HeaderRule[]
}

const config = JSON.parse(vercelRaw) as VercelConfig
const pkg = JSON.parse(packageRaw) as { scripts: Record<string, string> }

/** The headers Vercel would send for a path: every rule whose source matches, in order. */
function headersFor(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of config.headers) {
    // Vercel sources are path-to-regexp patterns; the ones used here are plain regular expressions.
    if (new RegExp(`^${rule.source}$`).test(path)) for (const h of rule.headers) out[h.key] = h.value
  }
  return out
}

describe('vercel.json', () => {
  it('is valid JSON and asks for the normal website build, not the Android one', () => {
    expect(config.framework).toBe('vite')
    expect(config.installCommand).toBe('npm ci')
    expect(config.buildCommand).toBe('npm run build')
    expect(config.buildCommand).not.toMatch(/native|android/i)
  })

  it('names only commands and folders that exist', () => {
    expect(pkg.scripts.build).toBe('tsc -b && vite build')
    expect(lockRaw.length).toBeGreaterThan(0) // npm ci needs the lock file
    // Vite writes the website to dist/ unless told otherwise; vite.config.ts only moves the Android build.
    expect(config.outputDirectory).toBe('dist')
    expect(pkg.scripts['android:web']).toContain('--mode native')
  })

  it('assumes no sub-path: no rewrites or redirects, and no path prefix in any header rule', () => {
    expect(config.rewrites).toBeUndefined()
    expect(config.redirects).toBeUndefined()
    for (const rule of config.headers) expect(rule.source.startsWith('/')).toBe(true)
    expect(vercelRaw).not.toMatch(/\/hippo\//i)
  })

  it('sends the page policy as a header: the same directives as the meta tag, plus frame-ancestors', () => {
    const header = headersFor('/')['Content-Security-Policy']
    expect(header).toBe(CSP_HEADER)
    expect(header).toBe(`${CSP}; frame-ancestors 'none'`)
    expect(CSP).not.toContain('frame-ancestors')
    // And the policy the built page carries is CSP: the plugin writes exactly this string.
    expect(headersFor('/assets/index-abc.js')['Content-Security-Policy']).toBe(CSP_HEADER)
  })

  it('sends the other security headers on every path', () => {
    for (const path of ['/', '/index.html', '/assets/index-abc.js', '/sw.js', '/hippo.json']) {
      const h = headersFor(path)
      expect(h['X-Content-Type-Options'], path).toBe('nosniff')
      expect(h['Referrer-Policy'], path).toBe('no-referrer')
      expect(h['X-Frame-Options'], path).toBe('DENY')
      expect(h['Permissions-Policy'], path).toMatch(/camera=\(\)/)
    }
  })

  it('turns off only features Hippo does not use', () => {
    const policy = headersFor('/')['Permissions-Policy'] ?? ''
    // Sharing, copying and installing need none of these to be listed, and none may be turned off.
    for (const used of ['clipboard-write', 'web-share', 'fullscreen', 'storage-access']) expect(policy).not.toContain(used)
  })

  it('never caches the service worker, the manifest or hippo.json, and caches hashed files for good', () => {
    for (const path of ['/sw.js', '/manifest.webmanifest', '/hippo.json']) {
      expect(headersFor(path)['Cache-Control'], path).toBe('public, max-age=0, must-revalidate')
    }
    expect(headersFor('/assets/index-DqIujsJ0.js')['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(headersFor('/assets/inter-latin-wght-normal-C2S99t-D.woff2')['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(headersFor('/')['Cache-Control']).toBeUndefined()
    expect(headersFor('/icon-192.png')['Cache-Control']).toBeUndefined()
  })
})

describe('the deploy button', () => {
  it('opens Vercel with the project to copy and default names, with the address encoded', () => {
    const u = new URL(DEPLOY_URL)
    expect(u.origin + u.pathname).toBe('https://vercel.com/new/clone')
    expect(u.searchParams.get('repository-url')).toBe(UPSTREAM_REPO_URL)
    expect(u.searchParams.get('project-name')).toBe('hippo')
    expect(u.searchParams.get('repository-name')).toBe('hippo')
    expect(DEPLOY_URL).toContain('repository-url=https%3A%2F%2Fgithub.com%2Fthekozugroup%2FHippo')
  })

  it('is the address the README button uses', () => {
    expect(readme).toContain(`](${DEPLOY_URL})`)
    expect(readme).toContain('https://vercel.com/button')
  })
})
