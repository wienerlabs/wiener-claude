// The status line that records usage-limit readings (bin/statusline.mjs). It is copied into this
// tool's own folder, so the command in Claude Code's settings keeps working when npx clears its
// cache, and stays as fast as plain node. Claude Code's settings are only read, never written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeDir, dataDir } from './paths.ts'

export const statusLineScript = (): string => path.join(dataDir(), 'statusline.mjs')

/** The command to put in Claude Code's statusLine setting, with the home folder as ~. */
export function statusLineCommand(): string {
  const file = path.resolve(statusLineScript())
  const home = os.homedir()
  return `node ${file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : JSON.stringify(file)}`
}

/** Puts the current script in place; quiet when the folder can't be written. */
export function installStatusLine(): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = [path.join(here, '../bin/statusline.mjs'), path.join(here, '../../bin/statusline.mjs')].find((f) => fs.existsSync(f))
  if (!source) return
  try {
    const text = fs.readFileSync(source, 'utf8')
    const target = statusLineScript()
    let current: string | null = null
    try {
      current = fs.readFileSync(target, 'utf8')
    } catch {
      // Not there yet.
    }
    if (current === text) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  } catch {
    // The dashboard works without it; the setup note says what to run.
  }
}

/** Whether Claude Code's settings already run this status line. Only that yes or no leaves here. */
export function statusLineConfigured(file = path.join(claudeDir(), 'settings.json')): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8')) as { statusLine?: { command?: unknown } }
    const command = settings.statusLine?.command
    return typeof command === 'string' && command.includes('statusline.mjs')
  } catch {
    return false
  }
}
