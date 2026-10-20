import fs from 'node:fs/promises'
import path from 'node:path'
import type { StatementSync } from 'node:sqlite'
import type { IndexStatus } from '../shared/types.ts'
import { type Db, clearIndex, getMeta, setMeta, transaction } from './db.ts'
import { readLinesFrom } from './jsonl.ts'
import { type ApiFact, type Fact, type SessionFact, parseLine, parseTs } from './parse.ts'
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
  private desktopSignature = ''
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
    const work: { file: FoundFile; row: FileRow; size: number; mtimeMs: number; ino: number }[] = []
    let truncated = false
    for (const file of found) {
      let st
      try {
        st = await fs.stat(file.path)
      } catch {
        continue
      }
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
      this.desktopSignature = ''
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
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`wiener-tools: ${w.file.path} okunamadı:`, err)
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
    const sessions = new Map<string, { first: SessionFact; last: SessionFact; cwdFact: SessionFact | null; entry: string | null }>()
    const apis = new Map<string, ApiFact>()
    for (const f of facts) {
      if (f.kind === 'session') {
        const s = sessions.get(f.sessionId)
        if (!s) sessions.set(f.sessionId, { first: f, last: f, cwdFact: f.cwd ? f : null, entry: f.entrypoint })
        else {
          if (f.ts < s.first.ts) s.first = f
          if (f.ts >= s.last.ts) s.last = f
          if (f.cwd && (!s.cwdFact || f.ts < s.cwdFact.ts)) s.cwdFact = f
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
        const lastWithBranch = s.last.gitBranch ? s.last : null
        this.st.upsertSession.run({
          $id: id, $slug: slug, $cwd: cwd, $pkey: project.key, $pname: project.name,
          $branch: lastWithBranch?.gitBranch ?? null, $version: s.last.version, $entry: s.entry,
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
            this.st.toolUse.run(f.id, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.name, f.mcpServer, f.sidechain ? 1 : 0)
            break
          }
          case 'tool_result': {
            const t = localParts(f.ts)
            this.st.toolResult.run(f.id, f.sessionId, fileId, f.ts, t.day, t.hour, t.dow, f.isError ? 1 : 0, f.denied)
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

  /** Mirrors the desktop app's session files. They are small, so a change rereads them all. */
  private async scanDesktop(): Promise<boolean> {
    const dir = this.opts.desktopDir
    if (!dir) return false
    const files = await findFiles(dir, 3, (name) => name.startsWith('local_') && name.endsWith('.json'))
    const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => `${f}:${s.mtimeMs}`, () => '')))
    const signature = stats.sort().join('|')
    if (signature === this.desktopSignature) return false
    this.desktopSignature = signature

    const rows: unknown[][] = []
    for (const f of files) {
      try {
        const o = JSON.parse(await fs.readFile(f, 'utf8')) as Record<string, unknown>
        const cli = typeof o.cliSessionId === 'string' ? o.cliSessionId : null
        if (!cli) continue
        rows.push([
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
        ])
      } catch {
        // A half-written file; the next change event rereads it.
      }
    }
    const insert = this.db.prepare(`INSERT OR REPLACE INTO desktop_sessions
      (cli_session_id, desktop_id, title, branch, worktree_name, archived, created_at, last_activity_at, model, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    transaction(this.db, () => {
      this.db.exec('DELETE FROM desktop_sessions')
      for (const r of rows) insert.run(...(r as (string | number | null)[]))
    })
    return true
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
    toolUse: p(`INSERT INTO tool_uses (id, session_id, file_id, ts, day, hour, dow, name, mcp_server, is_sidechain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, file_id = excluded.file_id, ts = excluded.ts,
        day = excluded.day, hour = excluded.hour, dow = excluded.dow, name = excluded.name,
        mcp_server = excluded.mcp_server, is_sidechain = excluded.is_sidechain
      WHERE tool_uses.name IS NULL`),
    toolResult: p(`INSERT INTO tool_uses (id, session_id, file_id, ts, day, hour, dow, is_error, denied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET is_error = excluded.is_error, denied = excluded.denied`),
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
 * projects/<slug>/<session>/, at any depth, and belong to that session.
 */
export async function discover(root: string): Promise<FoundFile[]> {
  const files = await findFiles(root, 6, (name) => name.endsWith('.jsonl'))
  const out: FoundFile[] = []
  for (const f of files) {
    const parts = path.relative(root, f).split(path.sep)
    if (parts.length < 2) continue
    const slug = parts[0] as string
    if (parts.length === 2) out.push({ path: f, slug, sessionId: path.basename(f, '.jsonl'), isSubagent: false })
    else out.push({ path: f, slug, sessionId: parts[1] as string, isSubagent: true })
  }
  // Main files first, so sessions exist before their subagents report in.
  return out.sort((a, b) => Number(a.isSubagent) - Number(b.isSubagent))
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
