// More work on carsi-web, the store the demo spends most of its last month on. These touch several
// files each, as features do: a page, a component, a helper, its tests, the translations.
import type { Story } from './stories.ts'

const pass = (tests: number) => ` Test Files  ${Math.ceil(tests / 8)} passed (${Math.ceil(tests / 8)})\n      Tests  ${tests} passed (${tests})\n   Duration  2.6s`

export const WEB_EXTRA: Story[] = [
  {
    title: 'Üretici sayfası',
    branch: 'feat/producer-page',
    prompt: 'Her üreticinin kendi sayfası olsun: kısa tanıtım, bulunduğu il ve satıştaki ürünleri. Adres /uretici/[slug].',
    read: ['src/lib/products.ts', 'src/components/ProductCard.tsx', 'messages/tr.json'],
    skill: 'frontend-design:frontend-design',
    todos: ['Veri katmanı', 'Sayfa ve başlık bileşeni', 'Çeviriler', 'Testler'],
    edits: [
      {
        file: 'src/lib/producers.ts',
        old: '',
        new: `import { db } from './db'

export interface Producer {
  slug: string
  name: string
  city: string
  story: string
}

/** A producer and the products they have on sale, newest first. */
export async function producerWithProducts(slug: string) {
  const producer = await db.producer.findUnique({ where: { slug } })
  if (!producer) return null
  const products = await db.product.findMany({
    where: { producerId: producer.id, stock: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
  })
  return { producer, products }
}`,
      },
      {
        file: 'src/components/ProducerHeader.tsx',
        old: '',
        new: `import { useTranslations } from 'next-intl'
import type { Producer } from '@/lib/producers'

export function ProducerHeader({ producer, count }: { producer: Producer; count: number }) {
  const t = useTranslations('producer')
  return (
    <header className="producer-header">
      <h1>{producer.name}</h1>
      <p className="producer-city">{producer.city}</p>
      <p className="producer-story">{producer.story}</p>
      <p className="producer-count">{t('productCount', { count })}</p>
    </header>
  )
}`,
      },
      {
        file: 'src/app/(shop)/uretici/[slug]/page.tsx',
        old: '',
        new: `import { notFound } from 'next/navigation'
import { ProducerHeader } from '@/components/ProducerHeader'
import { ProductCard } from '@/components/ProductCard'
import { producerWithProducts } from '@/lib/producers'

export default async function ProducerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await producerWithProducts(slug)
  if (!data) notFound()
  return (
    <main className="producer-page">
      <ProducerHeader producer={data.producer} count={data.products.length} />
      <ul className="product-grid">
        {data.products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </main>
  )
}`,
      },
      { file: 'messages/tr.json', old: '  "product": {', new: '  "producer": {\n    "productCount": "{count} ürün satışta"\n  },\n  "product": {' },
      {
        file: 'tests/producers.test.ts',
        old: '',
        new: `import { describe, expect, it } from 'vitest'
import { producerWithProducts } from '@/lib/producers'
import { seedProducer } from './mocks/db'

describe('producerWithProducts', () => {
  it('lists only products in stock, newest first', async () => {
    await seedProducer('ezine-peynircisi', [{ name: 'Ezine peyniri 1 kg', stock: 4 }, { name: 'Tulum peyniri', stock: 0 }])
    const data = await producerWithProducts('ezine-peynircisi')
    expect(data?.products.map((p) => p.name)).toEqual(['Ezine peyniri 1 kg'])
  })

  it('returns null for an unknown producer', async () => {
    expect(await producerWithProducts('yok')).toBeNull()
  })
})`,
      },
    ],
    test: { command: 'npm run test -- producers', fail: " FAIL  tests/producers.test.ts\nError: Failed to resolve import \"@/lib/producers\" from \"tests/producers.test.ts\". Does the file exist?\n\n Test Files  1 failed | 13 passed (14)", pass: pass(104) },
    summary: 'Üretici sayfası hazır: /uretici/[slug] adresinde üreticinin tanıtımı, ili ve stoktaki ürünleri görünüyor. Stokta olmayan ürünler listelenmiyor, bilinmeyen bir üretici 404 veriyor. Veri katmanı için iki test ekledim.',
    followUps: [
      { prompt: 'Ürün kartında üreticinin adı tıklanabilir olsun, üretici sayfasına gitsin.', edit: { file: 'src/components/ProductCard.tsx', old: '      <p className="producer">{product.producer.name}</p>', new: '      <Link className="producer" href={`/uretici/${product.producer.slug}`}>{product.producer.name}</Link>' }, reply: 'Ürün kartındaki üretici adı artık üretici sayfasına bağlanıyor.' },
    ],
    pr: true,
    review: { comment: '@ece: Sayfanın başlık ve açıklama meta etiketleri eksik, paylaşınca boş görünüyor.', edit: { file: 'src/app/(shop)/uretici/[slug]/page.tsx', old: "import { producerWithProducts } from '@/lib/producers'", new: "import { producerWithProducts } from '@/lib/producers'\n\nexport async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {\n  const data = await producerWithProducts((await params).slug)\n  return data ? { title: data.producer.name, description: data.producer.story.slice(0, 150) } : {}\n}" }, reply: 'generateMetadata ekledim: başlık üreticinin adı, açıklama tanıtımının ilk 150 karakteri.' },
  },
  {
    title: 'Kargo ücreti hesaplaması',
    branch: 'feat/shipping-fee',
    prompt: 'Kargo ücretini sepette göster: 500 TL ve üstü ücretsiz, altı 49,90 TL. Adalar için 30 TL ek ücret var.',
    read: ['src/lib/pricing.ts', 'src/components/CartSummary.tsx'],
    edits: [
      {
        file: 'src/lib/shipping.ts',
        old: '',
        new: `/** Kuruş. */
const FREE_FROM = 50_000
const STANDARD = 4_990
const ISLAND_EXTRA = 3_000

const ISLANDS = new Set(['Bozcaada', 'Gökçeada', 'Adalar', 'Cunda'])

export interface ShippingQuote {
  fee: number
  free: boolean
  /** How much more to spend for free shipping; 0 when already free. */
  toFree: number
}

export function shippingFor(subtotal: number, district: string | null): ShippingQuote {
  const extra = district && ISLANDS.has(district) ? ISLAND_EXTRA : 0
  if (subtotal >= FREE_FROM) return { fee: extra, free: extra === 0, toFree: 0 }
  return { fee: STANDARD + extra, free: false, toFree: FREE_FROM - subtotal }
}`,
      },
      {
        file: 'tests/shipping.test.ts',
        old: '',
        new: `import { describe, expect, it } from 'vitest'
import { shippingFor } from '@/lib/shipping'

describe('shippingFor', () => {
  it('is free from 500 TL', () => {
    expect(shippingFor(50_000, 'Kadıköy')).toEqual({ fee: 0, free: true, toFree: 0 })
  })

  it('charges the standard fee below it and says how far free shipping is', () => {
    expect(shippingFor(42_500, 'Kadıköy')).toEqual({ fee: 4_990, free: false, toFree: 7_500 })
  })

  it('adds the island surcharge, even when shipping is otherwise free', () => {
    expect(shippingFor(60_000, 'Bozcaada').fee).toBe(3_000)
    expect(shippingFor(10_000, 'Gökçeada').fee).toBe(7_990)
  })
})`,
      },
      { file: 'src/components/CartSummary.tsx', old: '        <span>{formatPrice(total)}</span>', new: "        <span>{formatPrice(total)}</span>\n      </div>\n      <div className=\"summary-row\">\n        <span>{t('shipping')}</span>\n        <span>{quote.free ? t('free') : formatPrice(quote.fee)}</span>" },
    ],
    test: { command: 'npm run test -- shipping', fail: " FAIL  tests/shipping.test.ts > shippingFor > adds the island surcharge, even when shipping is otherwise free\nAssertionError: expected 0 to be 3000 // Object.is equality\n ❯ tests/shipping.test.ts:13:44\n\n Test Files  1 failed | 14 passed (15)", pass: pass(108) },
    summary: 'Kargo ücreti sepette ayrı bir satırda: 500 TL ve üstü ücretsiz, altında 49,90 TL. Ada teslimatlarına 30 TL ek ücret ücretsiz kargoda bile ekleniyor; ilk testim tam bu durumu yakaladı. Sepette "ücretsiz kargoya X TL kaldı" bilgisi de var.',
    followUps: [
      { prompt: '"Ücretsiz kargoya X TL kaldı" mesajını sepet çekmecesinde de göster.', edit: { file: 'src/components/CartDrawer.tsx', old: '      <CartItems items={items} />', new: "      <CartItems items={items} />\n      {quote.toFree > 0 ? <p className=\"to-free\">{t('toFree', { amount: formatPrice(quote.toFree) })}</p> : null}" }, reply: 'Çekmecede de görünüyor; tutar sepet değiştikçe güncelleniyor.' },
    ],
    pr: true,
  },
  {
    title: 'Sipariş takip sayfası',
    branch: 'feat/order-tracking',
    prompt: 'Müşteri siparişinin nerede olduğunu görebilsin: /siparis/[id] sayfası, hazırlanıyor → kargoda → teslim edildi adımlarıyla bir zaman çizelgesi.',
    read: ['src/lib/orders.ts', 'src/app/api/orders/route.ts'],
    plan: '## Sipariş takip sayfası\n\n1. Sipariş olaylarını getiren orderTimeline fonksiyonu\n2. OrderTimeline bileşeni ve stilleri\n3. /siparis/[id] sayfası, yalnızca siparişin sahibi görebilir\n4. Çeviriler ve testler',
    todos: ['orderTimeline', 'OrderTimeline bileşeni', 'Sayfa ve yetki', 'Çeviriler'],
    edits: [
      {
        file: 'src/components/OrderTimeline.tsx',
        old: '',
        new: `import { useFormatter, useTranslations } from 'next-intl'
import type { OrderEvent } from '@/lib/orders'

const STEPS = ['preparing', 'shipped', 'delivered'] as const

export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  const t = useTranslations('order.status')
  const format = useFormatter()
  const reached = new Map(events.map((e) => [e.status, e.at]))
  return (
    <ol className="timeline">
      {STEPS.map((step) => {
        const at = reached.get(step)
        return (
          <li key={step} className={at ? 'timeline-step done' : 'timeline-step'}>
            <span className="timeline-dot" aria-hidden />
            <span className="timeline-label">{t(step)}</span>
            {at ? <time dateTime={at.toISOString()}>{format.dateTime(at, 'short')}</time> : null}
          </li>
        )
      })}
    </ol>
  )
}`,
      },
      {
        file: 'src/styles/timeline.css',
        old: '',
        new: `.timeline {
  display: grid;
  gap: 1.25rem;
  padding-left: 1.5rem;
  border-left: 2px solid var(--line);
}

.timeline-step {
  position: relative;
  color: var(--ink-3);
}

.timeline-step.done {
  color: var(--ink);
}

.timeline-dot {
  position: absolute;
  left: -1.95rem;
  top: 0.35rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 999px;
  background: var(--line);
}

.timeline-step.done .timeline-dot {
  background: var(--accent);
}`,
      },
      {
        file: 'src/app/(shop)/siparis/[id]/page.tsx',
        old: '',
        new: `import { notFound } from 'next/navigation'
import { OrderTimeline } from '@/components/OrderTimeline'
import { currentUser } from '@/lib/auth'
import { orderTimeline } from '@/lib/orders'
import '@/styles/timeline.css'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, order] = await Promise.all([currentUser(), orderTimeline(id)])
  // Someone else's order looks the same as a missing one.
  if (!order || order.userId !== user?.id) notFound()
  return (
    <main className="order-page">
      <h1>Sipariş #{order.number}</h1>
      <OrderTimeline events={order.events} />
    </main>
  )
}`,
      },
      { file: 'messages/tr.json', old: '  "order": {', new: '  "order": {\n    "status": {\n      "preparing": "Hazırlanıyor",\n      "shipped": "Kargoda",\n      "delivered": "Teslim edildi"\n    },' },
    ],
    test: { command: 'npm run test -- orders', fail: " FAIL  tests/orders.test.ts > orderTimeline > hides another user's order\nAssertionError: expected [Function] to throw NEXT_NOT_FOUND\n ❯ tests/orders.test.ts:48:31\n\n Test Files  1 failed | 15 passed (16)", pass: pass(113) },
    summary: 'Takip sayfası hazır: hazırlanıyor, kargoda ve teslim edildi adımları tarihleriyle bir zaman çizelgesinde. Başkasının siparişi açılmaya çalışılırsa sayfa yokmuş gibi 404 veriyor; ilk sürümde bu kontrol eksikti, test yakaladı.',
    pr: true,
    bigContext: true,
    review: { comment: '@mert: Kargo firmasının takip bağlantısını da gösterelim, müşteriler hep onu soruyor.', edit: { file: 'src/components/OrderTimeline.tsx', old: "            {at ? <time dateTime={at.toISOString()}>{format.dateTime(at, 'short')}</time> : null}", new: "            {at ? <time dateTime={at.toISOString()}>{format.dateTime(at, 'short')}</time> : null}\n            {step === 'shipped' && trackingUrl ? <a href={trackingUrl}>{t('track')}</a> : null}" }, reply: 'Kargoda adımında kargo firmasının takip bağlantısı da görünüyor.' },
  },
  {
    title: 'Yorumlarda sıralama',
    branch: 'feat/review-sorting',
    prompt: 'Ürün yorumları en yeniden eskiye sabit. En faydalı, en yeni ve puana göre sıralanabilsin.',
    read: ['src/components/Reviews.tsx', 'src/app/api/reviews/route.ts'],
    edits: [
      { file: 'src/app/api/reviews/route.ts', old: "    orderBy: { createdAt: 'desc' },", new: "    orderBy: SORTS[sort] ?? SORTS.helpful," },
      { file: 'src/app/api/reviews/route.ts', old: 'export async function GET(req: Request) {', new: "const SORTS = {\n  helpful: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],\n  newest: { createdAt: 'desc' },\n  rating: [{ rating: 'desc' }, { createdAt: 'desc' }],\n} as const\n\nexport async function GET(req: Request) {\n  const sort = new URL(req.url).searchParams.get('sort') as keyof typeof SORTS" },
      { file: 'src/components/Reviews.tsx', old: '      <h2>{t(\'title\')}</h2>', new: "      <div className=\"reviews-head\">\n        <h2>{t('title')}</h2>\n        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('sortLabel')}>\n          <option value=\"helpful\">{t('sort.helpful')}</option>\n          <option value=\"newest\">{t('sort.newest')}</option>\n          <option value=\"rating\">{t('sort.rating')}</option>\n        </select>\n      </div>" },
      {
        file: 'tests/reviews.test.ts',
        old: '',
        new: `import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/reviews/route'

const get = (sort: string) => GET(new Request(\`http://test/api/reviews?product=1&sort=\${sort}\`)).then((r) => r.json())

describe('GET /api/reviews', () => {
  it('puts the most helpful first by default', async () => {
    const rows = await get('')
    expect(rows[0].helpfulCount).toBeGreaterThanOrEqual(rows[1].helpfulCount)
  })

  it('sorts by rating, newest first among equals', async () => {
    const rows = await get('rating')
    expect(rows.map((r: { rating: number }) => r.rating)).toEqual([5, 5, 4, 3])
  })
})`,
      },
    ],
    test: { command: 'npm run test -- reviews', pass: pass(117) },
    summary: 'Yorumlar artık en faydalı (varsayılan), en yeni ve puana göre sıralanabiliyor. Eşit puanlarda en yeni yorum önde. Sıralama seçimi adreste tutuluyor, paylaşılan bağlantı aynı sırayla açılıyor.',
    model: 'sonnet',
  },
  {
    title: 'Sepet ve ödemede erişilebilirlik',
    branch: 'fix/cart-a11y',
    prompt: 'Sepet ve ödeme akışını erişilebilirlik açısından denetle; axe ile bir test ekle ve bulduklarını düzelt.',
    read: ['src/components/CartDrawer.tsx', 'src/components/CartSummary.tsx', 'src/styles/globals.css'],
    edits: [
      {
        file: 'tests/e2e/a11y.spec.ts',
        old: '',
        new: `import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/sepet', '/odeme']) {
  test(\`\${path} erişilebilirlik ihlali içermez\`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(results.violations).toEqual([])
  })
}`,
      },
      { file: 'src/components/CartDrawer.tsx', old: '      <button className="close" onClick={onClose}>', new: "      <button className=\"close\" onClick={onClose} aria-label={t('close')}>" },
      { file: 'src/components/CartSummary.tsx', old: '        <input value={code} onChange={(e) => setCode(e.target.value)} />', new: "        <label htmlFor=\"coupon\">{t('couponLabel')}</label>\n        <input id=\"coupon\" value={code} onChange={(e) => setCode(e.target.value)} />" },
      { file: 'src/styles/globals.css', old: '--ink-3: #9aa0a6;', new: '--ink-3: #6b7280;' },
    ],
    test: { command: 'npx playwright test a11y', fail: "  1) a11y.spec.ts:5:3 › /sepet erişilebilirlik ihlali içermez\n\n    Expected: []\n    Received: 3 violations: button-name, color-contrast, label\n\n  2 failed", pass: '  2 passed (9.8s)' },
    summary: 'axe üç sorun buldu ve hepsi düzeldi: çekmecenin kapat düğmesinin adı yoktu, kupon alanının etiketi yoktu, ikincil metin rengi kontrastı yetersizdi (3,1:1 → 4,8:1). Test artık sepet ve ödeme sayfalarını her CI çalışmasında denetliyor.',
    pr: true,
  },
  {
    title: 'Sipariş e-postaları',
    branch: 'feat/order-emails',
    prompt: 'Sipariş onayı ve kargoya verildi e-postalarını React Email ile yeniden yaz; şimdiki düz metin e-postalar çok kötü görünüyor.',
    read: ['src/lib/mail.ts', 'emails/README.md'],
    edits: [
      {
        file: 'emails/OrderConfirmation.tsx',
        old: '',
        new: `import { Body, Container, Head, Heading, Html, Preview, Row, Section, Text } from '@react-email/components'
import { formatPrice } from '../src/lib/format'

interface Props {
  name: string
  number: string
  items: { name: string; quantity: number; total: number }[]
  total: number
}

export default function OrderConfirmation({ name, number, items, total }: Props) {
  return (
    <Html lang="tr">
      <Head />
      <Preview>Siparişin alındı: #{number}</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f2' }}>
        <Container style={{ background: '#ffffff', padding: 32, borderRadius: 12 }}>
          <Heading as="h1">Teşekkürler {name}, siparişin alındı</Heading>
          <Text>Sipariş numaran #{number}. Üreticiler hazırlamaya başladı.</Text>
          <Section>
            {items.map((item) => (
              <Row key={item.name}>
                <Text>{item.quantity} × {item.name} · {formatPrice(item.total)}</Text>
              </Row>
            ))}
          </Section>
          <Text style={{ fontWeight: 600 }}>Toplam: {formatPrice(total)}</Text>
        </Container>
      </Body>
    </Html>
  )
}`,
      },
      {
        file: 'emails/ShippingUpdate.tsx',
        old: '',
        new: `import { Body, Button, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'

interface Props {
  name: string
  number: string
  carrier: string
  trackingUrl: string
}

export default function ShippingUpdate({ name, number, carrier, trackingUrl }: Props) {
  return (
    <Html lang="tr">
      <Head />
      <Preview>#{number} kargoya verildi</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f2' }}>
        <Container style={{ background: '#ffffff', padding: 32, borderRadius: 12 }}>
          <Heading as="h1">{name}, siparişin yola çıktı</Heading>
          <Text>#{number} numaralı siparişin {carrier} ile kargoya verildi.</Text>
          <Button href={trackingUrl} style={{ background: '#1c5cab', color: '#ffffff', padding: '12px 20px', borderRadius: 8 }}>
            Kargomu takip et
          </Button>
        </Container>
      </Body>
    </Html>
  )
}`,
      },
      { file: 'src/lib/mail.ts', old: "  const text = renderPlain(template, data)", new: "  const html = await render(templates[template](data))\n  const text = await render(templates[template](data), { plainText: true })" },
    ],
    test: { command: 'npm run email:test', pass: '✓ emails/OrderConfirmation.tsx rendered (html 6.1 kB, text 0.4 kB)\n✓ emails/ShippingUpdate.tsx rendered (html 4.3 kB, text 0.3 kB)' },
    summary: 'İki e-posta React Email ile yeniden yazıldı; HTML ve düz metin sürümleri aynı şablondan üretiliyor. Gmail, Outlook ve Apple Mail önizlemelerinde kontrol ettim. Kargo e-postasında takip düğmesi var.',
    pr: true,
  },
]
