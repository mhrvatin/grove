// The single source of project-specific truth for grove (the worktree dev
// launcher + dashboard). The grove-*.ts scripts know nothing about Facit; every
// Facit-specific fact — commands, env, the migrate prestart, the env-file —
// lives here. Loaded canonically from the main repo (never the invoking
// worktree's copy) so grove-up, grove-down, and the dashboard agree on ports.
import type { GroveConfig } from './grove-instances-utils.ts'

export default {
  envFile: '.env.local', // symlinked into a worktree if missing (secrets never copied into git)
  prestart: ['just', 'migrate'], // applied once against the shared DB before launch
  backend: {
    portBase: 8080,
    // Run the entrypoint directly, NOT `bun run --filter @facit/api dev`: the
    // filter runner prefixes every output line with `@facit/api dev: `, which
    // corrupts pino's one-line JSON and makes the log unparseable by the viewer.
    cmd: ['bun', '--watch', 'packages/api/src/index.ts'],
    env: (p) => ({
      DEV_AUTH_BYPASS: '1',
      NODE_ENV: 'development',
      PORT: String(p.be),
      WEBAUTHN_ORIGIN: `http://localhost:${p.fe}`,
    }),
  },
  frontend: {
    portBase: 5173,
    cmd: ['bun', 'run', '--filter', '@facit/web', 'dev'],
    // NB: PORT here is NOT the frontend's own port — vite.config.ts reads
    // process.env.PORT as the API proxy *target* and VITE_PORT as its listen
    // port. So `PORT: p.be` is deliberate, not a typo: the dev server proxies
    // /api to the backend. The key is overloaded (backend PORT = own port;
    // frontend PORT = the other slot's port) only because that's the env
    // contract vite.config.ts already expects.
    env: (p) => ({ PORT: String(p.be), VITE_PORT: String(p.fe) }),
  },
} satisfies GroveConfig
