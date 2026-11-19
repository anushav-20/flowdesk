import { useEffect, useRef, useState } from 'react'

/**
 * Returns [ref, inView]. inView becomes true once the element
 * scrolls into the viewport (used for reveal animations).
 */
export default function useInView({ threshold = 0.15, once = true } = {}) {
  const ref = useRef(null)
  // Old browsers without IntersectionObserver just show content immediately
  const [inView, setInView] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window))

  useEffect(() => {
    const node = ref.current
    if (!node || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, once])

  return [ref, inView]
}
