import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DASHBOARD_PORT = 4000

// Build to dist/ with relative asset URLs (base './') so the same index.html works
// served straight off disk by grove-dashboard.ts's Bun.serve. In dev, proxy /api to
// the Bun server; rewrite Origin to the dashboard's own origin or the server's
// same-origin CSRF guard (isSameOrigin) 403s every POST through the proxy.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${DASHBOARD_PORT}`,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', `http://localhost:${DASHBOARD_PORT}`)
          })
        },
      },
    },
  },
})
