import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, MemoryTransport, type DeploymentCheck } from '../../../core/index.ts'
import { CoreProvider } from '../../core/CoreProvider.tsx'
import { DeploymentChecks } from './DeploymentChecks.tsx'

const OK: DeploymentCheck = { id: 'https', status: 'ok', finding: 'This page is served over HTTPS.', fix: '' }
const WARN: DeploymentCheck = { id: 'own-origin', status: 'warning', finding: 'This copy shares its address with other sites.', fix: 'Use a domain of your own.' }
const PROBLEM: DeploymentCheck = { id: 'relays', status: 'problem', finding: '0 of 3 relays answered.', fix: 'Check your internet connection.' }
const UNKNOWN: DeploymentCheck = { id: 'persistent-storage', status: 'unknown', finding: 'This browser did not say.', fix: 'Nothing to do.' }

function setup(run: () => Promise<DeploymentCheck[]>) {
  const core = createCore({ dbName: `deploy-${Math.random()}`, transport: new MemoryTransport() })
  const user = userEvent.setup()
  render(
    <CoreProvider core={core}>
      <DeploymentChecks run={run} />
    </CoreProvider>,
  )
  return { user, row: () => screen.getByText('Deployment checks') }
}

describe('DeploymentChecks', () => {
  it('is closed and runs nothing until opened', async () => {
    const run = vi.fn(async () => [OK])
    const { user, row } = setup(run)
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('group')).not.toHaveAttribute('open')
    await user.click(row())
    expect(run).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('This page is served over HTTPS.')).toBeInTheDocument()
  })

  it('shows an ok check as one plain line with no mark and no fix', async () => {
    const { user, row } = setup(async () => [OK])
    await user.click(row())
    const item = (await screen.findByText(OK.finding)).closest('li')!
    expect(within(item).queryByText('Needs attention')).toBeNull()
    expect(within(item).queryByText('Could not check')).toBeNull()
    expect(item.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('All 1 checks passed.')
  })

  it('marks warnings and problems with a word and a fix, problems first, and announces the count', async () => {
    const { user, row } = setup(async () => [OK, WARN, PROBLEM])
    await user.click(row())
    await screen.findByText(PROBLEM.finding)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('.settings-check__finding')?.textContent)).toEqual([PROBLEM.finding, WARN.finding, OK.finding])
    expect(within(items[0]!).getByText('Needs attention')).toBeInTheDocument()
    expect(within(items[0]!).getByText(PROBLEM.fix)).toBeInTheDocument()
    expect(within(items[1]!).getByText('Needs attention')).toBeInTheDocument()
    expect(within(items[1]!).getByText(WARN.fix)).toBeInTheDocument()
    expect(items[2]!.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3 need attention.')
  })

  it('says "Could not check" for an unknown result', async () => {
    const { user, row } = setup(async () => [UNKNOWN, OK])
    await user.click(row())
    const item = (await screen.findByText(UNKNOWN.finding)).closest('li')!
    expect(within(item).getByText('Could not check')).toBeInTheDocument()
    expect(within(item).getByText(UNKNOWN.fix)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 could not be checked.')
  })

  it('shows a pending state, keeps the size of the button, and ignores a second press while checking', async () => {
    let finish: (c: DeploymentCheck[]) => void = () => undefined
    const run = vi.fn(() => new Promise<DeploymentCheck[]>((r) => (finish = r)))
    const { user, row } = setup(run)
    await user.click(row())
    expect(screen.getByRole('status')).toHaveTextContent('Checking')
    const again = screen.getByRole('button', { name: 'Check again' })
    expect(again).toHaveAttribute('aria-busy', 'true')
    await user.click(again)
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => finish([OK]))
    expect(screen.getByRole('status')).toHaveTextContent('All 1 checks passed.')
    expect(screen.getByRole('button', { name: 'Check again' })).not.toHaveAttribute('aria-busy')
  })

  it('runs again on "Check again" and keeps the old list on screen meanwhile', async () => {
    const results = [[PROBLEM], [OK]]
    let finish: (c: DeploymentCheck[]) => void = () => undefined
    const run = vi.fn(() => {
      const next = results.shift()
      return next ? Promise.resolve(next) : new Promise<DeploymentCheck[]>((r) => (finish = r))
    })
    const { user, row } = setup(run)
    await user.click(row())
    await screen.findByText(PROBLEM.finding)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await screen.findByText(OK.finding)
    expect(screen.queryByText(PROBLEM.finding)).toBeNull()
    expect(run).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(run).toHaveBeenCalledTimes(3)
    expect(screen.getByText(OK.finding)).toBeInTheDocument() // still there while checking
    await act(async () => finish([WARN]))
    expect(screen.getByText(WARN.finding)).toBeInTheDocument()
  })

  it('never hangs: a check that does not finish ends with a message and a way to try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { user, row } = setup(() => new Promise<DeploymentCheck[]>(() => undefined))
      await user.click(row())
      expect(screen.getByRole('status')).toHaveTextContent('Checking')
      await act(async () => void vi.advanceTimersByTime(12_500))
      expect(screen.getByRole('status')).toHaveTextContent('The checks did not finish. Try again.')
      expect(screen.getByRole('button', { name: 'Check again' })).not.toHaveAttribute('aria-busy')
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a rejected run as not finished', async () => {
    const { user, row } = setup(() => Promise.reject(new Error('boom')))
    await user.click(row())
    expect(await screen.findByText('The checks did not finish. Try again.')).toBeInTheDocument()
  })

  it('loads the updates part (version, check, helper) only once opened, and contacts nothing by itself', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const { user, row } = setup(async () => [OK])
      expect(screen.queryByRole('button', { name: 'Check for a newer version' })).toBeNull()
      await user.click(row())
      expect(await screen.findByRole('button', { name: 'Check for a newer version' })).toBeInTheDocument()
      expect(screen.getByText(__HIPPO_VERSION__)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Your repository' })).toBeInTheDocument()
      expect(fetchSpy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('github'))).toEqual([])
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
