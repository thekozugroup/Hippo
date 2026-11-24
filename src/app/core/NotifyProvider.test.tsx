import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { NotifyProvider } from './NotifyProvider.tsx'
import { useNotify, type Notify } from './notify.ts'

function Grab({ onReady }: { onReady: (notify: Notify) => void }) {
  const notify = useNotify()
  useEffect(() => onReady(notify), [notify, onReady])
  return null
}

describe('NotifyProvider', () => {
  afterEach(() => vi.useRealTimers())

  it('a newer message replaces the one showing; a low-priority one waits until the toast is free', () => {
    vi.useFakeTimers()
    let notify: Notify = () => undefined
    render(
      <NotifyProvider>
        <Grab onReady={(n) => (notify = n)} />
      </NotifyProvider>,
    )
    act(() => notify('Imported 3 wishes.'))
    expect(screen.getByRole('status')).toHaveTextContent('Imported 3 wishes.')
    act(() => notify('Hippo is ready to work offline.', { whenFree: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Imported 3 wishes.')
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.getByRole('status')).toHaveTextContent('Hippo is ready to work offline.')
    act(() => notify('Link copied.'))
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
    act(() => vi.advanceTimersByTime(8000))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('status')).toHaveTextContent('')
    // With nothing showing, it shows at once.
    act(() => notify('Hippo is ready to work offline.', { whenFree: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Hippo is ready to work offline.')
  })
})
