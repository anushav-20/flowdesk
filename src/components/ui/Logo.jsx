/** Brand mark + wordmark, used in the navbar and footer. */
export default function Logo({ size = 32 }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d5dfc" />
            <stop offset="1" stopColor="#22c3ee" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
        <path
          d="M9 21c3-8 7-10 14-10M9 15c2-3 5-4 8-4"
          stroke="#fff"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="logo__text">FlowDesk</span>
    </span>
  )
}
