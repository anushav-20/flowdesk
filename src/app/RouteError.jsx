import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { reportError } from '@/lib/monitoring'

/** Last-resort error screen for errors thrown outside the page error boundary. */
export default function RouteError() {
  const error = useRouteError()
  if (!isRouteErrorResponse(error)) reportError(error)

  return (
    <main className="container error-panel error-panel--full" role="alert">
      <h1>Something went wrong</h1>
      <p>{isRouteErrorResponse(error) ? `${error.status} – ${error.statusText}` : 'An unexpected error occurred.'}</p>
      <Link to="/" className="btn btn--primary btn--md">
        Back to home
      </Link>
    </main>
  )
}
