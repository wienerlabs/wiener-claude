// Writes a made-up home folder for the public demo: Claude Code transcripts for six invented
// projects over the last six months, plus the settings, memory, skills and MCP config around them.
// Nothing here comes from a real machine. A fixed seed makes every build produce the same data.
import fs from 'node:fs'
import path from 'node:path'
import { Pricing } from '../../server/pricing.ts'

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
    weighted: <T>(xs: readonly (readonly [T, number])[]): T => {
      const total = xs.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [x, w] of xs) if ((r -= w) <= 0) return x
      return (xs.at(-1) as readonly [T, number])[0]
    },
  }
}

interface Project {
  name: string
  repo: string
  weight: number
  files: string[]
  bash: string[]
  failing: string[]
  prompts: string[]
  titles: string[]
  branches: string[]
}

const PROJECTS: Project[] = [
  {
    name: 'acme-web', repo: 'acme/acme-web', weight: 30,
    files: ['src/app/(shop)/cart/page.tsx', 'src/app/(shop)/checkout/page.tsx', 'src/components/CartSummary.tsx', 'src/components/ProductCard.tsx', 'src/lib/pricing.ts', 'src/lib/cart.ts', 'src/lib/i18n.ts', 'src/app/api/orders/route.ts', 'src/styles/globals.css', 'tests/cart.test.ts', 'tests/pricing.test.ts', 'next.config.ts', 'package.json', 'README.md'],
    bash: ['npm run test', 'npm run lint', 'npm run build', 'npm run typecheck', 'git status', 'git diff --stat', 'npx playwright test checkout'],
    failing: ['npm run test', 'npm run typecheck', 'npx playwright test checkout'],
    prompts: [
      'Sepette indirim kuponu uygulanınca toplam yanlış yuvarlanıyor, sebebini bul ve düzelt',
      'Ödeme sayfasına adres doğrulaması ekle, hatalar alanların altında görünsün',
      'Ürün kartlarında görsel yüklenirken layout kayıyor, iskelet ekleyelim',
      'Sipariş API ucuna rate limit koy, dakikada 30 istek',
      'Checkout akışı için Playwright testi yaz: misafir kullanıcı, kuponlu sepet',
      'Fiyatları her yerde aynı biçimde göstermek için tek bir formatter yaz ve kullan',
      'Mobilde sepet çekmecesi kapanmıyor, dokunma alanını incele',
      'Arama sonuçlarını sunucu tarafında sayfalayalım, sonsuz kaydırma kalsın',
      'Ürün sayfasının LCP değeri 4 saniye, hızlandır',
      'Next.js 16 sürümüne geçişte kırılanları listele ve düzelt',
    ],
    titles: ['Kupon yuvarlama hatası', 'Adres doğrulaması', 'Ürün kartı iskeleti', 'Sipariş rate limit', 'Checkout e2e testi', 'Fiyat biçimlendirme', 'Mobil sepet çekmecesi', 'Sunucu tarafı sayfalama', 'Ürün sayfası performansı', 'Next.js 16 geçişi'],
    branches: ['main', 'feat/checkout-v2', 'fix/coupon-rounding', 'perf/product-lcp'],
  },
  {
    name: 'payments-api', repo: 'acme/payments-api', weight: 22,
    files: ['internal/refund/service.go', 'internal/refund/service_test.go', 'internal/ledger/ledger.go', 'internal/http/handlers.go', 'internal/webhooks/stripe.go', 'migrations/0042_refund_status.sql', 'cmd/api/main.go', 'go.mod', 'docs/refunds.md'],
    bash: ['go test ./...', 'go build ./...', 'go vet ./...', 'golangci-lint run', 'git status', 'make migrate', 'docker compose up -d db'],
    failing: ['go test ./...', 'golangci-lint run'],
    prompts: [
      'İade akışında aynı iade iki kez işlenebiliyor, yarış durumunu bul',
      'Stripe webhook imza doğrulamasını ekle ve test et',
      'Ledger kayıtları için idempotency anahtarı ekleyelim',
      'Refund status sütunu için migration yaz, geri alınabilir olsun',
      'Handler katmanındaki hata mesajlarını tek biçime getir',
      'Kısmi iade desteği ekle, toplam iade tutarı ödemeyi aşamasın',
      'Yavaş sorguları bul, ledger tablosuna index öner',
      'Para tutarlarını float yerine kuruş cinsinden int tut',
    ],
    titles: ['İade yarış durumu', 'Webhook imza doğrulaması', 'Ledger idempotency', 'Refund migration', 'Hata mesajı biçimi', 'Kısmi iade', 'Ledger indeksleri', 'Kuruş cinsinden tutarlar'],
    branches: ['main', 'fix/refund-race', 'feat/partial-refunds'],
  },
  {
    name: 'mobile-app', repo: 'acme/mobile-app', weight: 18,
    files: ['app/(tabs)/index.tsx', 'app/(tabs)/orders.tsx', 'app/product/[id].tsx', 'components/OrderRow.tsx', 'hooks/useCart.ts', 'lib/api.ts', 'app.json', 'package.json'],
    bash: ['npx expo start --clear', 'npm run test', 'npx tsc --noEmit', 'npx expo-doctor', 'git status'],
    failing: ['npx tsc --noEmit', 'npm run test'],
    prompts: [
      'Sipariş listesinde çekip yenileme ekle',
      'Ürün detayında görsel galeriyi kaydırılabilir yap',
      'Android geri tuşu sepetten çıkınca uygulamayı kapatıyor, düzelt',
      'Push bildirim izni ilk açılışta değil sipariş sonrası istensin',
      'Karanlık tema renklerini tasarım token larına bağla',
      'API katmanına yeniden deneme ve zaman aşımı ekle',
    ],
    titles: ['Çekip yenileme', 'Görsel galerisi', 'Android geri tuşu', 'Bildirim izni zamanı', 'Karanlık tema', 'API yeniden deneme'],
    branches: ['main', 'feat/order-refresh'],
  },
  {
    name: 'data-pipeline', repo: 'acme/data-pipeline', weight: 15,
    files: ['pipelines/orders_daily.py', 'pipelines/refunds.py', 'models/marts/fct_orders.sql', 'models/staging/stg_payments.sql', 'tests/test_orders_daily.py', 'dags/orders.py', 'pyproject.toml'],
    bash: ['pytest -q', 'dbt run --select fct_orders', 'dbt test', 'ruff check .', 'python -m pipelines.orders_daily --date 2026-10-01'],
    failing: ['pytest -q', 'dbt test'],
    prompts: [
      'Günlük sipariş raporunda iadeler düşülmüyor, modeli düzelt',
      'stg_payments modeline para birimi dönüşümü ekle',
      'Airflow DAG ı geç gelen verileri yeniden işlesin',
      'fct_orders için dbt testleri yaz: tekillik ve null kontrolü',
      'Pipeline çalışma süresini yarıya indirelim, darboğazı bul',
    ],
    titles: ['İadeleri rapordan düş', 'Para birimi dönüşümü', 'Geç gelen veri', 'dbt testleri', 'Pipeline hızlandırma'],
    branches: ['main', 'fix/refund-netting'],
  },
  {
    name: 'infra', repo: 'acme/infra', weight: 8,
    files: ['terraform/modules/api/main.tf', 'terraform/envs/prod/main.tf', 'terraform/envs/staging/main.tf', 'k8s/api/deployment.yaml', '.github/workflows/deploy.yml'],
    bash: ['terraform plan', 'terraform fmt -recursive', 'kubectl get pods -n api', 'gh workflow run deploy.yml'],
    failing: ['terraform plan'],
    prompts: [
      'Staging ortamına ayrı bir veritabanı ekle, prod ayarlarını kopyalama',
      'Deploy workflow una manuel onay adımı ekle',
      'API podları bellek yüzünden yeniden başlıyor, limitleri gözden geçir',
    ],
    titles: ['Staging veritabanı', 'Deploy onayı', 'Pod bellek limitleri'],
    branches: ['main'],
  },
  {
    name: 'docs-site', repo: 'acme/docs-site', weight: 7,
    files: ['docs/getting-started.mdx', 'docs/api/refunds.mdx', 'docs/api/orders.mdx', 'docusaurus.config.ts', 'sidebars.ts'],
    bash: ['npm run build', 'npm run start', 'git status'],
    failing: ['npm run build'],
    prompts: [
      'İade API dokümanını yeni kısmi iade alanlarıyla güncelle',
      'Başlangıç rehberine curl örnekleri ekle',
      'Kırık iç linkleri bul ve düzelt',
    ],
    titles: ['İade API dokümanı', 'curl örnekleri', 'Kırık linkler'],
    branches: ['main'],
  },
]

/** Asked again and again across sessions, so the İpuçları page has something to say. */
const ROUTINE = ['Testleri çalıştır, kırmızı olanları düzelt ve sonunda kısa bir özet geç', "Değişiklikleri commit'le ve PR aç, açıklamaya test planını yaz"]
const FOLLOW_UPS = ['devam et', 'evet, öyle yap', 'olmadı, hata hâlâ var', 'şunu da ekle: boş durum mesajı', 'bunu daha sade yaz', 'test ekle', 'güzel, devam', 'neden bu yolu seçtin?']
const REPLIES = [
  'Sebebi buldum: toplam, indirim uygulanmadan önce yuvarlanıyormuş. Yuvarlamayı en sona aldım ve bir test ekledim.',
  'Değişiklik hazır. Mevcut testlerin hepsi geçiyor; yeni durum için iki test ekledim.',
  'Burada iki yol var: ya sunucuda doğrularız ya da istemcide. Sunucu tarafı daha güvenli, onu uyguladım.',
  'İlgili dosyaları okudum. Sorun, aynı isteğin iki kez işlenmesine izin veren kontrol sırasında.',
  'Yaptıklarım: hatayı düzelttim, testi ekledim, lint temiz. Açık kalan bir şey yok.',
  'Bu değişiklik üç dosyaya dokunuyor. Önce testleri yazıp kırmızı olduğunu gördüm, sonra düzelttim.',
]
const MODELS = { opus: 'claude-opus-5-5', opus5: 'claude-opus-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' } as const
const VERSIONS = ['2.1.248', '2.1.255', '2.1.262', '2.1.270', '2.1.281', '2.1.288', '2.1.295', '2.1.299']

const DAY = 86_400_000

export interface DemoOptions {
  home: string
  now: Date
  seed?: number
}

export function generateDemoHome({ home, now, seed = 20261021 }: DemoOptions): void {
  const r = rng(seed)
  const pricing = new Pricing()
  const claude = path.join(home, '.claude')
  const projectsDir = path.join(claude, 'projects')
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
  const root = (p: Project) => path.join(home, 'code', p.name)
  const slugOf = (cwd: string) => cwd.replace(/[/.]/g, '-')

  // ---- sessions ---------------------------------------------------------------------------------
  const days = 180
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)
  let pr = 140
  let routineUsed = 0
  const liveCandidates: { sessionId: string; cwd: string }[] = []

  for (let d = 0; d < days; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d)
    const dow = (day.getDay() + 6) % 7
    // Busier on weekdays, and busier lately: usage grows over the six months.
    const growth = 0.25 + 0.75 * (d / days)
    const p = (dow < 5 ? 0.8 : dow === 5 ? 0.3 : 0.15) * growth
    const last = d === days - 1
    // The last day always has work in progress, whatever the hour the demo is built.
    if (!last && !r.chance(p)) continue
    const sessionsToday = last ? 2 : r.chance(0.3 * growth) ? 2 : 1
    for (let s = 0; s < sessionsToday; s++) {
      const project = r.weighted(PROJECTS.map((x) => [x, x.weight] as const))
      const startHour = r.weighted([[9, 3], [10, 4], [11, 3], [13, 3], [14, 4], [15, 3], [16, 3], [17, 2], [20, 1], [22, 1]] as const)
      const at = last
        ? new Date(now.getTime() - r.int(70, 160) * 60_000)
        : new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, r.int(0, 59), r.int(0, 59))
      if (at.getTime() > now.getTime() - 20 * 60_000) continue
      const sessionId = uuid()
      const worktree = r.chance(0.15) ? `${r.pick(['brave-otter', 'quiet-heron', 'swift-lynx', 'calm-badger'])}-${r.int(100, 999)}` : null
      const cwd = worktree ? path.join(root(project), '.claude', 'worktrees', worktree) : root(project)
      const branch = worktree ? `claude/${worktree}` : r.pick(project.branches)
      const version = VERSIONS[Math.min(VERSIONS.length - 1, Math.floor((d / days) * VERSIONS.length))] as string
      const entrypoint = r.chance(0.35) ? 'claude-desktop' : 'cli'
      const bigContext = r.chance(0.4)
      const model = d < days * 0.25 && r.chance(0.6) ? MODELS.opus5 : r.chance(0.2) ? MODELS.sonnet : MODELS.opus
      const records: Json[] = []
      const subagents: { name: string; records: Json[] }[] = []
      const base = (ts: number) => ({ sessionId, timestamp: new Date(ts).toISOString(), cwd, gitBranch: branch, version, entrypoint, userType: 'external' })
      let t = at.getTime()
      let context = r.int(18_000, 26_000)
      let firstCall = true
      let lastCall = 0
      let cost = 0
      let added = 0
      let removed = 0
      let msgs = 0
      const usage = (output: number, opts: { fast?: boolean; webSearch?: boolean } = {}) => {
        // The first call of a run, or the first after the cache expired, writes the whole context.
        const cold = firstCall || t - lastCall > 60 * 60_000
        const write = cold ? context : r.int(800, 6_000)
        const read = cold ? 0 : context
        firstCall = false
        lastCall = t
        context += write === context ? 0 : write
        context += Math.round(output * 0.6)
        const u = {
          input_tokens: r.int(3, 60), output_tokens: output, cache_read_input_tokens: read,
          cache_creation_input_tokens: write, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
          service_tier: 'standard', speed: opts.fast ? 'fast' : 'standard',
          ...(opts.webSearch ? { server_tool_use: { web_search_requests: 1 } } : {}),
        }
        cost += pricing.cost(model, {
          input: u.input_tokens, output, cacheRead: read, cacheWrite5m: 0, cacheWrite1h: write, webSearch: opts.webSearch ? 1 : 0, fast: !!opts.fast,
        }) ?? 0
        return u
      }
      const assistant = (content: Json[], output: number, opts: { fast?: boolean; webSearch?: boolean } = {}) => {
        msgs++
        records.push({ type: 'assistant', uuid: uuid(), ...base(t), requestId: id('req_'), message: { id: id('msg_'), type: 'message', role: 'assistant', model, content, usage: usage(output, opts) } })
      }
      const userPrompt = (text: string) => records.push({ type: 'user', uuid: uuid(), ...base(t), origin: { kind: 'human' }, message: { role: 'user', content: text } })
      const result = (toolId: string, content: string, extra: Json = {}, isError = false) =>
        records.push({ type: 'user', uuid: uuid(), ...base(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content, is_error: isError }] }, ...extra })
      const fast = r.chance(0.04)

      const promptCount = Math.max(3, Math.round(r.int(4, 22) * (0.6 + growth)))
      const topics = [...project.prompts].sort(() => r.next() - 0.5)
      let title = ''
      for (let k = 0; k < promptCount; k++) {
        // A long break inside a session: lunch, a meeting, the next morning.
        if (k > 0 && r.chance(0.08)) t += r.chance(0.5) ? r.int(65, 180) * 60_000 : r.int(14, 18) * 3_600_000
        else t += r.int(1, 9) * 60_000
        if (t > now.getTime() - 5 * 60_000) break

        let prompt: string
        if (k === 0) {
          prompt = topics[0] ?? project.prompts[0] as string
          title = project.titles[project.prompts.indexOf(prompt)] ?? prompt.slice(0, 40)
        } else if (r.chance(0.12) && routineUsed < 14) {
          prompt = ROUTINE[routineUsed++ % ROUTINE.length] as string
        } else if (r.chance(0.07)) {
          userPrompt('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>')
          records.push({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), ...base(t), content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: context } })
          context = r.int(28_000, 42_000)
          continue
        } else if (r.chance(0.04)) {
          userPrompt('<bash-input>git status --short</bash-input>')
          records.push({ type: 'user', uuid: uuid(), ...base(t + 1000), message: { role: 'user', content: '<bash-stdout> M src/lib/cart.ts\n M tests/cart.test.ts</bash-stdout><bash-stderr></bash-stderr>' } })
          continue
        } else {
          prompt = r.chance(0.5) ? r.pick(FOLLOW_UPS) : (topics[k % topics.length] as string)
        }
        userPrompt(prompt)

        const steps = r.int(2, 9)
        for (let st = 0; st < steps; st++) {
          t += r.int(4, 40) * 1000
          const kind = r.weighted([['read', 30], ['edit', 20], ['bash', 26], ['grep', 8], ['write', 4], ['web', 3], ['todo', 2], ['mcp', 3], ['agent', 1.5], ['skill', 1], ['ask', 1]] as const)
          const toolId = id('toolu_')
          const file = r.pick(project.files)
          const filePath = path.join(cwd, file)
          const say = r.chance(0.35) ? [{ type: 'text', text: r.pick(['Önce ilgili dosyaya bakayım.', 'Testleri çalıştırıyorum.', 'Şimdi düzeltmeyi uyguluyorum.', 'Bu fonksiyonun nerede çağrıldığını arıyorum.']) }] : []
          if (kind === 'read') {
            assistant([...say, { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: filePath } }], r.int(40, 200), { fast })
            t += 800
            result(toolId, `     1\t// ${file}\n     2\t…`, { toolUseResult: { type: 'text', file: { filePath, numLines: r.int(40, 400) } } })
          } else if (kind === 'edit' || kind === 'write') {
            const plus = r.int(2, kind === 'write' ? 120 : 30)
            const minus = kind === 'write' ? 0 : r.int(0, 18)
            added += plus
            removed += minus
            assistant([...say, { type: 'tool_use', id: toolId, name: kind === 'write' ? 'Write' : 'Edit', input: { file_path: filePath, old_string: '…', new_string: '…' } }], r.int(200, 1400), { fast })
            t += 600
            const lines = [...Array.from({ length: minus }, () => '-eski satır'), ...Array.from({ length: plus }, () => '+yeni satır')]
            result(toolId, `The file ${filePath} has been updated.`, {
              toolUseResult: kind === 'write' && r.chance(0.5)
                ? { type: 'create', filePath, content: `${'satır\n'.repeat(plus)}` }
                : { filePath, structuredPatch: [{ oldStart: 10, oldLines: minus, newStart: 10, newLines: plus, lines }] },
            })
          } else if (kind === 'bash') {
            const roll = r.next()
            if (roll < 0.03) {
              // Refused: a push straight to main, or a delete auto mode won't run.
              const user = r.chance(0.6)
              const command = user ? 'git push --force-with-lease origin main' : 'rm -rf node_modules/.cache dist'
              assistant([...say, { type: 'tool_use', id: toolId, name: 'Bash', input: { command, description: 'Run' } }], r.int(60, 160))
              t += 4000
              result(toolId, user ? "The user doesn't want to proceed with this tool use." : 'Blocked by auto mode.', { toolDenialKind: user ? 'user-rejected' : 'automode-blocked' }, true)
            } else if (roll < 0.05) {
              // zsh, not bash: an unquoted glob that matches nothing.
              const command = `cd ${cwd} && grep -rn "TODO" --include=*.ts src`
              assistant([...say, { type: 'tool_use', id: toolId, name: 'Bash', input: { command } }], r.int(60, 160))
              t += 1500
              result(toolId, 'Exit code 1\n(eval):1: no matches found: --include=*.ts', {}, true)
            } else if (roll < 0.06) {
              const command = `timeout 60 ${r.pick(project.bash)}`
              assistant([...say, { type: 'tool_use', id: toolId, name: 'Bash', input: { command } }], r.int(60, 160))
              t += 1000
              result(toolId, 'Exit code 127\n(eval):1: command not found: timeout', {}, true)
            } else {
              const command = `cd ${cwd} && ${r.pick(project.bash)}`
              const fails = r.chance(0.12) && project.failing.some((f) => command.endsWith(f))
              assistant([...say, { type: 'tool_use', id: toolId, name: 'Bash', input: { command, description: 'Run' } }], r.int(60, 220), { fast })
              t += r.int(2, 50) * 1000
              result(toolId, fails ? `Exit code 1\nFAIL ${r.pick(project.files)}\n  expected 42.5, received 42.49` : '✓ tamamlandı', { toolUseResult: { stdout: fails ? '' : 'ok', stderr: '', interrupted: false } }, fails)
            }
          } else if (kind === 'grep') {
            assistant([...say, { type: 'tool_use', id: toolId, name: 'Grep', input: { pattern: r.pick(['calculateTotal', 'refundStatus', 'useCart', 'TODO']), path: cwd } }], r.int(40, 120))
            t += 500
            result(toolId, `Found ${r.int(1, 9)} files`)
          } else if (kind === 'web') {
            const search = r.chance(0.5)
            assistant([...say, { type: 'tool_use', id: toolId, name: search ? 'WebSearch' : 'WebFetch', input: search ? { query: 'stripe webhook signature verification go' } : { url: 'https://nextjs.org/docs/app/guides/upgrading', prompt: 'Kırılan değişiklikler' } }], r.int(80, 300), { webSearch: search })
            t += 5000
            result(toolId, 'Sonuçlar alındı.')
          } else if (kind === 'todo') {
            const todos = ['Hatayı yeniden üret', 'Düzeltmeyi uygula', 'Test ekle', 'Dokümanı güncelle'].map((content, i) => ({ content, status: i < 2 ? 'completed' : r.chance(0.5) ? 'in_progress' : 'pending', activeForm: content }))
            assistant([{ type: 'tool_use', id: toolId, name: 'TodoWrite', input: { todos } }], r.int(80, 200))
            result(toolId, 'Todos have been modified successfully.')
          } else if (kind === 'mcp') {
            const tool = r.pick(['mcp__github__get_pull_request', 'mcp__github__list_issues', 'mcp__linear__get_issue', 'mcp__linear__update_issue'])
            assistant([...say, { type: 'tool_use', id: toolId, name: tool, input: { repo: project.repo } }], r.int(60, 200))
            t += 2000
            result(toolId, '{"ok":true}', {}, r.chance(0.05))
          } else if (kind === 'agent') {
            const type = r.pick(['Explore', 'Explore', 'general-purpose'])
            assistant([{ type: 'tool_use', id: toolId, name: 'Agent', input: { description: 'Kod tabanını tara', prompt: 'İlgili dosyaları bul ve özetle', subagent_type: type } }], r.int(100, 300))
            const agentRecords: Json[] = []
            const agentModel = type === 'Explore' ? MODELS.haiku : MODELS.opus
            let at2 = t
            for (let a = 0; a < r.int(3, 8); a++) {
              at2 += r.int(2, 8) * 1000
              const sub = id('toolu_')
              const ctx = 15_000 + a * 4_000
              agentRecords.push({
                type: 'assistant', isSidechain: true, uuid: uuid(), sessionId, timestamp: new Date(at2).toISOString(), cwd, version,
                message: { id: id('msg_'), role: 'assistant', model: agentModel, content: [{ type: 'tool_use', id: sub, name: r.pick(['Read', 'Grep', 'Glob']), input: { file_path: filePath, pattern: 'refund' } }],
                  usage: { input_tokens: 10, output_tokens: r.int(60, 300), cache_read_input_tokens: a === 0 ? 0 : ctx, cache_creation_input_tokens: a === 0 ? ctx : 3000, cache_creation: { ephemeral_5m_input_tokens: a === 0 ? ctx : 3000, ephemeral_1h_input_tokens: 0 } } },
              })
              agentRecords.push({ type: 'user', isSidechain: true, uuid: uuid(), sessionId, timestamp: new Date(at2 + 500).toISOString(), cwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: sub, content: 'ok' }] } })
            }
            subagents.push({ name: `agent-a${id('').slice(-12)}`, records: agentRecords })
            t = at2 + 2000
            result(toolId, 'İlgili dosyalar: src/lib/cart.ts, src/lib/pricing.ts. Yuvarlama pricing.ts içinde yapılıyor.')
          } else if (kind === 'skill') {
            assistant([{ type: 'tool_use', id: toolId, name: 'Skill', input: { skill: r.pick(['frontend-design:frontend-design', 'release-notes', 'sql-review']) } }], r.int(40, 120))
            result(toolId, 'Launching skill')
          } else {
            assistant([{ type: 'tool_use', id: toolId, name: 'AskUserQuestion', input: { questions: [{ question: 'Hangisi?', options: [{ label: 'A' }, { label: 'B' }] }] } }], r.int(60, 160))
            t += r.int(20, 120) * 1000
            result(toolId, 'User answered: A')
          }

          // An interrupt now and then, mid-task.
          if (r.chance(0.015)) {
            records.push({ type: 'user', uuid: uuid(), ...base(t + 2000), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
            break
          }
          // Auto-compact when the context fills up.
          const limit = bigContext ? 620_000 : 175_000
          if (context > limit) {
            records.push({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), ...base(t + 1000), content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: context } })
            context = r.int(30_000, 45_000)
          }
        }
        t += r.int(5, 30) * 1000
        assistant([{ type: 'text', text: r.pick(REPLIES) }], r.int(250, 1300), { fast })

        if (prompt === ROUTINE[1] && r.chance(0.8)) {
          const toolId = id('toolu_')
          assistant([{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: `cd ${cwd} && gh pr create --fill` } }], r.int(80, 200))
          pr++
          result(toolId, `https://github.com/${project.repo}/pull/${pr}`)
          records.push({ type: 'pr-link', sessionId, prNumber: pr, prUrl: `https://github.com/${project.repo}/pull/${pr}`, prRepository: project.repo, timestamp: new Date(t).toISOString() })
        }
      }

      // A plan presented for approval in some sessions.
      if (r.chance(0.12)) {
        const toolId = id('toolu_')
        assistant([{ type: 'tool_use', id: toolId, name: 'ExitPlanMode', input: { plan: `## Plan: ${title}\n\n1. Hatayı yeniden üreten bir test yaz\n2. Kök nedeni düzelt\n3. İlgili dokümanı güncelle` } }], r.int(200, 500))
        result(toolId, 'User has approved your plan.')
      }
      // The five-hour limit, hit twice in the busiest stretch.
      if (d > days - 20 && r.chance(0.08)) {
        records.push({
          type: 'assistant', uuid: uuid(), ...base(t + 1000), isApiErrorMessage: true,
          quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.round((t + 2 * 3_600_000) / 1000) },
          message: { id: id('msg_'), role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: '5 saatlik kullanım limitine ulaşıldı.' }], usage: { input_tokens: 0, output_tokens: 0 } },
        })
      }
      if (msgs === 0) continue

      records.push({ type: 'ai-title', sessionId, aiTitle: title })
      if (r.chance(0.15)) records.push({ type: 'custom-title', sessionId, customTitle: `${title} (${project.name})` })
      // Claude Code's own counter runs a little ahead of the transcript: calls it never wrote down.
      records.push({
        type: 'cost-state', sessionId, startTime: at.getTime(), totalCostUSD: Math.round(cost * (1 + r.next() * 0.12) * 1e4) / 1e4,
        totalLinesAdded: added, totalLinesRemoved: removed, totalAPIDuration: msgs * 9_000, totalToolDuration: msgs * 4_000, totalDuration: t - at.getTime(), modelUsage: {},
      })

      const slugDir = path.join(projectsDir, slugOf(cwd))
      write(path.join(slugDir, `${sessionId}.jsonl`), `${records.map((x) => JSON.stringify(x)).join('\n')}\n`)
      for (const s of subagents) write(path.join(slugDir, sessionId, 'subagents', `${s.name}.jsonl`), `${s.records.map((x) => JSON.stringify(x)).join('\n')}\n`)
      if (last) liveCandidates.push({ sessionId, cwd })
    }
  }

  // ---- what lives around the transcripts ----------------------------------------------------------
  write(path.join(claude, 'CLAUDE.md'), [
    '# Genel kurallar',
    '',
    '- Türkçe yanıt ver; kod, komut ve teknik terimler özgün haliyle kalsın.',
    '- Bir değişikliği bitirmeden önce testleri çalıştır.',
    '- Commit mesajları kısa ve emir kipinde olsun.',
    '- Gizli anahtarları asla dosyaya yazma.',
    '',
  ].join('\n'))

  const acme = PROJECTS[0] as Project
  const sections = [
    ['Mimari', ['App Router kullanıyoruz; sunucu bileşenleri varsayılan.', 'Veri erişimi yalnızca src/lib altındaki servislerden yapılır.', 'Durum yönetimi için Zustand; global store küçük tutulur.']],
    ['Komutlar', ['npm run dev: geliştirme sunucusu', 'npm run test: Vitest', 'npm run typecheck: tsc', 'npx playwright test: uçtan uca testler']],
    ['Kodlama kuralları', ['Para tutarları kuruş cinsinden integer tutulur.', 'Bileşen dosyaları PascalCase, yardımcılar camelCase.', 'Her yeni API ucu için zod şeması zorunlu.', 'CSS: Tailwind; özel sınıf yazmadan önce tasarım token larına bak.']],
    ['Sözlük', ['Sepet: cart', 'Kupon: coupon', 'Sipariş: order', 'İade: refund', 'Ödeme: checkout']],
  ] as const
  const body: string[] = [`# ${acme.name}`, '']
  // Long on purpose: the İpuçları page should find a CLAUDE.md worth trimming.
  for (let i = 0; i < 6; i++) {
    for (const [title, lines] of sections) {
      body.push(`## ${title}${i ? ` (${i + 1})` : ''}`, '', ...lines.map((l) => `- ${l} Ayrıntılar için ilgili README bölümüne ve docs/ klasöründeki karar kayıtlarına bak.`), '')
    }
  }
  write(path.join(root(acme), 'CLAUDE.md'), body.join('\n'))
  write(path.join(root(PROJECTS[1] as Project), 'CLAUDE.md'), '# payments-api\n\n- Go 1.24, standart kütüphane öncelikli.\n- Para tutarları int64 kuruş.\n- Her migration geri alınabilir olmalı.\n')

  const memDir = path.join(projectsDir, slugOf(root(acme)), 'memory')
  write(path.join(memDir, 'MEMORY.md'), '- [Para birimi](para-birimi.md) — tutarlar kuruş cinsinden\n- [Test komutu](test-komutu.md) — testler vitest ile\n- [Tasarım dili](tasarim-dili.md) — sade, az renk\n')
  write(path.join(memDir, 'para-birimi.md'), '---\nname: para-birimi\ndescription: Tutarlar her yerde kuruş cinsinden integer\nmetadata:\n  type: project\n---\n\nFiyatlar kuruş cinsinden tutulur; gösterirken formatPrice kullanılır.\n')
  write(path.join(memDir, 'test-komutu.md'), '---\nname: test-komutu\ndescription: Testler npm run test ile, jest değil vitest\nmetadata:\n  type: feedback\n---\n\nJest komutu yok; npm run test Vitest çalıştırır.\n')
  write(path.join(memDir, 'tasarim-dili.md'), '---\nname: tasarim-dili\ndescription: Arayüz sade, en fazla iki vurgu rengi\nmetadata:\n  type: user\n---\n\nKullanıcı kalabalık arayüz istemiyor.\n')

  write(path.join(claude, 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\ndescription: Son sürümden bu yana birleşen PR lardan sürüm notu yazar\n---\n\nPR başlıklarını grupla ve kullanıcıya dönük dille yaz.\n')
  write(path.join(claude, 'skills', 'sql-review', 'SKILL.md'), '---\nname: sql-review\ndescription: Migration ve sorguları index, kilit ve geri alınabilirlik açısından inceler\n---\n\nHer migration için geri alma adımını kontrol et.\n')
  write(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'frontend-design@claude-plugins-official': [{ scope: 'user', version: '1.4.0', installedAt: new Date(now.getTime() - 90 * DAY).toISOString() }],
      'commit-commands@claude-plugins-official': [{ scope: 'user', version: '1.1.2', installedAt: new Date(now.getTime() - 60 * DAY).toISOString() }],
    },
  }, null, 2))
  write(path.join(claude, 'settings.json'), JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(npm run test:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Read', 'Grep', 'Glob'], deny: ['Bash(rm -rf:*)'], ask: ['Bash(git push:*)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write "$CLAUDE_FILE_PATHS"' }] }] },
    env: { ACME_API_URL: 'https://api.example.com', DEMO_TOKEN: 'gösterilmez' },
    enabledPlugins: { 'frontend-design@claude-plugins-official': true, 'commit-commands@claude-plugins-official': false },
  }, null, 2))
  write(path.join(root(acme), '.mcp.json'), JSON.stringify({ mcpServers: { storybook: { command: 'npx', args: ['storybook-mcp'] } } }, null, 2))
  write(path.join(home, '.claude.json'), JSON.stringify({
    oauthAccount: { organizationRateLimitTier: 'default_claude_max_5x', organizationType: 'claude_max', emailAddress: 'demo@example.com' },
    cachedUsageUtilization: {
      fetchedAtMs: now.getTime() - 25 * 60_000,
      utilization: {
        five_hour: { utilization: 38, resets_at: new Date(now.getTime() + 2.5 * 3_600_000).toISOString() },
        seven_day: { utilization: 57, resets_at: new Date(now.getTime() + 3 * DAY).toISOString() },
      },
    },
    mcpServers: {
      github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'gösterilmez' } },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      puppeteer: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    },
    skillUsage: { 'release-notes': { usageCount: 6 }, 'sql-review': { usageCount: 4 } },
    pluginUsage: { 'frontend-design@claude-plugins-official': { usageCount: 11 } },
    projects: Object.fromEntries(PROJECTS.map((p) => [root(p), { allowedTools: [] }])),
  }, null, 2))

  // Two sessions "running right now", so the live panel has something to show.
  for (const [i, s] of liveCandidates.slice(-2).entries()) {
    write(path.join(claude, 'sessions', `${process.pid}${i ? `-${i}` : ''}.json`), JSON.stringify({
      pid: process.pid, sessionId: s.sessionId, cwd: s.cwd, status: i === 0 ? 'busy' : 'idle', updatedAt: new Date(now.getTime() - (i + 1) * 4 * 60_000).toISOString(),
    }))
  }
}
