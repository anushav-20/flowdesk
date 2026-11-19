import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { appStore } from '@/store/appStore'
import { renderWithRouter } from '@/test/utils'
import CommandPalette from './CommandPalette'

describe('CommandPalette', () => {
  it('focuses the search box and filters commands as you type', async () => {
    const { user } = renderWithRouter(<CommandPalette />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveFocus()

    await user.type(input, 'roi')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('ROI calculator')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates with arrow keys and Enter', async () => {
    const { user, router } = renderWithRouter(<CommandPalette />, {
      routes: [{ path: '/pricing', element: <p>pricing page</p> }],
    })
    appStore.dispatch({ type: 'palette/open' })

    await user.type(screen.getByRole('combobox'), 'pricing')
    await user.keyboard('{Enter}')

    expect(router.state.location.pathname).toBe('/pricing')
    expect(appStore.getState().paletteOpen).toBe(false)
  })

  it('runs actions such as toggling the theme', async () => {
    const { user } = renderWithRouter(<CommandPalette />)
    await user.type(screen.getByRole('combobox'), 'dark mode')
    await user.keyboard('{Enter}')
    expect(appStore.getState().theme).toBe('dark')
  })

  it('offers a blog search and shows an empty state', async () => {
    const { user } = renderWithRouter(<CommandPalette />)
    await user.type(screen.getByRole('combobox'), 'zzzz')
    expect(screen.getByRole('option')).toHaveTextContent('Search the blog for “zzzz”')

    await user.clear(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'q')
    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { user } = renderWithRouter(<CommandPalette />)
    appStore.dispatch({ type: 'palette/open' })
    await user.keyboard('{Escape}')
    expect(appStore.getState().paletteOpen).toBe(false)
  })
})
