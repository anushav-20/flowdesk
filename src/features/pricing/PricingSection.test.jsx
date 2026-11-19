import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { appStore } from '@/store/appStore'
import { renderWithRouter } from '@/test/utils'
import PricingSection from './PricingSection'

describe('PricingSection', () => {
  it('switches every plan to yearly prices and persists the choice', async () => {
    const { user } = renderWithRouter(<PricingSection />)
    const pro = screen.getByRole('article', { name: 'Pro' })
    expect(within(pro).getByText('$12')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /yearly/i }))

    expect(within(pro).getByText('$10')).toBeInTheDocument()
    expect(within(pro).getByText(/billed yearly/)).toBeInTheDocument()
    expect(appStore.getState().billing).toBe('yearly')
    expect(JSON.parse(localStorage.getItem('flowdesk-app')).state.billing).toBe('yearly')
  })

  it('shows a confirmation toast when a plan is chosen', async () => {
    const { user } = renderWithRouter(<PricingSection />)
    await user.click(screen.getByRole('button', { name: 'Start 14-day trial' }))
    expect(appStore.getState().toasts.at(-1).message).toMatch(/Pro plan selected/)
  })
})
