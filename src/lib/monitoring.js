import { env } from '@/config/env'

/**
 * Single place for error and performance reporting.
 * In production you would forward these to Sentry, Datadog, GA4, etc.
 * Keeping it behind this module means swapping providers touches one file.
 */

export function reportError(error, context = {}) {
  if (env.isDev) console.error('[FlowDesk error]', error, context)
  // e.g. Sentry.captureException(error, { extra: context })
}

/** Core Web Vitals (LCP, INP, CLS, FCP, TTFB). Loaded lazily so it never delays the page. */
export function reportWebVitals() {
  if (env.isTest) return
  import('web-vitals').then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
    const log = ({ name, value, rating }) => {
      if (env.isDev)
        console.info(`[Web Vitals] ${name}: ${Math.round(name === 'CLS' ? value * 1000 : value)} (${rating})`)
      // e.g. navigator.sendBeacon('/analytics', JSON.stringify({ name, value, rating }))
    }
    ;[onCLS, onINP, onLCP, onFCP, onTTFB].forEach((fn) => fn(log))
  })
}
