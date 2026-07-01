// The SVG symbol defs, rendered once at the top of the page. Ported verbatim from
// the old dashboard.html sprite (attributes camelCased for JSX). Icon refers to
// these by id via <use href="#id">.
export function Sprite() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol
          id="leaf"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 21V11" />
          <path
            d="M12 13C12 9 15 5.5 20 5C20 9.5 17 13 12 13Z"
            fill="currentColor"
            fillOpacity={0.15}
          />
          <path
            d="M12 16C12 12.5 9 9.5 4 9C4 13 7 16 12 16Z"
            fill="currentColor"
            fillOpacity={0.1}
          />
        </symbol>
        <symbol
          id="ext"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 17 17 7M9 7h8v8" />
        </symbol>
        <symbol id="play" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </symbol>
        <symbol
          id="restart"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </symbol>
        <symbol id="stop" viewBox="0 0 24 24" fill="currentColor">
          <rect x={6} y={6} width={12} height={12} rx={2} />
        </symbol>
      </defs>
    </svg>
  )
}
