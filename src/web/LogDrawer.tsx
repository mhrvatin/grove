import { useCallback, useState } from 'react'
import { fetchLogs } from './api'
import { usePoll } from './usePoll'

// One log at a time via tabs (LOG-2). Mounted only while the drawer is open, so
// it polls logs (~2s) only for open rows. All panes stay in the DOM (toggled by
// `hidden`) so each keeps its own scroll position; React rewrites only the changed
// text node, so growing logs don't yank scroll (DASH-5).
//
// Dual mode tabs: BE (default) / FE / launch.
// Single mode tabs: server (default) / launch.
const DUAL_TABS = [
  { key: 'be', label: 'BE' },
  { key: 'fe', label: 'FE' },
  { key: 'up', label: 'launch' },
] as const

const SINGLE_TABS = [
  { key: 'server', label: 'server' },
  { key: 'up', label: 'launch' },
] as const

type DualTabKey = (typeof DUAL_TABS)[number]['key']
type SingleTabKey = (typeof SINGLE_TABS)[number]['key']
type TabKey = DualTabKey | SingleTabKey

export function LogDrawer({ name, mode }: { name: string; mode: 'dual' | 'single' }) {
  const tabs = mode === 'single' ? SINGLE_TABS : DUAL_TABS
  const [tab, setTab] = useState<TabKey>(tabs[0].key)
  const { data } = usePoll(
    useCallback(() => fetchLogs(name), [name]),
    2000,
  )
  const logs = data ?? {}
  return (
    <div className="drawer">
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key as TabKey)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <pre key={t.key} className="logpane" hidden={tab !== t.key}>
          {(logs as Record<string, string | undefined>)[t.key] ?? ''}
        </pre>
      ))}
    </div>
  )
}
