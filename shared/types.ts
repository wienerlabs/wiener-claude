// API contract shared by the server and the web UI.

export type Metric = 'messages' | 'tokens' | 'cost' | 'sessions' | 'errors'
export type HeatmapView = 'calendar' | 'weekhour' | 'project'

export interface IndexStatus {
  state: 'indexing' | 'ready'
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  lastScanAt: number | null
  lastScanMs: number | null
}

export interface Summary {
  today: { messages: number; yesterdayMessages: number }
  week: { cost: number; lastWeekCost: number }
  live: LiveSession[]
  streak: { current: number; longest: number; activeToday: boolean }
  totals: { sessions: number; firstDay: string | null }
}

export interface LiveSession {
  sessionId: string
  pid: number
  cwd: string | null
  projectName: string | null
  title: string | null
  status: string | null
  updatedAt: number | null
}

export interface HeatmapCell {
  /** calendar: YYYY-MM-DD, weekhour: "dow:hour" (dow 0 = Monday), project: "projectKey|YYYY-MM-DD" */
  key: string
  value: number
}

export interface HeatmapResponse {
  view: HeatmapView
  metric: Metric
  from: string
  to: string
  cells: HeatmapCell[]
  max: number
  total: number
  /** Rows for the project view, ordered by total value. */
  projects: { key: string; name: string; total: number }[]
}

export interface DaySession {
  id: string
  title: string
  projectName: string
  firstTs: number
  lastTs: number
  messages: number
  cost: number
  errors: number
}

export interface DayDetail {
  day: string
  sessions: DaySession[]
  messages: number
  cost: number
}

export interface Insight {
  text: string
  tone: 'neutral' | 'good' | 'warn'
}

export type SessionSource = 'cli' | 'desktop' | 'other'

export interface SessionRow {
  id: string
  title: string
  projectKey: string
  projectName: string
  source: SessionSource
  gitBranch: string | null
  worktree: string | null
  firstTs: number
  lastTs: number
  activeMs: number
  prompts: number
  messages: number
  toolCalls: number
  toolErrors: number
  /** List price of every API call written to the transcript, subagents included. */
  costEstimate: number
  /**
   * Claude Code's own cost counter for its latest process run. It also counts calls that never
   * reach the transcript, so it can exceed the transcript cost for the same period.
   */
  counter: { cost: number; since: number; transcriptCost: number } | null
  /** Sum over runs of the counter's excess over the transcript: calls that were billed but not logged. */
  costHidden: number
  /** Known only when the counter's runs cover the whole session. */
  linesAdded: number | null
  linesRemoved: number | null
  prUrl: string | null
  prNumber: number | null
  models: string[]
  archived: boolean
}

export interface SessionList {
  rows: SessionRow[]
  total: number
}

export interface ProjectOption {
  key: string
  name: string
  sessions: number
}

export type ReplayItem =
  | { type: 'text'; text: string; ts: number }
  | { type: 'thinking'; text: string; ts: number; durationMs: number | null }
  | {
      type: 'tool'
      id: string
      name: string
      summary: string
      input: string
      ts: number
      result: { text: string; isError: boolean; denied: string | null; ts: number } | null
    }
  | { type: 'compact'; ts: number; trigger: string | null; preTokens: number | null }
  | { type: 'notice'; ts: number; tone: 'neutral' | 'error'; text: string }

export interface ReplayTurn {
  index: number
  ts: number
  prompt: { text: string; kind: 'prompt' | 'command' | 'bash'; images: number } | null
  items: ReplayItem[]
  cost: number
  outputTokens: number
  toolCalls: number
  errors: number
}

export interface ReplayPage {
  session: SessionRow
  turns: ReplayTurn[]
  from: number
  totalTurns: number
  /** Claude Code deletes old transcripts; the indexed numbers outlive the file. */
  fileMissing: boolean
}
