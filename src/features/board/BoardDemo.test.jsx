import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { boardStore } from './boardStore'
import BoardDemo from './BoardDemo'

const column = (name) => screen.getByRole('region', { name: new RegExp(`^${name}`) })

describe('BoardDemo', () => {
  it('adds a task to To do and announces it', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)

    await user.type(screen.getByLabelText('New task name'), 'Ship v2')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Add task' }))

    expect(within(column('To do')).getByText('Ship v2')).toBeInTheDocument()
    expect(screen.getByText('Added "Ship v2" to To do.')).toBeInTheDocument()
    expect(screen.getByLabelText('New task name')).toHaveValue('')
  })

  it('shows a validation error for an empty task', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the task a name first.')
  })

  it('moves a task with the keyboard-accessible arrow buttons', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)

    await user.click(screen.getByRole('button', { name: 'Move "Pricing page v2" to Done' }))

    expect(within(column('Done')).getByText('Pricing page v2')).toBeInTheDocument()
    expect(within(column('In progress')).queryByText('Pricing page v2')).not.toBeInTheDocument()
    expect(screen.getByText(/40%/)).toBeInTheDocument() // 2 of 5 done
  })

  it('deletes a task and filters by priority', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)

    await user.click(screen.getByRole('button', { name: 'Delete "Fix API rate limits"' }))
    expect(screen.queryByText('Fix API rate limits')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'High' }))
    expect(screen.getByText('Interview 5 beta users')).toBeInTheDocument()
    expect(screen.queryByText('Write launch announcement')).not.toBeInTheDocument()
  })

  it('persists the board to localStorage', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)
    await user.click(screen.getByRole('button', { name: 'Delete "Fix API rate limits"' }))

    const saved = JSON.parse(localStorage.getItem('flowdesk-board'))
    expect(Object.keys(saved.state.tasks)).not.toContain('t4')
    expect(boardStore.getState().columns.progress).toEqual(['t3'])
  })

  it('renames a task inline with the keyboard (Enter saves, Escape cancels)', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)

    await user.click(screen.getByRole('button', { name: 'Edit "Pricing page v2"' }))
    const input = screen.getByRole('textbox', { name: 'Edit name of "Pricing page v2"' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'Pricing page v3{Enter}')

    expect(screen.getByText('Pricing page v3')).toBeInTheDocument()
    expect(screen.getByText('Renamed “Pricing page v2” to “Pricing page v3”')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit "Pricing page v3"' }))
    await user.type(screen.getByRole('textbox', { name: /edit name/i }), ' draft{Escape}')
    expect(screen.getByText('Pricing page v3')).toBeInTheDocument()
  })

  it('shows status changes in the activity feed', async () => {
    const user = userEvent.setup()
    render(<BoardDemo />)
    expect(screen.getByText(/changes you make/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move "Write launch announcement" to In progress' }))

    const feed = screen.getByRole('region', { name: 'Recent activity' })
    expect(within(feed).getByText('Moved “Write launch announcement” from To do → In progress')).toBeInTheDocument()
  })
})
