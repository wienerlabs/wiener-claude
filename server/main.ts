import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdaptorServer } from '@hono/node-server'
import { type Lang, isLang, pick } from '../shared/i18n.ts'
import { PACKAGE } from '../shared/product.ts'
import { accountScopes } from './accounts.ts'
import { createApp } from './api.ts'
import { openDb } from './db.ts'
import { Indexer } from './indexer.ts'
import { coworkSessionsDir, dataDir, desktopSessionsDir, historyFile, liveSessionsDir, projectsDir, terminalLang } from './paths.ts'
import { Pricing } from './pricing.ts'
import { installStatusLine } from './statusline.ts'

const VERSION = '0.9.0'
const LANG = terminalLang()
const L = (tr: string, en: string) => pick(LANG, tr, en)

const HELP = L(
  `Wiener Lens ${VERSION}: Claude Code kullanımını yerelde gösterir.

Kullanım: ${PACKAGE} [seçenekler]

  --port <n>    Dinlenecek port (varsayılan 4747, doluysa bir sonraki)
  --host <h>    Bağlanılacak adres (varsayılan 127.0.0.1). 0.0.0.0 panelini yerel ağa açar.
  --lang <dil>  Panelin dili: tr ya da en (varsayılan tarayıcının dili)
  --no-open     Tarayıcıyı açma
  -h, --help    Bu yardımı göster
  -v, --version Sürümü göster

Ortam değişkenleri: CLAUDE_CONFIG_DIR, WIENER_DATA_DIR, WIENER_PORT, WIENER_LANG
`,
  `Wiener Lens ${VERSION}: your Claude Code usage, shown locally.

Usage: ${PACKAGE} [options]

  --port <n>    Port to listen on (default 4747, or the next free one)
  --host <h>    Address to bind (default 127.0.0.1). 0.0.0.0 opens the panel to your local network.
  --lang <lang> Panel language: tr or en (default: your browser's language)
  --no-open     Don't open the browser
  -h, --help    Show this help
  -v, --version Show the version

Environment variables: CLAUDE_CONFIG_DIR, WIENER_DATA_DIR, WIENER_PORT, WIENER_LANG
`,
)

function parseArgs(argv: string[]) {
  const opts: { port: number; host: string; open: boolean; lang: Lang | null } = { port: Number(process.env.WIENER_PORT ?? 4747), host: '127.0.0.1', open: true, lang: null }
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
    else if (a === '--lang') {
      const lang = argv[++i]
      if (!isLang(lang)) {
        process.stderr.write(L('--lang tr ya da en olmalı\n', '--lang must be tr or en\n'))
        process.exit(1)
      }
      opts.lang = lang
    } else if (a === '--no-open') opts.open = false
    else {
      process.stderr.write(`${L('Bilinmeyen seçenek', 'Unknown option')}: ${a}\n\n${HELP}`)
      process.exit(1)
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    process.stderr.write(L('--port 1 ile 65535 arasında bir sayı olmalı\n', '--port must be a number between 1 and 65535\n'))
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
  installStatusLine()
  const dbFile = path.join(dataDir(), 'index.db')
  const db = openDb(dbFile)
  const pricing = Pricing.load()
  const indexer = new Indexer(db, pricing, { projectsDir: projectsDir(), desktopDir: desktopSessionsDir(), coworkDir: coworkSessionsDir(), historyFile: historyFile() })
  const events = new EventEmitter()
  events.setMaxListeners(100)

  const lan = opts.host === '0.0.0.0' || opts.host === '::'
  const allowedHosts = lan ? null : new Set(['localhost', '127.0.0.1', '[::1]', opts.host])
  const app = createApp({ db, indexer, pricing, events, staticDir: findStaticDir(), allowedHosts, accountDb: accountScopes(db, dbFile) })

  let pageWaiting = false
  const server = createAdaptorServer({
    fetch: (req, env) => {
      pageWaiting = true
      return app.fetch(req, env)
    },
  })
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
  process.stdout.write(L(
    `\n  Wiener Lens  ${url}\n  Okunan klasör: ${projectsDir()}\n  Kendi verisi:  ${dataDir()}\n`,
    `\n  Wiener Lens  ${url}\n  Reading:   ${projectsDir()}\n  Own data:  ${dataDir()}\n`,
  ))
  if (lan) process.stdout.write(L('  Uyarı: panel yerel ağdaki herkese açık.\n', '  Warning: the panel is open to everyone on your local network.\n'))
  process.stdout.write('\n')

  let timer: NodeJS.Timeout | null = null
  const rescan = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      indexer.scan().then((changed) => changed && events.emit('update'), (err) => console.error(`${PACKAGE}: ${L('tarama hatası', 'scan failed')}`, err))
    }, 750)
  }
  const started = Date.now()
  indexer.scan().then(
    (changed) => {
      const files = (db.prepare('SELECT count(*) AS c FROM files').get() as { c: number }).c
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      process.stdout.write(L(`  İndeks hazır: ${files} dosya, ${secs} sn\n`, `  Index ready: ${files} ${files === 1 ? 'file' : 'files'}, ${secs}s\n`))
      if (changed) events.emit('update')
    },
    (err) => console.error(`${PACKAGE}: ${L('ilk tarama başarısız', 'first scan failed')}`, err),
  )
  watch(projectsDir(), rescan)
  watch(desktopSessionsDir(), rescan)
  watch(liveSessionsDir(), () => events.emit('live'))
  setInterval(rescan, 60_000).unref()

  if (opts.open) {
    setTimeout(() => {
      if (!pageWaiting) openBrowser(opts.lang ? `${url}/?lang=${opts.lang}` : url)
    }, 1500)
  }

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
