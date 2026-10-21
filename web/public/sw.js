const MARK =
  'M2 0 122 1 122 279 127 291 134 298 148 303 221 302 233 296 233 294 238 290 242 281 243 1 363 1 365 281 370 292 372 292 377 298 386 302 485 304 485 424 364 424 253 312 248 316 243 328 242 424 121 424 117 421 11 315 4 304 1 295 0 2Z M487 0 605 0 607 2 607 177 601 189 545 243 488 243 486 241 486 183 533 182 541 178 546 169 546 122 487 122 485 119Z'

const OFFLINE = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Wiener Tools</title>
<style>
:root{--bg:#f4f5f7;--surface:#fff;--ink:#15171c;--ink-2:#565b66;--line:#e3e5ea}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111316;--surface:#181b20;--ink:#eceef2;--ink-2:#a7adb8;--line:#262a31}}
:root[data-theme=dark]{--bg:#111316;--surface:#181b20;--ink:#eceef2;--ink-2:#a7adb8;--line:#262a31}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}
main{max-width:25rem;padding:24px;text-align:center}
svg{height:22px;fill:currentColor}
h1{margin:20px 0 8px;font-size:20px;font-weight:600;letter-spacing:-0.01em}
p{margin:0 0 18px;color:var(--ink-2)}
code{display:inline-block;padding:9px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
</style>
</head>
<body>
<main>
<svg viewBox="0 0 607 424" aria-hidden="true"><path fill-rule="evenodd" d="${MARK}"/></svg>
<h1 data-en="Wiener Tools is not running">Wiener Tools çalışmıyor</h1>
<p data-en="Run this in a terminal to start it. This window reloads by itself once the dashboard is up.">Başlatmak için terminalde şunu çalıştır. Panel açılınca bu pencere kendiliğinden yenilenir.</p>
<code>npx wiener-tools-claude</code>
</main>
<script>
let saved = null
try {
  const theme = localStorage.getItem('wiener-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
  saved = localStorage.getItem('wiener-lang')
} catch {}
const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
const lang = saved === 'tr' || saved === 'en' ? saved : langs.some((l) => l?.toLowerCase().startsWith('tr')) ? 'tr' : 'en'
if (lang === 'en') {
  document.documentElement.lang = 'en'
  for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset.en
}
setInterval(() => fetch('/api/status', { cache: 'no-store' }).then((r) => r.ok && location.reload(), () => {}), 1000)
</script>
</body>
</html>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })))
})
