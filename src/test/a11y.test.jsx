import axe from 'axe-core'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BoardDemo from '@/features/board/BoardDemo'
import ContactPage from '@/pages/ContactPage'
import PricingPage from '@/pages/PricingPage'
import { renderWithRouter } from './utils'

/**
 * Automated accessibility checks with axe-core (the engine behind Lighthouse's a11y audit).
 * Colour contrast is skipped because jsdom doesn't compute styles; it's checked in the browser instead.
 */
async function expectNoViolations(container) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
  expect(summary).toEqual([])
}

describe('accessibility (axe)', () => {
  it('Contact page has no violations', async () => {
    const { container } = renderWithRouter(<ContactPage />)
    await expectNoViolations(container)
  })

  it('Contact page with validation errors has no violations', async () => {
    const { container, user } = renderWithRouter(<ContactPage />)
    await user.click(screen.getByRole('button', { name: /send message/i }))
    await expectNoViolations(container)
  })

  it('Pricing page has no violations', async () => {
    const { container } = renderWithRouter(<PricingPage />)
    await expectNoViolations(container)
  })

  it('Board demo has no violations', async () => {
    const { container } = renderWithRouter(<BoardDemo />)
    await expectNoViolations(container)
  })
})
