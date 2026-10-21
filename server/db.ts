import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// The index is a cache of ~/.claude. Bump this when the schema or the way records are read
// changes; the old index is then dropped and rebuilt from the transcripts.
const INDEX_VERSION = 7

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  is_subagent INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms REAL NOT NULL DEFAULT 0,
  ino INTEGER NOT NULL DEFAULT 0,
  offset INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  slug TEXT,
  cwd TEXT,
  project_key TEXT,
  project_name TEXT,
  git_branch TEXT,
  version TEXT,
  entrypoint TEXT,
  first_ts INTEGER,
  last_ts INTEGER,
  custom_title TEXT,
  ai_title TEXT,
  first_prompt TEXT,
  first_prompt_ts INTEGER
);
CREATE INDEX sessions_last ON sessions(last_ts);

CREATE TABLE api_calls (
  msg_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, dow INTEGER NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
  cache_write_5m INTEGER NOT NULL, cache_write_1h INTEGER NOT NULL, web_search INTEGER NOT NULL,
  fast INTEGER NOT NULL, is_sidechain INTEGER NOT NULL,
  cost REAL
);
CREATE INDEX api_day ON api_calls(day);
CREATE INDEX api_session ON api_calls(session_id);

CREATE TABLE prompts (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, dow INTEGER NOT NULL,
  kind TEXT NOT NULL,
  preview TEXT NOT NULL
);
CREATE INDEX prompts_day ON prompts(day);
CREATE INDEX prompts_session ON prompts(session_id);

CREATE TABLE tool_uses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, dow INTEGER NOT NULL,
  name TEXT,
  mcp_server TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  is_error INTEGER,
  denied TEXT,
  detail TEXT,
  -- The start of a failed result's text, for telling setup mistakes from ordinary failures.
  error TEXT
);
CREATE INDEX tools_day ON tool_uses(day);
CREATE INDEX tools_session ON tool_uses(session_id);

CREATE TABLE events (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, dow INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX events_day ON events(day);
CREATE INDEX events_session ON events(session_id);

CREATE TABLE cost_states (
  session_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  total_cost REAL NOT NULL,
  lines_added INTEGER NOT NULL,
  lines_removed INTEGER NOT NULL,
  api_ms INTEGER NOT NULL,
  tool_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, start_time)
);

CREATE TABLE prs (
  url TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  number INTEGER,
  repo TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX prs_session ON prs(session_id);

-- Searchable text. "norm" is the text with Turkish dotless/dotted i folded to plain i, so a
-- search typed without Turkish letters still matches; it has the same length as "text".
CREATE TABLE texts (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  norm TEXT NOT NULL
);
CREATE INDEX texts_session ON texts(session_id);
CREATE VIRTUAL TABLE texts_fts USING fts5(norm, content='texts', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER texts_ai AFTER INSERT ON texts BEGIN
  INSERT INTO texts_fts (rowid, norm) VALUES (new.id, new.norm);
END;
CREATE TRIGGER texts_ad AFTER DELETE ON texts BEGIN
  INSERT INTO texts_fts (texts_fts, rowid, norm) VALUES ('delete', old.id, old.norm);
END;

CREATE TABLE file_edits (
  key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  tool TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL
);
CREATE INDEX edits_session ON file_edits(session_id);
CREATE INDEX edits_path ON file_edits(path);

CREATE TABLE limit_hits (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  resets_at INTEGER
);

CREATE TABLE tasks (
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (session_id, task_id)
);

CREATE TABLE plans (
  key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE desktop_sessions (
  cli_session_id TEXT PRIMARY KEY,
  desktop_id TEXT,
  title TEXT,
  branch TEXT,
  worktree_name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  last_activity_at INTEGER,
  model TEXT,
  cwd TEXT,
  account_id TEXT
);
`

export type Db = DatabaseSync

const MIGRATIONS: Record<number, string> = {
  6: 'ALTER TABLE desktop_sessions ADD COLUMN account_id TEXT',
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  let db = new DatabaseSync(file)
  let version = readVersion(db)
  while (version !== INDEX_VERSION) {
    const sql = MIGRATIONS[version]
    if (!sql) break
    const next = version + 1
    transaction(db, () => {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${next}`)
    })
    version = next
  }
  if (version !== INDEX_VERSION) {
    db.close()
    if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true })
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${INDEX_VERSION}`)
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;')
  return db
}

export const UNKNOWN_ACCOUNT = 'none'
export const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SESSION_TABLES = ['files', 'api_calls', 'prompts', 'tool_uses', 'events', 'cost_states', 'prs', 'texts', 'file_edits', 'limit_hits', 'tasks', 'plans']

export function openAccountDb(file: string, account: string): Db {
  if (account !== UNKNOWN_ACCOUNT && !ACCOUNT_ID.test(account)) throw new Error(`Geçersiz hesap: ${account}`)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA temp_store = MEMORY;')
  const scope = account === UNKNOWN_ACCOUNT
    ? 'NOT IN (SELECT cli_session_id FROM main.desktop_sessions WHERE account_id IS NOT NULL AND cli_session_id IS NOT NULL)'
    : `IN (SELECT cli_session_id FROM main.desktop_sessions WHERE account_id = '${account}')`
  db.exec(`CREATE TEMP VIEW sessions AS SELECT * FROM main.sessions WHERE id ${scope}`)
  db.exec(`CREATE TEMP VIEW desktop_sessions AS SELECT * FROM main.desktop_sessions WHERE cli_session_id ${scope}`)
  for (const t of SESSION_TABLES) db.exec(`CREATE TEMP VIEW ${t} AS SELECT * FROM main.${t} WHERE session_id ${scope}`)
  return db
}

function readVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  return row?.user_version ?? 0
}

/** Folds Turkish ı and İ to i and I. Keeps the string length, so offsets still line up. */
export function foldTurkish(text: string): string {
  return text.replace(/ı/g, 'i').replace(/İ/g, 'I')
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Removes everything derived from ~/.claude, keeping settings in meta. */
export function clearIndex(db: Db): void {
  transaction(db, () => {
    for (const t of ['files', 'sessions', 'api_calls', 'prompts', 'tool_uses', 'events', 'cost_states', 'prs', 'desktop_sessions', 'texts', 'file_edits', 'limit_hits', 'tasks', 'plans']) {
      db.exec(`DELETE FROM ${t}`)
    }
  })
}
