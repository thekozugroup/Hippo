// The app shell with Capacitor mocked: shares from other apps (at start and
// while running), links to the website, Back, and system bar styles.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Listener = (data?: unknown) => void
const appListeners = vi.hoisted(() => new Map<string, Listener>())
const sharedListeners = vi.hoisted(() => new Map<string, Listener>())
const app = vi.hoisted(() => ({
  addListener: vi.fn(async (event: string, cb: Listener) => {
    appListeners.set(event, cb)
    return { remove: async () => undefined }
  }),
  toggleBackButtonHandler: vi.fn(async () => undefined),
  minimizeApp: vi.fn(async () => undefined),
}))
const sharedText = vi.hoisted(() => ({
  take: vi.fn(),
  addListener: vi.fn(async (event: string, cb: Listener) => {
    sharedListeners.set(event, cb)
    return { remove: async () => undefined }
  }),
}))
const bars = vi.hoisted(() => ({ setStyle: vi.fn(async () => undefined) }))
const nav = vi.hoisted(() => ({ navigate: vi.fn(), historyIndex: vi.fn(() => 0) }))
const resumed = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/app', () => ({ App: app }))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: vi.fn(async () => ({ remove: async () => undefined })) } }))
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: vi.fn(async () => undefined) } }))
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { rmdir: vi.fn(async () => undefined), writeFile: vi.fn() }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }))
vi.mock('@capacitor/core', () => ({
  SystemBars: bars,
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
  SystemBarType: { StatusBar: 'StatusBar', NavigationBar: 'NavigationBar' },
  registerPlugin: (name: string) => (name === 'SharedText' ? sharedText : { perform: vi.fn(async () => undefined), fetch: vi.fn() }),
  CapacitorHttp: { request: vi.fn() },
}))
vi.mock('../core/core.ts', () => ({ appResumed: resumed }))
vi.mock('../layout/motionLocation.ts', () => nav)
vi.mock('../lib/site-address.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/site-address.ts')>()), PUBLIC_SITE_URL: 'https://site.example/Hippo/' }))

import { captureEpoch, clearCaptureDraft, peekCaptureDraft } from '../core/capture.ts'
import { startShell } from './shell.ts'

const flush = () => new Promise((r) => setTimeout(r, 0))
const atStart: { navigate: unknown[][]; setStyle: unknown[][]; toggle: unknown[][] } = { navigate: [], setStyle: [], toggle: [] }

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }))
  window.location.hash = '#/'
  // A share is waiting when the app starts (Android started Hippo from another app's Share).
  sharedText.take.mockResolvedValueOnce({ title: 'Red wool scarf', text: 'Look at this https://shop.example/p/red-scarf?utm_source=share&id=4' }).mockResolvedValue({})
  startShell()
  await flush()
  // Mock calls are cleared before each test, so keep what start-up did.
  atStart.navigate = [...nav.navigate.mock.calls]
  atStart.setStyle = [...bars.setStyle.mock.calls]
  atStart.toggle = [...app.toggleBackButtonHandler.mock.calls]
})
afterEach(() => {
  nav.navigate.mockClear()
})

describe('app shell', () => {
  it('cold start: the share that was waiting opens Add a wish, with tracking parameters removed', () => {
    expect(atStart.navigate).toEqual([['/item/new']])
    const draft = peekCaptureDraft()
    expect(draft).toEqual({ title: 'Red wool scarf', url: 'https://shop.example/p/red-scarf?id=4' })
  })

  it('a share while the app runs replaces the form (new epoch) and goes to Add a wish', async () => {
    const before = captureEpoch()
    sharedText.take.mockResolvedValueOnce({ text: 'https://other.example/kite' })
    sharedListeners.get('received')?.()
    await flush()
    expect(nav.navigate).toHaveBeenCalledWith('/item/new')
    expect(captureEpoch()).toBe(before + 1)
    expect(peekCaptureDraft()).toEqual({ title: 'Kite', url: 'https://other.example/kite' })
    clearCaptureDraft()
  })

  it('ignores shares without anything usable', async () => {
    const before = captureEpoch()
    sharedText.take.mockResolvedValueOnce({ title: 42 })
    sharedListeners.get('received')?.()
    sharedText.take.mockRejectedValueOnce(new Error('bridge gone'))
    sharedListeners.get('received')?.()
    await flush()
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(captureEpoch()).toBe(before)
  })

  it('opens share links of the public website, and nothing else', () => {
    const open = appListeners.get('appUrlOpen')
    open?.({ url: 'https://site.example/Hippo/#/l/AQIDBAUG' })
    expect(nav.navigate).toHaveBeenCalledWith('/l/AQIDBAUG')
    nav.navigate.mockClear()
    for (const url of ['https://evil.example/Hippo/#/l/AQIDBAUG', 'http://site.example/Hippo/#/l/AQIDBAUG', 'https://site.example/Other/#/l/AQIDBAUG', 'https://site.example/Hippo/#/settings', 42]) {
      open?.({ url })
    }
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('Back: hands Back to Android on a top-level screen, takes it while a sheet is open, and closes the sheet', async () => {
    // Home, nothing behind it: Android's own back (and its predictive animation) handles it.
    expect(atStart.toggle.at(-1)).toEqual([{ enabled: false }])
    const dialog = document.createElement('dialog')
    // jsdom has no dialog methods; close() is what the shell calls (BottomSheet then tells React).
    dialog.close = () => dialog.removeAttribute('open')
    document.body.append(dialog)
    dialog.setAttribute('open', '')
    await flush()
    expect(app.toggleBackButtonHandler).toHaveBeenLastCalledWith({ enabled: true })
    appListeners.get('backButton')?.()
    expect(dialog.open).toBe(false)
    dialog.remove()
    await flush()
    expect(app.toggleBackButtonHandler).toHaveBeenLastCalledWith({ enabled: false })
  })

  it('Back goes back in history when there is history, home from a deep screen, and leaves from Home', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    nav.historyIndex.mockReturnValue(2)
    appListeners.get('backButton')?.()
    expect(back).toHaveBeenCalled()
    nav.historyIndex.mockReturnValue(0)
    window.location.hash = '#/item/new'
    appListeners.get('backButton')?.()
    expect(nav.navigate).toHaveBeenCalledWith('/', { replace: true })
    window.location.hash = '#/'
    appListeners.get('backButton')?.()
    expect(app.minimizeApp).toHaveBeenCalled()
    back.mockRestore()
  })

  it('sets light status bar icons, and navigation bar icons for the light sheet', () => {
    expect(atStart.setStyle).toContainEqual([{ style: 'DARK', bar: 'StatusBar' }])
    expect(atStart.setStyle).toContainEqual([{ style: 'LIGHT', bar: 'NavigationBar' }])
  })

  it('setup and the dark theme switch the navigation bar to light icons', async () => {
    bars.setStyle.mockClear()
    document.documentElement.setAttribute('data-theme', 'dark')
    await flush()
    expect(bars.setStyle).toHaveBeenCalledWith({ style: 'DARK', bar: 'NavigationBar' })
    document.documentElement.removeAttribute('data-theme')
    await flush()
    window.location.hash = '#/welcome/start'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(document.documentElement.dataset.field).toBe('night')
    window.location.hash = '#/'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(document.documentElement.dataset.field).toBeUndefined()
  })

  it('coming back to the foreground retries sync and checks the clock', () => {
    appListeners.get('resume')?.()
    expect(resumed).toHaveBeenCalled()
  })
})
