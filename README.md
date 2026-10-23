<div align="center">

<img src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/web/public/favicon.svg" width="52" height="52" alt="" />

# Wiener Lens

A local dashboard for your Claude Code usage: heatmaps, session transcripts,<br />
cost and limits, tool usage and evidence-based tips.

[![npm](https://img.shields.io/npm/v/wiener-tools-lens?color=1c5cab&label=npm)](https://www.npmjs.com/package/wiener-tools-lens)
[![License: MIT](https://img.shields.io/badge/license-MIT-1c5cab)](LICENSE)
[![Node.js 22.13+](https://img.shields.io/badge/node-%E2%89%A5%2022.13-1c5cab)](https://nodejs.org)

**[Live demo](https://lens.wienerlabs.xyz/?lang=en)** · [Install](#install) · [Features](#features) · [Privacy](#privacy-and-security)

</div>

```bash
npx wiener-tools-lens
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/overview-dark.png" />
  <img alt="Overview: a year of activity on a calendar, today at a glance and the period table" src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/overview-light.png" />
</picture>

Claude Code writes every session to the `~/.claude` folder on your computer. Wiener Lens reads those files and turns them into a dashboard that opens in your browser: how much you work, where the money goes, which tools Claude uses and where it gets stuck. No account, no API key, no cloud: your data never leaves your machine.

- **Accurate numbers.** Claude Code writes one response across several lines; each response is counted once. Prices are checked against Claude Code's own `costUSD` values.
- **Evidence-based advice.** Every tip shows the sessions it is based on, the estimated saving and, where it helps, a `CLAUDE.md` line you can copy.
- **Fully local.** By default the server listens only on `127.0.0.1`, never writes to `~/.claude` and never shows secret values.
- **English and Turkish.** The interface opens in your browser's language, and the TR/EN switch in the menu changes it at any time. The live demo has an English data set too.

Wiener Lens is made by [Wiener Labs](https://wienerlabs.xyz), the team behind [Wiener Tools](https://tools.wienerlabs.xyz).

## Features

### Overview

A one-year calendar, plus day × hour and project × day heatmaps, by messages, tokens, cost, sessions or errors. Click a day on the calendar to open that day's sessions. The "This week, last 30 days, all time" table puts messages, token types and cost side by side, and the "What happened this week" card sums up the week in a few sentences.

### Sessions and search

<img alt="Session transcript: every step from the Linear issue to the failing test, the fix and the summary" src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/session.png" />

A turn-by-turn transcript of every session: prompts, replies, tool calls and their results, errors and compactions. Full-text search covers every prompt, reply and shell command, and it also finds Turkish words typed without Turkish characters ("degisiklik" finds "değişiklik"). Clicking a result opens the transcript at that message. The session page compares Claude Code's own cost counter with the transcript and shows the difference separately.

Claude Code deletes terminal transcripts after 30 days without changes (`cleanupPeriodDays`). The dashboard still shows those sessions: the prompts you wrote come from `~/.claude/history.jsonl`, the session is marked "prompt history only", and it has no replies, tool calls or cost. Cowork sessions are listed too, with their titles and accounts.

### Tips

<img alt="Tips: the cache rewritten after a break and context bloat, with the sessions behind them" src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/tips.png" />

Suggestions drawn from your transcripts with local rules, sorted by estimated saving:

| Tip | What it looks at |
| --- | --- |
| Context bloat | The share of cost from calls made with more than 200k tokens of context |
| Cache rewritten after breaks | The whole conversation written to the cache again after a break |
| Long `CLAUDE.md` | The cost of the instruction file read with every request |
| Model choice | What a smaller model would save on light work and subagents |
| Fast mode premium | The extra amount fast mode cost |
| Repeated errors from the environment | Recurring errors that come from the machine, such as missing programs or zsh differences |
| Frequent interrupts | How often Claude was stopped, and plan mode use |
| Prompts you keep retyping | Requests typed again and again that could be slash commands |
| Denied tool calls | Commands you denied or auto mode blocked |
| Unused MCP servers | Servers that are configured but never called |

### Tools

<img alt="Tools: call counts, failure rates, the split by kind and MCP servers" src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/tools.png" />

Which tools Claude uses and how often, and how many of those calls fail; the split by kind; MCP servers, skills and subagents and their share of cost; slash commands; how many sessions use features such as plan mode and compaction; Claude Code versions.

### Cost

The cost of the selected period and the change from the previous one, a month-end projection, a monthly budget and the day you would pass it at this pace, a daily or weekly cost chart, how the money splits across token types and models, and cache savings.

### Limits

How full the 5-hour and weekly limits are, when each fills at your recent pace or where it stands when it resets, and about how much work at list price still fits; open sessions with roughly how many prompts like their recent ones they have left; the current 5-hour window and the last 7 days from local records; and the times you hit a limit.

Anthropic reports the 5-hour and weekly limits as percentages, not tokens. Wiener Lens reads those percentages where they are saved on your computer: the Claude desktop app keeps a reading every so often while it runs, and Claude Code keeps an occasional one in `~/.claude.json`. Comparing how the percentage rose between two readings with the list price of the calls made in between, it learns how far a dollar of work moves each limit on your plan, and carries the last reading forward with what you have spent since. Percentages carried forward this way are marked "estimated". No setup is needed if you use the desktop app. Usage in claude.ai chats counts toward the same limits but isn't in local records, so the estimate can run low if you chat a lot.

If you only use Claude Code in the terminal, readings come from its status line instead, after every response. Wiener Lens ships one that records them in its own folder; add it to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node ~/.wiener-tools/claude/statusline.mjs" }
```

If you already have a status line, keep it: `node ~/.wiener-tools/claude/statusline.mjs -- <your command>` records the reading and shows your output.

### Projects

Each project's activity, main language, cost over time, split by branch and language, most changed files, opened PRs, and the tools, models, subagents and MCP servers it used. Worktrees count toward their own repository.

### Environment

What Claude Code remembers (memory), the instructions it follows (`CLAUDE.md`), unfinished tasks, plans put up for approval, skills, plugins, MCP servers and settings.

### Year in review

<img alt="Year in review card: messages, active days, tokens, cost, a year heatmap and the most worked-on projects" src="https://raw.githubusercontent.com/wienerlabs/wiener-lens/main/docs/images/year-card.png" width="640" />

A year's messages, active days, tokens, longest streak, most worked-on projects and most used tools on one card. The card downloads as a PNG, and project names and cost can be hidden. The image is made in your browser.

### More than one account

If you use more than one Claude account in the desktop app, an account picker appears at the bottom of the left menu. Pick an account and every screen shows only that account's sessions, cost and 5-hour window; the choice is remembered in your browser. The measured limit percentages on the Cost screen come from the last reading the desktop app saved for that account. The memory, instruction and settings files on the Environment screen are shared by all accounts, so they stay the same. Which account a session belongs to is read from the desktop app's account folders. Sessions with no record there, including Claude Code sessions in the terminal, are grouped under "Unknown account", so the accounts always add up to all of your data. Accounts are named after a shortened form of the e-mail address seen in `~/.claude.json` (`ada…@gmail.com`); an account whose e-mail hasn't been seen yet is shown by its order, such as "Account 2".

Most screens have "This week", "Last 30 days" and "All time" filters, and the choice stays in the address. The dashboard updates itself as files change and lists the sessions running right now separately.

## Install

Requires Node.js 22.13 or later (for the built-in SQLite). Run it on the computer where you use Claude Code:

```bash
npx wiener-tools-lens
```

The dashboard opens in your browser on its own. The first indexing takes from a few seconds to half a minute, depending on how much history you have; later starts read only the new records. Press Ctrl+C in the terminal to stop it.

Up to 0.7.0 the package was called `wiener-tools-claude`. The new one reads the same index (`~/.wiener-tools/claude`), so nothing is lost when you switch.

**Use it as an app.** The dashboard can also open in its own window with its own icon, without the address bar. In Chrome, Edge or Brave, press **Install as app** at the bottom of the menu; in Safari, use **Add to Dock** in the File menu. The app still connects to the server on this computer: if you open it while the server is off, a page shows how to start it, and once `npx wiener-tools-lens` is running the window switches to the dashboard on its own. If a dashboard window is already open, the command doesn't open another tab. The app is tied to the port it was installed from (4747 by default); if the dashboard opens on another port (because that port was taken or you passed `--port`), the app won't see it.

| Option | Default | Description |
| --- | --- | --- |
| `--port <n>` | `4747` | Port to listen on; if it is taken, the next one is tried |
| `--host <h>` | `127.0.0.1` | `0.0.0.0` opens the dashboard to your local network |
| `--lang <lang>` | your browser's language | Dashboard language: `tr` or `en` |
| `--no-open` | | Don't open the browser |
| `-v`, `--version` | | Show the version |

| Environment variable | Description |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Another Claude profile: `CLAUDE_CONFIG_DIR=~/.claude-work npx wiener-tools-lens` |
| `WIENER_DATA_DIR` | Folder for the index and settings (default `~/.wiener-tools/claude`) |
| `WIENER_PORT` | Default port |
| `WIENER_LANG` | Language of the terminal output (`tr` or `en`); the system language if unset |

You can override the price table with `~/.wiener-tools/claude/pricing.json` (dollars per MTok):

```json
{ "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 } }
```

## Privacy and security

- **Your data stays on your machine.** The dashboard sends no requests to any outside address; all analysis is done with local rules.
- **Read only.** Nothing is written to `~/.claude`. The dashboard keeps its own index in `~/.wiener-tools/claude/index.db` and the budget setting in `settings.json`; if the index is deleted, it is rebuilt from the transcripts. Claude Code deletes old transcripts after a while; the indexed numbers stay.
- **Closed to your local network.** By default the server listens on `127.0.0.1` and checks the `Host` header, which blocks access through DNS rebinding. The only write (the budget) requires a JSON body and checks the `Origin` header.
- **Secret values are never shown.** MCP server environment variables, headers and arguments, environment variable values in settings and hook arguments are never shown. Names are not read from `~/.claude.json`. The account id and e-mail address are read only to tell accounts apart; only a shortened form of the e-mail (`ada…@gmail.com`) is stored and shown.
- **Limited file access.** File contents are served only for the memory and `CLAUDE.md` files the server lists itself; a request carries an id from that list, not a path.
- **Error text is trimmed.** Only the first 400 characters of a failed tool result are kept in the local index, to tell setup errors from test failures.

<details>
<summary>What is read from where</summary>

| Source | What for |
| --- | --- |
| `~/.claude/projects/<project>/<session>.jsonl` | Messages, token usage, tool calls, titles, PR links |
| `~/.claude/projects/<project>/<session>/subagents/**` | Subagent transcripts; their cost is added to the main session |
| `~/Library/Application Support/Claude/claude-code-sessions` | Desktop session titles, branches, worktrees and which account each belongs to |
| `~/Library/Application Support/Claude/local-agent-mode-sessions` | Cowork session transcripts, titles and which account each belongs to |
| `~/Library/Application Support/Claude/plan-usage-history.json` | 5-hour and weekly limit percentages saved by the desktop app; shown as the selected account's reading |
| `~/.claude/history.jsonl` | Prompts of terminal sessions whose transcript was deleted: time, project and text |
| `~/.claude/sessions/*.json` | Claude Code processes running right now |
| `~/.claude.json` | Plan name, the last limit reading, skill and plugin usage counts, MCP server names and types |
| `~/.claude.json`, `~/.claude.json.backup` | Account id and the shortened e-mail for the account picker |
| `~/.claude/projects/<project>/memory/*.md` | Memory files |
| `~/.claude/CLAUDE.md`, `<project>/CLAUDE.md` | Instructions |
| `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` | Settings and installed plugins |

The desktop session folder path is verified only on macOS; the Windows and Linux paths follow Electron's defaults.

</details>

## How the numbers are computed

- **Duplicates are removed.** Claude Code writes a single API response on separate lines, one per content block, and later lines can carry larger token counts. Each response is counted once by `message.id`, with its largest values. History copied into forked or resumed sessions is also counted once.
- **Cost is at list price.** The price table lives in `server/pricing.ts`. 1-hour cache writes count as 2 times the input price, 5-minute ones as 1.25 times.
- **Cost not visible in transcripts.** Claude Code's own counter also counts calls that are not written to transcripts. Because the counter keeps only the last process run, it can't serve as a session total; the difference is shown separately on the session page.
- **Active time** is the sum of activity with no gap longer than 10 minutes.
- **Changed lines** are counted from the patches in Edit and Write results and from the diffs kept for shell commands. Files touched by git operations and Claude Code's temporary folders are not counted.
- **Limits.** Usage percentages are not kept locally; the last reading Claude Code saved with `/usage` is shown only while it is recent. The times you hit a limit are read from the transcripts, and the "current 5-hour window" is estimated from local requests.
- **Estimates in tips** use list prices and can overlap, so don't add them up.

## Live demo

[lens.wienerlabs.xyz](https://lens.wienerlabs.xyz/?lang=en) shows the dashboard itself with made-up data. The dashboard reads the `~/.claude` folder of the computer it runs on, so it can't run on a server as is; the demo is a static site instead:

1. `scripts/demo/generate.ts` creates transcripts spread over the last six months for six made-up projects, plus memory, skill, MCP and settings files. It runs with a fixed seed and reads nothing from a real machine.
2. `scripts/demo/build.ts` indexes this fake home folder with the real server code and writes every API response the interface can ask for as a static file. The build stops if a path from the build machine is left in the output.
3. The interface is built with `--mode demo`. It reads these files instead of the API, and does paging and title search in the browser.

```bash
npm run build:demo                              # dist/demo-site
npx vite preview --outDir ../dist/demo-site
```

The site is published on Vercel; the settings are in `vercel.json`. The demo data is generated for the moment of the build, and `.github/workflows/demo-refresh.yml` rebuilds it every two hours during working hours when the `VERCEL_DEPLOY_HOOK` secret is set. For screenshots the clock can be pinned: `DEMO_NOW=2026-10-21T16:20:00+03:00 npm run build:demo`.

## Development

```bash
git clone https://github.com/wienerlabs/wiener-lens.git
cd wiener-lens
npm install          # also builds the interface and the server
npm run dev          # API :4747, interface http://localhost:5747
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the server in watch mode and the interface with Vite |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Builds the interface into `dist/web` and the server into `dist/server` |
| `npm run build:demo` | Builds the live demo into `dist/demo-site` |
| `npm start` | Runs the built dashboard |

```
server/    Hono server, JSONL parser, incremental indexer (node:sqlite + FTS5), reports
web/       React 19 + Tailwind v4 interface
shared/    Types and helpers shared by the server and the interface
scripts/   The live demo's data generator and builder
test/      Vitest tests and synthetic transcript records
```

## Releases

| Version | What's in it |
| --- | --- |
| 0.6 | Tips |
| 0.5 | Tools, project trends (branches, languages, cost), year in review card |
| 0.4 | Period filter, period summary |
| 0.3 | Environment (memory, instructions, tasks, plans, skills, plugins, MCP, settings), budget, insights |
| 0.2 | Cost and limits, projects, full-text search |
| 0.1 | Indexer, overview, sessions |

## License

MIT © 2026 Wiener Labs. See [LICENSE](LICENSE) for details.
