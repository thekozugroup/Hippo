import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import template from '../../../../scripts/hosting/hippo-update.yml?raw'
import { newWorkflowFileUrl, type UpdateCheck } from '../../lib/auto-update.ts'
import UpdatesPanel from './UpdatesPanel.tsx'

function setup(check: (v: string) => Promise<UpdateCheck> = vi.fn(async () => ({ status: 'current' as const, latest: '0.1.5' }))) {
  const openUrl = vi.fn()
  const user = userEvent.setup()
  render(<UpdatesPanel version="0.1.5" check={check} openUrl={openUrl} />)
  return { user, openUrl, check }
}

describe('UpdatesPanel', () => {
  it("shows this copy's version and contacts nothing until asked", () => {
    const check = vi.fn(async (): Promise<UpdateCheck> => ({ status: 'current', latest: '0.1.5' }))
    setup(check)
    expect(screen.getByText('0.1.5')).toBeInTheDocument()
    expect(check).not.toHaveBeenCalled()
  })

  it('uses the version the build was made with by default', () => {
    render(<UpdatesPanel check={vi.fn()} openUrl={vi.fn()} />)
    expect(screen.getByText(__HIPPO_VERSION__)).toBeInTheDocument()
    expect(__HIPPO_VERSION__).toMatch(/^\d+\.\d+\.\d+/)
  })

  it.each([
    [{ status: 'behind', latest: '0.1.6' }, 'Version 0.1.6 is available. This copy has 0.1.5.'],
    [{ status: 'current', latest: '0.1.5' }, 'This copy is up to date.'],
    [{ status: 'ahead', latest: '0.1.4' }, 'is newer than the newest stable version (0.1.4)'],
    [{ status: 'failed', reason: 'offline' }, 'GitHub could not be reached.'],
    [{ status: 'failed', reason: 'unreadable' }, 'GitHub did not send a version.'],
  ] as const)('announces the result of a check: %j', async (result, text) => {
    const { user } = setup(async () => result)
    await user.click(screen.getByRole('button', { name: 'Check for a newer version' }))
    const live = (await screen.findByText(text, { exact: false })).closest('[aria-live]')
    expect(live).toHaveAttribute('aria-live', 'polite')
  })

  it('opens the prefilled GitHub page for a valid repository and says what to do there', async () => {
    const { user, openUrl } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Your repository' }), ' ada/hippo ')
    await user.click(screen.getByRole('button', { name: /Open GitHub to add the file/ }))
    expect(openUrl).toHaveBeenCalledWith(newWorkflowFileUrl('ada/hippo', template))
    expect(screen.getByText(/Press Commit changes there/)).toBeInTheDocument()
  })

  it('refuses a repository that is not name/repository, with the reason on the field', async () => {
    const { user, openUrl } = setup()
    const field = screen.getByRole('textbox', { name: 'Your repository' })
    await user.type(field, 'hippo')
    await user.click(screen.getByRole('button', { name: /Open GitHub to add the file/ }))
    expect(openUrl).not.toHaveBeenCalled()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Use exactly one slash/)).toBeInTheDocument()
  })
})
