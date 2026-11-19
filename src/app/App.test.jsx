import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/utils'
import { routes } from './router'

/** Full-app integration tests: real routes, layout, stores and lazy pages; only the network is mocked. */
function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  render(<RouterProvider router={router} />)
  return { router, user }
}

const posts = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `Post number ${i + 1}`,
  body: 'Some body text for the post.',
  tags: ['history'],
  reactions: { likes: i },
  views: 100,
  userId: 1,
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (url.includes('/comments/post/'))
        return jsonResponse({ comments: [{ id: 1, body: 'Great read!', likes: 2, user: { fullName: 'Asha K' } }] })
      if (url.includes('/users/')) return jsonResponse({ firstName: 'Ravi', lastName: 'Kumar' })
      if (/\/posts\/\d+$/.test(url)) return jsonResponse(posts[0])
      return jsonResponse({ posts, total: 30 })
    }),
  )
})

describe('App', () => {
  it('renders the home page with one h1 and a skip link', async () => {
    renderApp('/')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main')
    expect(await screen.findByRole('heading', { name: /try it/i })).toBeInTheDocument() // lazy board demo
  })

  it('navigates between pages from the navbar and updates the title', async () => {
    const { user, router } = renderApp('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })

    await user.click(within(nav).getByRole('link', { name: 'Pricing' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Plans for teams of every size' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/pricing')
    expect(document.title).toBe('Pricing · FlowDesk')
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens and closes the mobile menu', async () => {
    const { user } = renderApp('/')
    const toggle = screen.getByRole('button', { name: 'Open menu' })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the command menu with Ctrl+K', async () => {
    const { user } = renderApp('/')
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Command menu' })).toBeInTheDocument()
  })

  it('toggles and persists dark mode', async () => {
    const { user } = renderApp('/')
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem('flowdesk-app')).state.theme).toBe('dark')
  })

  it('shows a 404 page for unknown routes', async () => {
    renderApp('/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('loads the blog, paginates and keeps state in the URL', async () => {
    const { user, router } = renderApp('/blog')

    expect(await screen.findByText('Post number 1')).toBeInTheDocument()
    expect(screen.getByText('30 articles')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => expect(router.state.location.search).toBe('?page=2'))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('skip=6'), expect.anything())
  })

  it('filters the blog by tag', async () => {
    const { user, router } = renderApp('/blog')
    await screen.findByText('Post number 1')

    await user.click(screen.getByRole('button', { name: 'History' }))

    await waitFor(() => expect(router.state.location.search).toBe('?tag=history'))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/posts/tag/history'), expect.anything())
  })

  it('debounces blog search before calling the API', async () => {
    const { user, router } = renderApp('/blog')
    await screen.findByText('Post number 1')

    await user.type(screen.getByRole('searchbox', { name: 'Search articles' }), 'react')

    await waitFor(() => expect(router.state.location.search).toBe('?q=react'), { timeout: 2000 })
    const searchCalls = () => fetch.mock.calls.filter(([url]) => url.includes('/posts/search'))
    await waitFor(() => expect(searchCalls()).toHaveLength(1)) // one request, not one per keystroke
    expect(searchCalls()[0][0]).toContain('q=react')
  })

  it('opens an article with its author and comments', async () => {
    renderApp('/blog/1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Post number 1' })).toBeInTheDocument()
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument()
    expect(screen.getByText('Great read!')).toBeInTheDocument()
  })

  it('treats malformed article ids as not found without calling the API', async () => {
    renderApp('/blog/<script>')
    expect(await screen.findByText("We couldn't find that article.")).toBeInTheDocument()
    expect(fetch.mock.calls.some(([url]) => url.includes('script'))).toBe(false)
  })
})
