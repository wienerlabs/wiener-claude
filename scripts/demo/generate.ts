// Writes a made-up home folder for the public demo: Claude Code transcripts for six invented
// projects over the last five months, plus the settings, memory, skills and MCP config around them.
// The sessions follow the stories in stories.ts, so what a visitor reads holds together. Nothing
// here comes from a real machine; a fixed seed makes every build produce the same data.
//
// The demo exists in Turkish and English. The English stories mirror the Turkish ones one to one,
// and nothing below draws a random number based on the text, so both languages get the same
// sessions, ids, times and costs; only the words differ.
import fs from 'node:fs'
import path from 'node:path'
import { type Lang, pick } from '../../shared/i18n.ts'
import { Pricing } from '../../server/pricing.ts'
import { EARLY } from './history.ts'
import { CLAUDE_MD_WEB_EN, ROUTINE_PR_EN, ROUTINE_TESTS_EN, STORIES_EN } from './stories.en.ts'
import { CLAUDE_MD_WEB, type Edit, type ProjectStories, type Question, ROUTINE_PR, ROUTINE_TESTS, STORIES, type Story } from './stories.ts'

type Json = Record<string, unknown>

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
  }
}

const MODELS = { opus: 'claude-opus-5-5', opusOld: 'claude-opus-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' } as const
const VERSIONS = ['2.1.255', '2.1.262', '2.1.270', '2.1.281', '2.1.288', '2.1.295', '2.1.299']
const DAY = 86_400_000
const MIN = 60_000

/** Typed apostrophes, as people type them. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll('’', "'")) as T

const LINT: Record<string, { command: string; pass: string }> = {
  'carsi-web': { command: 'npm run lint', pass: '✔ No ESLint warnings or errors' },
  'carsi-payments': { command: 'golangci-lint run ./...', pass: '0 issues.' },
  'carsi-mobile': { command: 'npx tsc --noEmit', pass: '(no errors)' },
  'carsi-data': { command: 'ruff check .', pass: 'All checks passed!' },
  'carsi-infra': { command: 'terraform fmt -check -recursive', pass: '(no changes)' },
  'carsi-docs': { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
}

/** The project the demo's developer is busiest with lately. */
const FEATURED = 'carsi-web'

/** Stories set up for the two sessions still running when the demo is built. */
const TODAY = ['Ürün sayfasının LCP süresi', 'API istemcisinde zaman aşımı']
/** The same stories by position, which the English set shares: "project:story". */
const TODAY_AT = TODAY.map((title) => {
  const p = STORIES.findIndex((x) => x.stories.some((s) => s.title === title))
  return `${p}:${STORIES[p]?.stories.findIndex((s) => s.title === title)}`
})

export interface DemoOptions {
  home: string
  now: Date
  seed?: number
  lang?: Lang
}

export function generateDemoHome({ home, now, seed = 20261021, lang = 'tr' }: DemoOptions): void {
  const L = <T>(tr: T, en: T) => pick(lang, tr, en)
  const r = rng(seed)
  const pricing = new Pricing()
  const claude = path.join(home, '.claude')
  const projectsDir = path.join(claude, 'projects')
  const root = (name: string) => path.join(home, 'code', name)
  const slugOf = (cwd: string) => cwd.replace(/[/.]/g, '-')
  let counter = 0
  const id = (prefix: string) => `${prefix}${(++counter).toString(16).padStart(8, '0')}`
  const uuid = () => {
    const h = () => Math.floor(r.next() * 0x10000).toString(16).padStart(4, '0')
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
  }
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }

  // ---- schedule ---------------------------------------------------------------------------------
  const projects = plain(L(STORIES, STORIES_EN))
  type Work = { project: ProjectStories; story: Story | null; question: Question | null; review?: boolean; at?: string }
  const work: Work[] = []
  projects.forEach((p, pi) => {
    p.stories.forEach((story, si) => work.push({ project: p, story, question: null, at: `${pi}:${si}` }))
    for (const question of p.questions) work.push({ project: p, story: null, question })
  })
  const isToday = (w: Work) => TODAY_AT.includes(w.at ?? '')
  // Interleave projects, then let the busier, more eventful stories fall in the recent months.
  const eventful = (w: Work) => (w.story ? Number(!!w.story.bigContext) + Number(!!w.story.interrupt) + Number(!!w.story.zshGlob) + Number(!!w.story.blocked) : 0)
  const ordered = work
    .map((w) => ({ w, key: r.next() + eventful(w) * 0.35 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.w)
    .filter((w) => !isToday(w))
  const today = work.filter(isToday)

  const span = 150
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - span)
  // Working days, busier as the months go by: usage grows.
  const candidates: number[] = []
  for (let d = 0; d < span - 1; d++) {
    const day = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + d)
    const dow = (day.getDay() + 6) % 7
    const weight = (dow < 5 ? 1 : 0.15) * (0.2 + 0.8 * (d / span) ** 1.4)
    if (r.chance(weight)) candidates.push(d)
  }
  const isWorkday = (d: number) => (new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + d).getDay() + 6) % 7 < 5
  // The store gets the last six weeks: it is what this developer is working on now, so its page
  // has a full month to show. The other projects spread over the five months before.
  const featured = ordered.filter((w) => w.project.name === FEATURED)
  const others = ordered.filter((w) => w.project.name !== FEATURED)
  const otherDays = others.map((_, i) => candidates[Math.floor(((i + r.next() * 0.8) / others.length) * candidates.length)] ?? candidates.at(-1) ?? 0)
  // A few of them in the last two weeks too, every other working day, so this week is never
  // empty and week-on-week comparisons stay sensible.
  const lastTwoWeeks = Array.from({ length: 15 }, (_, i) => span - 1 - i).filter(isWorkday)
  lastTwoWeeks.filter((_, i) => i % 2 === 1).slice(0, 4).forEach((d, i) => { otherDays[otherDays.length - 1 - i] = d })
  const recentWorkdays = Array.from({ length: 42 }, (_, i) => span - 42 + i).filter((d) => d < span - 1 && isWorkday(d))
  const featuredDays = featured.map((_, i) => recentWorkdays[Math.floor(((i + r.next() * 0.6) / featured.length) * recentWorkdays.length)] ?? span - 2)
  const plan = [...others.map((w, i) => ({ w, d: otherDays[i] ?? 0 })), ...featured.map((w, i) => ({ w, d: featuredDays[i] ?? span - 2 }))]
    .sort((a, b) => a.d - b.d)

  const liveCandidates: { sessionId: string; cwd: string }[] = []
  let prNumber = 180
  /** The PR each story opened and when its session ended, for the review round that follows. */
  const opened = new Map<string, { number: number; endedAt: number }>()

  // ---- one session ------------------------------------------------------------------------------
  const session = (w: Work, startAt: Date, opts: { live: boolean }) => {
    const p = w.project
    const story = w.story
    const sessionId = uuid()
    const desktop = r.chance(0.35)
    const worktree = desktop && story && r.chance(0.5) ? story.branch.split('/').pop() : null
    const cwd = worktree ? path.join(root(p.name), '.claude', 'worktrees', worktree) : root(p.name)
    const branch = story ? (worktree ? `claude/${worktree}` : story.branch) : 'main'
    const age = (now.getTime() - startAt.getTime()) / DAY
    const version = VERSIONS[Math.max(0, VERSIONS.length - 1 - Math.floor(age / 22))] as string
    const model = story?.model === 'sonnet' ? MODELS.sonnet : age > 110 ? MODELS.opusOld : MODELS.opus
    const entrypoint = desktop ? 'claude-desktop' : 'cli'
    const records: Json[] = []
    const subagents: { name: string; records: Json[] }[] = []
    const base = (ts: number) => ({ sessionId, timestamp: new Date(ts).toISOString(), cwd, gitBranch: branch, version, entrypoint, userType: 'external' })

    let t = startAt.getTime()
    // System prompt, tools and CLAUDE.md before the first word.
    let context = r.int(32_000, 44_000)
    /** Tokens added since the last call: the previous reply and the tool results that followed. */
    let pending = 0
    let lastCall = 0
    let cold = true
    let cost = 0
    let added = 0
    let removed = 0
    let msgs = 0
    const fast = !!story?.fast
    const compactAt = story?.bigContext ? 560_000 : 170_000

    const usage = (output: number, webSearch = false) => {
      // The first call, or the first after the cache expired, writes the whole context again;
      // otherwise only what was added since the last call is written.
      const coldNow = cold || t - lastCall > 60 * MIN
      const fresh = pending + r.int(150, 700)
      const read = coldNow ? 0 : context
      context += fresh
      const written = coldNow ? context : fresh
      pending = output
      cold = false
      lastCall = t
      cost += pricing.cost(model, { input: 0, output, cacheRead: read, cacheWrite5m: 0, cacheWrite1h: written, webSearch: webSearch ? 1 : 0, fast }) ?? 0
      return {
        input_tokens: r.int(3, 40), output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: written,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: written }, service_tier: 'standard', speed: fast ? 'fast' : 'standard',
        ...(webSearch ? { server_tool_use: { web_search_requests: 1 } } : {}),
      }
    }
    const say = (text: string, output = r.int(120, 600)) => {
      t += r.int(6, 30) * 1000
      msgs++
      records.push({ type: 'assistant', uuid: uuid(), ...base(t), requestId: id('req_'), message: { id: id('msg_'), type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], usage: usage(output) } })
    }
    /** One tool call and its result; `lead` is the line Claude writes before it, if any. */
    const tool = (name: string, input: Json, result: string, o: { lead?: string; isError?: boolean; extra?: Json; output?: number; webSearch?: boolean; took?: number; grow?: number } = {}) => {
      t += r.int(4, 25) * 1000
      msgs++
      const toolId = id('toolu_')
      const content: Json[] = [...(o.lead ? [{ type: 'text', text: o.lead }] : []), { type: 'tool_use', id: toolId, name, input }]
      records.push({ type: 'assistant', uuid: uuid(), ...base(t), requestId: id('req_'), message: { id: id('msg_'), type: 'message', role: 'assistant', model, content, usage: usage(o.output ?? r.int(60, 260), o.webSearch) } })
      t += o.took ?? r.int(1, 6) * 1000
      records.push({ type: 'user', uuid: uuid(), ...base(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: result, is_error: !!o.isError }] }, ...o.extra })
      pending += o.grow ?? r.int(300, 1_500)
      return toolId
    }
    const prompt = (text: string) => {
      t += r.int(1, 6) * MIN
      records.push({ type: 'user', uuid: uuid(), ...base(t), origin: { kind: 'human' }, message: { role: 'user', content: text } })
    }
    const read = (file: string, big = false) => {
      const snippet = p.snippets[file] ?? (story?.edits.find((e) => e.file === file)?.old || `// ${file}`)
      const lines = snippet.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n')
      // The whole file goes into the context, not just the lines shown here.
      tool('Read', { file_path: path.join(cwd, file) }, lines, { lead: r.chance(0.4) ? L(`${path.basename(file)} dosyasına bakıyorum.`, `Looking at ${path.basename(file)}.`) : undefined, output: r.int(40, 140), grow: big ? r.int(7_000, 16_000) : r.int(3_000, 10_000) })
    }
    /** Files of this project other stories touch: what Claude looks at around the task. */
    const pool = [...new Set(p.stories.flatMap((x) => [...x.read, ...x.edits.map((e) => e.file)]))]
    const shuffle = <T>(xs: T[]) => xs.map((x) => [r.next(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x)
    /** Files next to these ones first, then from the same part of the tree: where Claude would look. */
    const related = (files: string[], n: number) => {
      const dirs = new Set(files.map((f) => path.dirname(f)))
      const tops = new Set(files.map((f) => f.split('/')[0]))
      const others = pool.filter((f) => !files.includes(f))
      const near = others.filter((f) => dirs.has(path.dirname(f)))
      const wider = others.filter((f) => !near.includes(f) && tops.has(f.split('/')[0]))
      return [...shuffle(near), ...shuffle(wider)].slice(0, n)
    }
    const bash = (command: string, out: string, o: { isError?: boolean; lead?: string; took?: number } = {}) => {
      // Claude reaches for GNU timeout now and then; this Mac doesn't have it.
      if (r.chance(0.07) && !command.startsWith('git')) {
        tool('Bash', { command: `timeout 120 ${command}`, description: command }, 'Exit code 127\n(eval):1: command not found: timeout', { isError: true, lead: o.lead })
        tool('Bash', { command, description: command }, out, { isError: o.isError, lead: L('Bu makinede timeout yok; komutu doğrudan çalıştırıyorum.', "timeout isn't installed on this machine; running the command directly."), took: o.took })
        return
      }
      tool('Bash', { command, description: command }, out, { isError: o.isError, lead: o.lead, took: o.took, grow: r.int(800, 3_000) })
    }
    const edit = (e: Edit, lead?: string) => {
      const oldLines = e.old ? e.old.split('\n') : []
      const newLines = e.new ? e.new.split('\n') : []
      added += newLines.length
      removed += oldLines.length
      const filePath = path.join(cwd, e.file)
      const create = !e.old
      tool(create ? 'Write' : 'Edit', create ? { file_path: filePath, content: e.new } : { file_path: filePath, old_string: e.old, new_string: e.new },
        create ? `File created successfully at: ${filePath}` : `The file ${filePath} has been updated.`, {
          lead,
          output: r.int(150, 900),
          extra: { toolUseResult: create ? { type: 'create', filePath, content: `${e.new}\n` } : { filePath, structuredPatch: [{ oldStart: 12, oldLines: oldLines.length, newStart: 12, newLines: newLines.length, lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)] }] } },
        })
    }
    const grep = (pattern: string, forceZsh = false) => {
      const ext = p.name === 'carsi-payments' ? 'go' : p.name === 'carsi-data' ? 'py' : 'ts*'
      // An unquoted glob: zsh refuses it before grep ever runs. Claude does this more than once.
      if (forceZsh || r.chance(0.3)) {
        tool('Bash', { command: `grep -rn "${pattern}" --include=*.${ext} .` }, `Exit code 1\n(eval):1: no matches found: --include=*.${ext}`, { isError: true })
        tool('Grep', { pattern, path: cwd }, `Found ${r.int(2, 9)} files`, { lead: L("zsh glob'u açmadan reddetti; Grep aracıyla arıyorum.", 'zsh rejected the unquoted glob; searching with the Grep tool instead.') })
        return
      }
      tool('Grep', { pattern, path: cwd }, `Found ${r.int(2, 9)} files`, { lead: L(`${pattern} nerelerde kullanılıyor, bakıyorum.`, `Checking where ${pattern} is used.`) })
    }
    const todo = (items: string[], done: number) =>
      tool('TodoWrite', { todos: items.map((content, i) => ({ content, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending', activeForm: content })) }, 'Todos have been modified successfully.')
    const maybeCompact = () => {
      if (context <= compactAt) return
      t += 5000
      records.push({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), ...base(t), content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: context } })
      context = r.int(32_000, 46_000)
      pending = 0
    }

    // ---- blocks: the session's prompts spread over one to three days of work ----
    type Step = () => void
    const turns: { prompt: string; run: Step }[] = []
    const pr = story ? opened.get(story.title) : undefined
    if (w.review && story?.review && pr) {
      const rv = story.review
      turns.push({
        prompt: L(`PR #${pr.number}'e gelen review yorumlarını uygula`, `Address the review comments on PR #${pr.number}`),
        run: () => {
          const [owner, repo] = p.repo.split('/')
          tool('mcp__github__get_pull_request_comments', { owner, repo, pull_number: pr.number }, rv.comment, { lead: L(`PR #${pr.number} yorumlarını okuyorum.`, `Reading the comments on PR #${pr.number}.`) })
          read(rv.edit.file)
          edit(rv.edit, L('Yorumu uyguluyorum.', 'Applying the comment.'))
          bash(story.test.command, story.test.pass)
          bash(`git commit -am "Review: ${story.title}" && git push`, `[${branch} ${id('').slice(-7)}] Review: ${story.title}\n 1 file changed`)
          say(rv.reply)
        },
      })
    } else if (w.question) {
      const q = w.question
      turns.push({ prompt: q.prompt, run: () => say(q.answer, r.int(500, 1100)) })
    } else if (story) {
      const s = story
      turns.push({
        prompt: s.issue ? `${s.issue.id}: ${s.prompt}` : s.prompt,
        run: () => {
          if (s.issue) tool('mcp__linear__get_issue', { id: s.issue.id }, s.issue.text, { lead: L(`${s.issue.id} kaydını okuyorum.`, `Reading ${s.issue.id}.`) })
          if (s.todos) todo(s.todos, 0)
          if (s.explore) {
            const agentId = `a${id('').slice(-12)}`
            tool('Agent', { description: L('İlgili kodu bul', 'Find the relevant code'), prompt: s.prompt, subagent_type: 'Explore' }, s.explore, { took: r.int(20, 60) * 1000 })
            const sub: Json[] = []
            let at = t - 40_000
            for (const f of s.read) {
              at += r.int(3, 8) * 1000
              const toolId = id('toolu_')
              sub.push({ type: 'assistant', isSidechain: true, agentId, uuid: uuid(), sessionId, timestamp: new Date(at).toISOString(), cwd, version,
                message: { id: id('msg_'), role: 'assistant', model: MODELS.haiku, content: [{ type: 'tool_use', id: toolId, name: 'Read', input: { file_path: path.join(cwd, f) } }],
                  usage: { input_tokens: 8, output_tokens: r.int(60, 200), cache_read_input_tokens: 12_000, cache_creation_input_tokens: 3_000, cache_creation: { ephemeral_5m_input_tokens: 3_000, ephemeral_1h_input_tokens: 0 } } } })
              sub.push({ type: 'user', isSidechain: true, agentId, uuid: uuid(), sessionId, timestamp: new Date(at + 400).toISOString(), cwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] } })
            }
            subagents.push({ name: `agent-${agentId}`, records: sub })
          }
          for (const f of s.read) read(f, s.bigContext)
          // A look around: related files, more of them for the large pieces of work.
          const around = related([...s.read, ...s.edits.map((e) => e.file)], s.bigContext ? r.int(10, 16) : r.int(2, 5))
          for (const f of around) read(f, s.bigContext)
          if (s.grep) grep(s.grep, s.zshGlob)
          if (s.web) tool(s.web.kind === 'search' ? 'WebSearch' : 'WebFetch', s.web.kind === 'search' ? { query: s.web.value } : { url: s.web.value, prompt: L('Kırılan değişiklikler neler?', 'What are the breaking changes?') }, s.web.result, { webSearch: s.web.kind === 'search', took: 6000 })
          if (s.skill) tool('Skill', { skill: s.skill }, `Launching skill: ${s.skill}`)
          if (s.ask) tool('AskUserQuestion', { questions: [{ question: s.ask.question, header: L('Karar', 'Decision'), options: s.ask.options.map((label) => ({ label })) }] }, `User has answered your questions: "${s.ask.question}"="${s.ask.answer}"`, { took: r.int(30, 120) * 1000 })
          if (s.plan) tool('ExitPlanMode', { plan: s.plan }, 'User has approved your plan. You can now start coding.', { took: r.int(40, 180) * 1000 })
          if (s.test.fail) bash(s.test.command, s.test.fail, { isError: true, lead: L('Önce hatayı yeniden üretiyorum.', 'Reproducing the failure first.') })
          if (s.interrupt) {
            const i = s.interrupt
            tool('Edit', { file_path: path.join(cwd, i.file), old_string: '…', new_string: '…' },
              "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
              { isError: true, lead: L(`Kapanma mantığını ${path.basename(i.file)} içinde düzeltiyorum.`, `Fixing the close logic in ${path.basename(i.file)}.`), extra: { toolDenialKind: 'interrupted' } })
            records.push({ type: 'user', uuid: uuid(), ...base(t + 1500), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } })
            prompt(i.prompt)
            read(s.edits[0]?.file ?? i.file)
          }
          if (s.blocked) {
            tool('Bash', { command: s.blocked.command }, 'Permission to use Bash with command ' + s.blocked.command + ' has been denied by auto mode.', { isError: true, lead: L('Eski derleme önbelleğini temizliyorum.', 'Clearing the old build cache.'), extra: { toolDenialKind: 'automode-blocked' } })
            bash(s.blocked.instead, 'Cleaned .next and caches', { lead: L('Auto mode silmeye izin vermedi; projenin kendi temizlik komutunu kullanıyorum.', "Auto mode blocked the delete; using the project's own clean script instead.") })
          }
          s.edits.forEach((e, i) => {
            edit(e, i === 0 ? L(`Düzeltmeyi ${path.basename(e.file)} içinde yapıyorum.`, `Making the fix in ${path.basename(e.file)}.`) : undefined)
            if (s.todos && i === 0) todo(s.todos, Math.min(s.todos.length - 1, 2))
            // Changes get checked as they go; large ones after every step.
            if (s.bigContext || r.chance(0.4)) bash(LINT[p.name]?.command ?? s.test.command, LINT[p.name]?.pass ?? s.test.pass)
            maybeCompact()
          })
          bash(s.test.command, s.test.pass, { lead: L('Testleri yeniden çalıştırıyorum.', 'Running the tests again.') })
          // A story whose work goes on elsewhere leaves its last task open.
          if (s.todos) todo(s.todos, s.leavesTaskOpen ? s.todos.length - 1 : s.todos.length)
          say(s.summary, r.int(350, 900))
        },
      })
      for (const f of s.followUps ?? []) {
        turns.push({
          prompt: f.prompt,
          run: () => {
            read(f.edit.file)
            for (const x of related([f.edit.file], r.int(1, 2))) read(x)
            edit(f.edit, L('Değişikliği yapıyorum.', 'Making the change.'))
            if (r.chance(0.5)) bash(LINT[p.name]?.command ?? s.test.command, LINT[p.name]?.pass ?? s.test.pass)
            bash(s.test.command, s.test.pass)
            say(f.reply)
          },
        })
      }
      // The conversation around the work: what changed, what else it touches, the full suite.
      const files = [...new Set([...s.edits, ...(s.followUps ?? []).map((f) => f.edit)].map((e) => e.file))]
      const extras: { prompt: string; run: Step }[] = [
        {
          prompt: L('Ne değişti, kısaca özetle', 'Summarize briefly what changed'),
          run: () => {
            bash('git diff --stat', `${files.map((f) => ` ${f} | ${r.int(3, 40)} ${'+'.repeat(r.int(2, 9))}${'-'.repeat(r.int(0, 4))}`).join('\n')}\n ${files.length} files changed`)
            const names = files.map((f) => path.basename(f)).join(', ')
            const gist = s.summary.split('. ')[0]
            say(L(`${files.length} dosya değişti: ${names}. ${gist}.`, `${files.length} ${files.length === 1 ? 'file' : 'files'} changed: ${names}. ${gist}.`))
          },
        },
        {
          prompt: L('Bunun başka bir yere yan etkisi olabilir mi?', 'Could this have side effects anywhere else?'),
          run: () => {
            const target = path.basename(files[0] ?? 'index', path.extname(files[0] ?? ''))
            tool('Grep', { pattern: target, path: cwd }, `Found ${r.int(2, 6)} files`, { lead: L(`${target} kullanan yerleri arıyorum.`, `Searching for places that use ${target}.`) })
            for (const f of related(files, r.int(1, 3))) read(f)
            const uses = r.int(2, 5)
            say(L(
              `${target} dışarıdan ${uses} yerde kullanılıyor; hepsine baktım, değişiklik onların davranışını etkilemiyor. Mevcut testler bu yolları da kapsıyor.`,
              `${target} is used in ${uses} other places; I checked each one and the change doesn't affect their behavior. The existing tests cover those paths too.`,
            ))
          },
        },
        {
          prompt: L('Bütün test paketini bir kez çalıştır', 'Run the full test suite once'),
          run: () => {
            bash(LINT[p.name]?.command ?? 'git status', LINT[p.name]?.pass ?? '')
            bash(s.test.command.split(' -- ')[0] ?? s.test.command, s.test.pass, { took: r.int(20, 90) * 1000 })
            say(L('Bütün paket temiz: testler ve lint geçiyor.', 'The full suite is clean: tests and lint pass.'))
          },
        },
      ]
      for (const x of extras.sort(() => r.next() - 0.5).slice(0, r.int(2, 3))) turns.push(x)
      if (r.chance(0.55)) {
        turns.push({ prompt: L(ROUTINE_TESTS, ROUTINE_TESTS_EN), run: () => { bash(s.test.command, s.test.pass); bash(LINT[p.name]?.command ?? 'git status', LINT[p.name]?.pass ?? ''); say(L('Hepsi yeşil: testler ve lint temiz, düzeltilecek bir şey çıkmadı.', 'All green: tests and lint are clean, nothing to fix.')) } })
      }
      if (s.pr) {
        turns.push({
          prompt: L(ROUTINE_PR, ROUTINE_PR_EN),
          run: () => {
            const files = [...new Set([...s.edits, ...(s.followUps ?? []).map((f) => f.edit)].map((e) => e.file))]
            bash('git status --short', files.map((f) => ` M ${f}`).join('\n'))
            bash(`git add -A && git commit -m "${s.title}"`, `[${branch} ${id('').slice(-7)}] ${s.title}\n ${files.length} files changed`)
            bash(`git push -u origin ${branch}`, `branch '${branch}' set up to track 'origin/${branch}'.`)
            prNumber++
            opened.set(s.title, { number: prNumber, endedAt: t })
            const url = `https://github.com/${p.repo}/pull/${prNumber}`
            bash(`gh pr create --title "${s.title}" --body-file /tmp/pr-body.md`, url)
            records.push({ type: 'pr-link', sessionId, prNumber, prUrl: url, prRepository: p.repo, timestamp: new Date(t).toISOString() })
            // Merging is the person's call.
            if (r.chance(0.35)) {
              tool('Bash', { command: `gh pr merge ${prNumber} --squash --auto` }, `The user doesn't want to proceed with this tool use. The tool use was rejected. The user said: ${L("merge'ü ben yaparım", "I'll do the merge myself")}`, {
                isError: true, lead: L('CI geçince otomatik birleşsin diye auto-merge açıyorum.', 'Turning on auto-merge so it lands once CI passes.'), extra: { toolDenialKind: 'user-rejected' },
              })
              say(L(
                `Tamam, birleştirmeyi sana bırakıyorum. PR #${prNumber} açık; açıklamada değişiklik özeti ve test planı var.`,
                `OK, I'll leave the merge to you. PR #${prNumber} is open; the description has a summary of the change and a test plan.`,
              ))
            } else {
              say(L(
                `PR #${prNumber} açıldı: ${url}\nAçıklamada ne değiştiğini, nedenini ve nasıl test edildiğini yazdım.`,
                `Opened PR #${prNumber}: ${url}\nThe description covers what changed, why, and how it was tested.`,
              ))
            }
          },
        })
      }
    }

    // Spread the turns over blocks of work; a break longer than an hour makes the cache go cold.
    const dayCount = opts.live ? 1 : story?.bigContext ? 3 : turns.length > 2 && r.chance(0.5) ? 2 : 1
    let turnIndex = 0
    for (let d = 0; d < dayCount && turnIndex < turns.length; d++) {
      if (d > 0) {
        const next = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + d, r.pick([9, 10, 13, 14]), r.int(0, 59))
        t = Math.max(t + 30 * MIN, next.getTime())
      }
      const perDay = Math.ceil((turns.length - turnIndex) / (dayCount - d))
      for (let k = 0; k < perDay && turnIndex < turns.length; k++) {
        if (k > 0 && !opts.live && r.chance(0.3)) t += r.int(70, 150) * MIN // lunch, a meeting
        const turn = turns[turnIndex++] as (typeof turns)[number]
        // A long conversation: the person compacts it before going on.
        if (context > 150_000 && !story?.bigContext && r.chance(0.5)) {
          prompt('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>')
          t += 20_000
          records.push({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), ...base(t), content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: context } })
          context = r.int(30_000, 42_000)
          pending = 0
        }
        if (turnIndex > 1 && r.chance(0.12)) {
          // A quick look at the working tree from the prompt box.
          prompt('<bash-input>git status --short</bash-input>')
          records.push({ type: 'user', uuid: uuid(), ...base(t + 800), message: { role: 'user', content: '<bash-stdout> M ' + (story?.edits[0]?.file ?? 'README.md') + '</bash-stdout><bash-stderr></bash-stderr>' } })
        }
        prompt(turn.prompt)
        turn.run()
      }
    }

    if (msgs === 0) return
    const title = w.review && story ? L(`${story.title}: review düzeltmeleri`, `${story.title}: review fixes`) : story?.title ?? w.question?.title ?? L('Soru', 'Question')
    records.push({ type: 'ai-title', sessionId, aiTitle: title })
    // Claude Code's own counter runs a little ahead of the transcript: calls it never wrote down.
    records.push({
      type: 'cost-state', sessionId, startTime: startAt.getTime(), totalCostUSD: Math.round(cost * (1 + r.next() * 0.1) * 1e4) / 1e4,
      totalLinesAdded: added, totalLinesRemoved: removed, totalAPIDuration: msgs * 8_000, totalToolDuration: msgs * 3_500, totalDuration: t - startAt.getTime(), modelUsage: {},
    })
    const dir = path.join(projectsDir, slugOf(cwd))
    write(path.join(dir, `${sessionId}.jsonl`), `${records.map((x) => JSON.stringify(x)).join('\n')}\n`)
    for (const s of subagents) write(path.join(dir, sessionId, 'subagents', `${s.name}.jsonl`), `${s.records.map((x) => JSON.stringify(x)).join('\n')}\n`)
    if (opts.live) liveCandidates.push({ sessionId, cwd })
    return t
  }

  plan.forEach(({ w, d }) => {
    const day = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + d)
    const hour = r.pick([9, 9, 10, 10, 11, 13, 14, 14, 15, 16, 20])
    session(w, new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, r.int(0, 59), r.int(0, 59)), { live: false })
  })
  // Review rounds: a working day or three after the PR, when the comments have come in.
  for (const w of ordered) {
    const pr = w.story?.review ? opened.get(w.story.title) : undefined
    if (!pr) continue
    const at = new Date(pr.endedAt)
    let day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + r.int(1, 3), r.pick([10, 11, 14, 15]), r.int(0, 59))
    while (day.getDay() === 0 || day.getDay() === 6) day = new Date(day.getTime() + DAY)
    if (day.getTime() < now.getTime() - 60 * MIN) session({ ...w, review: true }, day, { live: false })
  }
  // Today: two sessions still going, the last thing they did a few minutes ago. Before nine in the
  // morning there is no "today" yet; the demo's most recent work is then from the evening before.
  const workStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).getTime()
  if (now.getTime() - workStart > 90 * MIN) {
    today.forEach((w, i) => session(w, new Date(Math.max(workStart, now.getTime() - (95 - i * 35) * MIN)), { live: true }))
  }

  // ---- the months before: prompt history only -------------------------------------------------------
  // Claude Code deletes terminal transcripts after 30 days; ~/.claude/history.jsonl keeps the
  // prompts. The year before the stories exists only there, sparse at first, as usage grew. Its own
  // random sequence, so the sessions above stay the same whatever is added here.
  const hr = rng(seed + 1)
  const historyId = () => {
    const h = () => Math.floor(hr.next() * 0x10000).toString(16).padStart(4, '0')
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
  }
  const history: Json[] = []
  EARLY.forEach((e, i) => {
    // Oldest first, over the eleven months before the stories begin.
    const back = span + 6 + Math.floor(((EARLY.length - 1 - i + hr.next() * 0.7) / EARLY.length) * 190)
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hr.pick([10, 11, 14, 15, 16, 21]), hr.int(0, 59))
    while (day.getDay() === 0 || day.getDay() === 6) day = new Date(day.getTime() + DAY)
    let at = day.getTime()
    const sessionId = historyId()
    for (const [tr, en] of e.prompts) {
      history.push({ display: L(tr, en), pastedContents: {}, timestamp: at, project: root(e.project), sessionId })
      at += hr.int(4, 28) * MIN
    }
  })
  write(path.join(claude, 'history.jsonl'), `${history.map((x) => JSON.stringify(x)).join('\n')}\n`)

  // ---- what lives around the transcripts ----------------------------------------------------------
  write(path.join(claude, 'CLAUDE.md'), L([
    '# Genel kurallar',
    '',
    '- Türkçe yanıt ver; kod, komut ve teknik terimler özgün haliyle kalsın.',
    '- Bir hatayı düzeltmeden önce onu yakalayan testi yaz ve kırmızı olduğunu gör.',
    '- Commit mesajları kısa ve emir kipinde olsun.',
    '- Gizli anahtarları asla dosyaya ya da loglara yazma.',
    '',
  ], [
    '# General rules',
    '',
    '- Be concise; keep code, commands and technical terms exactly as they are.',
    '- Before fixing a bug, write the test that catches it and watch it fail.',
    '- Keep commit messages short and in the imperative.',
    '- Never write secrets to files or logs.',
    '',
  ]).join('\n'))
  write(path.join(root('carsi-web'), 'CLAUDE.md'), plain(L(CLAUDE_MD_WEB, CLAUDE_MD_WEB_EN)))
  write(path.join(root('carsi-payments'), 'CLAUDE.md'), L(
    "# carsi-payments\n\n- Go 1.24, standart kütüphane öncelikli.\n- Para tutarları int64 kuruş.\n- Her migration geri alınabilir olmalı; index'ler CONCURRENTLY oluşturulur.\n- Testler: `go test ./...`, yarış denetimi için `go test -race ./internal/...`.\n",
    '# carsi-payments\n\n- Go 1.24, standard library first.\n- Money amounts are int64 kuruş.\n- Every migration must be reversible; indexes are created CONCURRENTLY.\n- Tests: `go test ./...`, and `go test -race ./internal/...` for the race detector.\n',
  ))

  const memDir = path.join(projectsDir, slugOf(root('carsi-web')), 'memory')
  const memory = L(
    [
      { file: 'para-birimi', title: 'Para birimi', hook: 'tutarlar kuruş cinsinden', type: 'project', description: 'Tutarlar her yerde kuruş cinsinden tam sayı', body: 'Fiyatlar kuruş cinsinden tutulur; ekrana formatPrice ile yazılır.' },
      { file: 'test-komutu', title: 'Test komutu', hook: 'testler Vitest ile', type: 'feedback', description: 'Testler npm run test ile çalışır; Jest değil Vitest', body: 'npx jest komutu yok; npm run test Vitest çalıştırır.' },
      { file: 'arayuz-tercihi', title: 'Arayüz tercihi', hook: 'sade, az renk', type: 'user', description: 'Arayüz sade, en fazla iki vurgu rengi', body: "Kalabalık arayüz istemiyor; yeni bileşenlerde mevcut token'ları kullan." },
    ],
    [
      { file: 'currency', title: 'Currency', hook: 'amounts are in kuruş', type: 'project', description: 'Amounts are whole numbers of kuruş everywhere', body: 'Prices are stored in kuruş and shown on screen with formatPrice.' },
      { file: 'test-command', title: 'Test command', hook: 'tests run on Vitest', type: 'feedback', description: 'Tests run with npm run test; Vitest, not Jest', body: 'There is no npx jest; npm run test runs Vitest.' },
      { file: 'ui-preference', title: 'UI preference', hook: 'plain, few colors', type: 'user', description: 'Plain interface, at most two accent colors', body: "Doesn't want a busy interface; use the existing tokens in new components." },
    ],
  )
  write(path.join(memDir, 'MEMORY.md'), memory.map((m) => `- [${m.title}](${m.file}.md) — ${m.hook}\n`).join(''))
  for (const m of memory) {
    write(path.join(memDir, `${m.file}.md`), `---\nname: ${m.file}\ndescription: ${m.description}\nmetadata:\n  type: ${m.type}\n---\n\n${m.body}\n`)
  }

  write(path.join(claude, 'skills', 'release-notes', 'SKILL.md'), L(
    "---\nname: release-notes\ndescription: Son sürümden bu yana birleşen PR'lardan müşteriye dönük sürüm notu yazar\n---\n\nPR başlıklarını grupla, iç düzenlemeleri dışarıda bırak.\n",
    '---\nname: release-notes\ndescription: Writes customer-facing release notes from the PRs merged since the last release\n---\n\nGroup PR titles and leave internal changes out.\n',
  ))
  write(path.join(claude, 'skills', 'sql-review', 'SKILL.md'), L(
    '---\nname: sql-review\ndescription: Migration ve sorguları index, kilit ve geri alınabilirlik açısından inceler\n---\n\nHer migration için geri alma adımını ve kilit süresini kontrol et.\n',
    '---\nname: sql-review\ndescription: Reviews migrations and queries for indexes, locks and reversibility\n---\n\nFor every migration, check the rollback step and how long it holds locks.\n',
  ))
  write(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'frontend-design@claude-plugins-official': [{ scope: 'user', version: '1.4.0', installedAt: new Date(now.getTime() - 90 * DAY).toISOString() }],
      'commit-commands@claude-plugins-official': [{ scope: 'user', version: '1.1.2', installedAt: new Date(now.getTime() - 60 * DAY).toISOString() }],
    },
  }, null, 2))
  write(path.join(claude, 'settings.json'), JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(npm run test:*)', 'Bash(go test:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Read', 'Grep', 'Glob'], deny: ['Bash(rm -rf:*)'], ask: ['Bash(git push:*)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write "$CLAUDE_FILE_PATHS"' }] }] },
    env: { CARSI_API_URL: 'https://api.example.com', DEMO_TOKEN: L('gösterilmez', 'never shown') },
    enabledPlugins: { 'frontend-design@claude-plugins-official': true, 'commit-commands@claude-plugins-official': false },
  }, null, 2))
  write(path.join(root('carsi-web'), '.mcp.json'), JSON.stringify({ mcpServers: { storybook: { command: 'npx', args: ['storybook-mcp'] } } }, null, 2))
  write(path.join(home, '.claude.json'), JSON.stringify({
    oauthAccount: { organizationRateLimitTier: 'default_claude_max_5x', organizationType: 'claude_max', emailAddress: 'demo@example.com' },
    cachedUsageUtilization: {
      fetchedAtMs: now.getTime() - 25 * MIN,
      utilization: {
        five_hour: { utilization: 34, resets_at: new Date(now.getTime() + 2.5 * 3_600_000).toISOString() },
        seven_day: { utilization: 52, resets_at: new Date(now.getTime() + 3 * DAY).toISOString() },
      },
    },
    mcpServers: {
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: L('gösterilmez', 'never shown') } },
      puppeteer: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    },
    skillUsage: { 'release-notes': { usageCount: 3 }, 'sql-review': { usageCount: 2 } },
    pluginUsage: { 'frontend-design@claude-plugins-official': { usageCount: 6 } },
    projects: Object.fromEntries(projects.map((p) => [root(p.name), { allowedTools: [] }])),
  }, null, 2))

  // The two sessions running right now, for the live panel.
  for (const [i, s] of liveCandidates.entries()) {
    write(path.join(claude, 'sessions', `${process.pid}${i ? `-${i}` : ''}.json`), JSON.stringify({
      pid: process.pid, sessionId: s.sessionId, cwd: s.cwd, status: i === 0 ? 'busy' : 'idle', updatedAt: new Date(now.getTime() - (i + 1) * 3 * MIN).toISOString(),
    }))
  }
}
