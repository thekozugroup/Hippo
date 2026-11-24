import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Core } from '../../core/index.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { ClockNoticeProvider } from './ClockNotice.tsx'
import { CoreContext } from './context.ts'
import { NotifyProvider } from './NotifyProvider.tsx'
import { useNotify } from './notify.ts'

/** A clock whose first measurement arrives when the test says so. */
function fakeClock() {
  let offset: number | undefined
  const listeners = new Set<() => void>()
  return {
    clock: { ready: () => Promise.resolve(), offset: () => offset, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) },
    measure(ms: number) {
      offset = ms
      for (const l of [...listeners]) l()
    },
  }
}

function OtherMessage() {
  const notify = useNotify()
  return (
    <button type="button" onClick={() => notify('Hippo is ready to work offline.')}>
      Other message
    </button>
  )
}

function renderApp(clock: ReturnType<typeof fakeClock>['clock']) {
  const core = { clockSync: clock } as unknown as Core
  return render(
    <CoreContext value={core}>
      <NotifyProvider>
        <ClockNoticeProvider>
          <AppScreen title="Clock test">
            <OtherMessage />
          </AppScreen>
        </ClockNoticeProvider>
      </NotifyProvider>
    </CoreContext>,
  )
}

describe('clock notice', () => {
  beforeEach(() => localStorage.clear())

  it('a wrong clock is told on the screen and stays there when the next message replaces the toast, until dismissed', async () => {
    const user = userEvent.setup()
    const { clock, measure } = fakeClock()
    renderApp(clock)
    expect(screen.queryByRole('note', { name: 'Device clock' })).toBeNull()
    // The measurement arrives after the first render, as it does on a slow device.
    act(() => measure(-3600_000))
    const note = screen.getByRole('note', { name: 'Device clock' })
    expect(note).toHaveTextContent('The clock on this device is about 1 hour ahead.')
    expect(screen.getByRole('status')).toHaveTextContent('The clock on this device is about 1 hour ahead.')
    await user.click(screen.getByRole('button', { name: 'Other message' }))
    expect(screen.getByRole('status')).toHaveTextContent('Hippo is ready to work offline.')
    expect(screen.getByRole('note', { name: 'Device clock' })).toHaveTextContent('about 1 hour ahead')
    await user.click(screen.getByRole('button', { name: 'Dismiss the clock notice' }))
    expect(screen.queryByRole('note', { name: 'Device clock' })).toBeNull()
  })

  it('is told once: a later visit with the same wrong clock says nothing; a fixed clock clears it', () => {
    const first = fakeClock()
    const r = renderApp(first.clock)
    act(() => first.measure(3600_000))
    expect(screen.getByRole('note', { name: 'Device clock' })).toHaveTextContent('about 1 hour behind')
    r.unmount()

    const again = fakeClock()
    const r2 = renderApp(again.clock)
    act(() => again.measure(3600_000))
    expect(screen.queryByRole('note', { name: 'Device clock' })).toBeNull()
    act(() => again.measure(1000))
    act(() => again.measure(3600_000))
    expect(screen.getByRole('note', { name: 'Device clock' })).toBeInTheDocument()
    act(() => again.measure(0))
    expect(screen.queryByRole('note', { name: 'Device clock' })).toBeNull()
    r2.unmount()
  })
})
