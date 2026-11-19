import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { createAppRouter } from '@/app/router'
import { env } from '@/config/env'
import { reportWebVitals } from '@/lib/monitoring'
import '@/styles/variables.css'
import '@/styles/global.css'

const router = createAppRouter()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

reportWebVitals()

// Offline app shell (production, clean-URL deployments only; sandboxed previews don't allow service workers)
if (import.meta.env.PROD && env.routerMode === 'browser' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
