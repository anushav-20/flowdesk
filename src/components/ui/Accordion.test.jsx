import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Accordion from './Accordion'

const items = [
  { q: 'First question', a: 'First answer' },
  { q: 'Second question', a: 'Second answer' },
]

describe('Accordion', () => {
  it('opens the first item by default and links button to panel', () => {
    render(<Accordion items={items} />)
    const first = screen.getByRole('button', { name: 'First question' })
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'First question' })).toHaveTextContent('First answer')
    expect(document.getElementById(first.getAttribute('aria-controls'))).not.toBeNull()
  })

  it('opens one item at a time, by keyboard too', async () => {
    const user = userEvent.setup()
    render(<Accordion items={items} />)

    await user.tab()
    await user.tab() // focus second trigger
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Second question' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'First question' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('First answer')).not.toBeVisible()
  })
})
