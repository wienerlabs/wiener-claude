import { useSyncExternalStore } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<unknown> }
export type InstallWay = 'browser' | 'safari'
export type Install = { prompt: InstallPrompt | null; way: InstallWay | null }

const INSTALLED = 'wiener-installed'

let state: Install = { prompt: null, way: null }
const listeners = new Set<() => void>()

function update(next: Partial<Install>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function remember(installed: boolean): void {
  try {
    if (installed) localStorage.setItem(INSTALLED, '1')
    else localStorage.removeItem(INSTALLED)
  } catch {}
}

function remembered(): boolean {
  try {
    return localStorage.getItem(INSTALLED) === '1'
  } catch {
    return false
  }
}

export function installWay(userAgent: string, promptEvent: boolean): InstallWay | null {
  if (/Electron\//.test(userAgent)) return null
  if (promptEvent) return 'browser'
  const safari = /Version\/(\d+)[\d.]* Safari\//.exec(userAgent)
  return safari && Number(safari[1]) >= 17 ? 'safari' : null
}

export function registerApp(): void {
  document.head.append(Object.assign(document.createElement('link'), { rel: 'manifest', href: '/manifest.webmanifest' }))
  navigator.serviceWorker?.register('/sw.js').catch(() => {})
  const standalone = matchMedia('(display-mode: standalone)').matches
  if (standalone) remember(true)
  else if (!remembered()) update({ way: installWay(navigator.userAgent, 'onbeforeinstallprompt' in window) })
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    remember(false)
    update({ prompt: e as InstallPrompt, way: 'browser' })
  })
  window.addEventListener('appinstalled', () => {
    remember(true)
    update({ prompt: null, way: null })
  })
}

export function useInstall(): Install {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function installApp(): void {
  state.prompt?.prompt().catch(() => {})
  update({ prompt: null })
}
