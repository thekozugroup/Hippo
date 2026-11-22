import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, getSettings, LINK_PREVIEW_HOST, MemoryTransport, setLinkPreviewEnabled, type Core } from '../../core/index.ts'
import { App } from '../App.tsx'
import { clearCaptureDraft, handleStartupCapture } from '../core/capture.ts'

const LINK = 'https://shop.example/p/steel-kettle'
const FOUND = { status: 'success', data: { title: 'Steel kettle 1.7 L', image: { url: 'https://img.example/kettle.jpg' } } }
const LOOKING = 'Looking up the title and picture…'
const OFF_HINT = 'Pictures come automatically when you add with the bookmarklet or Shortcut. You can also turn on Link lookup in Settings.'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function deferred() {
  let resolve: (r: Response) => void = () => undefined
  const promise = new Promise<Response>((r) => (resolve = r))
  return { promise, resolve }
}

function setup(opts: { on?: boolean } = {}) {
  const core: Core = createCore({ dbName: `lookup-${Math.random()}`, transport: new MemoryTransport() })
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  return { core, fetchMock, user: userEvent.setup(), ready: opts.on ? setLinkPreviewEnabled(core.db, true) : Promise.resolve() }
}

async function openEditor(core: Core) {
  window.location.hash = '#/item/new'
  const view = render(<App core={core} />)
  await screen.findByRole('heading', { level: 1, name: 'Add a wish' })
  return view
}

const linkField = () => screen.getByRole('textbox', { name: 'Shop link' })
const nameField = () => screen.getByRole('textbox', { name: 'Name' })
/** The hint under the link field and the screen reader copy of it say the same thing. */
const said = (text: string) => screen.findAllByText(text)
const pictureField = () => screen.getByRole('textbox', { name: 'Picture link' })

async function pasteLink(user: ReturnType<typeof userEvent.setup>, link = LINK) {
  await user.click(linkField())
  await user.paste(link)
}

describe('wish editor: link lookup', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    clearCaptureDraft()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is off by default: a pasted link makes no request and shows one quiet hint, once per device', async () => {
    const { core, fetchMock, user } = setup()
    const first = await openEditor(core)
    await pasteLink(user)
    expect(await said(OFF_HINT)).not.toHaveLength(0)
    expect(nameField()).toHaveValue('Steel kettle')
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(async () => expect((await getSettings(core.db)).seen.linkPreviewHint).toBeTypeOf('number'))
    first.unmount()

    await openEditor(core)
    await pasteLink(user, 'https://other.example/p/teapot')
    expect(nameField()).toHaveValue('Teapot')
    expect(screen.queryAllByText(OFF_HINT)).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('off: no hint when a picture is already there, and no request for a prefilled link', async () => {
    const { core, fetchMock, user } = setup()
    handleStartupCapture(
      { search: `?url=${encodeURIComponent(LINK)}`, href: 'http://localhost/?x', hash: '' } as Location,
      { replaceState: () => undefined } as unknown as History,
    )
    await openEditor(core)
    await act(async () => undefined)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryAllByText(OFF_HINT)).toHaveLength(0)
    await user.type(pictureField(), 'https://img.example/a.jpg')
    await pasteLink(user, 'https://other.example/p/teapot')
    expect(screen.queryAllByText(OFF_HINT)).toHaveLength(0)
  })

  it('on: shows a pending line near the link, then fills the empty name and picture and says so', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    await openEditor(core)
    await pasteLink(user)
    expect(await said(LOOKING)).not.toHaveLength(0)
    expect(screen.getAllByRole('status').map((n) => n.textContent)).toContain(LOOKING) // announced politely
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(LINK_PREVIEW_HOST)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(encodeURIComponent(LINK))
    await act(async () => d.resolve(json(FOUND)))
    await waitFor(() => expect(nameField()).toHaveValue('Steel kettle 1.7 L'))
    expect(pictureField()).toHaveValue('https://img.example/kettle.jpg')
    expect(screen.queryAllByText(LOOKING)).toHaveLength(0)
    expect(screen.getAllByText('Filled in the title and picture. Check it before saving.').length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on: never overwrites what was typed, even when the answer arrives late', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    await openEditor(core)
    await user.type(nameField(), 'My kettle')
    await pasteLink(user)
    await said(LOOKING)
    await user.type(pictureField(), 'https://img.example/mine.jpg') // typed while waiting
    await act(async () => d.resolve(json(FOUND)))
    await waitFor(() => expect(screen.queryAllByText(LOOKING)).toHaveLength(0))
    expect(nameField()).toHaveValue('My kettle')
    expect(pictureField()).toHaveValue('https://img.example/mine.jpg')
  })

  it('on: a name that is only a guess from the link is replaced, a typed picture is kept', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    fetchMock.mockResolvedValueOnce(json(FOUND))
    await openEditor(core)
    await user.type(pictureField(), 'https://img.example/mine.jpg')
    await pasteLink(user)
    await waitFor(() => expect(nameField()).toHaveValue('Steel kettle 1.7 L'))
    expect(pictureField()).toHaveValue('https://img.example/mine.jpg')
    expect(screen.getAllByText('Filled in the title. Check it before saving.').length).toBeGreaterThan(0)
  })

  it('on: a prefilled link is looked up once on arrival', async () => {
    const { core, fetchMock, ready } = setup({ on: true })
    await ready
    fetchMock.mockResolvedValue(json(FOUND))
    handleStartupCapture(
      { search: `?url=${encodeURIComponent(LINK)}`, href: 'http://localhost/?x', hash: '' } as Location,
      { replaceState: () => undefined } as unknown as History,
    )
    await openEditor(core)
    await waitFor(() => expect(nameField()).toHaveValue('Steel kettle 1.7 L'))
    expect(pictureField()).toHaveValue('https://img.example/kettle.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['is rate limited', () => json({ status: 'fail', code: 'ERATE' }, 429), 'The free lookup service has no lookups left for now. You can add the title and picture yourself.'],
    ['finds nothing', () => json({ status: 'fail', code: 'EINVAL' }, 404), 'No title or picture found for this link. You can add them yourself.'],
    ['fails', () => json({}, 500), 'Could not look up this link. You can add the title and picture yourself.'],
  ])('on: when the service %s, it says so once and the wish can still be saved', async (_name, response, message) => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    fetchMock.mockResolvedValue(response())
    await openEditor(core)
    await pasteLink(user)
    expect(await said(message)).not.toHaveLength(0)
    expect(nameField()).toHaveValue('Steel kettle') // the guess stays
    // Leaving and re-entering the field does not ask again.
    await user.tab()
    await user.click(linkField())
    await user.tab()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wishlist' })).toBeInTheDocument()
  })

  it('on: a network error is reported like any other failure', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await openEditor(core)
    await pasteLink(user)
    expect(await said('Could not look up this link. You can add the title and picture yourself.')).not.toHaveLength(0)
  })

  it('on: changing the link cancels the lookup, so its answer is dropped', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    await openEditor(core)
    await pasteLink(user)
    await said(LOOKING)
    await user.type(linkField(), 'x')
    expect(screen.queryAllByText(LOOKING)).toHaveLength(0)
    await act(async () => d.resolve(json(FOUND)))
    expect(nameField()).toHaveValue('Steel kettle')
    expect(pictureField()).toHaveValue('')
    expect(screen.queryAllByText(/Filled in/)).toHaveLength(0)
  })

  it('on: pasting a newer link replaces the lookup in flight', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    const a = deferred()
    const b = deferred()
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await openEditor(core)
    await pasteLink(user)
    await said(LOOKING)
    await user.clear(linkField())
    await pasteLink(user, 'https://shop.example/p/teapot')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await act(async () => a.resolve(json(FOUND)))
    expect(pictureField()).toHaveValue('')
    await act(async () => b.resolve(json({ status: 'success', data: { title: 'Teapot', image: 'https://img.example/t.jpg' } })))
    await waitFor(() => expect(pictureField()).toHaveValue('https://img.example/t.jpg'))
  })

  it('on: leaving the screen cancels the lookup', async () => {
    const { core, fetchMock, user, ready } = setup({ on: true })
    await ready
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = await openEditor(core)
    await pasteLink(user)
    await said(LOOKING)
    view.unmount()
    await act(async () => d.resolve(json(FOUND)))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
