import fs from 'node:fs/promises'
import path from 'node:path'
import type { StatementSync } from 'node:sqlite'
import { pick } from '../shared/i18n.ts'
import type { IndexStatus } from '../shared/types.ts'
import { type Db, clearIndex, foldTurkish, getMeta, setMeta, transaction } from './db.ts'
import { readLinesFrom } from './jsonl.ts'
import { type ApiFact, type Fact, type SessionFact, parseLine, parseTs } from './parse.ts'
import { terminalLang } from './paths.ts'
import type { Pricing } from './pricing.ts'
import { projectOf } from './project.ts'
import { localParts } from './time.ts'

export interface IndexerOptions {
  projectsDir: string
  desktopDir: string | null
}

interface FileRow {
  id: number
  path: string
  size: number
  mtime_ms: number
  ino: number
  offset: number
}

interface FoundFile {
  path: string
  slug: string
  sessionId: string
  isSubagent: boolean
}

const FLUSH_EVERY = 20_000

/**
 * Keeps the SQLite index in step with ~/.claude/projects. Each scan reads only the bytes appended
 * since the last one. Every insert is keyed, so reading a line twice never counts it twice.
 */
export class Indexer {
  status: IndexStatus = { state: 'indexing', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, lastScanAt: null, lastScanMs: null }
  private running: Promise<boolean> | null = null
  private again = false
  private desktopFiles = new Map<string, { mtime: number; key: string; shown: string }>()
  private readonly db: Db
  private readonly pricing: Pricing
  private readonly opts: IndexerOptions
  private readonly st: Statements

  constructor(db: Db, pricing: Pricing, opts: IndexerOptions) {
    this.db = db
    this.pricing = pricing
    this.opts = opts
    this.st = statements(db)
  }

  /** Runs a scan, or queues one more if a scan is already running. Resolves true if anything changed. */
  scan(): Promise<boolean> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      let changed = false
      try {
        do {
          this.again = false
          changed = (await this.scanOnce()) || changed
        } while (this.again)
      } finally {
        this.running = null
      }
      return changed
    })()
    return this.running
  }

  private async scanOnce(): Promise<boolean> {
    const started = Date.now()
    let changed = this.refreshCosts()

    const found = await discover(this.opts.projectsDir)
    const stats = await Promise.all(found.map((f) => fs.stat(f.path).catch(() => null)))
    const work: { file: FoundFile; row: FileRow; size: number; mtimeMs: number; ino: number }[] = []
    let truncated = false
    for (const [i, file] of found.entries()) {
      const st = stats[i]
      if (!st) continue
      let row = this.st.fileByPath.get(file.path) as FileRow | undefined
      if (!row) {
        const { id } = this.st.insertFile.get(file.path, file.sessionId, file.isSubagent ? 1 : 0) as { id: number }
        row = { id, path: file.path, size: 0, mtime_ms: 0, ino: 0, offset: 0 }
      }
      if (st.size === row.size && st.mtimeMs === row.mtime_ms) continue
      if (st.size < row.offset || (row.ino !== 0 && st.ino !== row.ino)) truncated = true
      work.push({ file, row, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino })
    }

    if (truncated) {
      // A file was rewritten in place. Rare enough that rebuilding beats untangling it.
      clearIndex(this.db)
      this.desktopFiles = new Map()
      return this.scanOnce().then(() => true)
    }

    const isFirst = this.status.lastScanAt === null
    this.status = {
      ...this.status,
      state: isFirst || work.length > 50 ? 'indexing' : this.status.state,
      filesDone: 0,
      filesTotal: work.length,
      bytesDone: 0,
      bytesTotal: work.reduce((s, w) => s + Math.max(0, w.size - w.row.offset), 0),
    }

    for (const w of work) {
      try {
        const offset = await this.indexFile(w.file, w.row)
        this.st.updateFile.run(w.size, w.mtimeMs, w.ino, offset, w.row.id)
        changed = true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`wiener-tools-claude: ${w.file.path} ${pick(terminalLang(), 'okunamadı', 'could not be read')}:`, err)
      }
      this.status.filesDone++
    }

    changed = (await this.scanDesktop()) || changed
    this.status = { ...this.status, state: 'ready', lastScanAt: Date.now(), lastScanMs: Date.now() - started }
    return changed
  }

  private async indexFile(file: FoundFile, row: FileRow): Promise<number> {
    const ctx = { fileSessionId: file.sessionId, isSubagent: file.isSubagent }
    let batch: Fact[] = []
    const end = await readLinesFrom(
      file.path,
      row.offset,
      (line) => {
        let o: unknown
        try {
          o = JSON.parse(line)
        } catch {
          return
        }
        if (!o || typeof o !== 'object' || Array.isArray(o)) return
        for (const f of parseLine(o as Record<string, unknown>, ctx)) batch.push(f)
        if (batch.length >= FLUSH_EVERY) {
          this.apply(batch, row.id, file.slug)
          batch = []
        }
      },
      (bytes) => {
        this.status.bytesDone += bytes
      },
    )
    if (batch.length > 0) this.apply(batch, row.id, file.slug)
    return end
  }

  /** Writes a batch of facts in one transaction. */
  apply(facts: Fact[], fileId: number, slug: string): void {
    const sessions = new Map<
      string,
      { first: SessionFact; last: SessionFact; cwdFact: SessionFact | null; branchFact: SessionFact | null; versionFact: SessionFact | null; entry: string | null }
    >()
    const apis = new Map<string, ApiFact>()
    for (const f of facts) {
      if (f.kind === 'session') {
        const s = sessions.get(f.sessionId)
        if (!s) {
          sessions.set(f.sessionId, {
            first: f, last: f, cwdFact: f.cwd ? f : null, branchFact: f.gitBranch ? f : null, versionFact: f.version ? f : null, entry: f.entrypoint,
          })
        } else {
          if (f.ts < s.first.ts) s.first = f
          if (f.ts >= s.last.ts) s.last = f
          if (f.cwd && (!s.cwdFact || f.ts < s.cwdFact.ts)) s.cwdFact = f
          // Not every record carries the branch and version; the latest one that does wins.
          if (f.gitBranch && (!s.branchFact || f.ts >= s.branchFact.ts)) s.branchFact = f
          if (f.version && (!s.versionFact || f.ts >= s.versionFact.ts)) s.versionFact = f
          s.entry ??= f.entrypoint
        }
      } else if (f.kind === 'api') {
        const prev = apis.get(f.msgId)
        apis.set(f.msgId, prev ? mergeApi(prev, f) : f)
      }
    }

    transaction(this.db, () => {
      for (const [id, s] of sessions) {
        const cwd = s.cwdFact?.cwd ?? null
        const project = projectOf(cwd, slug)
        this.st.upsertSession.run({
          $id: id, $slug: slug, $cwd: cwd, $pkey: project.key, $pname: project.name,
          $branch: s.branchFact?.gitBranch ?? null, $version: s.versionFact?.version ?? null, $entry: s.entry,
          $first: s.first.ts, $last: s.last.ts,
        })
      }

      for (const f of apis.values()) {
        const ex = this.st.getApi.get(f.msgId) as
          | { input: number; output: number; cache_read: number; cache_write_5m: number; cache_write_1h: number; web_search: number; fast: number }
          | undefined
        const exTotal = ex ? ex.input + ex.output + ex.cache_read + ex.cache_write_5m + ex.cache_write_1h : 0
        const fTotal = f.input + f.output + f.cacheRead + f.cacheWrite5m + f.cacheWrite1h
        // A copy carried over by compaction or a resume can have zeroed usage. The call belongs to
        // wherever its real usage was logged, whichever file happened to be read first.
        if (ex && exTotal === 0 && fTotal > 0) this.st.deleteApi.run(f.msgId)
        const m = ex && !(exTotal === 0 && fTotal > 0)
          ? mergeApi(f, {
              ...f,
              input: ex.input, output: ex.output, cacheRead: ex.cache_read,
              cacheWrite5m: ex.cache_write_5m, cacheWrite1h: ex.cache_write_1h, webSearch: ex.web_search, fast: ex.fast === 1,
            })
          : f
        const t = localParts(m.ts)
        this.st.insertApi.run(
          m.msgId, m.sessionId, fileId, m.ts, t.day, t.hour, t.dow, m.model, m.input, m.output, m.cacheRead,
          m.cacheWrite5m, m.cacheWrite1h, m.webSearch, m.fast ? 1 : 0, m.sidechain ? 1 : 0, this.pricing.cost(m.model, m),
        )
      }

      for (const f of facts) {
        switch (f.kind) {
          case 'prompt': {
            const t = localParts(f.ts)
            this.st.insertPrompt.run(f.uuid, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.promptKind, f.preview)
            this.st.ensureSession.run(f.sessionId)
            this.st.firstPrompt.run(f.preview, f.ts, f.sessionId, f.ts)
            break
          }
          case 'tool_use': {
            const t = localParts(f.ts)
            this.st.toolUse.run(f.id, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.name, f.mcpServer, f.sidechain ? 1 : 0, f.detail)
            break
          }
          case 'tool_result': {
            const t = localParts(f.ts)
            this.st.toolResult.run(f.id, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.isError ? 1 : 0, f.denied, f.error)
            break
          }
          case 'event': {
            const t = localParts(f.ts)
            this.st.insertEvent.run(f.uuid, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.eventKind)
            break
          }
          case 'cost':
            this.st.costState.run(f.sessionId, f.startTime, f.totalCost, f.linesAdded, f.linesRemoved, f.apiMs, f.toolMs, f.durationMs)
            break
          case 'title':
            this.st.ensureSession.run(f.sessionId)
            ;(f.source === 'custom' ? this.st.customTitle : this.st.aiTitle).run(f.title, f.sessionId)
            break
          case 'pr':
            this.st.insertPr.run(f.url, f.sessionId, f.number, f.repo, f.ts)
            break
          case 'text':
            this.st.insertText.run(f.key, f.sessionId, f.ts, f.textKind, f.text, foldTurkish(f.text))
            break
          case 'file_edit':
            this.st.insertEdit.run(f.key, f.sessionId, f.ts, localParts(f.ts).day, f.path, f.tool, f.added, f.removed)
            break
          case 'limit_hit':
            this.st.insertLimitHit.run(f.uuid, f.sessionId, f.ts, f.limitKind, f.resetsAt)
            break
          case 'task':
            if (f.op === 'create') this.st.taskCreate.run(f.sessionId, f.taskId, f.subject, f.ts, f.ts)
            else if (f.op === 'update') this.st.taskUpdate.run(f.status, f.subject, f.ts, f.sessionId, f.taskId)
            else {
              this.st.todosClear.run(f.sessionId)
              f.todos.forEach((t, i) => this.st.todoInsert.run(f.sessionId, `todo:${i}`, t.subject, t.status, f.ts, f.ts))
            }
            break
          case 'plan':
            this.st.insertPlan.run(f.key, f.sessionId, f.ts, f.text)
            break
        }
      }
    })
  }

  /** Re-prices every API call when the price table changed since the last run. */
  private refreshCosts(): boolean {
    if (getMeta(this.db, 'pricing_version') === this.pricing.version) return false
    const rows = this.db
      .prepare('SELECT msg_id, model, input, output, cache_read, cache_write_5m, cache_write_1h, web_search, fast FROM api_calls')
      .all() as {
      msg_id: string; model: string; input: number; output: number; cache_read: number
      cache_write_5m: number; cache_write_1h: number; web_search: number; fast: number
    }[]
    const update = this.db.prepare('UPDATE api_calls SET cost = ? WHERE msg_id = ?')
    transaction(this.db, () => {
      for (const r of rows) {
        const cost = this.pricing.cost(r.model, {
          input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite5m: r.cache_write_5m,
          cacheWrite1h: r.cache_write_1h, webSearch: r.web_search, fast: r.fast === 1,
        })
        update.run(cost, r.msg_id)
      }
      setMeta(this.db, 'pricing_version', this.pricing.version)
    })
    return rows.length > 0
  }

  /**
   * Mirrors the desktop app's session files. Only files whose mtime moved are reread, and a change
   * is reported only when a field the panel shows changed: these files are rewritten on every
   * message just to bump their activity time.
   */
  private async scanDesktop(): Promise<boolean> {
    const dir = this.opts.desktopDir
    if (!dir) return false
    const files = await findFiles(dir, 3, (name) => name.startsWith('local_') && name.endsWith('.json'))
    const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => s.mtimeMs, () => null)))
    let changed = false
    const upserts: (string | number | null)[][] = []
    const removed: string[] = []
    const seen = new Set<string>()
    for (const [i, f] of files.entries()) {
      const mtime = stats[i]
      if (mtime == null) continue
      seen.add(f)
      const prev = this.desktopFiles.get(f)
      if (prev && prev.mtime === mtime) continue
      let row: (string | number | null)[]
      try {
        const o = JSON.parse(await fs.readFile(f, 'utf8')) as Record<string, unknown>
        const cli = typeof o.cliSessionId === 'string' ? o.cliSessionId : null
        if (!cli) continue
        row = [
          cli,
          typeof o.sessionId === 'string' ? o.sessionId : null,
          typeof o.title === 'string' ? o.title : null,
          typeof o.branch === 'string' ? o.branch : null,
          typeof o.worktreeName === 'string' ? o.worktreeName : null,
          o.isArchived === true ? 1 : 0,
          parseTs(o.createdAt),
          parseTs(o.lastActivityAt),
          typeof o.model === 'string' ? o.model : null,
          typeof o.cwd === 'string' ? o.cwd : null,
        ]
      } catch {
        continue // A half-written file; the next change event rereads it.
      }
      const shown = JSON.stringify(row.filter((_, k) => k !== 7))
      if (!prev || prev.shown !== shown) changed = true
      this.desktopFiles.set(f, { mtime, key: String(row[0]), shown })
      upserts.push(row)
    }
    for (const [f, info] of this.desktopFiles) {
      if (seen.has(f)) continue
      this.desktopFiles.delete(f)
      removed.push(info.key)
      changed = true
    }
    if (upserts.length || removed.length) {
      transaction(this.db, () => {
        for (const r of upserts) this.st.upsertDesktop.run(...r)
        for (const key of removed) this.st.deleteDesktop.run(key)
      })
    }
    return changed
  }
}

function statements(db: Db) {
  const p = (sql: string): StatementSync => db.prepare(sql)
  return {
    fileByPath: p('SELECT id, path, size, mtime_ms, ino, offset FROM files WHERE path = ?'),
    insertFile: p('INSERT INTO files (path, session_id, is_subagent) VALUES (?, ?, ?) RETURNING id'),
    updateFile: p('UPDATE files SET size = ?, mtime_ms = ?, ino = ?, offset = ? WHERE id = ?'),
    upsertSession: p(`
      INSERT INTO sessions (id, slug, cwd, project_key, project_name, git_branch, version, entrypoint, first_ts, last_ts)
      VALUES ($id, $slug, $cwd, $pkey, $pname, $branch, $version, $entry, $first, $last)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(sessions.slug, excluded.slug),
        cwd = CASE WHEN sessions.cwd IS NULL OR (excluded.cwd IS NOT NULL AND excluded.first_ts < sessions.first_ts)
                   THEN COALESCE(excluded.cwd, sessions.cwd) ELSE sessions.cwd END,
        project_key = CASE WHEN sessions.cwd IS NULL OR (excluded.cwd IS NOT NULL AND excluded.first_ts < sessions.first_ts)
                   THEN excluded.project_key ELSE sessions.project_key END,
        project_name = CASE WHEN sessions.cwd IS NULL OR (excluded.cwd IS NOT NULL AND excluded.first_ts < sessions.first_ts)
                   THEN excluded.project_name ELSE sessions.project_name END,
        git_branch = CASE WHEN excluded.git_branch IS NOT NULL AND excluded.last_ts >= COALESCE(sessions.last_ts, 0)
                   THEN excluded.git_branch ELSE sessions.git_branch END,
        version = CASE WHEN excluded.version IS NOT NULL AND excluded.last_ts >= COALESCE(sessions.last_ts, 0)
                   THEN excluded.version ELSE sessions.version END,
        entrypoint = COALESCE(sessions.entrypoint, excluded.entrypoint),
        first_ts = MIN(COALESCE(sessions.first_ts, excluded.first_ts), excluded.first_ts),
        last_ts = MAX(COALESCE(sessions.last_ts, excluded.last_ts), excluded.last_ts)`),
    ensureSession: p('INSERT OR IGNORE INTO sessions (id) VALUES (?)'),
    firstPrompt: p(`UPDATE sessions SET first_prompt = ?, first_prompt_ts = ?
      WHERE id = ? AND (first_prompt_ts IS NULL OR first_prompt_ts > ?)`),
    customTitle: p('UPDATE sessions SET custom_title = ? WHERE id = ?'),
    aiTitle: p('UPDATE sessions SET ai_title = ? WHERE id = ?'),
    getApi: p(`SELECT input, output, cache_read, cache_write_5m, cache_write_1h, web_search, fast
      FROM api_calls WHERE msg_id = ?`),
    deleteApi: p('DELETE FROM api_calls WHERE msg_id = ?'),
    insertApi: p(`INSERT INTO api_calls (msg_id, session_id, file_id, ts, day, hour, dow, model, input, output, cache_read,
        cache_write_5m, cache_write_1h, web_search, fast, is_sidechain, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(msg_id) DO UPDATE SET input = excluded.input, output = excluded.output, cache_read = excluded.cache_read,
        cache_write_5m = excluded.cache_write_5m, cache_write_1h = excluded.cache_write_1h,
        web_search = excluded.web_search, fast = excluded.fast, cost = excluded.cost`),
    insertPrompt: p(`INSERT OR IGNORE INTO prompts (uuid, session_id, file_id, ts, day, hour, dow, kind, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    toolUse: p(`INSERT INTO tool_uses (id, session_id, file_id, ts, day, hour, dow, name, mcp_server, is_sidechain, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, file_id = excluded.file_id, ts = excluded.ts,
        day = excluded.day, hour = excluded.hour, dow = excluded.dow, name = excluded.name,
        mcp_server = excluded.mcp_server, is_sidechain = excluded.is_sidechain, detail = excluded.detail
      WHERE tool_uses.name IS NULL`),
    taskCreate: p(`INSERT INTO tasks (session_id, task_id, subject, status, created_ts, updated_ts) VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(session_id, task_id) DO UPDATE SET subject = excluded.subject`),
    taskUpdate: p(`UPDATE tasks SET status = COALESCE(?, status), subject = COALESCE(?, subject), updated_ts = MAX(updated_ts, ?)
      WHERE session_id = ? AND task_id = ?`),
    todosClear: p("DELETE FROM tasks WHERE session_id = ? AND task_id LIKE 'todo:%'"),
    todoInsert: p(`INSERT OR REPLACE INTO tasks (session_id, task_id, subject, status, created_ts, updated_ts) VALUES (?, ?, ?, ?, ?, ?)`),
    insertPlan: p('INSERT OR IGNORE INTO plans (key, session_id, ts, text) VALUES (?, ?, ?, ?)'),
    toolResult: p(`INSERT INTO tool_uses (id, session_id, file_id, ts, day, hour, dow, is_error, denied, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET is_error = excluded.is_error, denied = excluded.denied, error = excluded.error`),
    insertEvent: p(`INSERT OR IGNORE INTO events (uuid, session_id, file_id, ts, day, hour, dow, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    costState: p(`INSERT INTO cost_states (session_id, start_time, total_cost, lines_added, lines_removed, api_ms, tool_ms, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, start_time) DO UPDATE SET
        lines_added = CASE WHEN excluded.total_cost >= total_cost THEN excluded.lines_added ELSE lines_added END,
        lines_removed = CASE WHEN excluded.total_cost >= total_cost THEN excluded.lines_removed ELSE lines_removed END,
        api_ms = CASE WHEN excluded.total_cost >= total_cost THEN excluded.api_ms ELSE api_ms END,
        tool_ms = CASE WHEN excluded.total_cost >= total_cost THEN excluded.tool_ms ELSE tool_ms END,
        duration_ms = CASE WHEN excluded.total_cost >= total_cost THEN excluded.duration_ms ELSE duration_ms END,
        total_cost = MAX(total_cost, excluded.total_cost)`),
    insertText: p('INSERT OR IGNORE INTO texts (key, session_id, ts, kind, text, norm) VALUES (?, ?, ?, ?, ?, ?)'),
    insertEdit: p(`INSERT OR IGNORE INTO file_edits (key, session_id, ts, day, path, tool, added, removed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    insertLimitHit: p('INSERT OR IGNORE INTO limit_hits (uuid, session_id, ts, kind, resets_at) VALUES (?, ?, ?, ?, ?)'),
    upsertDesktop: p(`INSERT OR REPLACE INTO desktop_sessions
      (cli_session_id, desktop_id, title, branch, worktree_name, archived, created_at, last_activity_at, model, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deleteDesktop: p('DELETE FROM desktop_sessions WHERE cli_session_id = ?'),
    insertPr: p(`INSERT INTO prs (url, session_id, number, repo, ts) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET number = excluded.number, repo = excluded.repo`),
  }
}
type Statements = ReturnType<typeof statements>

function mergeApi(a: ApiFact, b: ApiFact): ApiFact {
  // Streamed responses are logged once per content block; later lines can carry larger counts.
  return {
    ...a,
    ts: Math.min(a.ts, b.ts),
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h),
    webSearch: Math.max(a.webSearch, b.webSearch),
    fast: a.fast || b.fast,
  }
}

/**
 * Session files live at projects/<slug>/<session>.jsonl. Subagent transcripts live below
 * projects/<slug>/<session>/subagents/, at any depth, and belong to that session. Nothing else in
 * a session folder (tool results, attachments) is walked: a scan runs every few seconds.
 */
export async function discover(root: string): Promise<FoundFile[]> {
  const slugs = (await readDir(root)).filter((e) => e.isDirectory())
  const perSlug = await Promise.all(
    slugs.map(async (slug) => {
      const dir = path.join(root, slug.name)
      const out: FoundFile[] = []
      const entries = await readDir(dir)
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          out.push({ path: path.join(dir, e.name), slug: slug.name, sessionId: path.basename(e.name, '.jsonl'), isSubagent: false })
        }
      }
      const subagents = await Promise.all(
        entries.filter((e) => e.isDirectory()).map((e) => findFiles(path.join(dir, e.name, 'subagents'), 3, (n) => n.endsWith('.jsonl')).then((fs) => ({ session: e.name, fs }))),
      )
      for (const { session, fs: files } of subagents) {
        for (const f of files) out.push({ path: f, slug: slug.name, sessionId: session, isSubagent: true })
      }
      return out
    }),
  )
  // Main files first, so sessions exist before their subagents report in.
  return perSlug.flat().sort((a, b) => Number(a.isSubagent) - Number(b.isSubagent))
}

async function readDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function findFiles(dir: string, depth: number, match: (name: string) => boolean): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory() && depth > 0) out.push(...(await findFiles(full, depth - 1, match)))
    else if (e.isFile() && match(e.name)) out.push(full)
  }
  return out
}
