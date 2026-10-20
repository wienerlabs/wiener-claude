import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { HeatmapView, Metric, ReplayPage, SessionSource } from '../shared/types.ts'
import type { Db } from './db.ts'
import type { Indexer } from './indexer.ts'
import { liveSessions } from './live.ts'
import type { Pricing } from './pricing.ts'
import * as q from './queries.ts'
import { turnsOf } from './replay.ts'

export interface AppContext {
  db: Db
  indexer: Indexer
  pricing: Pricing
  /** Emits 'update' when the index changed and 'live' when running sessions changed. */
  events: EventEmitter
  staticDir: string | null
  /** Host names accepted in the Host header; null accepts any (LAN mode). */
  allowedHosts: Set<string> | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const REPLAY_PAGE = 25

function hostname(header: string | undefined): string {
  if (!header) return ''
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1)
  return header.split(':')[0] ?? ''
}

export function createApp(ctx: AppContext): Hono {
  const { db } = ctx
  const app = new Hono()

  // Blocks DNS rebinding: a page on another origin resolving its name to 127.0.0.1.
  app.use('*', async (c, next) => {
    if (ctx.allowedHosts && !ctx.allowedHosts.has(hostname(c.req.header('host')))) return c.text('Forbidden', 403)
    await next()
  })

  app.get('/api/status', (c) => c.json(ctx.indexer.status))

  app.get('/api/summary', async (c) => c.json(q.summary(db, await liveSessions(db))))

  app.get('/api/heatmap', (c) => {
    const view = (c.req.query('view') ?? 'calendar') as HeatmapView
    const metric = (c.req.query('metric') ?? 'messages') as Metric
    if (!q.VIEWS.includes(view) || !q.METRICS.includes(metric)) return c.json({ error: 'Geçersiz görünüm ya da metrik' }, 400)
    const range = q.defaultRange(view)
    const from = c.req.query('from') ?? range.from
    const to = c.req.query('to') ?? range.to
    if (!DAY.test(from) || !DAY.test(to)) return c.json({ error: 'Tarih YYYY-AA-GG biçiminde olmalı' }, 400)
    return c.json(q.heatmap(db, view, metric, from, to))
  })

  app.get('/api/day/:day', (c) => {
    const day = c.req.param('day')
    if (!DAY.test(day)) return c.json({ error: 'Tarih YYYY-AA-GG biçiminde olmalı' }, 400)
    return c.json(q.day(db, day))
  })

  app.get('/api/insights', (c) => c.json(q.insights(db)))

  app.get('/api/projects', (c) => c.json(q.projects(db)))

  app.get('/api/sessions', (c) => {
    const source = c.req.query('source')
    return c.json(
      q.sessions(db, {
        q: c.req.query('q') ?? null,
        project: c.req.query('project') ?? null,
        source: source === 'cli' || source === 'desktop' ? (source as SessionSource) : null,
        limit: Number(c.req.query('limit') ?? 50) || 50,
        offset: Number(c.req.query('offset') ?? 0) || 0,
      }),
    )
  })

  app.get('/api/sessions/:id', async (c) => {
    const id = c.req.param('id')
    const session = q.session(db, id)
    if (!session) return c.json({ error: 'Oturum bulunamadı' }, 404)
    const file = db.prepare('SELECT path FROM files WHERE session_id = ? AND is_subagent = 0').get(id) as { path: string } | undefined
    const from = Math.max(0, Number(c.req.query('from') ?? 0) || 0)
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? REPLAY_PAGE) || REPLAY_PAGE))
    if (!file || !fs.existsSync(file.path)) {
      return c.json({ session, turns: [], from: 0, totalTurns: 0, fileMissing: true } satisfies ReplayPage)
    }
    const turns = await turnsOf(file.path, ctx.pricing)
    return c.json({ session, turns: turns.slice(from, from + limit), from, totalTurns: turns.length, fileMissing: false } satisfies ReplayPage)
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

  app.all('/api/*', (c) => c.json({ error: 'Bulunamadı' }, 404))

  if (ctx.staticDir) {
    app.use('/*', serveStatic({ root: ctx.staticDir }))
    // Client-side routes all load the same page.
    const index = fs.readFileSync(path.join(ctx.staticDir, 'index.html'), 'utf8')
    // A missing file (a stale /assets/ hash) is a 404, not the app shell.
    app.get('*', (c) => (/\.[a-z0-9]+$/i.test(c.req.path) ? c.text('Bulunamadı', 404) : c.html(index)))
  }
  return app
}
