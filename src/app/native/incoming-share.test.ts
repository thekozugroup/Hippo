// Shares from other apps (Android's Share, then Hippo) with the Capacitor bridge mocked: the app
// not running (cold start), running in the foreground or the background, two shares in a row,
// Android handing an old share back, a first launch, transfer links and text without a link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (data?: unknown) => void
const sharedListeners = vi.hoisted(() => new Map<string, Listener>())
const sharedText = vi.hoisted(() => ({
  take: vi.fn(),
  addListener: vi.fn(async (event: string, cb: Listener) => {
    sharedListeners.set(event, cb)
    return { remove: async () => undefined }
  }),
}))
const nav = vi.hoisted(() => ({ navigate: vi.fn(), historyIndex: vi.fn(() => 0) }))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
    toggleBackButtonHandler: vi.fn(async () => undefined),
    minimizeApp: vi.fn(async () => undefined),
  },
}))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: vi.fn(async () => ({ remove: async () => undefined })) } }))
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: vi.fn(async () => undefined) } }))
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { rmdir: vi.fn(async () => undefined), writeFile: vi.fn() }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }))
vi.mock('@capacitor/core', () => ({
  SystemBars: { setStyle: vi.fn(async () => undefined) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
  SystemBarType: { StatusBar: 'StatusBar', NavigationBar: 'NavigationBar' },
  registerPlugin: (name: string) => (name === 'SharedText' ? sharedText : { perform: vi.fn(async () => undefined), fetch: vi.fn() }),
  CapacitorHttp: { request: vi.fn() },
}))
vi.mock('../core/core.ts', () => ({ appResumed: vi.fn() }))
vi.mock('../layout/motionLocation.ts', () => nav)

type CaptureModule = typeof import('../core/capture.ts')
type InboxModule = typeof import('../lib/transfer-inbox.ts')

const flush = () => new Promise((r) => setTimeout(r, 0))

/** A fresh app: new modules (as after the process started), with `waiting` held by the plugin at start. */
async function launch(waiting: unknown = {}): Promise<{ capture: CaptureModule; inbox: InboxModule }> {
  vi.resetModules()
  sharedListeners.clear()
  sharedText.take.mockReset()
  sharedText.take.mockResolvedValueOnce(waiting).mockResolvedValue({})
  const capture = await import('../core/capture.ts')
  const inbox = await import('../lib/transfer-inbox.ts')
  const shell = await import('./shell.ts')
  shell.startShell()
  await flush()
  return { capture, inbox }
}

/** What the plugin does when a share arrives while the app runs: holds it and fires "received". */
async function arrive(...answers: unknown[]): Promise<void> {
  for (const a of answers) sharedText.take.mockResolvedValueOnce(a)
  for (let i = 0; i < answers.length; i++) sharedListeners.get('received')?.()
  await flush()
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }))
  window.location.hash = '#/'
  nav.navigate.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('share into Hippo', () => {
  it('cold start: the share that started the app opens Add a wish once the web app asks for it', async () => {
    const { capture } = await launch({ title: 'Red wool scarf', text: 'https://example.com/products/red-wool-scarf?utm_source=share', seq: 1 })
    expect(sharedText.take).toHaveBeenCalledTimes(1)
    expect(nav.navigate.mock.calls).toEqual([['/item/new']])
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Red wool scarf', url: 'https://example.com/products/red-wool-scarf' })
  })

  it('cold start without a share: nothing opens', async () => {
    const { capture } = await launch({})
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(capture.peekCaptureDraft()).toBeNull()
  })

  it('running (foreground or background): "received" takes the share and opens Add a wish', async () => {
    const { capture } = await launch({})
    expect(sharedText.addListener).toHaveBeenCalledWith('received', expect.any(Function))
    const before = capture.captureEpoch()
    await arrive({ title: 'Kite', text: 'https://shop.example/kite?gclid=x&size=2', seq: 1 })
    expect(nav.navigate.mock.calls).toEqual([['/item/new']])
    expect(capture.captureEpoch()).toBe(before + 1)
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Kite', url: 'https://shop.example/kite?size=2' })
  })

  it('two shares in a row: the form shows the second', async () => {
    const { capture } = await launch({})
    await arrive({ title: 'First', text: 'https://a.example/first', seq: 1 })
    const afterFirst = capture.captureEpoch()
    await arrive({ title: 'Second', text: 'https://b.example/second', seq: 2 })
    expect(capture.captureEpoch()).toBe(afterFirst + 1)
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Second', url: 'https://b.example/second' })
  })

  it('two shares before the web app reads either: the plugin keeps only the second, and an older answer arriving late is ignored', async () => {
    const { capture } = await launch({})
    // Two "received" events; the plugin already holds only the second share, so the second take is empty.
    await arrive({ title: 'Second', text: 'https://b.example/second', seq: 2 }, {})
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Second', url: 'https://b.example/second' })
    // A stale answer (a lower share number) never replaces it.
    await arrive({ title: 'First', text: 'https://a.example/first', seq: 1 })
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Second', url: 'https://b.example/second' })
    expect(nav.navigate).toHaveBeenCalledTimes(1)
  })

  it('re-delivery: an intent Android hands back after recreating the app gives nothing, and the same share is never used twice', async () => {
    // The plugin skips a re-delivered intent (ShareInbox.isRedelivery), so the recreated app finds nothing.
    const { capture } = await launch({})
    expect(nav.navigate).not.toHaveBeenCalled()
    await arrive({ title: 'Kite', text: 'https://shop.example/kite', seq: 4 })
    capture.clearCaptureDraft()
    nav.navigate.mockClear()
    // The same share number again (a duplicate answer) does not reopen the form.
    await arrive({ title: 'Kite', text: 'https://shop.example/kite', seq: 4 })
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(capture.peekCaptureDraft()).toBeNull()
  })

  it('first launch: a share wins over setup on Home, and setup still comes when nothing was shared', async () => {
    const { capture } = await launch({ title: 'Red wool scarf', text: 'https://example.com/p/scarf', seq: 1 })
    expect(nav.navigate.mock.calls).toEqual([['/item/new']])
    // Home decides after the share was taken: it sends the new owner to the form, not to setup.
    expect(capture.homeRedirect('start', capture.peekCaptureDraft() !== null)).toBe('/item/new')
    capture.clearCaptureDraft()
    expect(capture.homeRedirect('start', capture.peekCaptureDraft() !== null)).toBe('/welcome/start')
    // A returning owner stays on Home either way.
    expect(capture.homeRedirect(null, true)).toBeNull()
  })

  it('a transfer link goes to the transfer import, never into a wish', async () => {
    const payload = 'A'.repeat(92)
    const { capture, inbox } = await launch({})
    await arrive({ text: `Open this on your phone: https://h.example/#/t/${payload}`, seq: 1 })
    expect(nav.navigate.mock.calls).toEqual([['/move/receive']])
    expect(inbox.heldTransferPayload()).toBe(payload)
    expect(capture.peekCaptureDraft()).toBeNull()
  })

  it('text without a link becomes the name, and what does not fit goes to the notes', async () => {
    const { capture } = await launch({ text: 'Blue kite for the beach', seq: 1 })
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Blue kite for the beach' })
    const long = `${'word '.repeat(60)}end`
    await arrive({ text: long, seq: 2 })
    const draft = capture.peekCaptureDraft()
    expect(Array.from(draft?.title ?? '').length).toBe(200)
    expect(draft?.notes).toBe(long)
    expect(draft?.url).toBeUndefined()
  })

  it('words beside a link: the name with no subject, the notes next to a subject', async () => {
    const { capture } = await launch({ text: 'Acme Trail Shoes, size 42 https://shop.example/dp/B0X1?utm_medium=app', seq: 1 })
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Acme Trail Shoes, size 42', url: 'https://shop.example/dp/B0X1' })
    await arrive({ title: 'Trail shoes', text: 'Look at these https://shop.example/dp/B0X1', seq: 2 })
    expect(capture.peekCaptureDraft()).toEqual({ title: 'Trail shoes', url: 'https://shop.example/dp/B0X1', notes: 'Look at these' })
    // Words that only repeat the subject are not copied into the notes.
    await arrive({ title: 'Trail shoes', text: 'Trail shoes https://shop.example/dp/B0X1', seq: 3 })
    expect(capture.peekCaptureDraft()?.notes).toBeUndefined()
  })

  it('untrusted text: only http(s) links are taken, and nothing usable opens nothing', async () => {
    const { capture } = await launch({})
    await arrive({ text: 'javascript:alert(1)', seq: 1 })
    expect(capture.peekCaptureDraft()?.url).toBeUndefined()
    capture.clearCaptureDraft()
    nav.navigate.mockClear()
    await arrive({ title: '   ', text: '', seq: 2 }, { title: 7 })
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(capture.peekCaptureDraft()).toBeNull()
  })
})
