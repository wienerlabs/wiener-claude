import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { compactNumber, dayMonth, formatInt, formatUsd } from '../shared/i18n.ts'
import { createApp } from '../server/api.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import { buildTurns } from '../server/replay.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

describe('number and date formats', () => {
  it('writes counts, money and dates the way each language does', () => {
    expect(formatInt(1347, 'tr')).toBe('1.347')
    expect(formatInt(1347, 'en')).toBe('1,347')
    expect(compactNumber(12_345, 'tr')).toBe('12,3 bin')
    expect(compactNumber(72_800_000, 'en')).toBe('72.8M')
    expect(formatUsd(6.92, 'tr')).toBe('$6,92')
    expect(formatUsd(6.92, 'en')).toBe('$6.92')
    expect(formatUsd(1234, 'en')).toBe('$1,234')
    expect(dayMonth(14, 8, 'tr')).toBe('14 Eylül')
    expect(dayMonth(14, 8, 'en')).toBe('September 14')
  })
})

describe('API language', () => {
  async function app() {
    const fx = tempProjects()
    // A Desktop session outside any folder: the index stores its project as "Klasörsüz oturumlar".
    const cwd = '/Users/me/Library/scratch-workspaces/abc'
    fx.write('-Users-me-Library-scratch-workspaces-abc/s1.jsonl', jsonl([
      prompt('neden kırıldı?', { cwd }),
      reply('m1', text('Bakıyorum.'), {}, { cwd }),
    ]))
    const db = openDb(':memory:')
    const pricing = new Pricing()
    const indexer = new Indexer(db, pricing, { projectsDir: fx.root, desktopDir: null })
    await indexer.scan()
    return createApp({ db, pricing, indexer, events: new EventEmitter(), staticDir: null, allowedHosts: null })
  }

  it('answers errors in the language asked for, Turkish by default', async () => {
    const a = await app()
    expect(await (await a.request('/api/sessions/nope')).json()).toEqual({ error: 'Oturum bulunamadı' })
    expect(await (await a.request('/api/sessions/nope?lang=en')).json()).toEqual({ error: 'Session not found' })
    expect(await (await a.request('/api/day/yesterday?lang=en')).json()).toEqual({ error: 'Dates must be in YYYY-MM-DD format' })
  })

  it('swaps the labels the index stores in Turkish for English answers', async () => {
    const a = await app()
    const tr = await (await a.request('/api/sessions')).json() as { rows: { title: string; projectName: string }[] }
    const en = await (await a.request('/api/sessions?lang=en')).json() as { rows: { title: string; projectName: string }[] }
    expect(tr.rows[0]?.projectName).toBe('Klasörsüz oturumlar')
    expect(en.rows[0]?.projectName).toBe('Sessions without a folder')
    // The person's own words are left alone.
    expect(en.rows[0]?.title).toBe('neden kırıldı?')
  })

  it('writes replay notices in the language asked for', () => {
    const records = [prompt('hi'), { type: 'user', uuid: 'x', sessionId: 's1', timestamp: '2026-10-01T10:00:10.000Z', message: { role: 'user', content: '[Request interrupted by user]' } }]
    const notice = (lang: 'tr' | 'en') => buildTurns(records, new Pricing(), lang)[0]?.items.find((i) => i.type === 'notice')
    expect(notice('tr')).toMatchObject({ text: 'Kullanıcı yanıtı yarıda kesti.' })
    expect(notice('en')).toMatchObject({ text: 'You interrupted the response.' })
  })
})
