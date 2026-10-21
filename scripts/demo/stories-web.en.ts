// The English mirror of stories-web.ts: the same carsi-web features, written in English. Every
// story keeps the shape of its Turkish twin (same files, same line counts) so the seeded generator
// builds the same sessions from either; test/demo-stories.test.ts holds the two together.
import type { Story } from './stories.ts'

const pass = (tests: number) => ` Test Files  ${Math.ceil(tests / 8)} passed (${Math.ceil(tests / 8)})\n      Tests  ${tests} passed (${tests})\n   Duration  2.6s`

export const WEB_EXTRA_EN: Story[] = [
  {
    title: 'Producer page',
    branch: 'feat/producer-page',
    prompt: 'Every producer should get their own page: a short intro, the province they’re in and the products they have on sale. The URL is /uretici/[slug].',
    read: ['src/lib/products.ts', 'src/components/ProductCard.tsx', 'messages/tr.json'],
    skill: 'frontend-design:frontend-design',
    todos: ['Data layer', 'Page and header component', 'Translations', 'Tests'],
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
    await seedProducer('ezine-dairy', [{ name: 'Ezine cheese 1 kg', stock: 4 }, { name: 'Tulum cheese', stock: 0 }])
    const data = await producerWithProducts('ezine-dairy')
    expect(data?.products.map((p) => p.name)).toEqual(['Ezine cheese 1 kg'])
  })

  it('returns null for an unknown producer', async () => {
    expect(await producerWithProducts('nobody')).toBeNull()
  })
})`,
      },
    ],
    test: { command: 'npm run test -- producers', fail: " FAIL  tests/producers.test.ts\nError: Failed to resolve import \"@/lib/producers\" from \"tests/producers.test.ts\". Does the file exist?\n\n Test Files  1 failed | 13 passed (14)", pass: pass(104) },
    summary: 'The producer page is ready: /uretici/[slug] shows the producer’s intro, their province and the products they have in stock. Out-of-stock products aren’t listed, and an unknown producer gives a 404. I added two tests for the data layer.',
    followUps: [
      { prompt: 'Make the producer name on the product card clickable so it goes to the producer page.', edit: { file: 'src/components/ProductCard.tsx', old: '      <p className="producer">{product.producer.name}</p>', new: '      <Link className="producer" href={`/uretici/${product.producer.slug}`}>{product.producer.name}</Link>' }, reply: 'The producer name on the product card now links to the producer page.' },
    ],
    pr: true,
    review: { comment: '@ece: The page has no title or description meta tags, so it shows up blank when shared.', edit: { file: 'src/app/(shop)/uretici/[slug]/page.tsx', old: "import { producerWithProducts } from '@/lib/producers'", new: "import { producerWithProducts } from '@/lib/producers'\n\nexport async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {\n  const data = await producerWithProducts((await params).slug)\n  return data ? { title: data.producer.name, description: data.producer.story.slice(0, 150) } : {}\n}" }, reply: 'Added generateMetadata: the title is the producer’s name and the description is the first 150 characters of their intro.' },
  },
  {
    title: 'Shipping fee calculation',
    branch: 'feat/shipping-fee',
    prompt: 'Show the shipping fee in the cart: free from 500 lira, 49.90 lira below that. Islands get a 30 lira surcharge.',
    read: ['src/lib/pricing.ts', 'src/components/CartSummary.tsx'],
    edits: [
      {
        file: 'src/lib/shipping.ts',
        old: '',
        new: `/** In kuruş. */
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
    summary: 'The shipping fee now has its own row in the cart: free from 500 lira, 49.90 lira below that. Island deliveries get the 30 lira surcharge even when shipping is otherwise free; my first test caught exactly that case. The cart also shows "X lira away from free shipping".',
    followUps: [
      { prompt: 'show the "X lira away from free shipping" message in the cart drawer too', edit: { file: 'src/components/CartDrawer.tsx', old: '      <CartItems items={items} />', new: "      <CartItems items={items} />\n      {quote.toFree > 0 ? <p className=\"to-free\">{t('toFree', { amount: formatPrice(quote.toFree) })}</p> : null}" }, reply: 'It shows in the drawer now too, and the amount updates as the cart changes.' },
    ],
    pr: true,
  },
  {
    title: 'Order tracking page',
    branch: 'feat/order-tracking',
    prompt: 'Customers should be able to see where their order is: a /siparis/[id] page with a timeline of preparing → shipped → delivered.',
    read: ['src/lib/orders.ts', 'src/app/api/orders/route.ts'],
    plan: '## Order tracking page\n\n1. An orderTimeline function that loads the order’s events\n2. OrderTimeline component and its styles\n3. /siparis/[id] page, visible only to the order’s owner\n4. Translations and tests',
    todos: ['orderTimeline', 'OrderTimeline component', 'Page and access check', 'Translations'],
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
      <h1>Order #{order.number}</h1>
      <OrderTimeline events={order.events} />
    </main>
  )
}`,
      },
      { file: 'messages/tr.json', old: '  "order": {', new: '  "order": {\n    "status": {\n      "preparing": "Hazırlanıyor",\n      "shipped": "Kargoda",\n      "delivered": "Teslim edildi"\n    },' },
    ],
    test: { command: 'npm run test -- orders', fail: " FAIL  tests/orders.test.ts > orderTimeline > hides another user's order\nAssertionError: expected [Function] to throw NEXT_NOT_FOUND\n ❯ tests/orders.test.ts:48:31\n\n Test Files  1 failed | 15 passed (16)", pass: pass(113) },
    summary: 'The tracking page is ready: preparing, shipped and delivered on a timeline, each with its date. Opening someone else’s order gives a 404, as if it didn’t exist; the first version was missing that check and the test caught it.',
    pr: true,
    bigContext: true,
    review: { comment: '@mert: Let’s show the carrier’s tracking link too, customers ask for it all the time.', edit: { file: 'src/components/OrderTimeline.tsx', old: "            {at ? <time dateTime={at.toISOString()}>{format.dateTime(at, 'short')}</time> : null}", new: "            {at ? <time dateTime={at.toISOString()}>{format.dateTime(at, 'short')}</time> : null}\n            {step === 'shipped' && trackingUrl ? <a href={trackingUrl}>{t('track')}</a> : null}" }, reply: 'The shipped step now shows the carrier’s tracking link as well.' },
  },
  {
    title: 'Sorting reviews',
    branch: 'feat/review-sorting',
    prompt: 'Product reviews are always newest first. Let people sort them by most helpful, newest and rating.',
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
    summary: 'Reviews can now be sorted by most helpful (the default), newest and rating. Among equal ratings the newest review comes first. The sort order is kept in the URL, so a shared link opens in the same order.',
    model: 'sonnet',
  },
  {
    title: 'Accessibility in cart and checkout',
    branch: 'fix/cart-a11y',
    prompt: 'Audit the cart and checkout flow for accessibility; add a test with axe and fix whatever it finds.',
    read: ['src/components/CartDrawer.tsx', 'src/components/CartSummary.tsx', 'src/styles/globals.css'],
    edits: [
      {
        file: 'tests/e2e/a11y.spec.ts',
        old: '',
        new: `import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/sepet', '/odeme']) {
  test(\`\${path} has no accessibility violations\`, async ({ page }) => {
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
    test: { command: 'npx playwright test a11y', fail: "  1) a11y.spec.ts:5:3 › /sepet has no accessibility violations\n\n    Expected: []\n    Received: 3 violations: button-name, color-contrast, label\n\n  2 failed", pass: '  2 passed (9.8s)' },
    summary: 'axe found three issues and all of them are fixed: the drawer’s close button had no accessible name, the coupon field had no label, and the secondary text color didn’t have enough contrast (3.1:1 → 4.8:1). The test now checks the cart and checkout pages on every CI run.',
    pr: true,
  },
  {
    title: 'Order emails',
    branch: 'feat/order-emails',
    prompt: 'Rewrite the order confirmation and shipping emails with React Email; the plain-text ones we send now look terrible.',
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
    <Html lang="en">
      <Head />
      <Preview>We got your order: #{number}</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f2' }}>
        <Container style={{ background: '#ffffff', padding: 32, borderRadius: 12 }}>
          <Heading as="h1">Thanks {name}, we got your order</Heading>
          <Text>Your order number is #{number}. The producers have started preparing it.</Text>
          <Section>
            {items.map((item) => (
              <Row key={item.name}>
                <Text>{item.quantity} × {item.name} · {formatPrice(item.total)}</Text>
              </Row>
            ))}
          </Section>
          <Text style={{ fontWeight: 600 }}>Total: {formatPrice(total)}</Text>
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
    <Html lang="en">
      <Head />
      <Preview>Order #{number} has shipped</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f2' }}>
        <Container style={{ background: '#ffffff', padding: 32, borderRadius: 12 }}>
          <Heading as="h1">{name}, your order is on its way</Heading>
          <Text>Your order #{number} has been handed to {carrier}.</Text>
          <Button href={trackingUrl} style={{ background: '#1c5cab', color: '#ffffff', padding: '12px 20px', borderRadius: 8 }}>
            Track my package
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
    summary: 'Both emails are rewritten with React Email, and the HTML and plain-text versions now come from the same template. I checked them in the Gmail, Outlook and Apple Mail previews. The shipping email has a tracking button.',
    pr: true,
  },
]
