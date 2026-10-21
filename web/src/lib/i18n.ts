// The interface language: a ?lang= link, else what the person picked, else the browser's.
// Changing it remounts the app (see main.tsx), so everything reads it at render time.
import { useSyncExternalStore } from 'react'
import { type Lang, isLang, pick } from '../../../shared/i18n.ts'

const KEY = 'wiener-lang'

function initial(): Lang {
  // A shared link can carry the language; it is remembered, then dropped from the address.
  if (typeof location !== 'undefined') {
    const url = new URL(location.href)
    const linked = url.searchParams.get('lang')
    if (isLang(linked)) {
      url.searchParams.delete('lang')
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      try {
        localStorage.setItem(KEY, linked)
      } catch {
        // Storage unavailable; the link's language lasts for this visit.
      }
      return linked
    }
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (isLang(saved)) return saved
  } catch {
    // Storage unavailable; fall back to the browser.
  }
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]
  return langs.some((l) => l?.toLowerCase().startsWith('tr')) ? 'tr' : 'en'
}

let current: Lang = initial()
if (typeof document !== 'undefined') document.documentElement.lang = current
const listeners = new Set<() => void>()

export const getLang = (): Lang => current

export function setLang(next: Lang): void {
  if (next === current) return
  current = next
  document.documentElement.lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage unavailable; the choice lasts for this visit.
  }
  for (const l of listeners) l()
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** The Turkish or the English text, for the current language. */
export const tx = <T>(tr: T, en: T): T => pick(current, tr, en)
