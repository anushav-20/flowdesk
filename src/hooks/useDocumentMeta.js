import { useEffect } from 'react'

const SITE = 'FlowDesk'

function setMeta(selector, attr, value) {
  if (!value) return
  const el = document.head.querySelector(selector)
  if (el) el.setAttribute(attr, value)
}

/**
 * Per-route SEO: updates <title>, meta description and Open Graph tags.
 * @param {{ title?: string, description?: string }} meta
 */
export default function useDocumentMeta({ title, description }) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SITE}` : `${SITE} – Plan, track and ship work together`
    document.title = fullTitle
    setMeta('meta[name="description"]', 'content', description)
    setMeta('meta[property="og:title"]', 'content', fullTitle)
    setMeta('meta[name="twitter:title"]', 'content', fullTitle)
    setMeta('meta[property="og:description"]', 'content', description)
  }, [title, description])
}
