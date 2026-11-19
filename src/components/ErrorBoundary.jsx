import { Component } from 'react'
import { reportError } from '@/lib/monitoring'

/**
 * Catches render errors (and failed lazy chunk downloads) in its subtree,
 * so one broken page or section never blanks the whole app.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info.componentStack })
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, reset: this.reset })

    return (
      <div className="container error-panel" role="alert">
        <h2>Something went wrong</h2>
        <p>This part of the page failed to load. Please try again.</p>
        <div className="error-panel__actions">
          <button type="button" className="btn btn--primary btn--md" onClick={this.reset}>
            Try again
          </button>
          <button type="button" className="btn btn--secondary btn--md" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
