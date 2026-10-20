import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/types.ts'
import { dataDir } from './paths.ts'

// Kept apart from the index: the index is dropped and rebuilt whenever its format changes.
const file = () => path.join(dataDir(), 'settings.json')

const DEFAULTS: Settings = { monthlyBudget: null }

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>
    return { monthlyBudget: validBudget(raw.monthlyBudget) }
  } catch {
    return { ...DEFAULTS }
  }
}

function validBudget(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7 ? Math.round(v * 100) / 100 : null
}

export class SettingsError extends Error {}

/** Applies a partial update; anything other than known keys with valid values is refused. */
export function updateSettings(patch: unknown): Settings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('Ayarlar bir nesne olmalı')
  const p = patch as Record<string, unknown>
  const next = readSettings()
  for (const key of Object.keys(p)) {
    if (key !== 'monthlyBudget') throw new SettingsError(`Bilinmeyen ayar: ${key}`)
  }
  if ('monthlyBudget' in p) {
    if (p.monthlyBudget === null) next.monthlyBudget = null
    else {
      const budget = validBudget(p.monthlyBudget)
      if (budget === null) throw new SettingsError('Bütçe 0 ile 10.000.000 arasında bir sayı olmalı')
      next.monthlyBudget = budget
    }
  }
  fs.mkdirSync(dataDir(), { recursive: true })
  // Write then rename, so a crash never leaves a half-written file.
  const tmp = `${file()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
  fs.renameSync(tmp, file())
  return next
}
