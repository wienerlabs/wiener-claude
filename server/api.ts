import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { type Lang, isLang, pick } from '../shared/i18n.ts'
import type { HeatmapView, Metric, ReplayPage, SessionSource } from '../shared/types.ts'
import { accountInfo, listAccounts } from './accounts.ts'
import type { Db } from './db.ts'
import type { Indexer } from './indexer.ts'
import { costReport, readAccount } from './costs.ts'
import { envReport, fileContent } from './env.ts'
import { liveSessions } from './live.ts'
import type { Pricing } from './pricing.ts'
import { projectDetail, projectList } from './projects.ts'
import { parseRange, rangeBounds } from './range.ts'
import * as q from './queries.ts'
import { turnsOf } from './replay.ts'
import { tipsReport } from './tips.ts'
import { toolsReport } from './tools.ts'
import { yearReport } from './year.ts'
import { SettingsError, readSettings, updateSettings } from './settings.ts'

export interface AppContext {
  db: Db
  indexer: Indexer
  pricing: Pricing
  /** Emits 'update' when the index changed and 'live' when running sessions changed. */
  events: EventEmitter
  staticDir: string | null
  /** Host names accepted in the Host header; null accepts any (LAN mode). */
  allowedHosts: Set<string> | null
  accountDb?: (account: string) => Db | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const REPLAY_PAGE = 25

/** The interface sends ?lang=; without one the answer is in Turkish. */
const langOf = (c: Context): Lang => {
  const lang = c.req.query('lang')
  return isLang(lang) ? lang : 'tr'
}

/**
 * Fallback names written in Turkish where the index is built or queried: an untitled session, an
 * unknown project, sessions outside any folder. English answers swap these whole JSON strings on
 * the way out, so the index and its queries stay the same in both languages.
 */
const STORED_LABELS: [string, string][] = [
  ['"Adsız oturum"', '"Untitled session"'],
  ['"Bilinmeyen"', '"Unknown"'],
  ['"Klasörsüz oturumlar"', '"Sessions without a folder"'],
]

function hostname(header: string | undefined): string {
  if (!header) return ''
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1)
  return header.split(':')[0] ?? ''
}

export function createApp(ctx: AppContext): Hono {
  const { db } = ctx
  const app = new Hono()
  const scopeOf = (c: Context): { db: Db; account: string | null } => {
    const account = c.req.query('account') ?? null
    const scoped = account ? (ctx.accountDb?.(account) ?? null) : null
    return scoped ? { db: scoped, account } : { db, account: null }
  }

  // Blocks DNS rebinding: a page on another origin resolving its name to 127.0.0.1.
  app.use('*', async (c, next) => {
    if (ctx.allowedHosts && !ctx.allowedHosts.has(hostname(c.req.header('host')))) return c.text('Forbidden', 403)
    await next()
  })

  // Blocks cross-site writes: a JSON body forces a CORS preflight this server never approves, and
  // a request that does carry an Origin must come from the panel itself.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    if (!(c.req.header('content-type') ?? '').startsWith('application/json')) return c.json({ error: pick(langOf(c), 'JSON bekleniyor', 'Expected JSON') }, 415)
    const origin = c.req.header('origin')
    if (origin) {
      let host = ''
      try {
        host = new URL(origin).hostname
      } catch {
        return c.json({ error: pick(langOf(c), 'Geçersiz Origin', 'Invalid Origin') }, 403)
      }
      const ok = ctx.allowedHosts ? ctx.allowedHosts.has(host) || ctx.allowedHosts.has(`[${host}]`) : host === hostname(c.req.header('host'))
      if (!ok) return c.json({ error: pick(langOf(c), 'Bu istek panelden gelmeli', 'This request must come from the panel') }, 403)
    }
    return next()
  })

  app.use('/api/*', async (c, next) => {
    await next()
    if (langOf(c) !== 'en' || !c.res.headers.get('content-type')?.startsWith('application/json')) return
    // Reading the body uses it up, so the response is rebuilt either way.
    const body = await c.res.text()
    const swapped = STORED_LABELS.reduce((text, [tr, en]) => (text.includes(tr) ? text.split(tr).join(en) : text), body)
    const headers = new Headers(c.res.headers)
    headers.delete('content-length')
    c.res = new Response(swapped, { status: c.res.status, headers })
  })

  app.get('/api/status', (c) => c.json(ctx.indexer.status))

  app.get('/api/accounts', (c) => c.json(listAccounts(db, langOf(c))))

  app.get('/api/summary', async (c) => {
    const { db, account } = scopeOf(c)
    return c.json(q.summary(db, await liveSessions(db, account !== null)))
  })

  const badDate = (c: Context) => c.json({ error: pick(langOf(c), 'Tarih YYYY-AA-GG biçiminde olmalı', 'Dates must be in YYYY-MM-DD format') }, 400)

  app.get('/api/heatmap', (c) => {
    const { db } = scopeOf(c)
    const view = (c.req.query('view') ?? 'calendar') as HeatmapView
    const metric = (c.req.query('metric') ?? 'messages') as Metric
    if (!q.VIEWS.includes(view) || !q.METRICS.includes(metric)) return c.json({ error: pick(langOf(c), 'Geçersiz görünüm ya da metrik', 'Invalid view or metric') }, 400)
    // ?range=week|30d|all wins; otherwise explicit from/to, otherwise the view's default window.
    const named = c.req.query('range') ? rangeBounds(db, parseRange(c.req.query('range'), '30d')) : null
    const range = named ?? q.defaultRange(view)
    const from = named ? named.from : c.req.query('from') ?? range.from
    const to = named ? named.to : c.req.query('to') ?? range.to
    if (!DAY.test(from) || !DAY.test(to)) return badDate(c)
    return c.json(q.heatmap(db, view, metric, from, to, c.req.query('project') || null, langOf(c)))
  })

  app.get('/api/day/:day', (c) => {
    const day = c.req.param('day')
    if (!DAY.test(day)) return badDate(c)
    return c.json(q.day(scopeOf(c).db, day))
  })

  app.get('/api/insights', (c) => c.json(q.insights(scopeOf(c).db, readSettings().monthlyBudget, langOf(c))))

  app.get('/api/settings', (c) => c.json(readSettings()))

  app.put('/api/settings', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: pick(langOf(c), 'Geçersiz JSON', 'Invalid JSON') }, 400)
    }
    try {
      const saved = updateSettings(body, langOf(c))
      ctx.events.emit('update')
      return c.json(saved)
    } catch (err) {
      if (err instanceof SettingsError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  // Reads a few hundred small files; while sessions run, the panel asks again every few seconds.
  const envCache = new Map<string, { at: number; report: ReturnType<typeof envReport> }>()
  app.get('/api/env', (c) => {
    const { db, account } = scopeOf(c)
    const lang = langOf(c)
    const key = `${lang}|${account ?? ''}`
    let hit = envCache.get(key)
    if (!hit || Date.now() - hit.at > 5000) {
      hit = { at: Date.now(), report: envReport(db, lang) }
      envCache.set(key, hit)
    }
    return c.json(hit.report)
  })

  app.get('/api/env/file/:id', (c) => {
    const content = fileContent(scopeOf(c).db, c.req.param('id'))
    return content ? c.json(content) : c.json({ error: pick(langOf(c), 'Dosya bulunamadı', 'File not found') }, 404)
  })

  app.get('/api/projects', (c) => c.json(projectList(scopeOf(c).db, parseRange(c.req.query('range'), 'all'))))

  app.get('/api/projects/:key', (c) => {
    const detail = projectDetail(scopeOf(c).db, c.req.param('key'), parseRange(c.req.query('range'), 'all'))
    return detail ? c.json(detail) : c.json({ error: pick(langOf(c), 'Proje bulunamadı', 'Project not found') }, 404)
  })

  app.get('/api/tips', (c) => c.json(tipsReport(scopeOf(c).db, ctx.pricing, parseRange(c.req.query('range'), '30d'), undefined, langOf(c))))

  app.get('/api/tools', (c) => c.json(toolsReport(scopeOf(c).db, parseRange(c.req.query('range'), '30d'))))

  app.get('/api/year', (c) => {
    const year = Number(c.req.query('year'))
    return c.json(yearReport(scopeOf(c).db, Number.isInteger(year) && year > 2000 && year < 3000 ? year : new Date().getFullYear()))
  })

  app.get('/api/costs', (c) => {
    const { db: scoped, account } = scopeOf(c)
    const info = account ? accountInfo(db, account) : readAccount()
    return c.json(costReport(scoped, ctx.pricing, info, Date.now(), readSettings().monthlyBudget, parseRange(c.req.query('range'), '30d')))
  })

  app.get('/api/sessions', (c) => {
    const { db } = scopeOf(c)
    const source = c.req.query('source')
    return c.json(
      q.sessions(db, {
        q: c.req.query('q') ?? null,
        project: c.req.query('project') ?? null,
        source: source === 'cli' || source === 'desktop' ? (source as SessionSource) : null,
        range: parseRange(c.req.query('range'), 'all'),
        limit: Number(c.req.query('limit') ?? 50) || 50,
        offset: Number(c.req.query('offset') ?? 0) || 0,
      }),
    )
  })

  app.get('/api/sessions/:id', async (c) => {
    const { db } = scopeOf(c)
    const id = c.req.param('id')
    const session = q.session(db, id)
    if (!session) return c.json({ error: pick(langOf(c), 'Oturum bulunamadı', 'Session not found') }, 404)
    const file = db.prepare('SELECT path FROM files WHERE session_id = ? AND is_subagent = 0').get(id) as { path: string } | undefined
    const from = Math.max(0, Number(c.req.query('from') ?? 0) || 0)
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? REPLAY_PAGE) || REPLAY_PAGE))
    if (!file || !fs.existsSync(file.path)) {
      return c.json({ session, turns: [], from: 0, totalTurns: 0, focusTurn: null, fileMissing: true } satisfies ReplayPage)
    }
    const { turns, keyIndex } = await turnsOf(file.path, ctx.pricing, langOf(c))
    // ?around=<key> opens the page holding a search hit, with a little context before it.
    const around = c.req.query('around')
    const focusTurn = around ? (keyIndex.get(around) ?? keyIndex.get(around.split(':')[0] ?? '') ?? null) : null
    const start = focusTurn !== null ? Math.max(0, focusTurn - 2) : from
    return c.json({
      session, turns: turns.slice(start, start + limit), from: start, totalTurns: turns.length, focusTurn, fileMissing: false,
    } satisfies ReplayPage)
  })

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: string) => () => void stream.writeSSE({ event, data: String(Date.now()) })
      const onUpdate = send('update')
      const onLive = send('live')
      ctx.events.on('update', onUpdate)
      ctx.events.on('live', onLive)
      let open = true
      stream.onAbort(() => {
        open = false
        ctx.events.off('update', onUpdate)
        ctx.events.off('live', onLive)
      })
      while (open) {
        await stream.writeSSE({ event: 'ping', data: '' })
        await stream.sleep(25_000)
      }
    }),
  )

  app.all('/api/*', (c) => c.json({ error: pick(langOf(c), 'Bulunamadı', 'Not found') }, 404))

  if (ctx.staticDir) {
    app.use('/*', serveStatic({ root: ctx.staticDir }))
    // Client-side routes all load the same page.
    const index = fs.readFileSync(path.join(ctx.staticDir, 'index.html'), 'utf8')
    // A missing file (a stale /assets/ hash) is a 404, not the app shell.
    app.get('*', (c) => (/\.[a-z0-9]+$/i.test(c.req.path) ? c.text('Not found', 404) : c.html(index)))
  }
  return app
}
