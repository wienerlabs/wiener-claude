// API contract shared by the server and the web UI.

export type Metric = 'messages' | 'tokens' | 'cost' | 'sessions' | 'errors'

/** Time filter shared by the screens: this week (from Monday), the last 30 days, or everything. */
export type RangeKey = 'week' | '30d' | 'all'

export interface RangeInfo {
  key: RangeKey
  from: string
  to: string
  days: number
}
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

/** Tokens by kind. Cache reads are the context Claude re-reads on every request. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface PeriodTotals extends TokenTotals {
  key: RangeKey
  from: string
  to: string
  messages: number
  cost: number
}

export interface Summary {
  today: { messages: number; yesterdayMessages: number }
  /** This week, the last 30 days and all time, side by side. */
  periods: PeriodTotals[]
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
  /** Project view only: one column per day, or per week (keyed by Monday) for long ranges. */
  columns: string[]
  bucket: 'day' | 'week'
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
  /** Where to look closer, when there is a screen for it. */
  href?: string
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

export interface Budget {
  monthly: number
  /** Day of the month the projection crosses the budget; null when it doesn't this month. */
  crossesOn: string | null
}

export interface CostReport {
  range: RangeInfo
  /** Spend in the range, and in the period it is compared with (null for "all"). */
  total: number
  previous: number | null
  /** Counter excess over the transcripts for runs that started in the range. */
  hidden: number
  cacheSavings: number
  /** Per day, or per week (keyed by Monday) for long ranges. */
  series: { bucket: 'day' | 'week'; points: DailyCost[] }
  /** The calendar month, for the projection and the budget, whatever range is selected. */
  month: { from: string; to: string; cost: number; projected: number; lastMonth: number; lastMonthToDate: number }
  budget: Budget | null
  models: ModelCost[]
  mix: CostMix
  /** Token counts behind the mix, for the same range. */
  tokens: TokenTotals
  projects: { key: string; name: string; cost: number }[]
  limits: Limits
}

export interface ProjectSummary {
  key: string
  name: string
  path: string | null
  /** All-time totals. */
  sessions: number
  cost: number
  firstTs: number
  lastTs: number
  /** Numbers for the selected range. */
  rangeSessions: number
  rangeCost: number
  rangeMessages: number
  /** Messages per day for the last 12 weeks, oldest first. */
  strip: number[]
  /** Most edited files in the range. */
  topFiles: string[]
  /** The language with the most changed lines in the range, docs and config aside. */
  language: string | null
}

export interface ProjectFile {
  path: string
  edits: number
  added: number
  removed: number
  lastTs: number
  sessions: number
}

/** Everything below the summary is for the selected range. */
export interface ProjectDetail extends ProjectSummary {
  range: RangeInfo
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
  /** Cost by day, or by week for long ranges. */
  series: { bucket: 'day' | 'week'; points: DailyCost[] }
  /** Branch each session was last on; desktop worktrees name theirs when git reports a detached HEAD. */
  branches: { name: string | null; sessions: number; messages: number; cost: number; lastTs: number }[]
  languages: LanguageShare[]
  agents: { name: string; calls: number }[]
  skills: { name: string; calls: number }[]
  mcp: { name: string; calls: number }[]
  /** What subagents cost in this project in the range. */
  subagentCost: number
}

export interface LanguageShare {
  name: string
  /** Lines added plus removed. */
  lines: number
  edits: number
  files: number
}

export type ToolCategory = 'shell' | 'files' | 'web' | 'agents' | 'planning' | 'skills' | 'mcp' | 'other'

export interface ToolStat {
  name: string
  category: ToolCategory
  calls: number
  /** Failed calls; a call the person refused counts as denied instead. */
  errors: number
  denied: number
  sessions: number
}

export interface UsageStat {
  name: string
  calls: number
  sessions: number
  lastTs: number
}

export interface McpServerStat extends UsageStat {
  errors: number
  tools: { name: string; calls: number }[]
}

export type FeatureKey = 'subagents' | 'skills' | 'mcp' | 'plan' | 'tasks' | 'web' | 'questions' | 'commands' | 'shell' | 'compact' | 'interrupt' | 'fast'

export interface ToolsReport {
  range: RangeInfo
  /** Sessions with a message in the range: the base for feature adoption. */
  sessions: number
  totals: { calls: number; errors: number; denied: number; apiErrors: number; apiRetries: number }
  categories: { key: ToolCategory; calls: number }[]
  tools: ToolStat[]
  mcp: McpServerStat[]
  skills: UsageStat[]
  agents: UsageStat[]
  /** What subagents cost, and their share of all spend in the range. */
  subagents: { cost: number; share: number }
  commands: UsageStat[]
  features: { key: FeatureKey; sessions: number; uses: number }[]
  versions: { version: string; sessions: number; firstTs: number; lastTs: number }[]
}

export interface YearReport {
  year: number
  /** Years with any recorded activity, newest first. */
  years: number[]
  from: string
  /** Today while the year is still running. */
  to: string
  partial: boolean
  firstDay: string | null
  days: { day: string; messages: number }[]
  totals: {
    sessions: number
    messages: number
    prompts: number
    tokens: number
    outputTokens: number
    cost: number
    linesAdded: number
    linesRemoved: number
    files: number
    prs: number
    toolCalls: number
  }
  activeDays: number
  longestStreak: { days: number; from: string; to: string } | null
  busiestDay: { day: string; messages: number } | null
  months: number[]
  /** Hour of the day (0–23) and weekday (0 = Monday) with the most messages. */
  peakHour: number | null
  peakWeekday: number | null
  projects: { name: string; messages: number; cost: number }[]
  tools: { name: string; calls: number }[]
  model: { name: string; share: number } | null
  skill: { name: string; calls: number } | null
  command: { name: string; uses: number } | null
  agent: { name: string; calls: number } | null
  longestSession: { id: string; title: string; messages: number } | null
}

export interface Settings {
  /** Monthly budget in dollars at list price; null when none is set. */
  monthlyBudget: number | null
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'index' | 'other'

export interface MemoryFile {
  id: string
  name: string
  description: string | null
  type: MemoryType
  projectName: string
  file: string
  mtime: number
  size: number
}

export interface InstructionFile {
  id: string
  /** "Kullanıcı" ("User") for ~/.claude/CLAUDE.md, otherwise the project's name. */
  scope: string
  scopeKind: 'user' | 'project'
  file: string
  mtime: number
  size: number
}

export interface FileContent {
  id: string
  file: string
  text: string
  truncated: boolean
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export interface TaskGroup {
  sessionId: string
  title: string
  projectName: string
  lastTs: number
  tasks: { id: string; subject: string; status: TaskStatus; updatedTs: number }[]
}

export interface PlanItem {
  key: string
  sessionId: string
  sessionTitle: string
  projectName: string
  ts: number
  title: string
  text: string
  /** approved: the plan was accepted; rejected: the person asked for changes. */
  outcome: 'approved' | 'rejected' | 'unknown'
}

export interface SkillItem {
  name: string
  description: string | null
  /** Where it comes from: a plugin name, "Kullanıcı" ("User"), a project, or "Claude Code". */
  source: string
  uses: number
  lastUsedAt: number | null
}

export interface PluginItem {
  name: string
  marketplace: string | null
  version: string | null
  enabled: boolean
  installedAt: number | null
  uses: number
}

export interface McpServer {
  name: string
  /** Where it is configured, in the interface language: "Kullanıcı", "Proje: …", "claude.ai connector", "Desktop uygulaması", "Plugin" or "Yapılandırma bulunamadı". */
  scope: string
  scopeKind: 'user' | 'project' | 'connector' | 'desktop' | 'plugin' | 'unconfigured'
  transport: 'stdio' | 'http' | 'sse' | null
  /** Program name for stdio servers, host for remote ones. Never arguments, headers or env. */
  target: string | null
  calls: number
  errors: number
  lastUsedAt: number | null
  topTools: string[]
}

export interface SettingsView {
  file: string | null
  values: { key: string; value: string }[]
  allow: string[]
  deny: string[]
  ask: string[]
  hooks: { event: string; matcher: string | null; command: string }[]
  /** Environment variable names only; values are never read out. */
  envKeys: string[]
  otherKeys: string[]
}

export interface EnvReport {
  memory: MemoryFile[]
  instructions: InstructionFile[]
  tasks: TaskGroup[]
  plans: PlanItem[]
  skills: SkillItem[]
  plugins: PluginItem[]
  mcp: McpServer[]
  settings: SettingsView
  subagents: { type: string; calls: number }[]
}

export type TipKind =
  | 'context'
  | 'cache-rewrite'
  | 'repeated-prompts'
  | 'denials'
  | 'setup-errors'
  | 'interrupts'
  | 'claude-md'
  | 'unused-mcp'
  | 'light-sessions'
  | 'subagent-model'
  | 'fast-mode'

export interface TipExample {
  label: string
  detail: string
  /** Opens the session this example comes from. */
  sessionId?: string
  /** Commands, file names and prompts read better in monospace. */
  mono?: boolean
}

/**
 * One piece of advice, built from what the transcripts show: what was seen, why it matters,
 * what to do, and the examples it rests on.
 */
export interface Tip {
  kind: TipKind
  title: string
  finding: string
  why: string
  action: string
  /** Estimated dollars in the range; null when the tip is about time or friction, not money. */
  saving: number | null
  /** "upTo" when the figure is a ceiling, "about" when it is an estimate. */
  savingKind: 'upTo' | 'about' | null
  examples: TipExample[]
  /** Something ready to paste: a CLAUDE.md line, a settings rule, a command file. */
  snippet: { label: string; code: string } | null
}

export interface TipsReport {
  range: RangeInfo
  tips: Tip[]
}
