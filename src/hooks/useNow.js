import { useEffect, useState } from 'react'

/**
 * Current time as state, refreshed every `interval` ms.
 * Keeps render functions pure (no Date.now() during render) while relative times stay fresh.
 */
export default function useNow(interval = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}
