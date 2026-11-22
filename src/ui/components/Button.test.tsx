import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, LinkButton } from './Button.tsx'

describe('Button', () => {
  it('fires onClick and defaults to type=button', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Add</Button>)
    const btn = screen.getByRole('button', { name: 'Add' })
    expect(btn).toHaveAttribute('type', 'button')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('ignores clicks while loading, keeps focus and announces busy', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).not.toBeDisabled()
    btn.focus()
    await userEvent.click(btn)
    await userEvent.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
    expect(btn).toHaveFocus()
  })

  it('is natively disabled when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Share
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Share' })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('hides the icon from assistive tech and applies the variant class', () => {
    render(
      <Button variant="primary" size="md" icon={<svg data-testid="icon" />}>
        Go
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toHaveClass('btn--primary', 'btn--md')
    expect(screen.getByTestId('icon').closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('LinkButton', () => {
  it('renders a link with the href', () => {
    render(<LinkButton href="#/lists">Lists</LinkButton>)
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '#/lists')
  })
})
