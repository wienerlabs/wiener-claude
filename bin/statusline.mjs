#!/usr/bin/env node
// Wiener Lens status line. Claude Code runs it after each response and passes the session's data
// on stdin, including how full the 5-hour and weekly usage limits are. The reading is appended to
// Wiener Lens's own folder, where the dashboard turns it into a forecast; nothing leaves the
// computer and nothing is written to ~/.claude.
//
//   "statusLine": { "type": "command", "command": "node ~/.wiener-tools/claude/statusline.mjs" }
//
// With your own status line, put it after "--": node …/statusline.mjs -- <your command>. It gets
// the same input and its output is shown instead of this one's.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = process.env.WIENER_DATA_DIR || path.join(os.homedir(), '.wiener-tools', 'claude')
const raw = fs.readFileSync(0, 'utf8')
let data = null
try {
  data = JSON.parse(raw)
} catch {
  // Not JSON: nothing to record.
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fiveHour = data?.rate_limits?.five_hour ?? null
const sevenDay = data?.rate_limits?.seven_day ?? null

if (fiveHour || sevenDay) {
  const sample = {
    t: Date.now(),
    s: typeof data.session_id === 'string' ? data.session_id : null,
    fh: num(fiveHour?.used_percentage),
    fr: num(fiveHour?.resets_at),
    sd: num(sevenDay?.used_percentage),
    sr: num(sevenDay?.resets_at),
    c: num(data.cost?.total_cost_usd),
  }
  // Only when something moved since the last line, so an idle prompt adds nothing.
  const lastFile = path.join(dir, 'limits-last.json')
  let last = null
  try {
    last = JSON.parse(fs.readFileSync(lastFile, 'utf8'))
  } catch {
    // First reading.
  }
  const same = last && ['s', 'fh', 'fr', 'sd', 'sr', 'c'].every((k) => last[k] === sample[k])
  if (!same) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'limits.jsonl'), `${JSON.stringify(sample)}\n`)
      fs.writeFileSync(lastFile, JSON.stringify(sample))
    } catch {
      // A status line must never fail the prompt.
    }
  }
}

const split = process.argv.indexOf('--')
if (split !== -1 && process.argv.length > split + 1) {
  const own = spawnSync(process.argv.slice(split + 1).join(' '), { input: raw, shell: true, encoding: 'utf8' })
  process.stdout.write(own.stdout ?? '')
} else if (fiveHour || sevenDay) {
  const locale = process.env.WIENER_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  const tr = locale.toLowerCase().startsWith('tr')
  const pct = (v) => (tr ? `%${Math.round(v)}` : `${Math.round(v)}%`)
  const clock = (s) => new Date(s * 1000).toTimeString().slice(0, 5)
  const parts = []
  if (num(fiveHour?.used_percentage) !== null) {
    const reset = num(fiveHour.resets_at) ? (tr ? `, sıfırlanma ${clock(fiveHour.resets_at)}` : `, resets ${clock(fiveHour.resets_at)}`) : ''
    parts.push(`${tr ? '5 saat' : '5h'} ${pct(fiveHour.used_percentage)}${reset}`)
  }
  if (num(sevenDay?.used_percentage) !== null) parts.push(`${tr ? 'hafta' : 'week'} ${pct(sevenDay.used_percentage)}`)
  process.stdout.write(parts.join(' · '))
}
