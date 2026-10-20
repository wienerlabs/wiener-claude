import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdaptorServer } from '@hono/node-server'
import { createApp } from './api.ts'
import { openDb } from './db.ts'
import { Indexer } from './indexer.ts'
import { dataDir, desktopSessionsDir, liveSessionsDir, projectsDir } from './paths.ts'
import { Pricing } from './pricing.ts'

const VERSION = '0.3.0'
const HELP = `Wiener Tools for Claude Code ${VERSION}: Claude Code kullanımını yerelde gösterir.

Kullanım: wiener-tools-claude [seçenekler]

  --port <n>    Dinlenecek port (varsayılan 4747, doluysa bir sonraki)
  --host <h>    Bağlanılacak adres (varsayılan 127.0.0.1). 0.0.0.0 panelini yerel ağa açar.
  --no-open     Tarayıcıyı açma
  -h, --help    Bu yardımı göster
  -v, --version Sürümü göster

Ortam değişkenleri: CLAUDE_CONFIG_DIR, WIENER_DATA_DIR, WIENER_PORT
`

function parseArgs(argv: string[]) {
  const opts = { port: Number(process.env.WIENER_PORT ?? 4747), host: '127.0.0.1', open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else if (a === '-v' || a === '--version') {
      process.stdout.write(`${VERSION}\n`)
      process.exit(0)
    } else if (a === '--port') opts.port = Number(argv[++i])
    else if (a === '--host') opts.host = String(argv[++i])
    else if (a === '--no-open') opts.open = false
    else {
      process.stderr.write(`Bilinmeyen seçenek: ${a}\n\n${HELP}`)
      process.exit(1)
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    process.stderr.write('--port 1 ile 65535 arasında bir sayı olmalı\n')
    process.exit(1)
  }
  return opts
}

/** The built UI next to the bundled server (dist/web), when there is one. */
function findStaticDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const dir of [path.join(here, '../web'), path.join(here, '../dist/web')]) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir
  }
  return null
}

function watch(dir: string | null, onChange: () => void): void {
  if (!dir || !fs.existsSync(dir)) return
  try {
    fs.watch(dir, { recursive: true }, onChange).on('error', () => {})
  } catch {
    // Recursive watching is unavailable here; the periodic scan still runs.
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const db = openDb(path.join(dataDir(), 'index.db'))
  const pricing = Pricing.load()
  const indexer = new Indexer(db, pricing, { projectsDir: projectsDir(), desktopDir: desktopSessionsDir() })
  const events = new EventEmitter()
  events.setMaxListeners(100)

  const lan = opts.host === '0.0.0.0' || opts.host === '::'
  const allowedHosts = lan ? null : new Set(['localhost', '127.0.0.1', '[::1]', opts.host])
  const app = createApp({ db, indexer, pricing, events, staticDir: findStaticDir(), allowedHosts })

  const server = createAdaptorServer({ fetch: app.fetch })
  const port = await new Promise<number>((resolve, reject) => {
    let attempt = opts.port
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempt < opts.port + 20) server.listen(++attempt, opts.host)
      else reject(err)
    })
    server.on('listening', () => resolve(attempt))
    server.listen(attempt, opts.host)
  })

  const url = `http://${lan ? 'localhost' : opts.host === '127.0.0.1' ? 'localhost' : opts.host}:${port}`
  process.stdout.write(`\n  Wiener Tools for Claude Code  ${url}\n  Okunan klasör: ${projectsDir()}\n  Kendi verisi:  ${dataDir()}\n`)
  if (lan) process.stdout.write('  Uyarı: panel yerel ağdaki herkese açık.\n')
  process.stdout.write('\n')

  let timer: NodeJS.Timeout | null = null
  const rescan = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      indexer.scan().then((changed) => changed && events.emit('update'), (err) => console.error('wiener-tools-claude: tarama hatası', err))
    }, 750)
  }
  const started = Date.now()
  indexer.scan().then(
    (changed) => {
      const files = (db.prepare('SELECT count(*) AS c FROM files').get() as { c: number }).c
      process.stdout.write(`  İndeks hazır: ${files} dosya, ${((Date.now() - started) / 1000).toFixed(1)} sn\n`)
      if (changed) events.emit('update')
    },
    (err) => console.error('wiener-tools-claude: ilk tarama başarısız', err),
  )
  watch(projectsDir(), rescan)
  watch(desktopSessionsDir(), rescan)
  watch(liveSessionsDir(), () => events.emit('live'))
  setInterval(rescan, 60_000).unref()

  if (opts.open) openBrowser(url)

  const shutdown = () => {
    server.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
