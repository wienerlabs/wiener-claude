import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEMO, demoJson } from './demo.ts'

// Bumped whenever the server says the index changed; every useApi refetches on a bump.
let version = 0
const listeners = new Set<() => void>()
const fire = () => {
  version++
  for (const l of listeners) l()
}

// A running session changes the index every second or so; refetching that often only burns CPU.
// Bumps are coalesced to at most one per interval, always followed by a trailing one.
const MIN_INTERVAL = 4000
let last = 0
let pending: ReturnType<typeof setTimeout> | null = null
const bump = () => {
  const wait = last + MIN_INTERVAL - Date.now()
  if (wait <= 0) {
    last = Date.now()
    fire()
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null
      last = Date.now()
      fire()
    }, wait)
  }
}

/** Refetches everything at once, skipping the throttle; for right after the person saved something. */
export function refreshNow(): void {
  if (pending) clearTimeout(pending)
  pending = null
  last = Date.now()
  fire()
}

let source: EventSource | null = null
function connect(): void {
  // The demo's data never changes, and there is no server to listen to.
  if (DEMO || source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/events')
  source.addEventListener('update', bump)
  source.addEventListener('live', bump)
  // EventSource reconnects on its own; refetch once it is back in case we missed events.
  source.addEventListener('open', bump)
}

export function useDataVersion(): number {
  connect()
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

const ACCOUNT_KEY = 'wiener-account'
let account: string | null = (() => {
  try {
    return localStorage.getItem(ACCOUNT_KEY)
  } catch {
    return null
  }
})()
const accountListeners = new Set<() => void>()

function setAccount(next: string | null): void {
  if (next === account) return
  account = next
  for (const l of accountListeners) l()
  refreshNow()
  try {
    if (next) localStorage.setItem(ACCOUNT_KEY, next)
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    return
  }
}

export function useAccount(): [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      accountListeners.add(cb)
      return () => accountListeners.delete(cb)
    },
    () => account,
  )
  return [value, setAccount]
}

const withAccount = (path: string) => (account ? `${path}${path.includes('?') ? '&' : '?'}account=${encodeURIComponent(account)}` : path)

export class ApiError extends Error {}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (DEMO) return demoJson<T>(path, signal)
  const res = await fetch(withAccount(path), { signal })
  if (!res.ok) {
    let message = `Sunucu ${res.status} döndü`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Not JSON.
    }
    throw new ApiError(message)
  }
  return (await res.json()) as T
}

export interface ApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** True while `data` still belongs to the previous path (only with `keepPrevious`). */
  stale: boolean
}

/**
 * Fetches `path` and refetches when it changes or the index updates. A live update keeps the data
 * on screen while it refetches. With `keepPrevious`, so does a new path (a filter change): the old
 * result stays, marked stale, until the new one arrives, instead of dropping back to a skeleton.
 */
export function useApi<T>(path: string | null, opts: { keepPrevious?: boolean } = {}): ApiState<T> {
  const v = useDataVersion()
  const [account] = useAccount()
  const key = path && `${account ?? ''}|${path}`
  const [state, setState] = useState<Omit<ApiState<T>, 'stale'> & { key: string | null }>({ data: null, error: null, loading: true, key })
  useEffect(() => {
    if (!path) return
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, ...(s.key !== key && !opts.keepPrevious ? { data: null, error: null, key } : {}) }))
    getJson<T>(path, ctrl.signal).then(
      (data) => setState({ data, error: null, loading: false, key }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false, key }))
      },
    )
    return () => ctrl.abort()
  }, [path, key, v, opts.keepPrevious])
  if (state.key === key) return { ...state, stale: false }
  return opts.keepPrevious && state.data !== null
    ? { data: state.data, error: null, loading: true, stale: true }
    : { data: null, error: null, loading: true, stale: false }
}
