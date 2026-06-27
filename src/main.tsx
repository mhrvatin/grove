import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// The brand stylesheet is a DOM contract reused verbatim from the old dashboard
// (status dots, 680px stacking, log drawer) — imported, not rebuilt in Tailwind.
import '../dashboard.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
