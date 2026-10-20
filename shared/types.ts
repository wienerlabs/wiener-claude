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
  /** Lines changed by Claude's edits (Edit, Write and shell edits), from the transcript. */
  linesAdded: number
  linesRemoved: number
  prUrl: string | null
  prNumber: number | null
  models: string[]
  archived: boolean
  /** Present when the list was filtered by a search query. */
  match?: SearchMatch | null
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
  | { type: 'text'; text: string; ts: number; key: string }
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
  prompt: { text: string; kind: 'prompt' | 'command' | 'bash'; images: number; key: string } | null
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
  /** Index of the turn holding the record asked for with ?around=, if any. */
  focusTurn: number | null
  /** Claude Code deletes old transcripts; the indexed numbers outlive the file. */
  fileMissing: boolean
}

export interface SearchMatch {
  /** Text around the first hit; hits are wrapped in \u0002 … \u0003. */
  snippet: string
  /** Record to jump to in the replay. */
  key: string
  kind: 'prompt' | 'reply' | 'command'
  ts: number
  hits: number
}

export interface DailyCost {
  day: string
  cost: number
  byModel: Record<string, number>
}

export interface ModelCost {
  model: string
  cost: number
  calls: number
  output: number
  share: number
}

export interface CostMix {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface Suggestion {
  text: string
  /** Estimated monthly saving in dollars, when one can be computed. */
  saving: number | null
}

export interface LimitHit {
  kind: 'five_hour' | 'seven_day' | 'other'
  at: number
  resetsAt: number | null
}

export interface Limits {
  /** "Max 5x", "Pro", … from the local account file; null when unknown. */
  plan: string | null
  /** Claude Code's own utilization reading, when it is recent enough to mean something. */
  measured: {
    fetchedAt: number
    fresh: boolean
    fiveHour: { percent: number; resetsAt: number | null } | null
    sevenDay: { percent: number; resetsAt: number | null } | null
  } | null
  /** The current 5-hour usage window, estimated from local activity. */
  block: { start: number; end: number; cost: number; messages: number } | null
  rolling7: { cost: number; atLastWeeklyHit: { at: number; cost: number } | null }
  hits: LimitHit[]
}

export interface CostReport {
  month: { from: string; to: string; cost: number; projected: number; lastMonth: number; lastMonthToDate: number; hidden: number }
  cacheSavings: number
  daily: DailyCost[]
  models: ModelCost[]
  mix: CostMix
  projects: { key: string; name: string; cost: number }[]
  suggestions: Suggestion[]
  limits: Limits
}

export interface ProjectSummary {
  key: string
  name: string
  path: string | null
  sessions: number
  firstTs: number
  lastTs: number
  cost: number
  cost30: number
  messages30: number
  /** Messages per day for the last 12 weeks, oldest first. */
  strip: number[]
  topFiles: string[]
}

export interface ProjectFile {
  path: string
  edits: number
  added: number
  removed: number
  lastTs: number
  sessions: number
}

export interface ProjectDetail extends ProjectSummary {
  prompts: number
  messages: number
  toolCalls: number
  toolErrors: number
  linesAdded: number
  linesRemoved: number
  files: ProjectFile[]
  prs: { url: string; number: number | null; repo: string | null; ts: number; sessionId: string; title: string }[]
  tools: { name: string; calls: number; errors: number }[]
  models: { model: string; cost: number }[]
}
