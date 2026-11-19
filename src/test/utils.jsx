import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'

/**
 * Renders `ui` inside a memory router so components using Link/useNavigate work.
 * Extra `routes` let a test assert where navigation went.
 */
export function renderWithRouter(ui, { route = '/', path = '*', routes = [] } = {}) {
  const router = createMemoryRouter([{ path, element: ui }, ...routes], { initialEntries: [route] })
  const user = userEvent.setup()
  return { user, router, ...render(<RouterProvider router={router} />) }
}

/** Builds a fake fetch Response. */
export function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
}
