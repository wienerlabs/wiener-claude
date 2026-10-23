import { Activity, Boxes, FolderGit2, Gauge, LayoutGrid, Lightbulb, Monitor, MonitorDown, Moon, Receipt, Sparkles, Sun, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Account, IndexStatus } from '../../shared/types.ts'
import { CopyCommand, DemoBanner } from './components/DemoBanner.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Mark } from './components/Mark.tsx'
import { cx } from './components/ui.tsx'
import { getJson, useAccount, useApi } from './lib/api.ts'
import { DEMO } from './lib/demo.ts'
import { fmtRelative } from './lib/format.ts'
import { setLang, tx, useLang } from './lib/i18n.ts'
import { installApp, useInstall } from './lib/install.ts'
import { onLinkClick, useLocation } from './lib/router.ts'
import { Costs } from './screens/Costs.tsx'
import { Environment } from './screens/Environment.tsx'
import { Limits } from './screens/Limits.tsx'
import { Overview } from './screens/Overview.tsx'
import { Projects } from './screens/Projects.tsx'
import { Sessions } from './screens/Sessions.tsx'
import { Tips } from './screens/Tips.tsx'
import { Tools } from './screens/Tools.tsx'
import { Year } from './screens/Year.tsx'

// Paths stay the same in both languages, so links keep working whoever shares them.
const nav = () => [
  { to: '/', label: tx('Genel bakış', 'Overview'), icon: LayoutGrid, match: (p: string) => p === '/' },
  { to: '/oturumlar', label: tx('Oturumlar', 'Sessions'), icon: Activity, match: (p: string) => p.startsWith('/oturumlar') },
  { to: '/projeler', label: tx('Projeler', 'Projects'), icon: FolderGit2, match: (p: string) => p.startsWith('/projeler') },
  { to: '/araclar', label: tx('Araçlar', 'Tools'), icon: Wrench, match: (p: string) => p.startsWith('/araclar') },
  { to: '/maliyet', label: tx('Maliyet', 'Cost'), icon: Receipt, match: (p: string) => p.startsWith('/maliyet') },
  { to: '/limitler', label: tx('Limitler', 'Limits'), icon: Gauge, match: (p: string) => p.startsWith('/limitler') },
  { to: '/ipuclari', label: tx('İpuçları', 'Tips'), icon: Lightbulb, match: (p: string) => p.startsWith('/ipuclari') },
  { to: '/ortam', label: tx('Ortam', 'Environment'), icon: Boxes, match: (p: string) => p.startsWith('/ortam') },
  { to: '/yil-ozeti', label: tx('Yıl özeti', 'Year in review'), icon: Sparkles, match: (p: string) => p.startsWith('/yil-ozeti') },
]

export function App() {
  const { path } = useLocation()
  const tail = (prefix: string) => (path.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length)) || null : null)
  const sessionId = tail('/oturumlar/')
  const projectKey = tail('/projeler/')

  useEffect(() => {
    const title = path === '/' ? null : nav().find((n) => n.match(path))?.label
    document.title = title ? `${title} · Wiener Lens` : 'Wiener Lens'
  }, [path])

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center gap-4 border-b border-line bg-bg px-4 py-3 md:sticky md:top-0 md:h-screen md:flex-col md:flex-nowrap md:items-stretch md:gap-0 md:border-r md:border-b-0 md:px-3 md:py-5">
        <a href="/" onClick={(e) => onLinkClick(e, '/')} aria-label={tx('Wiener Lens ana sayfa', 'Wiener Lens home')} className="flex items-center gap-2 rounded-md md:px-2 md:pb-6">
          <Mark />
          <span className="hidden font-display text-[17px] font-semibold tracking-[-0.02em] sm:inline">Wiener Lens</span>
        </a>
        <nav aria-label={tx('Ana menü', 'Main menu')} className="flex gap-0.5 md:flex-col md:gap-1">
          {nav().map(({ to, label, icon: Icon, match }) => {
            const active = match(path)
            return (
              <a
                key={to}
                href={to}
                onClick={(e) => onLinkClick(e, to)}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                title={label}
                className={cx(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] transition-colors md:px-2.5',
                  active ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden strokeWidth={1.75} />
                <span className="hidden md:inline">{label}</span>
              </a>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-3 md:px-2">
          <InstallButton />
          <AccountPicker />
          <IndexBadge />
          <div className="hidden items-center gap-2 sm:flex md:justify-between">
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        {DEMO ? <DemoBanner /> : null}
        {/* Keyed by path: moving to another screen clears an error left on the previous one. */}
        <ErrorBoundary key={path}>
          {path === '/' ? (
            <Overview />
          ) : path.startsWith('/oturumlar') ? (
            <Sessions selectedId={sessionId} />
          ) : path.startsWith('/projeler') ? (
            <Projects selectedKey={projectKey} />
          ) : path === '/maliyet' ? (
            <Costs />
          ) : path === '/limitler' ? (
            <Limits />
          ) : path === '/ortam' ? (
            <Environment />
          ) : path === '/ipuclari' ? (
            <Tips />
          ) : path === '/araclar' ? (
            <Tools />
          ) : path === '/yil-ozeti' ? (
            <Year />
          ) : (
            <NotFound />
          )}
        </ErrorBoundary>
        {/* Phones have no room for it in the top bar. */}
        <footer className="mt-10 flex justify-center sm:hidden">
          <LangToggle />
        </footer>
      </main>
    </div>
  )
}

function InstallButton() {
  const { prompt, way } = useInstall()
  if (!DEMO && !prompt && !way) return null
  return (
    <div className="hidden md:block">
      <button
        type="button"
        onClick={prompt ? installApp : undefined}
        popoverTarget={prompt ? undefined : 'install-help'}
        title={tx('Paneli kendi penceresi ve simgesiyle aç', 'Open the dashboard in its own window, with its own icon')}
        className="install-anchor flex items-center gap-1.5 rounded-md text-left text-[12px] text-ink-2 hover:text-ink"
      >
        <MonitorDown className="size-3.5 shrink-0" aria-hidden />
        {tx('Uygulama olarak yükle', 'Install as app')}
      </button>
      <div id="install-help" popover="auto" className="install-help w-72 rounded-xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink-2 shadow-lg">
        {DEMO ? (
          <>
            <p className="font-medium text-ink">{tx('Kendi bilgisayarına kur', 'Install it on your computer')}</p>
            <p className="mt-1">
              {tx(
                'Terminalde çalıştır; panel tarayıcında açılır ve oradaki bu düğme onu uygulama olarak yükler. Node.js 22.13 ya da üstü gerekir.',
                'Run this in a terminal. The dashboard opens in your browser, and this button there installs it as an app. Needs Node.js 22.13 or later.',
              )}
            </p>
            <div className="mt-3">
              <CopyCommand />
            </div>
          </>
        ) : way === 'safari' ? (
          tx("Safari menüsünde Dosya > Dock'a Ekle'yi seç.", 'In Safari, choose File > Add to Dock.')
        ) : (
          tx(
            'Adres çubuğunun sağındaki yükle simgesine bas. Simge görünmüyorsa sayfayı bir kez yenile.',
            'Click the install icon at the right end of the address bar. If it is not there, reload the page once.',
          )
        )}
      </div>
    </div>
  )
}

function AccountPicker() {
  const { data } = useApi<Account[]>(DEMO ? null : '/api/accounts', { keepPrevious: true })
  const [account, setAccount] = useAccount()
  const accounts = data?.filter((a) => a.kind === 'account').length ?? 0
  if (!data || (accounts < 2 && !account)) return null
  return (
    <select
      aria-label={tx('Hesap', 'Account')}
      value={account ?? ''}
      onChange={(e) => setAccount(e.target.value || null)}
      className="h-8 min-w-0 max-w-36 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink-2 md:max-w-none"
    >
      <option value="">{tx('Tüm hesaplar', 'All accounts')}</option>
      {data.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label} ({a.sessions})
        </option>
      ))}
    </select>
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

  if (DEMO) {
    return (
      <div className="hidden items-center gap-1.5 text-[12px] text-ink-3 md:flex" title={tx('Bu sayfadaki veriler uydurma', 'The data on this page is made up')}>
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        {tx('Demo verisi', 'Demo data')}
      </div>
    )
  }
  if (!status) return null
  if (status.state === 'indexing') {
    const pct = status.bytesTotal > 0 ? Math.round((status.bytesDone / status.bytesTotal) * 100) : 0
    return (
      <div className="text-[12px] text-ink-2" aria-live="polite">
        <span className="hidden md:inline">{tx('İndeksleniyor ', 'Indexing ')}</span>
        <span className="num">{tx(`%${pct}`, `${pct}%`)}</span>
        <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-line md:block">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="hidden items-center gap-1.5 text-[12px] text-ink-3 md:flex" title={tx('Dosyalar değiştikçe indeks kendini günceller', 'The index updates itself as the files change')}>
      <span className="size-1.5 rounded-full bg-good" aria-hidden />
      {tx('Güncel', 'Up to date')}{status.lastScanAt ? ` · ${fmtRelative(status.lastScanAt)}` : ''}
    </div>
  )
}

type Theme = 'system' | 'light' | 'dark'
const themes = (): { value: Theme; label: string; icon: typeof Sun }[] => [
  { value: 'system', label: tx('Sistem teması', 'System theme'), icon: Monitor },
  { value: 'light', label: tx('Açık tema', 'Light theme'), icon: Sun },
  { value: 'dark', label: tx('Koyu tema', 'Dark theme'), icon: Moon },
]

const LANG_OPTIONS = [
  { value: 'tr', short: 'TR', label: 'Türkçe' },
  { value: 'en', short: 'EN', label: 'English' },
] as const

function LangToggle() {
  const lang = useLang()
  return (
    <div role="radiogroup" aria-label={tx('Dil', 'Language')} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {LANG_OPTIONS.map(({ value, short, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          lang={value}
          aria-checked={lang === value}
          aria-label={label}
          title={label}
          onClick={() => setLang(value)}
          className={cx('h-7 rounded-md px-1.5 font-mono text-[11px] font-medium', lang === value ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink')}
        >
          {short}
        </button>
      ))}
    </div>
  )
}

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
  useEffect(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const system = (meta.dataset.system ??= meta.content)
      meta.content = theme === 'system' ? system : bg
    }
  }, [theme])
  return (
    <div role="radiogroup" aria-label={tx('Tema', 'Theme')} className="hidden rounded-lg border border-line bg-surface p-0.5 sm:inline-flex">
      {themes().map(({ value, label, icon: Icon }) => (
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
      <p className="font-display text-2xl">{tx('Bu sayfa yok', 'This page does not exist')}</p>
      <a href="/" onClick={(e) => onLinkClick(e, '/')} className="mt-3 inline-block text-accent underline underline-offset-2">
        {tx('Genel bakışa dön', 'Back to the overview')}
      </a>
    </div>
  )
}
