import { useCallback, useState } from 'react'
import { fetchLogs } from './api'
import { usePoll } from './usePoll'

// One log at a time via tabs, defaulting to BE (LOG-2). Mounted only while the
// drawer is open, so it polls logs (~2s) only for open rows. All three panes stay
// in the DOM (toggled by `hidden`) so each keeps its own scroll position; React
// rewrites only the changed text node, so growing logs don't yank scroll (DASH-5).
const TABS = [
  { key: 'be', label: 'BE' },
  { key: 'fe', label: 'FE' },
  { key: 'up', label: 'launch' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function LogDrawer({ name }: { name: string }) {
  const [tab, setTab] = useState<TabKey>('be')
  const { data } = usePoll(
    useCallback(() => fetchLogs(name), [name]),
    2000,
  )
  const logs = data ?? { up: '', be: '', fe: '' }
  return (
    <div className="drawer">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="logpane" hidden={tab !== 'up'}>
        {logs.up}
      </pre>
      <pre className="logpane" hidden={tab !== 'be'}>
        {logs.be}
      </pre>
      <pre className="logpane" hidden={tab !== 'fe'}>
        {logs.fe}
      </pre>
    </div>
  )
}
