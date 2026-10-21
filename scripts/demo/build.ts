// Records the public demo: generates a made-up home folder, indexes it with the real server code
// and saves every API response the interface can ask for as a static file next to the built site.
//
//   node dist/demo-build.mjs <site folder>     (npm run build:demo does this after vite build)
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { demoFile } from '../../shared/demo.ts'
import { LANGS } from '../../shared/i18n.ts'

const OUT = path.resolve(process.argv[2] ?? 'dist/demo-site')

/**
 * DEMO_NOW pins the demo's clock (for screenshots and the video): every "now" in the generator
 * and the server code reads the shifted time. Unset, the demo is built for the current moment.
 */
function shiftClock(to: number): void {
  const RealDate = Date
  const offset = to - RealDate.now()
  class Shifted extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...(args as [string | number | Date]))
    }
    static override now(): number {
      return RealDate.now() + offset
    }
  }
  globalThis.Date = Shifted as DateConstructor
}
/** What the demo's home folder is called in everything the visitor sees. */
const PUBLIC_HOME = '/Users/demo'
const RANGES = ['week', '30d', 'all'] as const
const METRICS = ['messages', 'tokens', 'cost', 'sessions', 'errors'] as const

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(OUT, 'index.html'))) throw new Error(`${OUT} içinde index.html yok; önce demo arayüzünü derle`)

  // The demo's clock runs on Turkish time, and every path below points at the made-up home.
  process.env.TZ = 'Europe/Istanbul'
  if (process.env.DEMO_NOW) {
    const at = Date.parse(process.env.DEMO_NOW)
    if (Number.isNaN(at)) throw new Error(`DEMO_NOW okunamadı: ${process.env.DEMO_NOW}`)
    shiftClock(at)
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-demo-'))
  const home = path.join(tmp, 'demo')
  process.env.HOME = home
  delete process.env.CLAUDE_CONFIG_DIR
  process.env.WIENER_DATA_DIR = path.join(tmp, 'data')
  process.env.WIENER_DESKTOP_DIR = path.join(tmp, 'no-desktop')

  const { generateDemoHome } = await import('./generate.ts')
  const { openDb } = await import('../../server/db.ts')
  const { Indexer } = await import('../../server/indexer.ts')
  const { Pricing } = await import('../../server/pricing.ts')
  const { createApp } = await import('../../server/api.ts')
  const { projectsDir } = await import('../../server/paths.ts')

  const outDir = path.join(OUT, 'demo-api')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  // Claude Code names project folders after the path with "/" and "." turned into "-"; those
  // names show up too (memory files), so they are swapped along with the plain paths.
  const slug = (p: string) => p.replace(/[/.]/g, '-')
  let files = 0
  let bytes = 0
  const now = new Date()

  // The same home in each language: the English stories mirror the Turkish ones, so both sets of
  // answers describe the same sessions. The browser asks with ?lang=, which names the files apart.
  for (const lang of LANGS) {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(process.env.WIENER_DATA_DIR, { recursive: true, force: true })
    generateDemoHome({ home, now, lang })
    fs.mkdirSync(process.env.WIENER_DATA_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.WIENER_DATA_DIR, 'settings.json'), JSON.stringify({ monthlyBudget: 80 }))

    const db = openDb(':memory:')
    const pricing = new Pricing()
    const indexer = new Indexer(db, pricing, { projectsDir: projectsDir(), desktopDir: null })
    await indexer.scan()
    const app = createApp({ db, indexer, pricing, events: new EventEmitter(), staticDir: null, allowedHosts: null })

    const swaps = [home, fs.realpathSync(home)].flatMap((h) => [[h, PUBLIC_HOME], [slug(h), slug(PUBLIC_HOME)]])
    const toReal = (url: string) => url.split(encodeURIComponent(PUBLIC_HOME)).join(encodeURIComponent(home)).split(PUBLIC_HOME).join(home)
    const toPublic = (text: string) => swaps.reduce((t, [from, to]) => t.split(from as string).join(to as string), text)
    const withLang = (url: string) => `${url}${url.includes('?') ? '&' : '?'}lang=${lang}`

    /** Saves the response under the URL the browser will ask for; `fetch` is what the server gets. */
    async function snap<T>(url: string, fetchUrl = url): Promise<T> {
      const res = await app.request(toReal(withLang(fetchUrl)), { headers: { host: '127.0.0.1' } })
      if (res.status !== 200) throw new Error(`${fetchUrl} (${lang}) → ${res.status}: ${await res.text()}`)
      const text = toPublic(await res.text())
      fs.writeFileSync(path.join(outDir, demoFile(withLang(url))), text)
      files++
      bytes += text.length
      return JSON.parse(text) as T
    }

    for (const url of ['/api/status', '/api/summary', '/api/insights', '/api/settings']) await snap(url)
    const env = await snap<{ memory: { id: string }[]; instructions: { id: string }[] }>('/api/env')
    for (const f of [...env.memory, ...env.instructions]) await snap(`/api/env/file/${f.id}`)

    for (const r of RANGES) {
      for (const name of ['tips', 'tools', 'costs', 'projects']) await snap(`/api/${name}?range=${r}`)
      for (const view of ['weekhour', 'project']) for (const m of METRICS) await snap(`/api/heatmap?view=${view}&metric=${m}&range=${r}`)
    }
    const year = await snap<{ years: number[] }>(`/api/year?year=${new Date().getFullYear()}`)
    for (const y of year.years) await snap(`/api/year?year=${y}`)

    const calendar = await snap<{ cells: { key: string; value: number }[] }>('/api/heatmap?view=calendar&metric=messages')
    for (const m of METRICS.slice(1)) await snap(`/api/heatmap?view=calendar&metric=${m}`)
    for (const c of calendar.cells) if (c.value > 0) await snap(`/api/day/${c.key}`)

    const projects = await snap<{ key: string }[]>('/api/projects')
    for (const p of projects) {
      const key = encodeURIComponent(p.key)
      for (const r of RANGES) await snap(`/api/projects/${key}?range=${r}`)
      for (const m of METRICS) await snap(`/api/heatmap?view=calendar&metric=${m}&project=${key}`)
    }

    // Session lists: every filter the list offers, unpaged; the browser pages and searches them.
    const sessions = new Set<string>()
    for (const source of ['', 'cli', 'desktop']) {
      for (const project of ['', ...projects.map((p) => p.key)]) {
        for (const range of RANGES) {
          const params = new URLSearchParams()
          if (source) params.set('source', source)
          if (project) params.set('project', project)
          if (range !== 'all') params.set('range', range)
          const list = await snap<{ rows: { id: string }[]; total: number }>(`/api/sessions?${params}`, `/api/sessions?${params}&limit=200`)
          if (list.total > list.rows.length) throw new Error(`Demo ${list.total} oturum üretti; liste en fazla 200 satır taşır`)
          for (const s of list.rows) sessions.add(s.id)
        }
      }
    }
    // A whole transcript per session; the browser hands out the page it asks for.
    for (const id of sessions) await snap(`/api/sessions/${id}`, `/api/sessions/${id}?from=0&limit=200`)
    db.close()
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  // Nothing of the build machine may reach the site.
  for (const f of fs.readdirSync(outDir)) {
    const text = fs.readFileSync(path.join(outDir, f), 'utf8')
    for (const leak of [tmp, slug(tmp), os.userInfo().username === 'demo' ? null : `/Users/${os.userInfo().username}`].filter(Boolean) as string[]) {
      if (text.includes(leak)) throw new Error(`${f} içinde derleme makinesine ait bir yol kaldı: ${leak}`)
    }
  }
  process.stdout.write(`Demo: ${files} yanıt, ${(bytes / 1e6).toFixed(1)} MB → ${path.relative(process.cwd(), outDir)}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
