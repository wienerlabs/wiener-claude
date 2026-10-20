import { Activity, Boxes, FolderGit2, LayoutGrid, Moon, Monitor, Receipt, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { IndexStatus } from '../../shared/types.ts'
import { cx } from './components/ui.tsx'
import { getJson, useApi } from './lib/api.ts'
import { fmtRelative } from './lib/format.ts'
import { onLinkClick, useLocation } from './lib/router.ts'
import { Costs } from './screens/Costs.tsx'
import { Environment } from './screens/Environment.tsx'
import { Overview } from './screens/Overview.tsx'
import { Projects } from './screens/Projects.tsx'
import { Sessions } from './screens/Sessions.tsx'

const NAV = [
  { to: '/', label: 'Genel bakış', icon: LayoutGrid, match: (p: string) => p === '/' },
  { to: '/oturumlar', label: 'Oturumlar', icon: Activity, match: (p: string) => p.startsWith('/oturumlar') },
  { to: '/projeler', label: 'Projeler', icon: FolderGit2, match: (p: string) => p.startsWith('/projeler') },
  { to: '/maliyet', label: 'Maliyet', icon: Receipt, match: (p: string) => p.startsWith('/maliyet') },
  { to: '/ortam', label: 'Ortam', icon: Boxes, match: (p: string) => p.startsWith('/ortam') },
]

const TITLES: [string, string][] = [
  ['/oturumlar', 'Oturumlar'],
  ['/projeler', 'Projeler'],
  ['/maliyet', 'Maliyet'],
  ['/ortam', 'Ortam'],
]

export function App() {
  const { path } = useLocation()
  const tail = (prefix: string) => (path.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length)) || null : null)
  const sessionId = tail('/oturumlar/')
  const projectKey = tail('/projeler/')

  useEffect(() => {
    const title = TITLES.find(([prefix]) => path.startsWith(prefix))?.[1]
    document.title = title ? `${title} · Wiener Tools` : 'Wiener Tools'
  }, [path])

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="flex items-center gap-4 border-b border-line bg-bg px-4 py-3 md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:gap-0 md:border-r md:border-b-0 md:px-3 md:py-5">
        <a href="/" onClick={(e) => onLinkClick(e, '/')} aria-label="Wiener Tools ana sayfa" className="flex items-center gap-2 rounded-md md:px-2 md:pb-6">
          <Mark />
          <span className="hidden font-display text-[17px] font-semibold tracking-[-0.02em] sm:inline">Wiener Tools</span>
        </a>
        <nav aria-label="Ana menü" className="flex gap-1 md:flex-col">
          {NAV.map(({ to, label, icon: Icon, match }) => {
            const active = match(path)
            return (
              <a
                key={to}
                href={to}
                onClick={(e) => onLinkClick(e, to)}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                className={cx(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[14px] transition-colors',
                  active ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden strokeWidth={1.75} />
                <span className="hidden sm:inline">{label}</span>
              </a>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-3 md:px-2">
          <IndexBadge />
          <ThemeToggle />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        {path === '/' ? (
          <Overview />
        ) : path.startsWith('/oturumlar') ? (
          <Sessions selectedId={sessionId} />
        ) : path.startsWith('/projeler') ? (
          <Projects selectedKey={projectKey} />
        ) : path === '/maliyet' ? (
          <Costs />
        ) : path === '/ortam' ? (
          <Environment />
        ) : (
          <NotFound />
        )}
      </main>
    </div>
  )
}

/** The brand mark is a tiny heatmap, the thing this tool is about. */
function Mark() {
  const cells = [1, 3, 0, 2, 4, 1, 0, 2, 3]
  return (
    <span className="grid grid-cols-3 gap-[2px]" aria-hidden>
      {cells.map((l, i) => (
        <span key={i} className="size-[5px] rounded-[1.5px]" style={{ background: `var(--heat-${l})` }} />
      ))}
    </span>
  )
}

function IndexBadge() {
  const { data } = useApi<IndexStatus>('/api/status')
  const [live, setLive] = useState<IndexStatus | null>(null)
  const status = live ?? data
  const [, tick] = useState(0)

  // While indexing, poll for progress; the event stream only reports finished scans.
  useEffect(() => {
    if (status?.state !== 'indexing') return
    const id = setInterval(() => getJson<IndexStatus>('/api/status').then(setLive, () => {}), 800)
    return () => clearInterval(id)
  }, [status?.state])
  useEffect(() => {
    if (data) setLive(null)
  }, [data])
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!status) return null
  if (status.state === 'indexing') {
    const pct = status.bytesTotal > 0 ? Math.round((status.bytesDone / status.bytesTotal) * 100) : 0
    return (
      <div className="text-[12px] text-ink-2" aria-live="polite">
        <span className="hidden md:inline">İndeksleniyor </span>
        <span className="num">%{pct}</span>
        <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-line md:block">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="hidden items-center gap-1.5 text-[12px] text-ink-3 md:flex" title="Dosyalar değiştikçe indeks kendini günceller">
      <span className="size-1.5 rounded-full bg-good" aria-hidden />
      Güncel{status.lastScanAt ? ` · ${fmtRelative(status.lastScanAt)}` : ''}
    </div>
  )
}

type Theme = 'system' | 'light' | 'dark'
const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Sistem teması', icon: Monitor },
  { value: 'light', label: 'Açık tema', icon: Sun },
  { value: 'dark', label: 'Koyu tema', icon: Moon },
]

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = document.documentElement.dataset.theme
    return t === 'light' || t === 'dark' ? t : 'system'
  })
  const choose = (t: Theme) => {
    setTheme(t)
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
    try {
      if (t === 'system') localStorage.removeItem('wiener-theme')
      else localStorage.setItem('wiener-theme', t)
    } catch {
      // Storage unavailable; the choice lasts for this visit.
    }
  }
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={cx('grid size-7 flex-1 place-items-center rounded-md', theme === value ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink')}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="font-display text-2xl">Bu sayfa yok</p>
      <a href="/" onClick={(e) => onLinkClick(e, '/')} className="mt-3 inline-block text-accent underline underline-offset-2">
        Genel bakışa dön
      </a>
    </div>
  )
}
