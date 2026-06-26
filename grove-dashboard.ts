#!/usr/bin/env bun
// Web control panel for worktree dev instances. Stateless discovery:
// `git worktree list` + .grove/instances/*.json + a port liveness probe.
// Buttons spawn the grove-up / grove-down entrypoints directly (no `just`).
//
// Runs detached in the background (`just grove`); stop with `just grove-stop`.
// No foreground process means no Ctrl+C to crash the recipe.
// ponytail: localhost-only dev tool over trusted input (worktree names from
// git), so no HTML-escaping / auth. Add both if this ever leaves localhost.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRows,
  formatPinoLog,
  groveSummary,
  instanceLogSections,
  isActionableName,
  isAllowedName,
  isSameOrigin,
  orphanInstances,
  prunedReaped,
  reapTargets,
  rowStatus,
} from './grove-dashboard-utils.ts'
import {
  groveRoot,
  killByPortAndPids,
  listWorktreeDirs,
  loadConfig,
  mainRepoRoot,
  portsInUse,
  readInstances,
  spawnDetached,
} from './grove-instances.ts'

const PORT = Number(process.env['DASHBOARD_PORT']) || 4000
const repoRoot = mainRepoRoot()
// Orphans already reaped (DASH-16) — kept so a reaped orphan's port, if a later
// process rebinds it, is never re-SIGTERM'd. Pruned each poll to names that are
// still orphans (prunedReaped), so it bounds reaping to once per orphan episode.
let reaped = new Set<string>()

async function alive(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(400) })
    return true
  } catch {
    return false
  }
}

function tail(file: string, lines = 200): string {
  if (!existsSync(file)) return '(no log)'
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

async function renderRows(): Promise<string> {
  // Load config lazily on the serve path only — `start`/`stop` are config-
  // independent (just a port-kill / detached respawn), so stopping the dashboard
  // must never fail because grove.config.ts isn't on main yet. loadConfig caches.
  const config = await loadConfig()
  const worktreeDirs = listWorktreeDirs()
  const instances = readInstances()
  // Auto-reap orphans (DASH-16): an instance whose worktree was removed. On first
  // sighting kill its listeners so the freed ports don't leak — killByPortAndPids
  // is lsof-gated per port (a dead port is a no-op), so this is unconditional and
  // frees a still-live BE even when the FE has already died. The instance file is
  // kept as a visible tombstone (DASH-15), so we record the name (reaped) and
  // never touch its ports again — otherwise a later process that rebinds a freed
  // port (e.g. a fresh vite on 5173) would be killed every poll. prunedReaped then
  // drops names that are no longer orphans (cleared, or worktree recreated), so a
  // worktree removed → recreated → removed reaps fresh on each removal episode.
  const orphans = orphanInstances(worktreeDirs, instances)
  for (const o of reapTargets(reaped, orphans)) {
    killByPortAndPids([o.bePort, o.fePort], [o.bePid, o.fePid])
    reaped.add(o.name)
  }
  reaped = prunedReaped(reaped, orphans)
  const rows = buildRows(worktreeDirs, instances, config)
  // Empty-state teaches the tool. Rendered as a tbody row so it survives the
  // /rows poll the same way real rows do (no separate code path to keep in sync).
  if (rows.length === 0) {
    return `<tr><td colspan=4><div class=empty><svg class=mark><use href=#leaf></use></svg>
      <h2>No worktrees yet</h2>
      <p>Create a git worktree, then run <code>just grove-up</code> to plant it here.</p>
      </div></td></tr>`
  }
  const cells = await Promise.all(
    rows.map(async (r) => {
      // Three-state status (DASH-12): a worktree with an instance file but a dead
      // port probe is *failed* (UP-6 pid-0 bind-timeout, or a crashed slot), not
      // idle — so a failed start never looks like a never-started one.
      const status = rowStatus(r.running, r.running && (await alive(r.fePort)), r.orphaned)
      const dot = `<span class=dot></span>`
      // Strip the scheme for display — the running worktree's address is the
      // signal; `localhost:5173` reads cleaner than the full URL. href stays whole.
      const host = r.url.replace(/^https?:\/\//, '')
      const link = `<a class=url href="${r.url}" target=_blank rel=noopener>${host} <svg class=ic><use href=#ext></use></svg></a>
        <div class=ports>api <b>${r.bePort}</b> · web <b>${r.fePort}</b></div>`
      // data-act/data-wt let the client intercept the submit (fetch, no reload —
      // DASH-11) while the action attr stays a working no-JS fallback (303 → /).
      const form = (action: string, cls: string, icon: string, label: string) =>
        `<form method=post action="/${action}/${r.name}" data-act="${action}" data-wt="${r.name}"><button class="btn ${cls}"><svg class=ic><use href=#${icon}></use></svg>${label}</button></form>`
      // Show logs toggles an inline log row attached to this worktree (same tab),
      // tracked client-side so it survives the 2s poll. Never a new page.
      const logsBtn = `<button type=button class="btn ghost" aria-expanded=false onclick="toggleLogs('${r.name}')">logs</button>`
      // Orphan tombstone (DASH-15): its worktree is gone, so neither start nor
      // restart applies — only clear, which runs the stop/down path to remove the
      // stale instance record. Failed/live both expose restart (retry) + stop
      // (clears a pid-0 file); only a truly idle worktree gets the bare "start".
      const actions =
        status === 'orphaned'
          ? form('down', 'danger', 'stop', 'clear')
          : status === 'idle'
            ? `${form('up', 'primary', 'play', 'start')}${logsBtn}`
            : `${form('restart', '', 'restart', 'restart')}${form('down', 'danger', 'stop', 'stop')}${logsBtn}`
      // The phase line carries the failed/starting/removed label. Server renders the
      // failed/removed text; the client fills "starting…" (and the fast-fail
      // backstop) into the empty span for idle rows it just acted on.
      const phase =
        status === 'failed'
          ? `<span class="phase failed">failed · open launch log</span>`
          : status === 'orphaned'
            ? `<span class="phase orphaned">worktree removed · server stopped</span>`
            : `<span class=phase hidden></span>`
      // The log row is rendered hidden alongside every worktree; toggleLogs/
      // refreshLogs reveal and fill it. One full-width pane at a time — tabs
      // switch between the launch, BE and FE logs (BE shown first).
      const tab = (key: string, label: string) =>
        `<button type=button class=tab data-tab="${key}-${r.name}" onclick="showTab('${r.name}','${key}')">${label}</button>`
      const logRow = `<tr class=logrow id="logrow-${r.name}" hidden><td colspan=4><div class=drawer>
        <div class=tabs>${tab('be', 'BE')}${tab('fe', 'FE')}${tab('up', 'launch')}</div>
        <pre id="up-${r.name}" class=logpane hidden></pre>
        <pre id="be-${r.name}" class=logpane></pre>
        <pre id="fe-${r.name}" class=logpane hidden></pre></div></td></tr>`
      return `<tr class="wt ${status}" data-wt="${r.name}"><td class=col-status>${dot}</td><td><div class=name>${r.name}</div>${phase}</td><td>${link}</td><td class=col-actions>${actions}</td></tr>${logRow}`
    }),
  )
  return cells.join('')
}

function page(rows: string, summary: { running: number; total: number }): string {
  // Poll the /rows fragment instead of a full-page refresh, so the table updates
  // in place without flicker or losing scroll position (DASH-5). refresh() morphs:
  // it caches the last /rows string and only touches the DOM when it changes,
  // replacing just the data rows whose markup differs and never the sibling log
  // rows — so open log panes keep their DOM identity, scroll and content. Open
  // logs are tracked in `open` and refilled only when their text changes.
  // ponytail: single server-rendered HTML string with inline CSS/JS (DASH-7) —
  // no build step until the UI outgrows one. Brand identity lives in the tokens
  // below; rationale in docs/superpowers/specs/2026-06-26-grove-design.md.
  return `<!doctype html><html lang=en><meta charset=utf8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>grove</title>
<style>
:root{
  --bg:oklch(1 0 0);--surface:oklch(0.976 0.006 110);--surface-2:oklch(0.958 0.009 110);
  --border:oklch(0.905 0.011 110);--border-strong:oklch(0.84 0.013 110);
  --ink:oklch(0.27 0.022 122);--muted:oklch(0.515 0.018 116);
  --primary:oklch(0.50 0.115 128);--primary-strong:oklch(0.43 0.115 128);
  --leaf:oklch(0.66 0.16 132);--leaf-glow:oklch(0.74 0.15 132 / .45);
  --accent:oklch(0.55 0.125 66);--accent-strong:oklch(0.47 0.125 66);
  --danger:oklch(0.54 0.15 30);--danger-soft:oklch(0.955 0.03 40);
  --log-bg:oklch(0.205 0.014 122);--log-surface:oklch(0.26 0.016 122);--log-ink:oklch(0.88 0.012 100);
  --radius:10px;--radius-sm:7px;--shadow-sm:0 1px 2px oklch(0.27 0.02 122 / .06);
  --ease:cubic-bezier(.22,1,.36,1);
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizelegibility}
body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--bg);font-size:14px;line-height:1.5;min-height:100vh;
  background-image:radial-gradient(120% 80% at 100% 0%,oklch(0.97 0.02 110) 0%,transparent 55%);background-attachment:fixed}
.wrap{padding:1.75rem clamp(1rem,4vw,2.5rem) 4rem}
a{color:inherit}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem;flex-wrap:wrap;
  padding-bottom:1.25rem;margin-bottom:1.25rem;border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:.7rem}
.mark{width:30px;height:30px;flex:none;color:var(--primary)}
.wordmark{font-family:var(--mono);font-size:1.5rem;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink)}
.tagline{font-size:.8rem;color:var(--muted);margin-top:.2rem}
.summary{display:flex;align-items:center;gap:1.1rem;font-size:.85rem}
.stat{display:flex;align-items:baseline;gap:.4rem}
.stat .n{font-family:var(--mono);font-size:1.05rem;font-weight:600;color:var(--ink)}
.stat .n.live{color:var(--primary)}
.stat .l{color:var(--muted)}.stat .dot{margin-right:.1rem}
.panel{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-sm);overflow:hidden}
table{border-collapse:collapse;width:100%}
thead th{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
  text-align:left;padding:.7rem 1rem;background:var(--surface);border-bottom:1px solid var(--border)}
thead th.r{text-align:right}
tbody tr.wt{transition:background .12s var(--ease)}
tbody tr.wt:hover{background:var(--surface)}
tbody td{padding:.8rem 1rem;border-bottom:1px solid var(--border);vertical-align:middle}
tbody tr.wt:last-child td,tbody tr.logrow:last-child td{border-bottom:none}
.col-status{width:1.5rem;padding-right:0}
.col-actions{text-align:right;white-space:nowrap}
.dot{display:inline-block;width:.62rem;height:.62rem;border-radius:50%;flex:none;border:1.5px solid transparent}
.dot.on{background:var(--leaf);box-shadow:0 0 0 4px var(--leaf-glow);animation:pulse 2.6s var(--ease) infinite}
/* Row dot is driven by the row's status class (DASH-12), not a per-dot modifier. */
tr.wt.live .dot{background:var(--leaf);box-shadow:0 0 0 4px var(--leaf-glow);animation:pulse 2.6s var(--ease) infinite}
tr.wt.idle .dot{background:transparent;border-color:var(--border-strong)}
tr.wt.failed .dot{background:transparent;border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-soft)}
tr.wt.orphaned .dot{background:var(--border-strong);border-color:var(--border-strong)}
tr.wt.orphaned .name{color:var(--muted);font-weight:500;text-decoration:line-through}
tr.wt.starting .dot{background:var(--accent);box-shadow:0 0 0 4px oklch(0.55 0.125 66 / .3);animation:pulse 1.4s var(--ease) infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 3px var(--leaf-glow)}50%{box-shadow:0 0 0 6px transparent}}
.name{font-family:var(--mono);font-size:.92rem;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
tr.wt.idle .name{color:var(--muted);font-weight:500}
.phase{font-family:var(--mono);font-size:.72rem;margin-top:.25rem}
.phase.failed{color:var(--danger)}
.phase.starting{color:var(--accent)}
.phase.orphaned{color:var(--muted)}
.url{display:inline-flex;align-items:center;gap:.35rem;font-family:var(--mono);font-size:.82rem;color:var(--accent);
  text-decoration:none;border-bottom:1px solid transparent;transition:border-color .12s var(--ease),color .12s}
.url:hover{color:var(--accent-strong);border-bottom-color:currentColor}
.url .ic{width:13px;height:13px;opacity:.7}
.ports{font-family:var(--mono);font-size:.72rem;color:var(--muted);margin-top:.2rem}
.ports b{color:var(--ink);font-weight:500}
tr.wt.idle .url{color:var(--muted)}
.btn{font:inherit;font-size:.8rem;font-weight:500;font-family:var(--sans);padding:.42rem .85rem;border-radius:var(--radius-sm);
  border:1px solid var(--border-strong);background:var(--bg);color:var(--ink);cursor:pointer;margin-left:.4rem;
  transition:background .12s var(--ease),border-color .12s,color .12s,transform .06s;display:inline-flex;align-items:center;gap:.35rem}
.btn:hover{background:var(--surface-2);border-color:var(--muted)}
.btn:active{transform:translateY(.5px)}
.btn:disabled{opacity:.55;cursor:default;transform:none}
.btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}
.btn.primary:hover{background:var(--primary-strong);border-color:var(--primary-strong)}
.btn.danger{color:var(--danger);border-color:var(--border-strong)}
.btn.danger:hover{background:var(--danger-soft);border-color:var(--danger)}
.btn.ghost{border-color:transparent;color:var(--muted);background:transparent;padding-inline:.6rem}
.btn.ghost:hover{color:var(--ink);background:var(--surface-2)}
.btn.ghost[aria-expanded=true]{color:var(--primary);background:var(--surface-2)}
.btn .ic{width:14px;height:14px}
form{display:inline}
tr.logrow td{padding:0;background:var(--surface)}
.drawer{padding:.75rem 1rem 1rem}
.tabs{display:inline-flex;gap:.15rem;padding:.2rem;background:var(--surface-2);border-radius:var(--radius-sm);margin-bottom:.6rem}
.tab{font:inherit;font-size:.76rem;font-weight:500;font-family:var(--mono);padding:.3rem .7rem;border:none;border-radius:5px;
  background:transparent;color:var(--muted);cursor:pointer;transition:background .12s,color .12s}
.tab:hover{color:var(--ink)}
.tab.active{background:var(--log-bg);color:var(--log-ink)}
.logpane{margin:0;height:20rem;overflow:auto;background:var(--log-bg);color:var(--log-ink);padding:.85rem 1rem;
  border-radius:var(--radius-sm);box-shadow:inset 0 1px 6px oklch(0 0 0 / .35);font-family:var(--mono);font-size:12px;
  line-height:1.6;white-space:pre-wrap;word-break:break-word}
.logpane::-webkit-scrollbar{width:10px;height:10px}
.logpane::-webkit-scrollbar-thumb{background:var(--log-surface);border-radius:6px;border:2px solid var(--log-bg)}
.empty{text-align:center;padding:4rem 1.5rem;color:var(--muted)}
.empty .mark{width:46px;height:46px;margin:0 auto .9rem;color:var(--border-strong)}
.empty h2{font-family:var(--mono);font-size:1rem;color:var(--ink);margin:0 0 .4rem;font-weight:600}
.empty p{margin:0}
.empty code{font-family:var(--mono);background:var(--surface-2);padding:.1rem .4rem;border-radius:4px;color:var(--primary)}
footer{margin-top:1rem;font-size:.74rem;color:var(--muted);display:flex;align-items:center;gap:.5rem;font-family:var(--mono)}
.live-pip{width:.4rem;height:.4rem;border-radius:50%;background:var(--leaf);box-shadow:0 0 0 3px var(--leaf-glow)}
@media (max-width:680px){
  header{flex-direction:column;align-items:flex-start;gap:.85rem}
  .summary{gap:1.1rem}
  thead{display:none}table,tbody{display:block}
  tr.wt{display:block;position:relative;padding:.95rem 1rem .95rem 2.5rem;border-bottom:1px solid var(--border)}
  tr.wt td{display:block;padding:.12rem 0;border:none}
  .col-status{position:absolute;left:1rem;top:1.15rem;width:auto;padding:0}
  .col-actions{text-align:left;margin-top:.7rem;white-space:normal}
  .btn{margin-left:0;margin-right:.4rem}
  tr.logrow td{padding:0}.logpane{height:16rem}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
<svg width=0 height=0 style=position:absolute aria-hidden=true><defs>
<symbol id=leaf viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.7 stroke-linecap=round stroke-linejoin=round>
  <path d="M12 21V11"/><path d="M12 13C12 9 15 5.5 20 5C20 9.5 17 13 12 13Z" fill=currentColor fill-opacity=.15/>
  <path d="M12 16C12 12.5 9 9.5 4 9C4 13 7 16 12 16Z" fill=currentColor fill-opacity=.1/></symbol>
<symbol id=ext viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M7 17 17 7M9 7h8v8"/></symbol>
<symbol id=play viewBox="0 0 24 24" fill=currentColor><path d="M8 5v14l11-7z"/></symbol>
<symbol id=restart viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></symbol>
<symbol id=stop viewBox="0 0 24 24" fill=currentColor><rect x=6 y=6 width=12 height=12 rx=2/></symbol>
</defs></svg>
<div class=wrap>
<header>
  <div class=brand>
    <svg class=mark><use href=#leaf></use></svg>
    <div><div class=wordmark>grove</div><div class=tagline>worktree dev instances</div></div>
  </div>
  <div class=summary>
    <div class=stat><span class="dot on"></span><span class="n live" id=stat-running>${summary.running}</span><span class=l>running</span></div>
    <div class=stat><span class=n id=stat-total>${summary.total}</span><span class=l>worktrees</span></div>
  </div>
</header>
<div class=panel><table>
<thead><tr><th class=col-status></th><th>worktree</th><th>address</th><th class=r>actions</th></tr></thead>
<tbody id=rows>${rows}</tbody></table></div>
<footer><span class=live-pip></span>live · refreshing every 2s</footer>
</div>
<script>
const open=new Set(), active=new Map(), logCache=new Map()
let lastRows='' // last /rows HTML — morph skips the DOM entirely when it's unchanged
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
const pending=new Map(), failed=new Set(), BACKSTOP_MS=70000
const rowOf=name=>document.querySelector('#rows tr.wt[data-wt="'+CSS.escape(name)+'"]')
function setPhase(row,cls,text){const p=row.querySelector('.phase'); if(p){p.hidden=false; p.className='phase '+cls; p.textContent=text}}
function updateCounts(){
  const er=document.getElementById('stat-running'), et=document.getElementById('stat-total')
  if(er) er.textContent=document.querySelectorAll('#rows tr.wt.live').length
  if(et) et.textContent=document.querySelectorAll('#rows tr.wt:not(.orphaned)').length // orphan tombstones aren't worktrees (DASH-15)
}
function applyPending(){
  for(const name of failed){ // persist a fast-fail notice on the (server-idle) row
    const row=rowOf(name)
    if(!row){failed.delete(name); continue}
    if(row.classList.contains('live')){failed.delete(name); continue} // a slow-but-legit start finally went live
    row.classList.add('failed'); setPhase(row,'failed','start failed · open launch log')
    // morph skips failed rows, so the server's enabled-button markup never lands —
    // re-enable here every tick so the failed row stays retryable (DASH-12).
    for(const b of row.querySelectorAll('.col-actions form button')) b.disabled=false
  }
  for(const [name,t] of pending){
    const row=rowOf(name)
    if(!row){pending.delete(name); continue} // worktree removed
    if(row.classList.contains('live')||row.classList.contains('failed')){pending.delete(name); continue}
    if(performance.now()-t>BACKSTOP_MS){ // never went live, never wrote a file → fast-fail
      pending.delete(name); failed.add(name)
      row.classList.add('failed'); setPhase(row,'failed','start failed · open launch log')
      for(const b of row.querySelectorAll('.col-actions form button')) b.disabled=false // retryable now (no 2s gap before the failed loop)
    }else{
      row.classList.add('starting'); setPhase(row,'starting','starting…')
      for(const b of row.querySelectorAll('.col-actions form button')) b.disabled=true // keep logs usable
    }
  }
}
function showTab(name,key){
  active.set(name,key)
  for(const k of ['up','be','fe']){
    const el=document.getElementById(k+'-'+name); if(el) el.hidden=(k!==key)
    const t=document.querySelector('[data-tab="'+k+'-'+name+'"]'); if(t) t.classList.toggle('active',k===key)
  }
}
async function refreshLogs(name){
  const row=document.getElementById('logrow-'+name); if(!row) return
  row.hidden=false
  const btn=document.querySelector('[onclick="toggleLogs(\\''+name+'\\')"]'); if(btn) btn.setAttribute('aria-expanded','true')
  try{
    const r=await fetch('/logs/'+encodeURIComponent(name)); if(!r.ok) return
    const j=await r.json()
    // Only rewrite a pane when its text changed, and keep scrollTop across the
    // write — else every 2s poll reflashes the pane and yanks scroll to the top
    // (DASH-5). Growing logs append below, so the same offset shows the same lines.
    for(const k of ['up','be','fe']){
      const el=document.getElementById(k+'-'+name); if(!el) continue
      const ck=name+'/'+k
      if(logCache.get(ck)===j[k]) continue
      logCache.set(ck,j[k])
      const top=el.scrollTop; el.textContent=j[k]; el.scrollTop=top
    }
  }catch{}
  showTab(name,active.get(name)||'be')
}
function toggleLogs(name){
  const btn=document.querySelector('[onclick="toggleLogs(\\''+name+'\\')"]')
  if(open.has(name)){open.delete(name); const row=document.getElementById('logrow-'+name); if(row) row.hidden=true; if(btn) btn.setAttribute('aria-expanded','false')}
  else{open.add(name); refreshLogs(name)}
}
function morph(html){
  const tbody=document.getElementById('rows')
  const tmp=document.createElement('tbody'); tmp.innerHTML=html
  const incoming=[...tmp.querySelectorAll('tr.wt')]
  const cur=[...tbody.querySelectorAll('tr.wt')]
  // A worktree appeared/disappeared (or the empty-state row toggled) → the row set
  // changed; rebuild wholesale (rare). Drop the log cache so refreshLogs refills
  // the blanked panes.
  if(incoming.map(t=>t.dataset.wt).join(',')!==cur.map(t=>t.dataset.wt).join(',')){
    logCache.clear(); tbody.innerHTML=html; return
  }
  // Otherwise touch only the data rows whose markup differs — never the sibling
  // logrow (excluded by the tr.wt selector), so open log panes survive untouched.
  for(const nt of incoming){
    const name=nt.dataset.wt
    const ct=tbody.querySelector('tr.wt[data-wt="'+CSS.escape(name)+'"]'); if(!ct) continue
    // pending/failed rows are client-owned (applyPending paints starting…/failed):
    // don't let the server's idle render flash over them. Adopt the server row
    // only once it settles live — then applyPending clears the pending entry.
    if(pending.has(name)||failed.has(name)){
      if(nt.classList.contains('live')) ct.replaceWith(nt)
      continue
    }
    if(ct.outerHTML!==nt.outerHTML) ct.replaceWith(nt)
  }
}
async function refresh(){
  try{
    const r=await fetch('/rows'); if(!r.ok) return
    const html=await r.text()
    if(html!==lastRows){lastRows=html; morph(html)} // skip the DOM when /rows is unchanged
    updateCounts(); applyPending()
    for(const name of open) refreshLogs(name)
  }catch{}
}
// Intercept the action forms so start/restart/stop reconcile through the 2s poll
// instead of a full-page 303 reload (DASH-11) — scroll and open log drawers stay
// put. redirect:'manual' so fetch doesn't follow the 303 and re-download '/'.
// No-JS clients fall back to the form's native POST → redirect.
document.addEventListener('submit',e=>{
  const f=e.target
  if(!(f instanceof HTMLFormElement)||!f.dataset.act) return
  e.preventDefault()
  const act=f.dataset.act, name=f.dataset.wt
  failed.delete(name) // a retry clears any prior fast-fail notice
  // Drop the stale server-rendered verdict class first: restart fires on a live/
  // failed row, and applyPending() treats live/failed as a settled outcome and
  // discards the pending entry — so without this the row never shows 'starting…'.
  if(act==='up'||act==='restart'){pending.set(name,performance.now()); rowOf(name)?.classList.remove('live','failed','idle'); applyPending()}
  fetch(f.action,{method:'POST',redirect:'manual'}).then(refresh).catch(()=>{})
})
updateCounts(); applyPending()
setInterval(refresh,2000)
</script>`
}

function decodeName(seg: string | undefined): string {
  if (!seg) return ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return '' // malformed percent-encoding → no worktree matches it
  }
}

function up(name: string): void {
  // Fire-and-return; grove-up detaches its own processes (and may wait ~30s to
  // bind). Capture output to a per-instance launch log so failed starts are
  // inspectable from the dashboard. ponytail: truncate per start ('w'), no rotation.
  const logsDir = join(groveRoot(), 'logs')
  mkdirSync(logsDir, { recursive: true }) // dir may not exist before grove-up's own mkdir
  const fd = openSync(join(logsDir, `${name}-up.log`), 'w')
  // Spawn the grove-up entrypoint directly (not via `just`) so the dashboard
  // stays project-agnostic — no dependency on the consumer's task runner or
  // recipe names. The child inherits a dup of fd, so close ours immediately to
  // avoid leaking a descriptor per click in this long-lived process.
  Bun.spawn(['bun', 'run', join(import.meta.dir, 'grove-up.ts'), name], {
    cwd: repoRoot,
    stdout: fd,
    stderr: fd,
  })
  closeSync(fd)
}

function down(name: string): void {
  // Synchronous so callers (incl. restart) know the ports are freed before reusing them.
  Bun.spawnSync(['bun', 'run', join(import.meta.dir, 'grove-down.ts'), name], {
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

function serve(): void {
  Bun.serve({
    port: PORT,
    // Loopback-only: this is a localhost dev tool with no auth, so the kernel —
    // not just convention — keeps it off the LAN. The POST guards below are the
    // in-process trust boundary for same-host browsers.
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      // The client encodeURIComponent's the name (worktree names contain `+`),
      // and URL.pathname does NOT decode — so decode it back before any check or
      // path build. A malformed encoding decodes to '' → treated as no match.
      const [, action, seg] = url.pathname.split('/')
      const name = decodeName(seg)
      if (req.method === 'POST') {
        // Trust boundary: HTTP input flows into `just` → shell. Reject cross-site
        // POSTs (CSRF) and any name that is not a real worktree (injection).
        if (!isSameOrigin(req.headers.get('origin'), PORT)) {
          return new Response('forbidden', { status: 403 })
        }
        // `down` may target an orphan tombstone (instance file, no worktree) to
        // clear it (SEC-3a); up/restart need a real worktree to launch into.
        const known =
          action === 'down'
            ? isActionableName(name, listWorktreeDirs(), readInstances())
            : isAllowedName(name, listWorktreeDirs())
        if (!name || !known) {
          return new Response('unknown worktree', { status: 404 })
        }
        if (action === 'up') {
          up(name)
          return Response.redirect('/', 303)
        }
        if (action === 'down') {
          down(name)
          return Response.redirect('/', 303)
        }
        if (action === 'restart') {
          down(name)
          await Bun.sleep(300) // let the OS release the ports before grove-up's in-use precheck
          up(name)
          return Response.redirect('/', 303)
        }
      }
      if (action === 'rows') {
        return new Response(await renderRows(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      if (action === 'logs' && name) {
        // Guard name first: it now flows into a filesystem path (path-traversal).
        // Accept orphan instance names too (SEC-3a) so a log drawer left open when
        // a live row transitions to an orphan tombstone keeps resolving its logs.
        if (!isActionableName(name, listWorktreeDirs(), readInstances())) {
          return new Response('unknown worktree', { status: 404 })
        }
        // Return the three logs as separate keyed fields, never concatenated, so
        // the row renders one independently-scrollable pane per log. Paths are
        // built deterministically — a never-launched instance still has a launch
        // log worth showing.
        const sections = instanceLogSections(join(groveRoot(), 'logs'), name)
        const body: Record<string, string> = {}
        // BE is pino one-line JSON (no TTY → no pino-pretty); expand it to a
        // human, timestamped line. launch/FE are already plain text.
        for (const s of sections) {
          const raw = tail(s.path)
          body[s.key] = s.key === 'be' ? formatPinoLog(raw) : raw
        }
        return Response.json(body)
      }
      // Seed the header counts server-side (total is exact; the client recounts
      // live status dots after the first poll). loadConfig caches, so this second
      // buildRows is in-memory and cheap.
      const config = await loadConfig()
      const summary = groveSummary(buildRows(listWorktreeDirs(), readInstances(), config))
      return new Response(page(await renderRows(), summary), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })
  console.log(`dashboard on http://localhost:${PORT}`)
}

function start(): void {
  if (portsInUse([PORT]).length > 0) {
    console.log(`dashboard already running → http://localhost:${PORT}`)
    return
  }
  const log = join(groveRoot(), 'logs', 'dashboard.log')
  mkdirSync(join(groveRoot(), 'logs'), { recursive: true })
  // Re-launch this same script in `serve` mode, detached, so closing the
  // terminal (or Ctrl+C) leaves it running. import.meta.path is this file's
  // absolute path (= argv[1] when run as the entrypoint), typed as string.
  spawnDetached(['bun', 'run', import.meta.path, 'serve'], { cwd: repoRoot, env: {}, logFile: log })
  console.log(`▶ dashboard → http://localhost:${PORT} (logs: ${log}, stop: just grove-stop)`)
}

function stop(): void {
  killByPortAndPids([PORT], [])
  console.log(`■ dashboard stopped`)
}

const mode = process.argv[2] ?? 'start'
if (mode === 'serve') serve()
else if (mode === 'stop') stop()
else start()
