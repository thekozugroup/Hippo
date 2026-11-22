import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from './Switch.tsx'

function Controlled() {
  const [on, setOn] = useState(false)
  return <Switch label="Show prices" checked={on} onChange={(e) => setOn(e.target.checked)} />
}

describe('Switch', () => {
  it('exposes role=switch with its label as the name', () => {
    render(<Switch label="Show prices" description="Givers see costs" />)
    expect(screen.getByRole('switch', { name: /Show prices/ })).not.toBeChecked()
  })

  it('toggles with a click and with Space', async () => {
    render(<Controlled />)
    const sw = screen.getByRole('switch', { name: 'Show prices' })
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    await userEvent.keyboard(' ')
    expect(sw).not.toBeChecked()
  })

  it('clicking the label toggles it', async () => {
    render(<Controlled />)
    await userEvent.click(screen.getByText('Show prices'))
    expect(screen.getByRole('switch')).toBeChecked()
  })

  it('does not toggle when disabled', async () => {
    const onChange = vi.fn()
    render(<Switch label="Locked" disabled onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Locked' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
