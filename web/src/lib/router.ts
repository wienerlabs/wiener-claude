import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}
if (typeof window !== 'undefined') window.addEventListener('popstate', notify)

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return
  if (opts.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  notify()
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => location.pathname + location.search,
  )
  const url = new URL(href, 'http://x')
  return { path: url.pathname, query: url.searchParams }
}

/** Plain left clicks navigate in place; modified clicks keep the browser's behavior. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, to: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  navigate(to)
}
