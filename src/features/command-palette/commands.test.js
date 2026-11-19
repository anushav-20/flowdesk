import { describe, expect, it } from 'vitest'
import { buildCommands, filterCommands } from './commands'

const commands = buildCommands({ theme: 'light', billing: 'monthly' })

describe('command palette commands', () => {
  it('returns everything for an empty query', () => {
    expect(filterCommands(commands, '  ')).toHaveLength(commands.length)
  })

  it('matches labels and keywords, case-insensitively', () => {
    expect(filterCommands(commands, 'PRICING').map((c) => c.id)).toContain('nav-pricing')
    expect(filterCommands(commands, 'kanban').map((c) => c.id)).toEqual(['nav-demo'])
  })

  it('requires every word to match', () => {
    expect(filterCommands(commands, 'dark mode').map((c) => c.id)).toEqual(['act-theme'])
    expect(filterCommands(commands, 'dark pricing')).toEqual([])
  })

  it('labels actions based on current state', () => {
    const dark = buildCommands({ theme: 'dark', billing: 'yearly' })
    expect(dark.find((c) => c.id === 'act-theme').label).toBe('Switch to light mode')
    expect(dark.find((c) => c.id === 'act-billing').label).toBe('Show monthly prices')
  })
})
