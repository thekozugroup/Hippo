import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, MemoryTransport } from '../../core/index.ts'
import { App } from '../App.tsx'
import { NotifyProvider } from '../core/NotifyProvider.tsx'
import { installGuideFor, installPlacement, readInstallEnv, type InstallEnv } from './guide.ts'
import { welcomeStepsFor } from '../core/onboarding.ts'
import { setWelcomeOrder, welcomeOrder } from '../layout/routeMotion.ts'
import { InstallGuide } from './InstallGuide.tsx'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.27.79 (iPhone15,2; iOS 18_6; en_GB; en-GB; scale=3.00; 1179x2556; 734582132)'

const env = (userAgent: string, more: Partial<InstallEnv> = {}): InstallEnv => ({ userAgent, maxTouchPoints: 5, standalone: false, canPrompt: false, ...more })

function withNotify(ui: React.ReactNode) {
  return render(<NotifyProvider>{ui}</NotifyProvider>)
}

/** A browser install prompt, as Chromium fires it. */
function firePrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn(() => Promise.resolve())
  Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) })
  window.dispatchEvent(e)
  return prompt
}

const realUa = navigator.userAgent
const realOrder = welcomeOrder()
/** Pretends to be another device. Setup's step order is fixed when the app starts, so it is worked out again here as App.tsx does. */
function setUserAgent(ua: string, touch = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touch, configurable: true })
  setWelcomeOrder(ua === realUa ? realOrder : welcomeStepsFor(installPlacement(installGuideFor(readInstallEnv(false)))))
}

// An accepted prompt marks Hippo installed for the rest of the page's life (as in a real tab), so
// the tests that accept one run last.
describe('the setup step', () => {
  afterEach(() => setUserAgent(realUa))

  it('on iPhone: Home Screen steps, why it comes first, "I added it" and carrying on in the browser', async () => {
    setUserAgent(IPHONE, 5)
    window.location.hash = '#/welcome/install'
    const user = userEvent.setup()
    render(<App core={createCore({ dbName: `install-${Math.random()}`, transport: new MemoryTransport() })} />)
    expect(await screen.findByRole('heading', { level: 1, name: /Put Hippo on\s*your Home Screen/ })).toBeInTheDocument()
    expect(screen.getByText(/On iPhone, the Home Screen app keeps its own copy/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'I added it' }))
    expect(await screen.findByText(/Now open Hippo from your Home Screen/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Carry on in the browser' }))
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('in an app’s browser: Copy link is the main button and carrying on here is the other', async () => {
    setUserAgent(INSTAGRAM, 5)
    window.location.hash = '#/welcome/install'
    render(<App core={createCore({ dbName: `install-${Math.random()}`, transport: new MemoryTransport() })} />)
    expect(await screen.findByRole('heading', { level: 1, name: /Open Hippo\s*in Safari first/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Carry on here' })).toBeInTheDocument()
  })
  it('on Android with the prompt: the main button installs; afterwards it continues', async () => {
    setUserAgent(ANDROID)
    const prompt = firePrompt('accepted')
    window.location.hash = '#/welcome/install'
    const user = userEvent.setup()
    render(<App core={createCore({ dbName: `install-${Math.random()}`, transport: new MemoryTransport() })} />)
    expect(await screen.findByRole('heading', { level: 1, name: /Put Hippo on\s*your home screen/ })).toBeInTheDocument()
    expect(screen.getByText(/shows up when you tap Share in other apps/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install Hippo' }))
    expect(prompt).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getAllByText('Hippo is installed. Open it from your home screen.').length).toBeGreaterThan(0)
  })

})

describe('InstallGuide', () => {
  it('shows the steps as a numbered list, icons hidden, the device’s words in bold', () => {
    withNotify(<InstallGuide guide={installGuideFor(env(IPHONE))} />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[1]).toHaveTextContent('Scroll down and tap Add to Home Screen.')
    expect(within(items[1] as HTMLElement).getByText('Add to Home Screen').tagName).toBe('STRONG')
    for (const svg of list.querySelectorAll('svg')) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says nothing when the install prompt is dismissed, and leaves the button there', async () => {
    const user = userEvent.setup()
    firePrompt('dismissed')
    withNotify(<InstallGuide guide={installGuideFor(env(ANDROID, { canPrompt: true, maxTouchPoints: 0 }))} />)
    await user.click(screen.getByRole('button', { name: 'Install Hippo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install Hippo' })).not.toHaveAttribute('aria-busy'))
    expect(screen.queryByText(/installed/)).toBeNull()
  })

  it('inside an app: copies Hippo’s own address, never the page fragment', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/g/secret-topic'
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    withNotify(<InstallGuide guide={installGuideFor(env(INSTAGRAM))} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(window.location.origin + window.location.pathname)
    expect(String(writeText.mock.calls[0])).not.toContain('secret')
    expect(await screen.findByText('Link copied. Open Safari and paste it.')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('says so when Hippo is already installed', () => {
    withNotify(<InstallGuide guide={installGuideFor(env(IPHONE, { standalone: true }))} />)
    expect(screen.getByText('Hippo is installed on this device.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })
  it('offers the browser’s install prompt as one button and announces when it worked', async () => {
    const user = userEvent.setup()
    const prompt = firePrompt('accepted')
    withNotify(<InstallGuide guide={installGuideFor(env(ANDROID, { canPrompt: true, maxTouchPoints: 0 }))} />)
    expect(screen.queryByRole('list')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Install Hippo' }))
    expect(prompt).toHaveBeenCalledOnce()
    expect(await screen.findByText('Hippo is installed. Open it from your home screen.')).toBeInTheDocument()
  })

})
