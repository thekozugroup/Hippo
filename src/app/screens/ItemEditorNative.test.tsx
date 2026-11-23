// The wish form inside the Android app: the phone reads the shop page itself
// (lookupOnDevice), a price counts as something to fill, nothing goes to the
// third-party service, and the setting can turn it off.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, MemoryTransport, setPageLookupEnabled, type Core, type LinkPreviewResult } from '../../core/index.ts'

const native = vi.hoisted(() => ({
  lookupOnDevice: vi.fn<(url: string, deps: { signal?: AbortSignal }) => Promise<LinkPreviewResult>>(),
}))

vi.mock('../native/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/index.ts')>()),
  isNativeApp: () => true,
  lookupOnDevice: native.lookupOnDevice,
}))
vi.mock('../native/platform.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/platform.ts')>()),
  isNativeApp: () => true,
}))

import { App } from '../App.tsx'
import { clearCaptureDraft, captureShared } from '../core/capture.ts'

const LINK = 'https://shop.example/p/steel-kettle'

function setup() {
  const core: Core = createCore({ dbName: `native-lookup-${Math.random()}`, transport: new MemoryTransport() })
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  return { core, fetchMock, user: userEvent.setup() }
}

async function openEditor(core: Core) {
  window.location.hash = '#/item/new'
  render(<App core={core} />)
  await screen.findByRole('heading', { level: 1, name: 'Add a wish' })
}

const field = (name: string) => screen.getByRole('textbox', { name })

describe('wish editor in the Android app', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    clearCaptureDraft()
    native.lookupOnDevice.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a shared link is read on the phone and fills the empty name, picture and price', async () => {
    const { core, fetchMock } = setup()
    native.lookupOnDevice.mockResolvedValue({
      kind: 'found',
      patch: { title: 'Steel kettle 1.7 L', imageUrl: 'https://img.example/kettle.jpg', price: { amount: 3499, currency: 'EUR' } },
    })
    captureShared({ text: LINK })
    await openEditor(core)
    await waitFor(() => expect(field('Name')).toHaveValue('Steel kettle 1.7 L'))
    expect(field('Picture link')).toHaveValue('https://img.example/kettle.jpg')
    expect(screen.getByRole('textbox', { name: /Price/ })).toHaveValue('34.99')
    expect(native.lookupOnDevice).toHaveBeenCalledWith(LINK, expect.objectContaining({ db: core.db }))
    expect((await screen.findAllByText('Filled in the title, picture and price. Check it before saving.')).length).toBeGreaterThan(0)
    // Nothing went to the third-party service.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never overwrites what the person typed', async () => {
    const { core, user } = setup()
    let answer: (r: LinkPreviewResult) => void = () => undefined
    native.lookupOnDevice.mockImplementation(() => new Promise((r) => (answer = r)))
    await openEditor(core)
    await user.click(field('Shop link'))
    await user.paste(LINK)
    await user.clear(field('Name'))
    await user.type(field('Name'), 'My kettle')
    answer({ kind: 'found', patch: { title: 'Steel kettle 1.7 L', imageUrl: 'https://img.example/kettle.jpg' } })
    await waitFor(() => expect(field('Picture link')).toHaveValue('https://img.example/kettle.jpg'))
    expect(field('Name')).toHaveValue('My kettle')
  })

  it('looks up a pasted link whose name and picture are filled but whose price is empty', async () => {
    const { core } = setup()
    native.lookupOnDevice.mockResolvedValue({ kind: 'found', patch: { price: { amount: 1999, currency: 'USD' } } })
    captureShared({ title: 'Lamp', text: LINK })
    await openEditor(core)
    await waitFor(() => expect(native.lookupOnDevice).toHaveBeenCalled())
  })

  it('turned off in Settings: nothing is read and nothing is said', async () => {
    const { core, user } = setup()
    await setPageLookupEnabled(core.db, false)
    await openEditor(core)
    await user.click(field('Shop link'))
    await user.paste(LINK)
    expect(field('Name')).toHaveValue('Steel kettle')
    await new Promise((r) => setTimeout(r, 50))
    expect(native.lookupOnDevice).not.toHaveBeenCalled()
    expect(screen.queryByText(/Link lookup/)).toBeNull()
  })

  it('a newer link cancels the running lookup', async () => {
    const { core, user } = setup()
    const signals: AbortSignal[] = []
    native.lookupOnDevice.mockImplementation((_url, deps) => {
      if (deps.signal) signals.push(deps.signal)
      return new Promise(() => undefined)
    })
    await openEditor(core)
    await user.click(field('Shop link'))
    await user.paste(LINK)
    await waitFor(() => expect(signals).toHaveLength(1))
    await user.type(field('Shop link'), 'x')
    expect(signals[0]?.aborted).toBe(true)
  })
})
