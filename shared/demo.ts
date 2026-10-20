// The public demo serves recorded API responses as static files. Both the recorder and the
// browser name a response's file the same way: a hash of its path with the query sorted.

/** FNV-1a, 32 bit: short, stable names, the same in Node and the browser. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function demoFile(url: string): string {
  const u = new URL(url, 'http://demo.invalid')
  const params = [...u.searchParams].sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
  const canonical = `${u.pathname}${params.length ? `?${new URLSearchParams(params)}` : ''}`
  const name = u.pathname.replace(/^\/api\//, '').split('/')[0] || 'api'
  return `${name}-${fnv1a(canonical)}.json`
}
