// Inline SVG icon referencing a <symbol> from <Sprite/>. aria-hidden because grove
// has no a11y obligation (SPEC non-goal) — and it keeps biome's svg-title rule quiet.
export function Icon({ id, className = 'ic' }: { id: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  )
}
