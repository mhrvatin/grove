// The status dot's colour, ring and pulse all come from the row's status class
// (tr.wt.<status> .dot in dashboard.css, DASH-12), so the dot itself is a bare span.
export function StatusDot() {
  return <span className="dot" />
}
