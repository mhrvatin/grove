// Shared impure I/O for `grove up` / `grove down` / the dashboard: git, fs and
// process calls. Pure logic + types live in lib/instances-utils.ts; this is
// the only module that touches the filesystem, git, lsof, the process table,
// and that loads grove.config.jsonc. No top-level run, no shebang — it is imported.
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type GroveConfig,
  type GroveSlot,
  type Instance,
  makeDualInstance,
  makeSingleInstance,
} from './instances-utils.ts'

export type { GroveConfig, Instance }
export { makeDualInstance, makeSingleInstance }

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function gitOut(args: string[]): string {
  return decode(Bun.spawnSync(['git', ...args]).stdout).trim()
}

// The main repo root (parent of the common git dir) — the canonical anchor for
// both .grove/ and grove.config.jsonc, so every worktree agrees regardless of
// which one invoked the command.
export function mainRepoRoot(): string {
  return dirname(gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir']))
}

// Shared .grove/ at the main repo root.
export function groveRoot(): string {
  return join(mainRepoRoot(), '.grove')
}

// Load the main repo's grove.config.jsonc (never the invoking worktree's copy),
// so `grove up`, `grove down`, and the dashboard read one config and agree on ports.
// Bun parses .jsonc natively (comments stripped); the dynamic import keeps the
// path off tsc's static module graph.
let configCache: GroveConfig | null = null
export async function loadConfig(): Promise<GroveConfig> {
  if (configCache) return configCache
  const path = join(mainRepoRoot(), 'grove.config.jsonc')
  if (!existsSync(path)) {
    console.error(`No grove.config.jsonc in main repo (${path})`)
    process.exit(1)
  }
  const mod = (await import(pathToFileURL(path).href)) as { default: GroveConfig }
  configCache = assertConfig(mod.default, path)
  return configCache
}

// JSON has no compile-time `satisfies` check, so validate the loaded shape.
// Accepts either a dual config (backend + frontend slots) or a single-process
// config (server slot). Fails loudly on any other shape.
function assertConfig(c: GroveConfig, path: string): GroveConfig {
  const slotOk = (s: unknown): boolean => {
    const slot = s as GroveSlot | undefined
    return (
      !!slot &&
      typeof slot.portBase === 'number' &&
      Array.isArray(slot.cmd) &&
      typeof slot.env === 'object'
    )
  }
  const raw = c as Record<string, unknown>
  if (typeof raw['envFile'] !== 'string') {
    console.error(`Malformed grove config (${path}): need envFile`)
    process.exit(1)
  }
  if ('server' in raw) {
    if (!slotOk(raw['server'])) {
      console.error(`Malformed grove config (${path}): "server" must have {portBase,cmd,env}`)
      process.exit(1)
    }
    if ('backend' in raw || 'frontend' in raw) {
      console.error(
        `Malformed grove config (${path}): "server" is mutually exclusive with "backend"/"frontend"`,
      )
      process.exit(1)
    }
    return c
  }
  if (!slotOk(raw['backend']) || !slotOk(raw['frontend'])) {
    console.error(
      `Malformed grove config (${path}): need backend/frontend {portBase,cmd,env}, or use "server" for single-process mode`,
    )
    process.exit(1)
  }
  return c
}

export function currentToplevel(): string {
  return gitOut(['rev-parse', '--show-toplevel'])
}

export function listWorktreeDirs(): string[] {
  return gitOut(['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

function instancesDir(): string {
  return join(groveRoot(), 'instances')
}

// A corrupt/partially-written instance file must not crash the dashboard: parse
// defensively and skip anything unreadable rather than throwing mid-render.
// Backward compat: old instance files (pre single-slot) lack a `kind` field —
// default them to 'dual' so existing .grove/ state keeps working without migration.
function parseInstanceFile(path: string): Instance | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (!parsed['kind']) parsed['kind'] = 'dual'
    return parsed as Instance
  } catch {
    console.warn(`skipping unreadable instance file: ${path}`)
    return null
  }
}

export function readInstances(): Instance[] {
  const dir = instancesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => parseInstanceFile(join(dir, f)))
    .filter((i): i is Instance => i !== null)
}

export function readInstance(name: string): Instance | null {
  const f = join(instancesDir(), `${name}.json`)
  return existsSync(f) ? parseInstanceFile(f) : null
}

export function writeInstance(inst: Instance): void {
  mkdirSync(instancesDir(), { recursive: true })
  writeFileSync(join(instancesDir(), `${inst.name}.json`), `${JSON.stringify(inst)}\n`)
}

export function removeInstance(name: string): void {
  rmSync(join(instancesDir(), `${name}.json`), { force: true })
}

// Ensure the worktree has config.envFile (symlink from the main repo if missing),
// so it tracks the source and secrets are never copied into git.
export function ensureEnvFile(dir: string, envFile: string): void {
  const dest = join(dir, envFile)
  if (existsSync(dest)) return
  const src = join(mainRepoRoot(), envFile)
  if (!existsSync(src)) {
    console.error(`No ${envFile} in main repo (${src})`)
    process.exit(1)
  }
  symlinkSync(src, dest)
}

function lsofPids(port: number, listenOnly: boolean): number[] {
  const args = ['-ti', `tcp:${port}`]
  if (listenOnly) args.push('-sTCP:LISTEN')
  const out = decode(Bun.spawnSync(['lsof', ...args]).stdout).trim()
  return out ? out.split('\n').map(Number) : []
}

// Which of these ports already have a listener (the grove-up in-use precheck).
export function portsInUse(ports: number[]): number[] {
  return ports.filter((p) => lsofPids(p, true).length > 0)
}

// Record the listening pid *by port* — the slot cmdlines are identical across
// worktrees, so only the unique port identifies the real server. Wait up to ~30s
// for the port to bind; 0 means it never did.
export function waitForPort(port: number): number {
  for (let t = 0; t < 60; t++) {
    const [pid] = lsofPids(port, true)
    if (pid) return pid
    Bun.sleepSync(500)
  }
  return 0
}

// Kill the listeners on each port (the real servers + their children) and the
// recorded pids (the wrappers + their direct children via pkill -P).
// kill/pkill on a gone pid is a harmless no-op — spawnSync never throws on a
// non-zero exit, so no error guard is needed. The pid > 0 guard IS needed:
// a failed-bind instance is recorded with pid 0, and `kill 0` / `pkill -P 0`
// target the entire process group, not nothing — those rely on the port kill.
// listenOnly: lsof -i tcp:<port> matches BOTH ends of a loopback connection, so
// without the LISTEN filter we'd also kill clients connected to the port — e.g.
// a Firefox tab on the dev server, which crashes the whole browser. Only ever
// kill listeners; the wrapper's children are covered by pkill -P below.
export function killByPortAndPids(ports: number[], pids: number[]): void {
  for (const port of ports) {
    const ps = lsofPids(port, true)
    if (ps.length) Bun.spawnSync(['kill', ...ps.map(String)])
  }
  for (const pid of pids) {
    if (pid > 0) {
      Bun.spawnSync(['kill', String(pid)])
      Bun.spawnSync(['pkill', '-P', String(pid)])
    }
  }
}

// Launch a process that outlives this command. `nohup` gives SIGHUP immunity
// (so closing the terminal won't kill the servers — bare unref() does NOT
// survive SIGHUP, verified). stdin is ignored and stdout/stderr go to the log
// file, so the child holds none of the caller's fds — otherwise it blocks the
// caller's pipe open forever. unref() lets this process exit without waiting on
// the orphaned child.
export function spawnDetached(
  cmd: string[],
  opts: { cwd: string; env: Record<string, string>; logFile: string },
): void {
  const fd = openSync(opts.logFile, 'w') // truncate on each start (no rotation)
  const proc = Bun.spawn(['nohup', ...cmd], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin: 'ignore',
    stdout: fd,
    stderr: fd,
  })
  proc.unref()
}

// Run config.prestart (e.g. ['just', 'migrate']) once against the shared DB
// before starting. Idempotent prestarts are safe to repeat per launch.
export function runPrestart(dir: string, prestart: string[]): void {
  const [cmd, ...args] = prestart
  if (!cmd) return
  Bun.spawnSync([cmd, ...args], { cwd: dir, stdout: 'inherit', stderr: 'inherit' })
}
