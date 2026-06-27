// grove dashboard client. Poll the /rows fragment instead of a full-page refresh,
// so the table updates in place without flicker or losing scroll position (DASH-5).
// refresh() morphs: it caches the last /rows string and only touches the DOM when
// it changes, replacing just the data rows whose markup differs and never the
// sibling log rows — so open log panes keep their DOM identity, scroll and content.
// Open logs are tracked in `open` and refilled only when their text changes.
// Plain browser JS served as-is — no build step, no framework (SPEC DASH-17).
const open = new Set(),
  active = new Map(),
  logCache = new Map()
let lastRows = '' // last /rows HTML — morph skips the DOM entirely when it's unchanged
// name -> performance.now() when start/restart was clicked. A row stays "starting…"
// until a /rows poll reports it live or failed (DASH-11/12). The backstop covers a
// fast-fail launch (UP-3 port-in-use) that writes no instance file, so the server
// never flips it to failed: 70s > grove-up's worst-case sequential 30s+30s bind
// wait (waitForPort: 60×500ms per port), so a slow-but-legit start is never falsely
// flagged. Faster fast-fail detection would mean polling the launch log — not worth
// it for a ~1-in-100 hash collision.
// pending: launches awaiting a server verdict. failed: fast-fails the server can
// never report (no instance file), kept so the notice survives each 2s poll (morph
// skips these rows) instead of flashing for one frame — cleared when the user
// retries, or if a slow-but-legit start finally goes live.
const pending = new Map(),
  failed = new Set(),
  BACKSTOP_MS = 70000
const rowOf = (name) => document.querySelector(`#rows tr.wt[data-wt="${CSS.escape(name)}"]`)
function setPhase(row, cls, text) {
  const p = row.querySelector('.phase')
  if (p) {
    p.hidden = false
    p.className = `phase ${cls}`
    p.textContent = text
  }
}
function updateCounts() {
  const er = document.getElementById('stat-running'),
    et = document.getElementById('stat-total')
  if (er) er.textContent = document.querySelectorAll('#rows tr.wt.live').length
  // orphan tombstones aren't worktrees (DASH-15)
  if (et) et.textContent = document.querySelectorAll('#rows tr.wt:not(.orphaned)').length
}
function applyPending() {
  for (const name of failed) {
    // persist a fast-fail notice on the (server-idle) row
    const row = rowOf(name)
    if (!row) {
      failed.delete(name)
      continue
    }
    if (row.classList.contains('live')) {
      failed.delete(name)
      continue
    } // a slow-but-legit start finally went live
    row.classList.add('failed')
    setPhase(row, 'failed', 'start failed · open launch log')
    // morph skips failed rows, so the server's enabled-button markup never lands —
    // re-enable here every tick so the failed row stays retryable (DASH-12).
    for (const b of row.querySelectorAll('.col-actions form button')) b.disabled = false
  }
  for (const [name, t] of pending) {
    const row = rowOf(name)
    if (!row) {
      pending.delete(name)
      continue
    } // worktree removed
    if (row.classList.contains('live') || row.classList.contains('failed')) {
      pending.delete(name)
      continue
    }
    if (performance.now() - t > BACKSTOP_MS) {
      // never went live, never wrote a file → fast-fail
      pending.delete(name)
      failed.add(name)
      row.classList.add('failed')
      setPhase(row, 'failed', 'start failed · open launch log')
      for (const b of row.querySelectorAll('.col-actions form button')) b.disabled = false // retryable now (no 2s gap before the failed loop)
    } else {
      row.classList.add('starting')
      setPhase(row, 'starting', 'starting…')
      for (const b of row.querySelectorAll('.col-actions form button')) b.disabled = true // keep logs usable
    }
  }
}
function showTab(name, key) {
  active.set(name, key)
  for (const k of ['up', 'be', 'fe']) {
    const el = document.getElementById(`${k}-${name}`)
    if (el) el.hidden = k !== key
    const t = document.querySelector(`[data-tab="${k}-${name}"]`)
    if (t) t.classList.toggle('active', k === key)
  }
}
async function refreshLogs(name) {
  const row = document.getElementById(`logrow-${name}`)
  if (!row) return
  row.hidden = false
  const btn = document.querySelector(`[onclick="toggleLogs('${name}')"]`)
  if (btn) btn.setAttribute('aria-expanded', 'true')
  try {
    const r = await fetch(`/logs/${encodeURIComponent(name)}`)
    if (!r.ok) return
    const j = await r.json()
    // Only rewrite a pane when its text changed, and keep scrollTop across the
    // write — else every 2s poll reflashes the pane and yanks scroll to the top
    // (DASH-5). Growing logs append below, so the same offset shows the same lines.
    for (const k of ['up', 'be', 'fe']) {
      const el = document.getElementById(`${k}-${name}`)
      if (!el) continue
      const ck = `${name}/${k}`
      if (logCache.get(ck) === j[k]) continue
      logCache.set(ck, j[k])
      const top = el.scrollTop
      el.textContent = j[k]
      el.scrollTop = top
    }
  } catch {}
  showTab(name, active.get(name) || 'be')
}
function toggleLogs(name) {
  const btn = document.querySelector(`[onclick="toggleLogs('${name}')"]`)
  if (open.has(name)) {
    open.delete(name)
    const row = document.getElementById(`logrow-${name}`)
    if (row) row.hidden = true
    if (btn) btn.setAttribute('aria-expanded', 'false')
  } else {
    open.add(name)
    refreshLogs(name)
  }
}
function morph(html) {
  const tbody = document.getElementById('rows')
  const tmp = document.createElement('tbody')
  tmp.innerHTML = html
  const incoming = [...tmp.querySelectorAll('tr.wt')]
  const cur = [...tbody.querySelectorAll('tr.wt')]
  // A worktree appeared/disappeared (or the empty-state row toggled) → the row set
  // changed; rebuild wholesale (rare). Drop the log cache so refreshLogs refills
  // the blanked panes.
  if (incoming.map((t) => t.dataset.wt).join(',') !== cur.map((t) => t.dataset.wt).join(',')) {
    logCache.clear()
    tbody.innerHTML = html
    return
  }
  // Otherwise touch only the data rows whose markup differs — never the sibling
  // logrow (excluded by the tr.wt selector), so open log panes survive untouched.
  for (const nt of incoming) {
    const name = nt.dataset.wt
    const ct = tbody.querySelector(`tr.wt[data-wt="${CSS.escape(name)}"]`)
    if (!ct) continue
    // pending/failed rows are client-owned (applyPending paints starting…/failed):
    // don't let the server's idle render flash over them. Adopt the server row
    // only once it settles live — then applyPending clears the pending entry.
    if (pending.has(name) || failed.has(name)) {
      if (nt.classList.contains('live')) ct.replaceWith(nt)
      continue
    }
    if (ct.outerHTML !== nt.outerHTML) ct.replaceWith(nt)
  }
}
async function refresh() {
  try {
    const r = await fetch('/rows')
    if (!r.ok) return
    const html = await r.text()
    if (html !== lastRows) {
      lastRows = html
      morph(html)
    } // skip the DOM when /rows is unchanged
    updateCounts()
    applyPending()
    for (const name of open) refreshLogs(name)
  } catch {}
}
// Intercept the action forms so start/restart/stop reconcile through the 2s poll
// instead of a full-page 303 reload (DASH-11) — scroll and open log drawers stay
// put. redirect:'manual' so fetch doesn't follow the 303 and re-download '/'.
// No-JS clients fall back to the form's native POST → redirect.
document.addEventListener('submit', (e) => {
  const f = e.target
  if (!(f instanceof HTMLFormElement) || !f.dataset.act) return
  e.preventDefault()
  const act = f.dataset.act,
    name = f.dataset.wt
  failed.delete(name) // a retry clears any prior fast-fail notice
  // Drop the stale server-rendered verdict class first: restart fires on a live/
  // failed row, and applyPending() treats live/failed as a settled outcome and
  // discards the pending entry — so without this the row never shows 'starting…'.
  if (act === 'up' || act === 'restart') {
    pending.set(name, performance.now())
    rowOf(name)?.classList.remove('live', 'failed', 'idle')
    applyPending()
  }
  fetch(f.action, { method: 'POST', redirect: 'manual' })
    .then(refresh)
    .catch(() => {})
})
// The server-rendered rows wire their controls with inline `onclick="toggleLogs(…)"`
// / `showTab(…)`, which resolve against the global scope. As a classic (non-module)
// script these top-level functions are already global, but expose them explicitly:
// it documents the HTML→JS contract and stops the linter treating them as unused
// (it can't see callers that live in HTML attributes).
window.toggleLogs = toggleLogs
window.showTab = showTab
updateCounts()
applyPending()
setInterval(refresh, 2000)
