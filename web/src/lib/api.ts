import { useEffect, useState, useSyncExternalStore } from 'react'

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
  if (source || typeof EventSource === 'undefined') return
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

export class ApiError extends Error {}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
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
}

/**
 * Fetches `path` and refetches when it changes or the index updates. Keeps showing the previous
 * data while a refetch is in flight, so live updates never flash a loading state.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const v = useDataVersion()
  const [state, setState] = useState<ApiState<T> & { path: string | null }>({ data: null, error: null, loading: true, path })
  useEffect(() => {
    if (!path) return
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, ...(s.path !== path ? { data: null, error: null, path } : {}) }))
    getJson<T>(path, ctrl.signal).then(
      (data) => setState({ data, error: null, loading: false, path }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }))
      },
    )
    return () => ctrl.abort()
  }, [path, v])
  return state.path === path ? state : { data: null, error: null, loading: true }
}
