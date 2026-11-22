import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomSheet } from './BottomSheet.tsx'

// jsdom does not implement <dialog> methods; model the parts we rely on.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Claim
      </button>
      <BottomSheet
        open={open}
        title="Claim this gift"
        description="Cast iron pan"
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
      >
        <label>
          Your name
          <input />
        </label>
        <button type="button">Confirm</button>
      </BottomSheet>
    </>
  )
}

describe('BottomSheet', () => {
  it('is closed by default and has no dialog in the accessibility tree', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a named, described dialog and moves focus inside', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    const dialog = screen.getByRole('dialog', { name: 'Claim this gift' })
    expect(dialog).toHaveAccessibleDescription('Cast iron pan')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus()
  })

  it('closes with the close button and returns focus to the trigger', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: 'Claim' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape (the dialog cancel event)', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a click on the backdrop but not on the content', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
