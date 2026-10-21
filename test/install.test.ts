import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

type Icon = { src: string; sizes: string }
type FetchEvent = { request: { mode: string }; respondWith: (answer: Promise<Response>) => void }

const publicFile = (name: string) => new URL(`../web/public/${name}`, import.meta.url)

function serviceWorker(fetch: () => Promise<Response>): (mode: string) => Promise<Response> | null {
  const handlers = new Map<string, (e: FetchEvent) => void>()
  const self = { addEventListener: (type: string, fn: (e: FetchEvent) => void) => handlers.set(type, fn) }
  vm.runInNewContext(fs.readFileSync(publicFile('sw.js'), 'utf8'), { self, fetch, Response })
  return (mode) => {
    let answer: Promise<Response> | null = null
    handlers.get('fetch')?.({ request: { mode }, respondWith: (a) => (answer = a) })
    return answer
  }
}

describe('installable app', () => {
  it('lists icons that exist at the sizes it claims', () => {
    const { icons } = JSON.parse(fs.readFileSync(publicFile('manifest.webmanifest'), 'utf8')) as { icons: Icon[] }
    const actual = icons.map(({ src }) => {
      const png = fs.readFileSync(publicFile(src.slice(1)))
      return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
    })
    expect(actual).toEqual(icons.map((i) => i.sizes))
    expect(actual).toEqual(expect.arrayContaining(['192x192', '512x512']))
  })

  it('shows the offline page only when the dashboard cannot be reached', async () => {
    let up = false
    const handle = serviceWorker(async () => {
      if (!up) throw new TypeError('Failed to fetch')
      return new Response('dashboard')
    })
    expect(handle('cors')).toBeNull()
    expect(await (await handle('navigate'))?.text()).toContain('npx wiener-tools-claude')
    up = true
    expect(await (await handle('navigate'))?.text()).toBe('dashboard')
  })
})
