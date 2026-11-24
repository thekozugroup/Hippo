// The Android adapters with Capacitor's plugins mocked: share, backup files,
// native HTTP, haptics, and the pure shell decisions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const share = vi.hoisted(() => ({ share: vi.fn() }))
const fs = vi.hoisted(() => ({ writeFile: vi.fn(), rmdir: vi.fn() }))
const http = vi.hoisted(() => ({ request: vi.fn() }))
const local = vi.hoisted(() => ({ fetch: vi.fn(), perform: vi.fn(), take: vi.fn(), addListener: vi.fn() }))

vi.mock('@capacitor/share', () => ({ Share: share }))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: fs,
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}))
const bridge = vi.hoisted(() => ({ native: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => bridge.native },
  CapacitorHttp: http,
  registerPlugin: (name: string) => {
    if (name === 'PageFetch') return { fetch: local.fetch }
    if (name === 'TouchFeedback') return { perform: local.perform }
    return { take: local.take, addListener: local.addListener }
  },
}))

import { BACKUP_DIR, isBackupFileName, shareBackup, shareLink } from './share.ts'
import { fetchPage, headForDate } from './http.ts'
import { haptic, hapticFor } from './feedback.ts'
import { backActionFor, barStylesFor, sharedTextFrom } from './logic.ts'
import { capacitorSaysNative, isNativeApp } from './platform.ts'
import { PageFetchError } from '../../core/index.ts'

beforeEach(() => {
  for (const m of [share.share, fs.writeFile, fs.rmdir, http.request, local.fetch, local.perform]) m.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platform', () => {
  it('is never native in the website build, whatever the page claims', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    expect(isNativeApp()).toBe(false)
  })
  it("reads Capacitor's runtime check", () => {
    expect(capacitorSaysNative({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
    expect(capacitorSaysNative({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
    expect(capacitorSaysNative({})).toBe(false)
    expect(
      capacitorSaysNative({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('x')
          },
        },
      }),
    ).toBe(false)
  })
})

describe('share sheet', () => {
  it('shares a link and reports a cancel as cancelled, other errors as failed', async () => {
    share.share.mockResolvedValueOnce({})
    expect(await shareLink({ title: 'Birthday', text: 'My wishlist: Birthday', url: 'https://site.example/#/l/abc' })).toBe('shared')
    expect(share.share).toHaveBeenCalledWith({ title: 'Birthday', text: 'My wishlist: Birthday', url: 'https://site.example/#/l/abc', dialogTitle: 'Share link' })
    share.share.mockRejectedValueOnce(new Error('Share canceled'))
    expect(await shareLink({ title: 'B', url: 'https://site.example/' })).toBe('cancelled')
    share.share.mockRejectedValueOnce(new Error('No activity'))
    expect(await shareLink({ title: 'B', url: 'https://site.example/' })).toBe('failed')
  })

  it('writes a backup to the private cache folder, clears older ones first, and shares the file', async () => {
    fs.rmdir.mockResolvedValue(undefined)
    fs.writeFile.mockResolvedValue({ uri: 'file:///data/cache/backups/hippo-backup-2026-11-23.json' })
    share.share.mockResolvedValue({})
    expect(await shareBackup('hippo-backup-2026-11-23.json', '{"format":"hippo"}')).toBe('shared')
    expect(fs.rmdir).toHaveBeenCalledWith({ path: BACKUP_DIR, directory: 'CACHE', recursive: true })
    expect(fs.writeFile).toHaveBeenCalledWith({ path: 'backups/hippo-backup-2026-11-23.json', data: '{"format":"hippo"}', directory: 'CACHE', encoding: 'utf8', recursive: true })
    expect(share.share).toHaveBeenCalledWith({ title: 'hippo-backup-2026-11-23.json', files: ['file:///data/cache/backups/hippo-backup-2026-11-23.json'], dialogTitle: 'Save backup' })
  })

  it('refuses file names it did not make, and reports write failures', async () => {
    expect(isBackupFileName('../../shared_prefs/x.json')).toBe(false)
    expect(isBackupFileName('hippo-backup-2026-11-23.json')).toBe(true)
    expect(await shareBackup('../evil.json', '{}')).toBe('failed')
    expect(fs.writeFile).not.toHaveBeenCalled()
    fs.rmdir.mockRejectedValue(new Error('missing'))
    fs.writeFile.mockRejectedValue(new Error('disk full'))
    expect(await shareBackup('hippo-backup-2026-11-23.json', '{}')).toBe('failed')
    expect(share.share).not.toHaveBeenCalled()
  })
})

describe('native HTTP', () => {
  it('passes the page fetch through and turns plugin errors into PageFetchError codes', async () => {
    const page = { status: 200, url: 'https://shop.example/p', contentType: 'text/html', body: '<title>x</title>' }
    local.fetch.mockResolvedValueOnce(page)
    expect(await fetchPage('https://shop.example/p', { timeoutMs: 8000, maxBytes: 1000 })).toEqual(page)
    expect(local.fetch).toHaveBeenCalledWith({ url: 'https://shop.example/p', timeoutMs: 8000, maxBytes: 1000 })
    for (const [code, expected] of [
      ['blocked', 'blocked'],
      ['timeout', 'timeout'],
      ['network', 'network'],
      ['something else', 'network'],
    ] as const) {
      local.fetch.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      const e = await fetchPage('https://shop.example/p', { timeoutMs: 1, maxBytes: 1 }).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(PageFetchError)
      expect((e as PageFetchError).code).toBe(expected)
    }
  })

  it('asks the site for its Date header with a HEAD request that does not follow redirects', async () => {
    http.request.mockResolvedValueOnce({ status: 200, url: '', data: '', headers: { Date: 'Mon, 23 Nov 2026 10:00:00 GMT', Age: '3' } })
    const res = await headForDate('https://site.example/Hippo/?hippo-time=abc')
    expect(res.headers.get('date')).toBe('Mon, 23 Nov 2026 10:00:00 GMT')
    expect(res.headers.get('age')).toBe('3')
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://site.example/Hippo/?hippo-time=abc', method: 'HEAD', disableRedirects: true }))
  })

  it('sends nothing without the Android bridge (the clock then stays on the device time)', async () => {
    bridge.native = false
    await expect(headForDate('https://site.example/Hippo/')).rejects.toThrow()
    expect(http.request).not.toHaveBeenCalled()
    bridge.native = true
  })
})

describe('haptics', () => {
  it('taps for switches and for danger buttons inside an open sheet only', () => {
    document.body.innerHTML = `
      <input id="sw" type="checkbox" role="switch">
      <input id="cb" type="checkbox">
      <dialog open><button id="danger" class="btn btn--danger">Delete</button><button id="calm" class="btn btn--secondary">Keep</button></dialog>
      <button id="loose" class="btn btn--danger">Delete</button>`
    const el = (id: string) => document.getElementById(id)
    expect(hapticFor({ type: 'change', target: el('sw') })).toBe('toggle')
    expect(hapticFor({ type: 'change', target: el('cb') })).toBeUndefined()
    expect(hapticFor({ type: 'click', target: el('danger') })).toBe('warning')
    expect(hapticFor({ type: 'click', target: el('calm') })).toBeUndefined()
    expect(hapticFor({ type: 'click', target: el('loose') })).toBeUndefined()
    expect(hapticFor({ type: 'click', target: null })).toBeUndefined()
    expect(hapticFor({ type: 'slidecomplete', target: el('calm') })).toBe('confirm')
  })

  it('does nothing under reduced motion', () => {
    local.perform.mockResolvedValue(undefined)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    haptic('confirm')
    expect(local.perform).not.toHaveBeenCalled()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    haptic('confirm')
    expect(local.perform).toHaveBeenCalledWith({ kind: 'confirm' })
  })
})

describe('shell decisions', () => {
  it('Back closes a sheet, then goes back, then leaves from a top-level screen', () => {
    expect(backActionFor({ sheetOpen: true, historyIndex: 0, path: '/' })).toBe('close-sheet')
    expect(backActionFor({ sheetOpen: false, historyIndex: 2, path: '/item/new' })).toBe('history-back')
    expect(backActionFor({ sheetOpen: false, historyIndex: 1, path: '/settings' })).toBe('history-back')
    for (const path of ['/', '/wishlist', '/lists', '/settings', '/welcome/name']) {
      expect(backActionFor({ sheetOpen: false, historyIndex: 0, path }), path).toBe('leave')
    }
    // Opened straight from a share or a link, with nothing behind it: Home first.
    expect(backActionFor({ sheetOpen: false, historyIndex: 0, path: '/item/new' })).toBe('go-home')
    expect(backActionFor({ sheetOpen: false, historyIndex: 0, path: '/g/abc' })).toBe('go-home')
  })

  it('status bar icons are always light; navigation bar icons follow the theme and setup', () => {
    expect(barStylesFor({ dark: false, darkField: false })).toEqual({ status: 'DARK', navigation: 'LIGHT' })
    expect(barStylesFor({ dark: true, darkField: false })).toEqual({ status: 'DARK', navigation: 'DARK' })
    expect(barStylesFor({ dark: false, darkField: true })).toEqual({ status: 'DARK', navigation: 'DARK' })
    // The light sheet under the status bar: dark icons; the dark sheet or the night field keep them light.
    expect(barStylesFor({ dark: false, darkField: false, sheetUnder: true })).toEqual({ status: 'LIGHT', navigation: 'LIGHT' })
    expect(barStylesFor({ dark: true, darkField: false, sheetUnder: true })).toEqual({ status: 'DARK', navigation: 'DARK' })
    expect(barStylesFor({ dark: false, darkField: true, sheetUnder: true })).toEqual({ status: 'DARK', navigation: 'DARK' })
  })

  it('takes only string fields from a share', () => {
    expect(sharedTextFrom({ title: 'Scarf', text: 'https://shop.example/s' })).toEqual({ title: 'Scarf', text: 'https://shop.example/s' })
    expect(sharedTextFrom({ text: 'https://shop.example/s', extra: 1 })).toEqual({ text: 'https://shop.example/s' })
    expect(sharedTextFrom({ title: 5, text: ['x'] })).toBeNull()
    expect(sharedTextFrom({ title: '  ', text: '' })).toBeNull()
    expect(sharedTextFrom({})).toBeNull()
    expect(sharedTextFrom(null)).toBeNull()
    expect(sharedTextFrom('https://x.example')).toBeNull()
  })
})
