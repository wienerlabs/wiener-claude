import { useSyncExternalStore } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<unknown> }

let pending: InstallPrompt | null = null
const listeners = new Set<() => void>()

function setPending(next: InstallPrompt | null): void {
  pending = next
  for (const l of listeners) l()
}

export function registerApp(): void {
  document.head.append(Object.assign(document.createElement('link'), { rel: 'manifest', href: '/manifest.webmanifest' }))
  navigator.serviceWorker?.register('/sw.js').catch(() => {})
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    setPending(e as InstallPrompt)
  })
  window.addEventListener('appinstalled', () => setPending(null))
}

export function useInstallPrompt(): InstallPrompt | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pending,
  )
}

export function installApp(): void {
  pending?.prompt().catch(() => {})
  setPending(null)
}
