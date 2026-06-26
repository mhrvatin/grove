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
  instanceLogSections,
  isAllowedName,
  isSameOrigin,
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

const PORT = Number(process.env.DASHBOARD_PORT) || 4000
const repoRoot = mainRepoRoot()

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
  const rows = buildRows(listWorktreeDirs(), readInstances(), config)
  const cells = await Promise.all(
    rows.map(async (r) => {
      // Keep the short-circuit: stopped worktrees (no instance file) are never
      // probed. status splits the old binary dot into live / failed / stopped —
      // a failed start is an instance file with a dead port (UP-6 writes pid 0).
      const portLive = r.running && (await alive(r.fePort))
      const status = rowStatus(r.running, portLive)
      // Status is shown as a coloured dot AND a text label (never colour alone).
      const dot = `<span class="dot ${status}" title="${status}" aria-label="${status}"></span> <span class=statuslabel>${status}</span>`
      const link = `<a href="${r.url}" target=_blank>${r.url}</a>`
      // Actions fire via fetch (act()), not a form POST, so the page never reloads
      // and open log rows / scroll survive (DASH-5). Show logs toggles an inline
      // log row attached to this worktree (same tab), tracked client-side so it
      // survives the 2s poll. Never a new page.
      const logsBtn = `<button type=button onclick="toggleLogs('${r.name}')">logs</button>`
      const actions =
        status === 'live'
          ? `<button type=button onclick="act('restart','${r.name}')">restart</button>
             <button type=button onclick="act('down','${r.name}')">stop</button>
             ${logsBtn}`
          : `<button type=button onclick="act('up','${r.name}')">start</button>
             ${logsBtn}${status === 'failed' ? ' <span class=hint>start failed — see launch log</span>' : ''}`
      // The log row is rendered hidden alongside every worktree; toggleLogs/
      // refreshLogs reveal and fill it. One full-width pane at a time — tabs
      // switch between the launch, BE and FE logs (BE shown first).
      const tab = (key: string, label: string) =>
        `<button type=button class=tab data-tab="${key}-${r.name}" onclick="showTab('${r.name}','${key}')">${label}</button>`
      const logRow = `<tr class=logrow id="logrow-${r.name}" hidden><td colspan=4>
        <div class=tabs>${tab('be', 'BE')}${tab('fe', 'FE')}${tab('up', 'launch')}</div>
        <pre id="up-${r.name}" class=logpane hidden></pre>
        <pre id="be-${r.name}" class=logpane></pre>
        <pre id="fe-${r.name}" class=logpane hidden></pre></td></tr>`
      return `<tr data-name="${r.name}" data-status="${status}"><td>${dot}</td><td>${r.name}</td><td>${link}</td><td>${actions}</td></tr>${logRow}`
    }),
  )
  return cells.join('')
}

function page(rows: string): string {
  // Poll the /rows fragment instead of a full-page refresh, so the table updates
  // in place without flicker or losing scroll position. To kill the every-2s
  // flash, refresh() morphs: it caches the last /rows string and only touches the
  // DOM when it changes, replacing just the data rows whose markup actually
  // differs (DASH-5). Open log rows are tracked in `open`, never recreated by the
  // morph, and refilled only when their text changes — so they stay open and keep
  // scroll position.
  return `<!doctype html><meta charset=utf8>
<title>grove</title>
<style>body{font:14px system-ui;margin:2rem}
table{border-collapse:collapse;width:100%}td,th{padding:.5rem;border-bottom:1px solid #ddd;text-align:left}
.dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;vertical-align:middle}
.dot.live{background:#16a34a}.dot.failed{background:#dc2626}.dot.stopped{background:#9ca3af}
.dot.pending{background:transparent;border:2px solid #d97706;border-top-color:transparent;box-sizing:border-box;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.statuslabel{font-size:.85em;color:#475569}.hint{font-size:.8em;color:#92400e}
button{font:inherit;padding:.2rem .6rem;margin-right:.3rem}
button:disabled{opacity:.5;cursor:default}
.tabs{margin:.25rem 0}.tab{cursor:pointer}.tab.active{font-weight:600;background:#0b0f17;color:#fff}
.logpane{margin:0;height:24rem;overflow:auto;background:#0b0f17;color:#cbd5e1;padding:.5rem;border-radius:.3rem;font:12px ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}</style>
<h1>grove — worktrees</h1>
<table><thead><tr><th>status</th><th>worktree</th><th>url</th><th>actions</th></tr></thead>
<tbody id=rows>${rows}</tbody></table>
<script>
const open=new Set(), active=new Map(), pending=new Map(), logCache=new Map()
let lastRows=''
function paintPending(name){
  const tr=document.querySelector('tr[data-name="'+CSS.escape(name)+'"]'); if(!tr) return
  const dot=tr.querySelector('.dot'); if(dot) dot.className='dot pending'
  const lbl=tr.querySelector('.statuslabel'); if(lbl) lbl.textContent='starting…'
  tr.querySelectorAll('button').forEach(b=>{b.disabled=true})
}
async function act(action,name){
  // fetch, not a form POST, so the page never reloads (DASH-5). start/restart get
  // an optimistic 'starting…' until a poll sees live/failed or the 65s ceiling
  // lapses — grove-up waits 30s per port, BE then FE sequentially, so a two-port
  // bind failure writes its failed record at ~60s; the ceiling sits just past that
  // so the row stays 'starting…' straight through to 'failed' instead of blipping
  // 'stopped'. A prestart that dies before writing an instance file falls back to
  // 'stopped' + the launch log. stop is fast (sync teardown), so it skips pending.
  if(action!=='down'){pending.set(name,Date.now()+65000); paintPending(name)}
  let res
  try{res=await fetch('/'+action+'/'+encodeURIComponent(name),{method:'POST'})}catch{}
  if(res&&!res.ok){pending.delete(name); lastRows=''} // 403/404 resolve without throwing — drop the phantom + force a corrective re-morph
  refresh()
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
  try{
    const r=await fetch('/logs/'+encodeURIComponent(name)); if(!r.ok) return
    const j=await r.json()
    // Only write a pane when its text changed — an unchanged log left alone keeps
    // its scroll position and doesn't reflash on every 2s poll (DASH-5).
    for(const k of ['up','be','fe']){
      const el=document.getElementById(k+'-'+name); if(!el) continue
      const ck=name+'/'+k
      if(logCache.get(ck)!==j[k]){logCache.set(ck,j[k]); el.textContent=j[k]}
    }
  }catch{}
  showTab(name,active.get(name)||'be')
}
function toggleLogs(name){
  if(open.has(name)){open.delete(name); const row=document.getElementById('logrow-'+name); if(row) row.hidden=true}
  else{open.add(name); refreshLogs(name)}
}
function morph(html){
  const tbody=document.getElementById('rows')
  const tmp=document.createElement('tbody'); tmp.innerHTML=html
  const incoming=[...tmp.querySelectorAll('tr[data-name]')]
  const cur=[...tbody.querySelectorAll('tr[data-name]')]
  // A worktree appeared/disappeared → row set changed; rebuild wholesale (rare).
  if(incoming.map(t=>t.dataset.name).join(',')!==cur.map(t=>t.dataset.name).join(',')){
    // Wholesale rebuild blanks every log pane; drop the cache so refreshLogs refills them.
    logCache.clear(); tbody.innerHTML=html; return
  }
  // Otherwise touch only the data rows that differ — and never recreate the log
  // rows (left in the DOM, refilled by refreshLogs), so open logs survive.
  for(const nt of incoming){
    const name=nt.dataset.name
    const ct=tbody.querySelector('tr[data-name="'+CSS.escape(name)+'"]'); if(!ct) continue
    // A pending row is client-owned: let the server overwrite it only once it
    // settles (live/failed), else keep the spinner instead of flashing back.
    if(pending.has(name)){
      if(nt.dataset.status==='live'||nt.dataset.status==='failed') ct.replaceWith(nt)
      continue
    }
    if(ct.outerHTML!==nt.outerHTML) ct.replaceWith(nt)
  }
}
async function refresh(){
  try{
    const r=await fetch('/rows'); if(!r.ok) return
    const html=await r.text()
    if(html!==lastRows){lastRows=html; morph(html)} // skip the DOM entirely when nothing changed
    // Re-apply 'starting…' to still-pending rows; clear it once the server reports
    // a settled state (live/failed), the row is gone, or the ceiling lapses.
    for(const [name,deadline] of pending){
      const tr=document.querySelector('tr[data-name="'+CSS.escape(name)+'"]')
      const st=tr&&tr.dataset.status
      if(!tr||st==='live'||st==='failed'||Date.now()>deadline){pending.delete(name); lastRows=''} // force a re-morph so the ceiling-lapse row reverts to server truth (re-enables buttons)
      else paintPending(name)
    }
    for(const name of open) refreshLogs(name)
  }catch{}
}
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
        if (!name || !isAllowedName(name, listWorktreeDirs())) {
          return new Response('unknown worktree', { status: 404 })
        }
        // 204, not a redirect: act() issues these via fetch and drives the table
        // refresh itself, so the page never navigates (DASH-5).
        if (action === 'up') {
          up(name)
          return new Response(null, { status: 204 })
        }
        if (action === 'down') {
          down(name)
          return new Response(null, { status: 204 })
        }
        if (action === 'restart') {
          down(name)
          await Bun.sleep(300) // let the OS release the ports before grove-up's in-use precheck
          up(name)
          return new Response(null, { status: 204 })
        }
      }
      if (action === 'rows') {
        return new Response(await renderRows(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      if (action === 'logs' && name) {
        // Guard name first: it now flows into a filesystem path (path-traversal).
        if (!isAllowedName(name, listWorktreeDirs())) {
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
      return new Response(page(await renderRows()), {
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
  // terminal (or Ctrl+C) leaves it running. argv[1] = this file's absolute path.
  spawnDetached(['bun', 'run', process.argv[1], 'serve'], { cwd: repoRoot, env: {}, logFile: log })
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
