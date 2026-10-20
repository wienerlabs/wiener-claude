import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  EnvReport, FileContent, InstructionFile, McpServer, MemoryFile, MemoryType, PlanItem, PluginItem, SettingsView, SkillItem, TaskGroup, TaskStatus,
} from '../shared/types.ts'
import type { Db } from './db.ts'
import { claudeDir, projectsDir } from './paths.ts'

type Json = Record<string, unknown>
type Row = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const idOf = (file: string) => createHash('sha1').update(file).digest('hex').slice(0, 16)
const home = os.homedir()
const short = (p: string) => (p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p)

function readJson(file: string): Json | null {
  try {
    return obj(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function statOf(file: string): fs.Stats | null {
  try {
    const st = fs.statSync(file)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

function listDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The handful of YAML front-matter fields memory and skill files use, nested "metadata" included. */
export function frontMatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text.startsWith('---')) return out
  const end = text.indexOf('\n---', 3)
  if (end < 0) return out
  let parent: string | null = null
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^(\s*)([\w-]+):\s*(.*)$/)
    if (!m) continue
    const [, indent, key, raw] = m as unknown as [string, string, string, string]
    const value = raw.replace(/^["']|["']$/g, '').trim()
    if (!indent) {
      parent = value ? null : key
      if (value) out[key] = value
    } else if (parent && value) out[`${parent}.${key}`] = value
  }
  return out
}

// ---- files: memory and instructions ------------------------------------------------------------

function projectNames(db: Db): Map<string, string> {
  return new Map(
    (db.prepare(`SELECT slug, project_name FROM sessions WHERE slug IS NOT NULL AND project_name IS NOT NULL GROUP BY slug`).all() as Row[]).map((r) => [
      String(r.slug), String(r.project_name),
    ]),
  )
}

const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

export function memoryFiles(db: Db): (MemoryFile & { path: string })[] {
  const names = projectNames(db)
  const out: (MemoryFile & { path: string })[] = []
  for (const slug of listDir(projectsDir())) {
    if (!slug.isDirectory()) continue
    const dir = path.join(projectsDir(), slug.name, 'memory')
    for (const f of listDir(dir)) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue
      const file = path.join(dir, f.name)
      const st = statOf(file)
      if (!st) continue
      let head = ''
      try {
        head = fs.readFileSync(file, 'utf8').slice(0, 4000)
      } catch {
        continue
      }
      const fm = frontMatter(head)
      const rawType = fm['metadata.type'] ?? fm.type ?? ''
      const type: MemoryType = f.name === 'MEMORY.md' ? 'index' : (MEMORY_TYPES as string[]).includes(rawType) ? (rawType as MemoryType) : 'other'
      out.push({
        id: idOf(file),
        path: file,
        name: f.name === 'MEMORY.md' ? 'Dizin (MEMORY.md)' : fm.name ?? f.name.replace(/\.md$/, ''),
        description: fm.description ?? null,
        type,
        projectName: names.get(slug.name) ?? slug.name.replace(/^-+/, '').split('-').pop() ?? slug.name,
        file: short(file),
        mtime: st.mtimeMs,
        size: st.size,
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** Repository roots this machine has used Claude Code in. */
function projectRoots(db: Db, claudeJson: Json | null): { root: string; name: string }[] {
  const roots = new Map<string, string>()
  for (const r of db.prepare(`SELECT project_key AS key, project_name AS name FROM sessions WHERE project_key LIKE '/%' GROUP BY project_key`).all() as Row[]) {
    roots.set(String(r.key), String(r.name))
  }
  for (const p of Object.keys(obj(claudeJson?.projects) ?? {})) {
    if (p.startsWith('/') && !p.includes('/.claude/worktrees/') && !p.includes('/scratch-workspaces/') && !roots.has(p)) roots.set(p, path.basename(p))
  }
  return [...roots].map(([root, name]) => ({ root, name }))
}

export function instructionFiles(db: Db, claudeJson: Json | null = readClaudeJson()): (InstructionFile & { path: string })[] {
  const out: (InstructionFile & { path: string })[] = []
  const seen = new Set<string>()
  const add = (file: string, scope: string) => {
    const st = statOf(file)
    if (!st) return
    let real = file
    try {
      real = fs.realpathSync(file)
    } catch {
      // Keep the path as given.
    }
    if (seen.has(real)) return
    seen.add(real)
    out.push({ id: idOf(file), path: file, scope, file: short(file), mtime: st.mtimeMs, size: st.size })
  }
  add(path.join(claudeDir(), 'CLAUDE.md'), 'Kullanıcı')
  for (const { root, name } of projectRoots(db, claudeJson)) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) add(path.join(root, f), name)
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

const MAX_FILE = 200_000

/** Content of a memory or instruction file, looked up by id so no arbitrary path can be read. */
export function fileContent(db: Db, id: string): FileContent | null {
  const match = [...memoryFiles(db), ...instructionFiles(db)].find((f) => f.id === id)
  if (!match) return null
  try {
    const text = fs.readFileSync(match.path, 'utf8')
    return { id, file: match.file, text: text.slice(0, MAX_FILE), truncated: text.length > MAX_FILE }
  } catch {
    return null
  }
}

// ---- tasks and plans ---------------------------------------------------------------------------

const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`

export function taskGroups(db: Db): TaskGroup[] {
  const rows = db.prepare(`SELECT t.session_id, t.task_id, t.subject, t.status, t.updated_ts, ${TITLE} AS title,
      COALESCE(s.project_name, 'Bilinmeyen') AS project, s.last_ts
    FROM tasks t LEFT JOIN sessions s ON s.id = t.session_id LEFT JOIN desktop_sessions d ON d.cli_session_id = t.session_id
    WHERE t.status != 'deleted' ORDER BY s.last_ts DESC`).all() as Row[]
  const groups = new Map<string, TaskGroup>()
  for (const r of rows) {
    const id = String(r.session_id)
    const g = groups.get(id) ?? { sessionId: id, title: String(r.title), projectName: String(r.project), lastTs: n(r.last_ts), tasks: [] }
    const status = (['pending', 'in_progress', 'completed'] as const).includes(r.status as 'pending') ? (r.status as TaskStatus) : 'pending'
    g.tasks.push({ id: String(r.task_id), subject: String(r.subject), status, updatedTs: n(r.updated_ts) })
    groups.set(id, g)
  }
  const order = (id: string) => {
    const m = id.match(/(\d+)$/)
    return m ? Number(m[1]) : 0
  }
  for (const g of groups.values()) g.tasks.sort((a, b) => order(a.id) - order(b.id))
  return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs)
}

export function plans(db: Db): PlanItem[] {
  return (db.prepare(`SELECT p.key, p.session_id, p.ts, p.text, u.is_error, u.denied, ${TITLE} AS title, COALESCE(s.project_name, 'Bilinmeyen') AS project
      FROM plans p LEFT JOIN tool_uses u ON u.id = p.key LEFT JOIN sessions s ON s.id = p.session_id
      LEFT JOIN desktop_sessions d ON d.cli_session_id = p.session_id ORDER BY p.ts DESC LIMIT 200`).all() as Row[]).map((r) => {
    const text = String(r.text)
    const heading = text.split('\n').find((l) => l.trim().length > 0)?.replace(/^#+\s*/, '').trim() ?? 'Plan'
    return {
      key: String(r.key),
      sessionId: String(r.session_id),
      sessionTitle: String(r.title),
      projectName: String(r.project),
      ts: n(r.ts),
      title: heading.length > 120 ? `${heading.slice(0, 119)}…` : heading,
      text,
      outcome: r.is_error === 0 ? 'approved' : r.is_error === 1 ? 'rejected' : 'unknown',
    }
  })
}

// ---- skills, plugins, MCP ----------------------------------------------------------------------

let claudeJsonCache: { mtime: number; data: Json | null } | null = null

function readClaudeJson(): Json | null {
  const file = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json')
  const st = statOf(file)
  if (!st) return null
  if (claudeJsonCache?.mtime === st.mtimeMs) return claudeJsonCache.data
  claudeJsonCache = { mtime: st.mtimeMs, data: readJson(file) }
  return claudeJsonCache.data
}

function skillsIn(dir: string, source: string): { name: string; description: string | null; source: string }[] {
  const out: { name: string; description: string | null; source: string }[] = []
  for (const d of listDir(dir)) {
    if (!d.isDirectory()) continue
    const file = path.join(dir, d.name, 'SKILL.md')
    try {
      const fm = frontMatter(fs.readFileSync(file, 'utf8').slice(0, 4000))
      out.push({ name: fm.name ?? d.name, description: fm.description ?? null, source })
    } catch {
      // No SKILL.md here.
    }
  }
  return out
}

function installedPlugins(): { key: string; name: string; marketplace: string | null; entry: Json }[] {
  const data = readJson(path.join(claudeDir(), 'plugins', 'installed_plugins.json'))
  const out: { key: string; name: string; marketplace: string | null; entry: Json }[] = []
  for (const [key, value] of Object.entries(obj(data?.plugins) ?? {})) {
    const entry = obj(Array.isArray(value) ? value[0] : value)
    if (!entry) continue
    const [name, marketplace] = key.split('@') as [string, string | undefined]
    out.push({ key, name, marketplace: marketplace ?? null, entry })
  }
  return out
}

function plugins(settings: Json | null, claudeJson: Json | null): PluginItem[] {
  const enabled = obj(settings?.enabledPlugins) ?? {}
  const usage = obj(claudeJson?.pluginUsage) ?? {}
  return installedPlugins()
    .map(({ key, name, marketplace, entry }) => ({
      name,
      marketplace,
      version: str(entry.version),
      enabled: enabled[key] === true,
      installedAt: str(entry.installedAt) ? Date.parse(String(entry.installedAt)) || null : null,
      uses: n(obj(usage[key])?.usageCount),
    }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
}

function skills(db: Db, claudeJson: Json | null, roots: { root: string; name: string }[]): SkillItem[] {
  const defined: { name: string; description: string | null; source: string }[] = [...skillsIn(path.join(claudeDir(), 'skills'), 'Kullanıcı')]
  for (const p of installedPlugins()) {
    const dir = str(p.entry.installPath)
    if (dir) defined.push(...skillsIn(path.join(dir, 'skills'), p.name))
  }
  for (const { root, name } of roots) defined.push(...skillsIn(path.join(root, '.claude', 'skills'), name))
  const known = new Set(defined.map((d) => d.name))
  // "plugin:skill" and "skill" are the same skill when a skill file by that name exists.
  const canonical = (name: string) => {
    const tail = name.includes(':') ? name.split(':').pop() ?? name : name
    return known.has(tail) ? tail : name
  }

  const found = new Map<string, SkillItem>()
  const get = (name: string) => {
    const key = canonical(name)
    const s = found.get(key) ?? { name: key, description: null, source: 'Claude Code', uses: 0, lastUsedAt: null }
    found.set(key, s)
    return s
  }
  for (const d of defined) Object.assign(get(d.name), { description: d.description, source: d.source })

  // Claude Code's own count, which may list one skill under two names, and the Skill tool calls
  // in the transcripts; the larger of the two is the better estimate.
  const counted = new Map<string, number>()
  const called = new Map<string, number>()
  for (const [name, v] of Object.entries(obj(claudeJson?.skillUsage) ?? {})) {
    const u = obj(v)
    const s = get(name)
    counted.set(s.name, (counted.get(s.name) ?? 0) + n(u?.usageCount))
    s.lastUsedAt = Math.max(s.lastUsedAt ?? 0, n(u?.lastUsedAt)) || null
  }
  for (const r of db.prepare(`SELECT detail, count(*) AS c, max(ts) AS last FROM tool_uses WHERE name = 'Skill' AND detail IS NOT NULL GROUP BY detail`).all() as Row[]) {
    const s = get(String(r.detail))
    called.set(s.name, (called.get(s.name) ?? 0) + n(r.c))
    s.lastUsedAt = Math.max(s.lastUsedAt ?? 0, n(r.last)) || null
  }
  for (const s of found.values()) s.uses = Math.max(counted.get(s.name) ?? 0, called.get(s.name) ?? 0)
  return [...found.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
}

const PACKAGE_RUNNERS = new Set(['npx', 'uvx', 'bunx', 'pnpx', 'pipx'])
const PACKAGE_SPEC = /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/

/**
 * What a server runs, without anything that could carry a secret: the program name, and for
 * package runners the package name when it looks like one. Env, headers and other args are skipped.
 */
export function mcpTarget(config: Json): { transport: McpServer['transport']; target: string | null } {
  const type = str(config.type)
  const command = str(config.command)
  const url = str(config.url)
  if (command) {
    const program = path.basename(command)
    const args = Array.isArray(config.args) ? config.args.filter((a): a is string => typeof a === 'string') : []
    const pkg = PACKAGE_RUNNERS.has(program) ? args.find((a) => !a.startsWith('-')) : undefined
    return { transport: 'stdio', target: pkg && PACKAGE_SPEC.test(pkg) ? `${program} ${pkg}` : program }
  }
  if (url) {
    let host: string | null = null
    try {
      host = new URL(url).host
    } catch {
      host = null
    }
    return { transport: type === 'sse' ? 'sse' : 'http', target: host }
  }
  return { transport: type === 'stdio' || type === 'http' || type === 'sse' ? type : null, target: null }
}

const DESKTOP_SERVERS = new Set(['Claude_Browser', 'Claude_Code_iOS_Simulator', 'visualize', 'computer-use', 'claude-in-chrome', 'terminal', 'mcp-registry', 'scheduled-tasks'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function mcpServers(db: Db, claudeJson: Json | null, roots: { root: string; name: string }[]): McpServer[] {
  const servers = new Map<string, McpServer>()
  const configure = (name: string, scope: string, config: Json) => {
    if (servers.has(name)) return
    servers.set(name, { name, scope, ...mcpTarget(config), calls: 0, errors: 0, lastUsedAt: null, topTools: [] })
  }
  for (const [name, c] of Object.entries(obj(claudeJson?.mcpServers) ?? {})) if (obj(c)) configure(name, 'Kullanıcı', c as Json)
  for (const [root, p] of Object.entries(obj(claudeJson?.projects) ?? {})) {
    for (const [name, c] of Object.entries(obj(obj(p)?.mcpServers) ?? {})) if (obj(c)) configure(name, `Proje: ${path.basename(root)}`, c as Json)
  }
  for (const { root, name: project } of roots) {
    for (const [name, c] of Object.entries(obj(readJson(path.join(root, '.mcp.json'))?.mcpServers) ?? {})) {
      if (obj(c)) configure(name, `Proje: ${project} (.mcp.json)`, c as Json)
    }
  }
  const usage = db.prepare(`SELECT mcp_server, count(*) AS calls, sum(CASE WHEN is_error = 1 AND denied IS NULL THEN 1 ELSE 0 END) AS errors, max(ts) AS last
    FROM tool_uses WHERE mcp_server IS NOT NULL GROUP BY mcp_server`).all() as Row[]
  const tools = db.prepare(`SELECT name, count(*) AS c FROM tool_uses WHERE mcp_server = ? GROUP BY name ORDER BY c DESC LIMIT 3`)
  for (const r of usage) {
    const name = String(r.mcp_server)
    if (!servers.has(name)) {
      const scope = UUID.test(name)
        ? 'claude.ai bağlayıcısı'
        : name.startsWith('ccd_') || DESKTOP_SERVERS.has(name)
          ? 'Desktop uygulaması'
          : name.startsWith('plugin_')
            ? 'Eklenti'
            : 'Yapılandırma bulunamadı'
      servers.set(name, { name, scope, transport: null, target: null, calls: 0, errors: 0, lastUsedAt: null, topTools: [] })
    }
    const s = servers.get(name) as McpServer
    s.calls = n(r.calls)
    s.errors = n(r.errors)
    s.lastUsedAt = n(r.last) || null
    s.topTools = (tools.all(name) as Row[]).map((t) => String(t.name).split('__').slice(2).join('__'))
  }
  return [...servers.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

// ---- settings ----------------------------------------------------------------------------------

// String settings that describe behavior and never hold credentials.
const SAFE_STRINGS = new Set(['model', 'language', 'effortLevel', 'outputStyle', 'theme', 'defaultMode', 'forceLoginMethod', 'autoUpdatesChannel'])

export function settingsView(settings: Json | null, file: string | null): SettingsView {
  const view: SettingsView = { file: file && settings ? short(file) : null, values: [], allow: [], deny: [], ask: [], hooks: [], envKeys: [], otherKeys: [] }
  if (!settings) return view
  const perms = obj(settings.permissions) ?? {}
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  view.allow = list(perms.allow)
  view.deny = list(perms.deny)
  view.ask = list(perms.ask)
  if (str(perms.defaultMode)) view.values.push({ key: 'permissions.defaultMode', value: String(perms.defaultMode) })
  for (const [event, entries] of Object.entries(obj(settings.hooks) ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const e = obj(entry)
      for (const h of Array.isArray(e?.hooks) ? e.hooks : []) {
        const command = str(obj(h)?.command)
        // Only the program's name: the rest of a hook command may carry tokens.
        const program = command ? path.basename(command.trim().split(/\s+/)[0] ?? '') : str(obj(h)?.type) ?? '?'
        view.hooks.push({ event, matcher: str(e?.matcher), command: program })
      }
    }
  }
  view.envKeys = Object.keys(obj(settings.env) ?? {}).sort()
  const handled = new Set(['permissions', 'hooks', 'env', 'enabledPlugins'])
  for (const [key, value] of Object.entries(settings)) {
    if (handled.has(key)) continue
    if (typeof value === 'boolean' || typeof value === 'number') view.values.push({ key, value: String(value) })
    else if (typeof value === 'string' && SAFE_STRINGS.has(key)) view.values.push({ key, value })
    else view.otherKeys.push(key)
  }
  return view
}

export function envReport(db: Db): EnvReport {
  const claudeJson = readClaudeJson()
  const settingsFile = path.join(claudeDir(), 'settings.json')
  const settings = readJson(settingsFile)
  const roots = projectRoots(db, claudeJson)
  const subagents = (db.prepare(`SELECT detail, count(*) AS c FROM tool_uses WHERE name IN ('Agent', 'Task') AND detail IS NOT NULL
      GROUP BY detail ORDER BY c DESC LIMIT 12`).all() as Row[]).map((r) => ({ type: String(r.detail), calls: n(r.c) }))
  const strip = <T extends { path: string }>(xs: T[]) => xs.map(({ path: _p, ...rest }) => rest)
  return {
    memory: strip(memoryFiles(db)),
    instructions: strip(instructionFiles(db, claudeJson)),
    tasks: taskGroups(db),
    plans: plans(db),
    skills: skills(db, claudeJson, roots),
    plugins: plugins(settings, claudeJson),
    mcp: mcpServers(db, claudeJson, roots),
    settings: settingsView(settings, settingsFile),
    subagents,
  }
}

