/* ETH Expert Vote logo — compass rose with checkmark, inlined so it renders
   without any asset fetch (dev, prod build, and jsdom tests alike). */
export default function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="ETH Expert Vote logo">
      <circle cx="60" cy="60" r="60" fill="#ffffff" />
      <g fill="#1f407a">
        <path d="M60 6 L70 43 L50 43 Z" />
        <path d="M60 114 L70 77 L50 77 Z" />
        <path d="M6 60 L43 70 L43 50 Z" />
        <path d="M114 60 L77 70 L77 50 Z" />
        <path d="M60 22 L67 39 L53 39 Z" transform="rotate(45 60 60)" />
        <path d="M60 22 L67 39 L53 39 Z" transform="rotate(135 60 60)" />
        <path d="M60 22 L67 39 L53 39 Z" transform="rotate(225 60 60)" />
        <path d="M60 22 L67 39 L53 39 Z" transform="rotate(315 60 60)" />
      </g>
      <circle cx="60" cy="60" r="32" fill="none" stroke="#1f407a" strokeWidth="9" />
      <circle cx="60" cy="60" r="25" fill="#ffffff" />
      <path
        d="M43 62 L57 76 L88 36"
        fill="none"
        stroke="#ffffff"
        strokeWidth="20"
        strokeLinecap="square"
      />
      <path
        d="M43 62 L57 76 L88 36"
        fill="none"
        stroke="#1f407a"
        strokeWidth="11"
        strokeLinecap="square"
      />
    </svg>
  )
}
