import { useEffect, useState } from 'react'

/** Returns `value` only after it has stopped changing for `delay` ms (e.g. search-as-you-type). */
export default function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])

  return debounced
}
