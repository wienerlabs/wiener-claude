// The English mirror of stories.ts: the same projects, sessions and numbers, with the fictional
// team writing in English. Every story keeps the shape of its Turkish twin (same files, branches,
// commands and line counts) so the seeded generator builds the same sessions from either;
// test/demo-stories.test.ts holds the two together.

import { WEB_EXTRA_EN } from './stories-web.en.ts'
import type { ProjectStories } from './stories.ts'

const vitestFail = (file: string, name: string, line: number, message: string) =>
  ` FAIL  ${file} > ${name}\n${message}\n ❯ ${file}:${line}:24\n\n Test Files  1 failed | 11 passed (12)\n      Tests  1 failed | 86 passed (87)\n   Duration  2.38s`
const vitestPass = (tests: number) => ` Test Files  12 passed (12)\n      Tests  ${tests} passed (${tests})\n   Duration  2.41s`
const goFail = (pkg: string, test: string, file: string, line: number, message: string) =>
  `--- FAIL: ${test} (0.03s)\n    ${file}:${line}: ${message}\nFAIL\nFAIL\tgithub.com/carsi-app/carsi-payments/internal/${pkg}\t0.241s\nFAIL`
const goPass = (pkg: string) => `ok  \tgithub.com/carsi-app/carsi-payments/internal/${pkg}\t0.233s`

export const STORIES_EN: ProjectStories[] = [
  {
    name: 'carsi-web',
    repo: 'carsi-app/carsi-web',
    snippets: {
      'src/lib/pricing.ts': "import type { CartItem, Coupon } from './types'\n\n/** Subtotal in kuruş. */\nexport function subtotal(items: CartItem[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)\n}",
      'src/lib/cart.ts': "import { create } from 'zustand'\nimport { applyCoupon } from './pricing'\n\nexport const useCart = create<CartState>((set, get) => ({\n  items: [],\n  coupon: null,",
      'src/app/(shop)/checkout/page.tsx': "import { AddressForm } from '@/components/AddressForm'\nimport { CartSummary } from '@/components/CartSummary'\n\nexport default async function CheckoutPage() {",
      'src/components/ProductCard.tsx': "import Image from 'next/image'\nimport { formatPrice } from '@/lib/format'\n\nexport function ProductCard({ product }: { product: Product }) {",
      'src/app/api/orders/route.ts': "import { NextResponse } from 'next/server'\nimport { createOrder } from '@/lib/orders'\n\nexport async function POST(req: Request) {",
      'src/lib/products.ts': "import { db } from './db'\n\nexport async function productBySlug(slug: string) {\n  return db.product.findUnique({ where: { slug }, include: { producer: true } })\n}",
      'messages/tr.json': '{\n  "cart": {\n    "title": "Sepetim",\n    "empty": "Sepetin boş"\n  },',
      'messages/en.json': '{\n  "cart": {\n    "title": "My cart",\n    "empty": "Your cart is empty"\n  },',
      'src/lib/orders.ts': "export interface OrderEvent {\n  status: 'preparing' | 'shipped' | 'delivered'\n  at: Date\n}",
      'src/components/Reviews.tsx': "'use client'\n\nimport { useTranslations } from 'next-intl'\nimport { useState } from 'react'",
      'src/app/api/reviews/route.ts': "import { NextResponse } from 'next/server'\nimport { db } from '@/lib/db'",
      'src/styles/globals.css': '@import "tailwindcss";\n\n:root {\n  --ink: #15171c;\n  --ink-2: #4b5160;',
      'src/lib/mail.ts': "import { render } from '@react-email/render'\nimport { templates } from '../../emails'\n\nexport async function sendMail(to: string, template: keyof typeof templates, data: unknown) {",
      'emails/README.md': '# Emails\n\nTemplates are written with React Email; run `npm run email:dev` to preview them.',
      'src/lib/format.ts': "const try2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })",
      'src/components/CartDrawer.tsx': "'use client'\n\nimport { useCart } from '@/lib/cart'\n\nexport function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {",
      'src/components/CartSummary.tsx': "import { formatPrice } from '@/lib/format'\n\nexport function CartSummary({ total }: { total: number }) {",
    },
    stories: [
      {
        title: 'Coupon discount rounding drift',
        branch: 'fix/coupon-rounding',
        prompt: 'With a 15% coupon in the cart the total comes out 1 kuruş short: I see 42.49 where it should be 42.50. Find out why and fix it.',
        read: ['src/lib/pricing.ts', 'src/lib/cart.ts', 'tests/pricing.test.ts'],
        grep: 'applyCoupon',
        edits: [
          { file: 'src/lib/pricing.ts', old: '  const discount = items.reduce((sum, item) => sum + Math.round(item.price * item.quantity * coupon.rate), 0)', new: '  // Rounding per item drifts by a kuruş on larger carts; round once, on the subtotal.\n  const discount = Math.round(subtotal(items) * coupon.rate)' },
          { file: 'tests/pricing.test.ts', old: "  it('applies a percentage coupon', () => {", new: "  it('rounds a percentage coupon once, on the subtotal', () => {\n    expect(applyCoupon(threeItems, percent15).total).toBe(4250)\n  })\n\n  it('applies a percentage coupon', () => {" },
        ],
        test: { command: 'npm run test -- pricing', fail: vitestFail('tests/pricing.test.ts', 'applyCoupon > rounds a percentage coupon once, on the subtotal', 31, 'AssertionError: expected 4249 to be 4250 // Object.is equality'), pass: vitestPass(88) },
        summary: 'Found it: the discount was rounded per item and then summed, so on a three-item cart the total drifted by 1 kuruş. The discount is now computed once, from the subtotal. I added a test that catches the bug; all 88 tests pass.',
        followUps: [
          { prompt: 'Can the total go negative with fixed-amount coupons? It shouldn’t.', edit: { file: 'src/lib/pricing.ts', old: '  return subtotal(items) - discount', new: '  return Math.max(0, subtotal(items) - discount)' }, reply: 'It could: a 100 lira coupon on an 80 lira cart came out at -20 lira. The total is now floored at zero, and I added a test for that case.' },
        ],
        pr: true,
        review: { comment: '@deniz: The comment in applyCoupon is fine as is, but let’s see a test for fixed-amount coupons too; what happens if both are applied to the same cart?', edit: { file: 'tests/pricing.test.ts', old: "  it('applies a percentage coupon', () => {", new: "  it('never lets a fixed coupon push the total below zero', () => {\n    expect(applyCoupon(smallCart, fixed100).total).toBe(0)\n  })\n\n  it('applies a percentage coupon', () => {" }, reply: 'Added the fixed-amount coupon test. Two coupons on the same cart are already blocked (one coupon per order), and I noted that in the PR description.' },
      },
      {
        title: 'Address validation on checkout',
        branch: 'feat/address-validation',
        prompt: 'Add address validation to the checkout page: postal code is 5 digits, city and district are required. Errors should show under the field they belong to.',
        read: ['src/app/(shop)/checkout/page.tsx', 'src/components/AddressForm.tsx', 'src/lib/validation.ts'],
        skill: 'frontend-design:frontend-design',
        todos: ['Write the address schema', 'Show errors in the form', 'Add tests'],
        edits: [
          { file: 'tests/AddressForm.test.tsx', old: '', new: "import { render, screen } from '@testing-library/react'\nimport userEvent from '@testing-library/user-event'\nimport { describe, expect, it } from 'vitest'\nimport { AddressForm } from '@/components/AddressForm'\n\ndescribe('AddressForm', () => {\n  it('shows an error for a 4-digit postal code', async () => {\n    render(<AddressForm onSubmit={() => {}} />)\n    await userEvent.type(screen.getByLabelText('Postal code'), '3400')\n    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))\n    expect(await screen.findByText('Postal code must be 5 digits')).toBeVisible()\n  })\n\n  it('keeps the district list disabled until a city is chosen', () => {\n    render(<AddressForm onSubmit={() => {}} />)\n    expect(screen.getByLabelText('District')).toBeDisabled()\n  })\n})" },
          { file: 'src/lib/validation.ts', old: 'export const addressSchema = z.object({\n  line1: z.string().min(1),', new: "export const addressSchema = z.object({\n  line1: z.string().min(1, 'Address line is required'),\n  city: z.string().min(1, 'Choose a city'),\n  district: z.string().min(1, 'Choose a district'),\n  postalCode: z.string().regex(/^\\d{5}$/, 'Postal code must be 5 digits')," },
          { file: 'src/components/AddressForm.tsx', old: '      <input {...register(\'postalCode\')} />', new: "      <input {...register('postalCode')} aria-invalid={!!errors.postalCode} />\n      {errors.postalCode ? <p className=\"field-error\">{errors.postalCode.message}</p> : null}" },
        ],
        test: { command: 'npm run test -- AddressForm', fail: vitestFail('tests/AddressForm.test.tsx', 'AddressForm > shows an error for a 4-digit postal code', 22, "TestingLibraryElementError: Unable to find an element with the text: Postal code must be 5 digits"), pass: vitestPass(91) },
        summary: 'The address schema now requires city, district and a 5-digit postal code, and each error shows right under its field. I added three new tests; they all pass.',
        followUps: [
          { prompt: 'Screen readers should read the error messages too.', edit: { file: 'src/components/AddressForm.tsx', old: '      <input {...register(\'postalCode\')} aria-invalid={!!errors.postalCode} />', new: "      <input {...register('postalCode')} aria-invalid={!!errors.postalCode} aria-describedby=\"postalCode-error\" />" }, reply: 'Every field is now tied to its error text with aria-describedby, so a screen reader reads the error when it reaches the field.' },
        ],
        pr: true,
        review: { comment: '@ece: The district list shouldn’t open before a city is chosen; right now it shows an empty list.', edit: { file: 'src/components/AddressForm.tsx', old: "      <select {...register('district')}>", new: "      <select {...register('district')} disabled={!city}>" }, reply: 'District stays disabled until a city is chosen, and its placeholder says "Choose a city first". I updated the test as well.' },
      },
      {
        title: 'Rate limit on the orders API',
        branch: 'feat/orders-rate-limit',
        prompt: 'Put a limit of 30 requests per minute per IP on the orders API. Past that it should return 429 with a Retry-After header.',
        read: ['src/app/api/orders/route.ts', 'src/lib/ratelimit.ts'],
        edits: [
          { file: 'tests/orders.route.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { POST } from '@/app/api/orders/route'\n\nconst order = () => new Request('http://test/api/orders', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, body: JSON.stringify(sampleOrder) })\n\ndescribe('POST /api/orders', () => {\n  it('returns 429 on the 31st request', async () => {\n    for (let i = 0; i < 30; i++) expect((await POST(order())).status).toBe(201)\n    const res = await POST(order())\n    expect(res.status).toBe(429)\n    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)\n  })\n})" },
          { file: 'src/app/api/orders/route.ts', old: 'export async function POST(req: Request) {', new: "export async function POST(req: Request) {\n  const limit = await ordersLimiter.check(clientIp(req))\n  if (!limit.ok) {\n    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } })\n  }" },
        ],
        test: { command: 'npm run test -- orders', fail: vitestFail('tests/orders.route.test.ts', 'POST /api/orders > returns 429 on the 31st request', 44, 'AssertionError: expected 201 to be 429 // Object.is equality'), pass: vitestPass(93) },
        summary: 'The orders endpoint is limited to 30 requests per minute per IP; past that it returns 429 with a Retry-After header saying how many seconds to wait. The counter uses the existing Redis connection, so there’s no new dependency.',
        pr: true,
        review: { comment: '@mert: Business customers come from behind a single IP; when there’s an API key, let’s apply the limit per key.', edit: { file: 'src/app/api/orders/route.ts', old: '  const limit = await ordersLimiter.check(clientIp(req))', new: "  const limit = await ordersLimiter.check(req.headers.get('x-api-key') ?? clientIp(req))" }, reply: 'With an API key the limit applies per key, otherwise per IP. If business accounts need their own quota, we can add it in a follow-up.' },
      },
      {
        title: 'End-to-end test for guest checkout',
        branch: 'test/guest-checkout-e2e',
        prompt: 'Write a Playwright test for a guest user checking out with a coupon.',
        read: ['tests/e2e/checkout.spec.ts', 'playwright.config.ts'],
        edits: [
          { file: 'tests/e2e/guest-checkout.spec.ts', old: '', new: "test('guest user checks out with a coupon', async ({ page }) => {\n  await page.goto('/urun/ayvalik-zeytinyagi-1l')\n  await page.getByRole('button', { name: 'Add to cart' }).click()\n  await page.getByLabel('Coupon code').fill('SUMMER15')\n  await page.getByRole('button', { name: 'Go to payment' }).click()\n  await expect(page.frameLocator('#payment-frame').getByLabel('Card number')).toBeVisible()\n})" },
        ],
        test: { command: 'npx playwright test guest-checkout', fail: "  1) guest-checkout.spec.ts:3:1 › guest user checks out with a coupon\n\n    Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n    Locator: getByLabel('Card number')\n\n  1 failed", pass: '  3 passed (14.2s)' },
        summary: 'Test is in. The first run couldn’t find the card field because the payment form lives in an iframe; going in with frameLocator made it pass. The scenario covers cart, coupon and payment end to end.',
      },
      {
        title: 'Upgrade to Next.js 16',
        branch: 'chore/next-16',
        prompt: 'Let’s move to Next.js 16. First list what will break, then fix it step by step.',
        read: ['package.json', 'next.config.ts', 'src/app/api/orders/route.ts'],
        web: { kind: 'fetch', value: 'https://nextjs.org/docs/app/guides/upgrading/version-16', result: 'Breaking changes: async request APIs (cookies, headers, params) are now Promise-only; experimental.ppr renamed; Node.js 20.9+ required.' },
        plan: '## Next.js 16 upgrade\n\n1. Bump next, react and react-dom\n2. Await the cookies() and headers() calls\n3. Remove the old experimental keys from next.config.ts\n4. Get typecheck and build clean\n5. Check the product, cart and checkout pages by hand',
        todos: ['Bump versions', 'Update async request APIs', 'Clean up the config', 'Get the build passing'],
        edits: [
          { file: 'src/app/api/orders/route.ts', old: "  const session = cookies().get('session')", new: "  const session = (await cookies()).get('session')" },
          { file: 'next.config.ts', old: '  experimental: { ppr: true },', new: '  cacheComponents: true,' },
        ],
        test: { command: 'npm run typecheck', fail: "src/app/api/orders/route.ts(12,28): error TS2339: Property 'get' does not exist on type 'Promise<ReadonlyRequestCookies>'.\nsrc/app/(shop)/cart/page.tsx(9,31): error TS2339: Property 'get' does not exist on type 'Promise<ReadonlyRequestCookies>'.\n\nFound 2 errors in 2 files.", pass: 'tsc --noEmit\n(no errors)' },
        summary: 'The upgrade is done. Two things broke: cookies() now returns a Promise (I awaited all 6 calls), and experimental.ppr is gone (cacheComponents replaces it). Typecheck is clean and the build passes; I also checked the product, cart and checkout pages by hand.',
        pr: true,
        review: { comment: '@deniz: middleware.ts should be renamed to proxy.ts as well, the build warns about it.', edit: { file: 'src/proxy.ts', old: '', new: "export { middleware as proxy } from './middleware-impl'\nexport const config = { matcher: ['/((?!_next|favicon.ico).*)'] }" }, reply: 'middleware.ts is now proxy.ts and the build warning is gone. Behavior is unchanged; the redirect tests pass.' },
        bigContext: true,
        blocked: { command: 'rm -rf .next/cache node_modules/.cache', instead: 'npm run clean' },
      },
      {
        title: 'Product page LCP',
        branch: 'perf/product-lcp',
        prompt: 'LCP on the product page is over 4 seconds on mobile. Find out why and get it under 2.5 seconds.',
        read: ['src/app/(shop)/product/[slug]/page.tsx', 'src/components/ProductGallery.tsx'],
        explore: 'The LCP element is the first image in the gallery. It loads with loading="lazy" and is a single 2400px-wide file with no sizes set. On top of that, the reviews component pulls in a 180 KB client bundle that blocks the first paint.',
        edits: [
          { file: 'src/components/ProductGallery.tsx', old: '        <Image src={images[0].url} alt={images[0].alt} fill loading="lazy" />', new: '        <Image src={images[0].url} alt={images[0].alt} fill priority sizes="(max-width: 768px) 100vw, 50vw" />' },
          { file: 'src/app/(shop)/product/[slug]/page.tsx', old: "import { Reviews } from '@/components/Reviews'", new: "const Reviews = dynamic(() => import('@/components/Reviews'))" },
        ],
        test: { command: 'npm run build', pass: '✓ Compiled successfully in 18.4s\nRoute (app)                 Size  First Load JS\n┌ ○ /                    5.21 kB         118 kB\n├ ● /product/[slug]      7.84 kB         121 kB' },
        summary: 'There were two causes: the LCP image was lazy-loaded with no sizes, and the reviews component added 180 KB to the initial load. The image is now priority with sizes set, and reviews load afterwards. In a local Lighthouse run, mobile LCP went from 4.1 s to 2.2 s.',
        fast: true,
      },
      {
        title: 'Cart drawer not closing on mobile',
        branch: 'fix/cart-drawer-close',
        prompt: 'On mobile the cart drawer doesn’t close when you tap outside it. Fix it.',
        read: ['src/components/CartSummary.tsx'],
        interrupt: { file: 'src/components/CartSummary.tsx', prompt: 'No, the problem isn’t in the summary, it’s in the drawer itself: look at the tap handling in CartDrawer.' },
        edits: [
          { file: 'src/components/CartDrawer.tsx', old: '    <div className="overlay" onClick={onClose} />', new: '    <div className="overlay" onPointerDown={onClose} />' },
        ],
        test: { command: 'npm run test -- CartDrawer', pass: vitestPass(94) },
        summary: 'You were right, it was in CartDrawer: the backdrop only listened for click, and iOS Safari doesn’t fire click while scrolling. I switched it to pointerdown and tested on desktop and mobile.',
      },
      {
        title: 'One formatter for prices',
        branch: 'refactor/format-price',
        prompt: 'Prices are formatted differently everywhere. Write a single formatPrice and use it everywhere.',
        read: ['src/lib/format.ts'],
        grep: 'toFixed(2)',
        zshGlob: true,
        edits: [
          { file: 'tests/format.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { formatPrice } from '@/lib/format'\n\ndescribe('formatPrice', () => {\n  it('writes kuruş as Turkish lira', () => {\n    expect(formatPrice(123450)).toBe('₺1.234,50')\n  })\n\n  it('formats zero too', () => {\n    expect(formatPrice(0)).toBe('₺0,00')\n  })\n})" },
          { file: 'src/lib/format.ts', old: '', new: "const try2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })\n\n/** Writes an amount in kuruş as \"1.234,50 ₺\". */\nexport const formatPrice = (kurus: number) => try2.format(kurus / 100)" },
          { file: 'src/components/CartSummary.tsx', old: '        <span>{(total / 100).toFixed(2)} TL</span>', new: '        <span>{formatPrice(total)}</span>' },
          { file: 'src/components/ProductCard.tsx', old: '      <p className="price">₺{(product.price / 100).toFixed(2)}</p>', new: '      <p className="price">{formatPrice(product.price)}</p>' },
        ],
        test: { command: 'npm run test', pass: vitestPass(96) },
        summary: 'Added formatPrice and moved every toFixed(2) call across 7 files over to it; prices now read "1.234,50 ₺" everywhere. I updated the snapshot tests.',
        bigContext: true,
      },
      {
        title: 'Stock check in the cart',
        branch: 'fix/cart-stock',
        prompt: 'You can add more of a product to the cart than there is in stock. The quantity shouldn’t go over stock, and if someone tries, let’s tell them.',
        read: ['src/lib/cart.ts', 'src/components/CartSummary.tsx'],
        edits: [
          { file: 'src/lib/cart.ts', old: '    set({ items: upsert(get().items, product, quantity) })', new: "    const allowed = Math.min(quantity, product.stock)\n    set({ items: upsert(get().items, product, allowed) })\n    if (allowed < quantity) toast(`Only ${product.stock} left in stock`)" },
        ],
        test: { command: 'npm run test -- cart', fail: vitestFail('tests/cart.test.ts', 'addItem > caps the quantity at the stock', 27, 'AssertionError: expected 3 to be 2 // Object.is equality'), pass: vitestPass(98) },
        summary: 'The quantity is now capped at the stock; if someone asks for more, we add as many as we can and tell them how many are left. Server-side order validation already checked stock, so this just brings the UI in line with it.',
      },
      {
        title: 'Missing English translations',
        branch: 'fix/i18n-missing-keys',
        prompt: 'The English site shows raw key names in a few places. Find the missing translations and fill them in.',
        read: ['messages/tr.json', 'messages/en.json', 'scripts/i18n-check.ts'],
        edits: [
          { file: 'messages/en.json', old: '    "address": {', new: '    "address": {\n      "postalCode": "Postal code must be 5 digits",\n      "district": "Choose a district",' },
        ],
        test: { command: 'npm run i18n:check', fail: 'Missing keys in en.json (3):\n  checkout.address.postalCode\n  checkout.address.district\n  cart.stockLimit', pass: 'All 412 keys present in tr.json and en.json.' },
        summary: 'Three keys were missing, all of them Turkish strings added by the last two features (address validation and the stock check). I added the translations, and i18n:check now runs in CI too, so the next missing key will fail the build.',
        model: 'sonnet',
      },
      {
        title: 'Server-side pagination for search results',
        branch: 'perf/search-pagination',
        prompt: 'The search page fetches every result at once; categories with 2000 products are very slow. Let’s paginate on the server and keep the infinite scroll.',
        read: ['src/app/(shop)/search/page.tsx', 'src/lib/search.ts'],
        edits: [
          { file: 'tests/search.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { search } from '@/lib/search'\n\ndescribe('search', () => {\n  it('returns pages of 24 and says when there is more', async () => {\n    const page = await search({ category: 'olive-oil' })\n    expect(page.items).toHaveLength(24)\n    expect(page.next).toBeTruthy()\n  })\n\n  it('fetches the page after the cursor without repeats', async () => {\n    const first = await search({ category: 'olive-oil' })\n    const second = await search({ category: 'olive-oil', after: first.next })\n    expect(second.items[0].id).not.toBe(first.items.at(-1)?.id)\n  })\n})" },
          { file: 'src/lib/search.ts', old: '  return db.product.findMany({ where })', new: '  return db.product.findMany({ where, take: PAGE_SIZE + 1, cursor: after ? { id: after } : undefined, skip: after ? 1 : 0, orderBy: { id: "asc" } })' },
        ],
        test: { command: 'npm run test -- search', pass: vitestPass(101) },
        summary: 'Search now paginates with a cursor, 24 results per page; fetching one extra row tells us whether there’s more without a separate count query. In the 2000-product category the first response went from 1.8 s to 210 ms.',
        bigContext: true,
        pr: true,
        review: { comment: '@ece: Coming back loses the scroll position, it jumps to the top of the page.', edit: { file: 'src/app/(shop)/search/page.tsx', old: '  const [pages, setPages] = useState<Page[]>([first])', new: '  const [pages, setPages] = useSessionState<Page[]>(`search:${query}`, [first])' }, reply: 'Loaded pages are now kept for the session; going to a product and back leaves the list and the scroll position where they were.' },
      },
      ...WEB_EXTRA_EN,
    ],
    questions: [
      {
        title: 'Server action or route handler',
        prompt: 'In Next.js, how should I choose between a server action and a route handler when submitting a form?',
        answer: 'Short rule: if only your own UI submits the form, use a server action; if you need an endpoint that something else will call too, use a route handler.\n\nServer actions fit well with form state, error display and revalidatePath, and you don’t write a separate fetch layer. A route handler is the right choice when a mobile app, a webhook or another service will use the same endpoint; the HTTP contract is explicit and can be versioned. In your case: a server action for the checkout form, and a route handler for the orders endpoint the mobile app also uses.',
      },
    ],
  },
  {
    name: 'carsi-payments',
    repo: 'carsi-app/carsi-payments',
    snippets: {
      'internal/refund/service.go': 'package refund\n\n// Service creates refunds and records them in the ledger.\ntype Service struct {\n\tdb     *sql.DB\n\tledger *ledger.Ledger\n}',
      'internal/ledger/ledger.go': 'package ledger\n\n// Entry is one movement of money, in kuruş.\ntype Entry struct {\n\tID        string\n\tPaymentID string\n\tAmount    int64',
      'internal/webhooks/stripe.go': 'package webhooks\n\nimport (\n\t"net/http"\n\n\t"github.com/stripe/stripe-go/v82/webhook"\n)',
    },
    stories: [
      {
        title: 'Refunds processed twice',
        branch: 'fix/refund-race',
        prompt: 'When the same refund request comes in twice in a row it can be processed twice. Find the race condition and fix it.',
        issue: { id: 'PAY-218', text: 'From support: two refunds went through on the same order. The customer may have pressed the button twice. The ledger has two refund entries for the same payment_id.' },
        read: ['internal/refund/service.go', 'internal/ledger/ledger.go', 'internal/refund/service_test.go'],
        edits: [
          { file: 'internal/refund/service.go', old: '\tp, err := s.payments.Get(ctx, tx, req.PaymentID)', new: '\t// Lock the payment row so a second request waits instead of refunding again.\n\tp, err := s.payments.GetForUpdate(ctx, tx, req.PaymentID)' },
          { file: 'internal/refund/service.go', old: '\tif p.Status == StatusRefunded {', new: '\tif p.Status == StatusRefunded || p.Status == StatusRefunding {' },
        ],
        test: { command: 'go test ./internal/refund/...', fail: goFail('refund', 'TestRefund_ConcurrentRequests', 'service_test.go', 58, 'ledger entries = 2, want 1'), pass: goPass('refund') },
        summary: 'The cause: both requests read the payment row at the same time and both saw "not refunded yet". The row is now locked with SELECT … FOR UPDATE, and I also check for the "refunding" status. The test I wrote with two concurrent requests now sees a single ledger entry.',
        pr: true,
        review: { comment: '@selin: How long does a request wait on the lock? Let’s put a timeout on it.', edit: { file: 'internal/refund/service.go', old: '\tp, err := s.payments.GetForUpdate(ctx, tx, req.PaymentID)', new: '\tlockCtx, cancel := context.WithTimeout(ctx, 3*time.Second)\n\tdefer cancel()\n\tp, err := s.payments.GetForUpdate(lockCtx, tx, req.PaymentID)' }, reply: 'Added a 3-second timeout on the lock; when it runs out the request returns 409 and the client can retry.' },
      },
      {
        title: 'Stripe webhook signature verification',
        branch: 'feat/webhook-signature',
        prompt: 'Stripe webhooks don’t verify signatures. Add it, and return 400 on an invalid signature.',
        read: ['internal/webhooks/stripe.go', 'internal/http/router.go'],
        web: { kind: 'search', value: 'stripe-go webhook ConstructEvent tolerance', result: 'webhook.ConstructEventWithOptions(payload, header, secret, ConstructEventOptions{Tolerance: 5 * time.Minute}) verifies the Stripe-Signature header.' },
        edits: [
          { file: 'internal/webhooks/stripe.go', old: '\tvar event stripe.Event\n\tif err := json.Unmarshal(payload, &event); err != nil {', new: '\tevent, err := webhook.ConstructEventWithOptions(payload, r.Header.Get("Stripe-Signature"), h.secret,\n\t\twebhook.ConstructEventOptions{Tolerance: 5 * time.Minute})\n\tif err != nil {\n\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)\n\t\treturn\n\t}' },
        ],
        test: { command: 'go test ./internal/webhooks/...', fail: goFail('webhooks', 'TestStripeWebhook_InvalidSignature', 'stripe_test.go', 31, 'status = 200, want 400'), pass: goPass('webhooks') },
        summary: 'Webhooks are now verified against the Stripe-Signature header; an invalid signature, or one older than 5 minutes, gets a 400. The secret comes from an environment variable and isn’t in the code.',
        pr: true,
        review: { comment: '@selin: Let’s log invalid signatures, but not the body, just the event id and the IP.', edit: { file: 'internal/webhooks/stripe.go', old: '\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)', new: '\t\th.log.Warn("stripe webhook: invalid signature", "ip", r.RemoteAddr)\n\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)' }, reply: 'Invalid signatures are now logged as a warning along with the IP; the request body never goes to the log.' },
      },
      {
        title: 'Idempotency key for the ledger',
        branch: 'feat/ledger-idempotency',
        prompt: 'Let’s add an idempotency key to ledger entries; a second entry with the same key must not get written.',
        read: ['internal/ledger/ledger.go', 'migrations/0042_refund_status.sql'],
        skill: 'sql-review',
        edits: [
          { file: 'migrations/0043_ledger_idempotency.sql', old: '', new: '-- +goose Up\nALTER TABLE ledger_entries ADD COLUMN idempotency_key text;\nCREATE UNIQUE INDEX CONCURRENTLY ledger_entries_idempotency_key ON ledger_entries (idempotency_key);\n\n-- +goose Down\nDROP INDEX CONCURRENTLY ledger_entries_idempotency_key;\nALTER TABLE ledger_entries DROP COLUMN idempotency_key;' },
          { file: 'internal/ledger/ledger.go', old: '\tPaymentID string', new: '\tPaymentID      string\n\tIdempotencyKey string' },
        ],
        test: { command: 'go test ./internal/ledger/...', pass: goPass('ledger') },
        summary: 'The migration runs both up and down, and the index is built CONCURRENTLY so the table isn’t locked. A second write with the same key now returns ErrDuplicate, which the service treats as "already processed".',
      },
      {
        title: 'Partial refund support',
        branch: 'feat/partial-refunds',
        prompt: 'Add support for partial refunds. A payment should be able to take more than one partial refund.',
        read: ['internal/refund/service.go', 'internal/refund/types.go'],
        ask: { question: 'What should happen if partial refunds add up to more than the payment amount?', options: ['Reject the request (422)', 'Refund what’s left'], answer: 'Reject the request (422)' },
        plan: '## Partial refunds\n\n1. amount and sequence columns on the refunds table\n2. 422 when total refunds exceed the payment amount\n3. Payment status: partially refunded / fully refunded\n4. API docs and tests',
        todos: ['Extend the table', 'Add the total check', 'Update the statuses', 'Update the docs'],
        edits: [
          { file: 'internal/refund/service.go', old: '\tif req.Amount != p.Amount {\n\t\treturn ErrPartialNotSupported\n\t}', new: '\trefunded, err := s.refundedTotal(ctx, tx, p.ID)\n\tif err != nil {\n\t\treturn err\n\t}\n\tif refunded+req.Amount > p.Amount {\n\t\treturn ErrRefundExceedsPayment // 422\n\t}' },
        ],
        test: { command: 'go test ./internal/refund/...', fail: goFail('refund', 'TestPartialRefund_ExceedsPayment', 'service_test.go', 112, 'err = <nil>, want ErrRefundExceedsPayment'), pass: goPass('refund') },
        summary: 'Partial refunds are in: a payment can take as many partial refunds as needed, and a request that would push the total past the payment gets a 422. The payment status moves correctly between partially and fully refunded. The docs still need updating in carsi-docs, in a separate PR.',
        leavesTaskOpen: true,
        pr: true,
        review: { comment: '@mert: Let’s also return the remaining refundable amount in the 422 response; the mobile app will show it.', edit: { file: 'internal/http/handlers.go', old: '\t\twriteProblem(w, 422, "refund_exceeds_payment", err.Error())', new: '\t\twriteProblemWith(w, 422, "refund_exceeds_payment", err.Error(), map[string]any{"refundable": p.Amount - refunded})' }, reply: 'The 422 response now returns the remaining amount, in kuruş, in a refundable field. I added it to the docs too.' },
        bigContext: true,
      },
      {
        title: 'Integer amounts instead of floats',
        branch: 'refactor/amounts-in-kurus',
        prompt: 'Some places keep money amounts as float64. Convert them all to int64 kuruş.',
        read: ['internal/http/handlers.go', 'internal/refund/types.go'],
        explore: 'float64 amounts show up in 4 places: the request struct in the http handler, refund.Request, the total in the reporting package and a test helper. The database columns are already bigint.',
        edits: [
          { file: 'internal/refund/types.go', old: '\tAmount float64 `json:"amount"`', new: '\t// Amount is in kuruş.\n\tAmount int64 `json:"amount"`' },
          { file: 'internal/http/handlers.go', old: '\t\tAmount: req.Amount,', new: '\t\tAmount: int64(math.Round(req.Amount * 100)),' },
        ],
        test: { command: 'go build ./... && go test ./...', fail: '# github.com/carsi-app/carsi-payments/internal/report\ninternal/report/daily.go:41:15: cannot use r.Amount (variable of type int64) as float64 value in assignment', pass: 'ok  \tgithub.com/carsi-app/carsi-payments/internal/http\t0.312s\nok  \tgithub.com/carsi-app/carsi-payments/internal/refund\t0.233s\nok  \tgithub.com/carsi-app/carsi-payments/internal/report\t0.104s' },
        summary: 'All amounts are now int64 kuruş. The public API still accepts floats; the conversion happens only at the handler boundary, in one place. The reporting package sums in kuruş too, so the rounding differences are gone.',
        bigContext: true,
      },
      {
        title: 'One shape for error responses',
        branch: 'refactor/problem-json',
        prompt: 'Handlers return errors in three different shapes. Switch them all to application/problem+json.',
        read: ['internal/http/handlers.go', 'internal/http/errors.go'],
        edits: [
          { file: 'internal/http/errors.go', old: '', new: '// writeProblem writes an RFC 9457 problem document.\nfunc writeProblem(w http.ResponseWriter, status int, title, detail string) {\n\tw.Header().Set("Content-Type", "application/problem+json")\n\tw.WriteHeader(status)\n\tjson.NewEncoder(w).Encode(problem{Type: "about:blank", Title: title, Status: status, Detail: detail})\n}' },
        ],
        test: { command: 'go test ./internal/http/...', pass: goPass('http') },
        summary: 'Every error response is now problem+json, with type, title, status and detail fields. The mobile app was reading the old "error" field, so for backward compatibility I keep filling it in for one more release.',
        model: 'sonnet',
      },
      {
        title: 'Slow ledger query',
        branch: 'perf/ledger-index',
        prompt: 'The daily reconciliation query takes 40 seconds. Find out why it’s slow and speed it up.',
        read: ['internal/report/daily.go', 'migrations/0043_ledger_idempotency.sql'],
        skill: 'sql-review',
        edits: [
          { file: 'migrations/0044_ledger_created_at.sql', old: '', new: '-- +goose Up\nCREATE INDEX CONCURRENTLY ledger_entries_created_at ON ledger_entries (created_at, payment_id);\n\n-- +goose Down\nDROP INDEX CONCURRENTLY ledger_entries_created_at;' },
        ],
        test: { command: 'go test ./internal/report/...', pass: goPass('report') },
        summary: 'The query scanned the whole table for the date range (Seq Scan in EXPLAIN, 18 million rows). I added a composite index on created_at and payment_id; on a local copy the same query went from 40 s to 0.6 s. The index is built CONCURRENTLY, so it doesn’t block writes.',
      },
      {
        title: 'Health check endpoint',
        branch: 'feat/healthz',
        prompt: 'Add a /healthz endpoint for the load balancer; it should return 503 if we can’t reach the database or Redis.',
        read: ['internal/http/router.go'],
        edits: [
          { file: 'internal/http/health.go', old: '', new: 'func (h *Handler) healthz(w http.ResponseWriter, r *http.Request) {\n\tctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)\n\tdefer cancel()\n\tif err := h.db.PingContext(ctx); err != nil {\n\t\thttp.Error(w, "db unavailable", http.StatusServiceUnavailable)\n\t\treturn\n\t}\n\tw.WriteHeader(http.StatusOK)\n}' },
        ],
        test: { command: 'go test ./internal/http/...', pass: goPass('http') },
        summary: '/healthz pings the database and Redis with a 2-second timeout and returns 503 if either doesn’t answer. The endpoint needs no auth and isn’t logged; otherwise it would write a log line every 10 seconds.',
        model: 'sonnet',
      },
    ],
    questions: [
      {
        title: 'Testing context cancellation in Go',
        prompt: 'How do I test that a Go function reacts correctly when its context is cancelled?',
        answer: 'The cleanest way is to control the cancellation from the test: start with ctx, cancel := context.WithCancel(...), run the function in a goroutine, call cancel() and check that the returned error satisfies errors.Is(err, context.Canceled). Avoid sleeps that depend on timing; having the function signal on a channel when it reaches the point where it waits, and cancelling right then, keeps the test deterministic.',
      },
    ],
  },
  {
    name: 'carsi-mobile',
    repo: 'carsi-app/carsi-mobile',
    snippets: {
      'app/(tabs)/orders.tsx': "import { FlatList } from 'react-native'\nimport { useOrders } from '@/hooks/useOrders'\n\nexport default function OrdersScreen() {",
      'lib/api.ts': "const BASE_URL = process.env.EXPO_PUBLIC_API_URL\n\nexport async function api<T>(path: string, init?: RequestInit): Promise<T> {",
    },
    stories: [
      {
        title: 'Pull to refresh on orders',
        branch: 'feat/orders-refresh',
        prompt: 'Add pull-to-refresh to the orders screen.',
        read: ['app/(tabs)/orders.tsx', 'hooks/useOrders.ts'],
        edits: [
          { file: 'app/(tabs)/orders.tsx', old: '    <FlatList data={orders} renderItem={renderOrder} />', new: '    <FlatList\n      data={orders}\n      renderItem={renderOrder}\n      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}\n    />' },
        ],
        test: { command: 'npm run test -- orders', pass: ' PASS  app/(tabs)/orders.test.tsx\nTests:       12 passed, 12 total' },
        summary: 'The orders list now supports pull-to-refresh; it reuses the existing react-query query, so I didn’t add a separate request layer.',
      },
      {
        title: 'Android back button in the cart',
        branch: 'fix/android-back',
        prompt: 'On Android, pressing back in the cart closes the app. It should go back to the previous screen.',
        read: ['app/cart.tsx', 'app/_layout.tsx'],
        edits: [
          { file: 'app/_layout.tsx', old: "      <Stack.Screen name=\"cart\" options={{ presentation: 'modal' }} />", new: "      <Stack.Screen name=\"cart\" options={{ presentation: 'modal', gestureEnabled: true }} />" },
          { file: 'app/cart.tsx', old: '  return (', new: "  useFocusEffect(\n    useCallback(() => {\n      const sub = BackHandler.addEventListener('hardwareBackPress', () => (router.canGoBack() ? (router.back(), true) : false))\n      return () => sub.remove()\n    }, []),\n  )\n\n  return (" },
        ],
        test: { command: 'npx tsc --noEmit', fail: "app/cart.tsx(14,7): error TS2304: Cannot find name 'useFocusEffect'.", pass: '(no errors)' },
        summary: 'The cart opened as a modal, and when the back button found no previous screen on the stack it closed the app. I now catch the back button on the cart screen and go back to the previous screen; when the stack is empty the default behavior stays.',
      },
      {
        title: 'When to ask for notification permission',
        branch: 'feat/notification-permission',
        prompt: 'We ask for notification permission the first time the app opens, and most people say no. Let’s ask after their first order instead.',
        read: ['app/_layout.tsx', 'lib/notifications.ts'],
        edits: [
          { file: 'app/_layout.tsx', old: '  useEffect(() => { requestNotificationPermission() }, [])', new: '' },
          { file: 'app/order/success.tsx', old: '  return (', new: '  useEffect(() => {\n    if (isFirstOrder) requestNotificationPermission()\n  }, [isFirstOrder])\n\n  return (' },
        ],
        test: { command: 'npm run test', pass: ' PASS  lib/notifications.test.ts\nTests:       48 passed, 48 total' },
        summary: 'Permission is now requested only on the confirmation screen of the first order, the moment shipment notifications start to make sense. Users who declined before aren’t asked again.',
      },
      {
        title: 'Timeout in the API client',
        branch: 'feat/api-timeout',
        prompt: 'API requests wait forever on a weak connection. Add a 10-second timeout and a single retry.',
        read: ['lib/api.ts'],
        missingTool: true,
        edits: [
          { file: 'lib/api.ts', old: '  const res = await fetch(`${BASE_URL}${path}`, init)', new: '  const res = await fetchWithRetry(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(10_000) }, { retries: 1 })' },
        ],
        test: { command: 'npm run test -- api', pass: ' PASS  lib/api.test.ts\nTests:       9 passed, 9 total' },
        summary: 'Requests time out after 10 seconds, and only GET requests are retried once; requests like creating an order aren’t retried, so they can never be sent twice.',
      },
      {
        title: 'Dark theme tokens',
        branch: 'feat/dark-tokens',
        prompt: 'The dark theme colors are hardcoded in each component. Wire them up to the design tokens.',
        read: ['theme/tokens.ts', 'components/OrderRow.tsx'],
        skill: 'frontend-design:frontend-design',
        edits: [
          { file: 'components/OrderRow.tsx', old: "  const bg = scheme === 'dark' ? '#1c1f24' : '#ffffff'", new: '  const bg = tokens.surface[scheme]' },
        ],
        test: { command: 'npm run test', pass: ' PASS  components/OrderRow.test.tsx\nTests:       48 passed, 48 total' },
        summary: 'Moved 23 hardcoded colors to tokens; the dark and light themes are now managed from a single file. I checked the contrast ratios and they all pass WCAG AA.',
        model: 'sonnet',
      },
      {
        title: 'Badges for order statuses',
        branch: 'feat/order-status-badge',
        prompt: 'The order list shows the status as plain text. Let’s make it a colored badge: preparing, shipped, delivered, refunded.',
        read: ['components/OrderRow.tsx', 'theme/tokens.ts'],
        edits: [
          { file: 'components/StatusBadge.tsx', old: '', new: "const TONE: Record<OrderStatus, keyof typeof tokens.badge> = {\n  preparing: 'neutral',\n  shipped: 'info',\n  delivered: 'success',\n  refunded: 'warning',\n}\n\nexport function StatusBadge({ status }: { status: OrderStatus }) {\n  return <Text style={[styles.badge, tokens.badge[TONE[status]]]}>{t(`order.status.${status}`)}</Text>\n}" },
        ],
        test: { command: 'npm run test -- StatusBadge', pass: ' PASS  components/StatusBadge.test.tsx\nTests:       4 passed, 4 total' },
        summary: 'Added a colored badge for the four statuses; the colors come from the theme tokens and stay readable in the dark theme. The labels come from the translation file.',
        model: 'sonnet',
      },
    ],
    questions: [],
  },
  {
    name: 'carsi-data',
    repo: 'carsi-app/carsi-data',
    snippets: {
      'models/marts/fct_orders.sql': "{{ config(materialized='incremental', unique_key='order_id') }}\n\nselect\n    o.order_id,\n    o.ordered_at,",
      'pipelines/orders_daily.py': 'from datetime import date\n\nimport polars as pl\n\n\ndef build_daily(day: date) -> pl.DataFrame:',
    },
    stories: [
      {
        title: 'Refunds not netted in the daily report',
        branch: 'fix/refund-netting',
        prompt: 'The daily orders report doesn’t subtract refunds from revenue. Fix the model.',
        read: ['models/marts/fct_orders.sql', 'pipelines/orders_daily.py', 'tests/test_orders_daily.py'],
        edits: [
          { file: 'models/marts/fct_orders.sql', old: '    o.gross_amount as net_amount,', new: '    o.gross_amount - coalesce(r.refunded_amount, 0) as net_amount,' },
          { file: 'models/marts/fct_orders.sql', old: "from {{ ref('stg_orders') }} o", new: "from {{ ref('stg_orders') }} o\nleft join {{ ref('int_refunds_by_order') }} r using (order_id)" },
        ],
        test: { command: 'pytest -q tests/test_orders_daily.py', fail: 'F.......\nFAILED tests/test_orders_daily.py::test_refunds_are_netted - assert 1840.0 == 1650.0\n1 failed, 7 passed in 1.92s', pass: '........\n8 passed in 1.88s' },
        summary: 'Net revenue is now computed with refunds subtracted. Refunds are summed per order before the join, so an order with several refunds doesn’t fan out into duplicate rows. I reran the last 7 days and the totals match finance’s numbers.',
        pr: true,
        review: { comment: '@can: Let’s add a unique test on int_refunds_by_order too, so the join can’t duplicate rows.', edit: { file: 'models/intermediate/schema.yml', old: '  - name: int_refunds_by_order', new: '  - name: int_refunds_by_order\n    columns:\n      - name: order_id\n        tests: [unique, not_null]' }, reply: 'Added the test and it passes; one row per order is now guaranteed.' },
      },
      {
        title: 'Currency conversion for payments',
        branch: 'feat/fx-conversion',
        prompt: 'stg_payments sums EUR and USD payments without converting them to TRY. Convert them at the daily rate.',
        read: ['models/staging/stg_payments.sql', 'models/staging/stg_fx_rates.sql'],
        edits: [
          { file: 'models/staging/stg_payments.sql', old: '    amount as amount_try,', new: "    amount * coalesce(fx.rate, 1) as amount_try,\n    currency," },
        ],
        test: { command: 'dbt test --select stg_payments', fail: "Failure in test not_null_stg_payments_amount_try\n  Got 12 results, configured to fail if != 0", pass: 'Completed successfully\nDone. PASS=6 WARN=0 ERROR=0 SKIP=0 TOTAL=6' },
        summary: 'Payments are now converted to TRY at the rate of the payment date. 12 records had no rate because they fell on a weekend; for those days I use the last business day’s rate, and I documented that in the model description.',
      },
      {
        title: 'Reprocessing late-arriving data',
        branch: 'feat/late-data',
        prompt: 'The payment provider sends some records 2 days late and the daily report misses them. Have the DAG reprocess the last 3 days.',
        read: ['dags/orders.py', 'models/marts/fct_orders.sql'],
        edits: [
          { file: 'models/marts/fct_orders.sql', old: '  where ordered_at > (select max(ordered_at) from {{ this }})', new: "  where ordered_at > (select max(ordered_at) from {{ this }}) - interval '3 days'" },
          { file: 'dags/orders.py', old: '    catchup=False,', new: '    catchup=False,\n    # The payment provider sends some records up to two days late.\n    params={"lookback_days": 3},' },
        ],
        test: { command: 'dbt build --select fct_orders', pass: 'Completed successfully\nDone. PASS=9 WARN=0 ERROR=0 SKIP=0 TOTAL=9' },
        summary: 'The incremental model now reprocesses the last 3 days on every run, and unique_key keeps duplicate rows out. Run time went from 40 to 55 seconds, which is acceptable.',
      },
      {
        title: 'dbt tests for fct_orders',
        branch: 'test/fct-orders',
        prompt: 'Write the basic dbt tests for fct_orders: order_id unique and not null, net amount never negative.',
        read: ['models/marts/schema.yml'],
        edits: [
          { file: 'models/marts/schema.yml', old: '  - name: fct_orders', new: '  - name: fct_orders\n    columns:\n      - name: order_id\n        tests: [unique, not_null]\n      - name: net_amount\n        tests:\n          - dbt_utils.accepted_range:\n              min_value: 0' },
        ],
        test: { command: 'dbt test --select fct_orders', pass: 'Completed successfully\nDone. PASS=4 WARN=0 ERROR=0 SKIP=0 TOTAL=4' },
        summary: 'Added four tests and they all pass. The lower bound for net_amount is zero; fully refunded orders stay at zero and nothing goes negative.',
        model: 'sonnet',
      },
      {
        title: 'Customer cohort model',
        branch: 'feat/customer-cohorts',
        prompt: 'Marketing needs a monthly customer cohort model: group customers by the month of their first order and work out how many of them order again in the months after.',
        read: ['models/marts/fct_orders.sql', 'models/marts/dim_customers.sql'],
        edits: [
          { file: 'models/marts/fct_customer_cohorts.sql', old: '', new: "with first_orders as (\n    select customer_id, date_trunc('month', min(ordered_at)) as cohort_month\n    from {{ ref('fct_orders') }}\n    group by 1\n)\nselect\n    f.cohort_month,\n    date_trunc('month', o.ordered_at) as order_month,\n    count(distinct o.customer_id) as customers\nfrom {{ ref('fct_orders') }} o\njoin first_orders f using (customer_id)\ngroup by 1, 2" },
        ],
        test: { command: 'dbt build --select fct_customer_cohorts', pass: 'Completed successfully\nDone. PASS=3 WARN=0 ERROR=0 SKIP=0 TOTAL=3' },
        summary: 'The cohort model is ready: for each first-order month, how many customers ordered again in each month after. I’d compute the rate in the dashboard rather than in the model, so different breakdowns can come from the same model.',
        bigContext: true,
        pr: true,
        review: { comment: '@can: Refunded first orders shouldn’t count toward a cohort.', edit: { file: 'models/marts/fct_customer_cohorts.sql', old: "    from {{ ref('fct_orders') }}\n    group by 1", new: "    from {{ ref('fct_orders') }}\n    where net_amount > 0\n    group by 1" }, reply: 'Fully refunded orders no longer count as a first order; cohort sizes shrank by about 3% on average, as expected.' },
      },
      {
        title: 'Cleaning up Ruff warnings',
        branch: 'chore/ruff',
        prompt: 'ruff check reports 37 warnings. Clean them up without changing behavior.',
        read: ['pyproject.toml'],
        edits: [
          { file: 'pipelines/refunds.py', old: 'from typing import List, Dict', new: '' },
          { file: 'pipelines/orders_daily.py', old: '    except:', new: '    except pl.exceptions.ComputeError:' },
        ],
        test: { command: 'ruff check . && pytest -q', fail: 'Found 37 errors.\n[*] 31 fixable with the --fix option.', pass: 'All checks passed!\n........................\n24 passed in 1.91s' },
        summary: '31 of the 37 warnings were fixed automatically, and I fixed the remaining 6 by hand. One was a real bug: a bare except that also swallowed Ctrl+C. All tests pass.',
        model: 'sonnet',
      },
    ],
    questions: [
      {
        title: 'Catching late-arriving data in dbt',
        prompt: 'What’s the standard way to not miss late-arriving rows in an incremental dbt model?',
        answer: 'The usual approach is a lookback window: start the incremental filter not from max(date) but from max(date) minus N days, and use the merge strategy with a unique_key. That way the last N days of rows are rewritten on every run without creating duplicates. Pick N from the source’s actual delay; making it too large only makes runs longer for nothing.',
      },
    ],
  },
  {
    name: 'carsi-infra',
    repo: 'carsi-app/carsi-infra',
    snippets: {
      'terraform/envs/staging/main.tf': 'module "api" {\n  source = "../../modules/api"\n\n  environment = "staging"',
    },
    stories: [
      {
        title: 'Separate database for staging',
        branch: 'feat/staging-db',
        prompt: 'Staging uses a copy of the prod database. Set up its own small database, and don’t copy the prod settings.',
        read: ['terraform/envs/staging/main.tf', 'terraform/modules/db/variables.tf'],
        edits: [
          { file: 'terraform/envs/staging/main.tf', old: '  database_url = data.aws_ssm_parameter.prod_db_url.value', new: '  database_url = module.staging_db.connection_url' },
        ],
        test: { command: 'terraform plan', pass: 'Plan: 3 to add, 1 to change, 0 to destroy.' },
        summary: 'Staging now has its own db.t4g.small instance, with 1-day backups and deletion protection off. The plan adds 3 resources and only changes the staging API’s connection URL; it doesn’t touch prod.',
        model: 'sonnet',
      },
      {
        title: 'Approval step for prod deploys',
        branch: 'feat/deploy-approval',
        prompt: 'Add a manual approval to the prod deploy workflow; staging stays automatic.',
        read: ['.github/workflows/deploy.yml'],
        edits: [
          { file: '.github/workflows/deploy.yml', old: '  deploy-prod:\n    runs-on: ubuntu-latest', new: '  deploy-prod:\n    runs-on: ubuntu-latest\n    environment: production' },
        ],
        test: { command: 'actionlint .github/workflows/deploy.yml', pass: '(no problems found)' },
        summary: 'The prod job is now tied to the production environment; once you add required reviewers to that environment on GitHub, deploys will wait for approval. I didn’t touch the staging job.',
      },
      {
        title: 'Memory limits on the API pods',
        branch: 'fix/api-memory',
        prompt: 'The API pods keep restarting with OOMKilled. Take a look at the limits.',
        read: ['k8s/api/deployment.yaml'],
        edits: [
          { file: 'k8s/api/deployment.yaml', old: '            memory: 256Mi', new: '            memory: 512Mi' },
        ],
        test: { command: 'kubectl diff -f k8s/api/deployment.yaml', pass: '-            memory: 256Mi\n+            memory: 512Mi' },
        summary: 'Over the last 7 days the pods use 310–340 MiB at peak hours, so the 256 MiB limit wasn’t enough. I raised the limit to 512 MiB and left the request at 384 MiB. I also added an alert that fires when memory goes over 85%.',
      },
      {
        title: 'CDN caching for static files',
        branch: 'perf/cdn-cache',
        prompt: 'Next.js static files aren’t being cached on the CDN. Add the right cache rules.',
        read: ['terraform/modules/cdn/main.tf'],
        edits: [
          { file: 'terraform/modules/cdn/main.tf', old: '  default_ttl = 0', new: '  default_ttl = 0\n\n  ordered_cache_behavior {\n    path_pattern     = "/_next/static/*"\n    cache_policy_id  = data.aws_cloudfront_cache_policy.caching_optimized.id\n    target_origin_id = "web"\n    viewer_protocol_policy = "redirect-to-https"\n    allowed_methods  = ["GET", "HEAD"]\n    cached_methods   = ["GET", "HEAD"]\n  }' },
        ],
        test: { command: 'terraform plan', pass: 'Plan: 0 to add, 1 to change, 0 to destroy.' },
        summary: 'Files under /_next/static now stay cached on the CDN for a year, which is safe because their names carry a content hash. HTML pages aren’t cached.',
      },
    ],
    questions: [],
  },
  {
    name: 'carsi-docs',
    repo: 'carsi-app/carsi-docs',
    snippets: {
      'docs/api/refunds.mdx': '---\ntitle: Refunds\n---\n\nUse the `POST /v1/refunds` endpoint to create a refund.',
    },
    stories: [
      {
        title: 'Partial refunds in the refund docs',
        branch: 'docs/partial-refunds',
        prompt: 'Update the refunds API docs for partial refunds: the amount field, the 422 error and an example request.',
        read: ['docs/api/refunds.mdx'],
        edits: [
          { file: 'docs/api/refunds.mdx', old: 'Use the `POST /v1/refunds` endpoint to create a refund.', new: 'Use the `POST /v1/refunds` endpoint to create a refund. If you pass `amount`, the refund is partial; a payment can take more than one partial refund.\n\n:::warning\nIf the refunds add up to more than the payment amount, the request is rejected with `422 refund_exceeds_payment`.\n:::' },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'The docs now cover partial refunds, the total limit and the 422 error, with curl and Go examples.',
        model: 'sonnet',
      },
      {
        title: 'Broken internal links',
        branch: 'fix/broken-links',
        prompt: 'The build warns about broken links. Find them and fix them.',
        read: ['docusaurus.config.ts'],
        edits: [
          { file: 'docs/api/orders.mdx', old: '[partial refund](../refunds#partial)', new: '[partial refund](./refunds.mdx#partial-refunds)' },
        ],
        test: { command: 'npm run build', fail: '[ERROR] Docusaurus found broken links!\n- Broken link on source page path = /docs/api/orders:\n   -> linking to ../refunds#partial', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'There was one broken link: the anchor changed when its heading was renamed. Fixed it, and onBrokenLinks is now "throw", so the next broken link will stop the build.',
        model: 'sonnet',
      },
      {
        title: 'October release notes',
        branch: 'docs/release-notes-oct',
        prompt: 'Write the October release notes from the PRs merged since September.',
        read: ['docs/changelog.mdx'],
        skill: 'release-notes',
        edits: [
          { file: 'docs/changelog.mdx', old: '## September 2026', new: '## October 2026\n\n- **Partial refunds:** a payment can now take more than one partial refund.\n- **Webhook security:** unsigned requests are rejected.\n- **Faster product page:** on mobile the product page opens about twice as fast.\n\n## September 2026' },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'Out of 14 PRs I picked the 3 changes that matter to customers and wrote them up in plain language; internal changes are left out.',
        model: 'sonnet',
      },
      {
        title: 'Webhook signature verification guide',
        branch: 'docs/webhook-signatures',
        prompt: 'Write a guide for customers on verifying webhook signatures: why it matters, with Node and Go examples.',
        read: ['docs/api/webhooks.mdx'],
        edits: [
          { file: 'docs/guides/webhook-signatures.mdx', old: '', new: "---\ntitle: Verifying webhook signatures\n---\n\nEvery webhook request carries an HMAC-SHA256 signature in the `Carsi-Signature` header. Do not process a request until you have verified its signature." },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'The guide is written: what the signature is, the timestamp tolerance, and Node and Go examples. The most common mistake (parsing the body as JSON and verifying afterwards) gets its own warning box.',
        model: 'sonnet',
      },
    ],
    questions: [],
  },
]

/** Asked again and again across sessions. */
export const ROUTINE_TESTS_EN = "Run the tests, fix anything that's red, and give me a short summary at the end"
export const ROUTINE_PR_EN = 'Commit the changes and open a PR, put the test plan in the description'

export const CLAUDE_MD_WEB_EN = `# carsi-web

Çarşı's customer site: an online bazaar selling products from local producers. Product listings, cart, checkout and order tracking. Next.js App Router, TypeScript, Tailwind, Zustand, Vitest and Playwright.

## Commands

- \`npm run dev\`: dev server, http://localhost:3000
- \`npm run test\`: Vitest unit tests. For a single file, \`npm run test -- pricing\`
- \`npm run typecheck\`: \`tsc --noEmit\`
- \`npm run lint\`: ESLint and Prettier checks
- \`npx playwright test\`: end-to-end tests; needs \`npm run build && npm start\` first
- \`npm run clean\`: safely deletes \`.next\` and the cache folders. Don't \`rm -rf\` them by hand.

## Folder layout

- \`src/app/(shop)\`: customer-facing pages. Pages are server components by default.
- \`src/app/api\`: route handlers. The mobile app uses these endpoints too; change them without breaking the contract.
- \`src/components\`: shared components. Client components are marked with \`'use client'\` at the top of the file.
- \`src/lib\`: business logic. Pricing, cart, orders and validation live here; components hold no business logic.
- \`tests\`: Vitest tests. \`tests/e2e\`: Playwright scenarios.

## Money and prices

- All amounts are kept in kuruş, as an integer \`number\`. Never do money math with floats.
- Use only \`formatPrice\` to display them; no hand formatting with \`toFixed\`.
- Discounts are computed once from the subtotal and rounded once, at the very end.
- VAT is included in prices; the cart summary shows it separately and never adds it again.
- Coupon rules live in \`src/lib/pricing.ts\`; before adding a new coupon type, write a test there.

## Forms and validation

- All form schemas are defined with zod in \`src/lib/validation.ts\`. Server and client share the same schema.
- Error messages are short, plain and shown right below the field.
- Every invalid field is tied to its error text with \`aria-invalid\` and \`aria-describedby\`.
- Postal codes are stored as 5 digits, phone numbers in E.164 format.

## Accessibility

- Every interactive element must be reachable by keyboard; don't use a clickable \`div\`, use a \`button\`.
- Image \`alt\` text names the product and its variant; decorative images get \`alt=""\`.
- Color contrast is at least WCAG AA. Stay within the design tokens.
- Modals and drawers keep focus inside and close on Escape.

## Internationalization

- Strings live in \`messages/tr.json\` and \`messages/en.json\`. Don't hardcode text.
- When adding a key, add it to both languages; a missing key fails CI.
- Dates and numbers are formatted with \`Intl\`, in the user's language.

## Tests

- Before fixing a bug, write a test that catches it and watch it fail.
- Keep unit tests fast; fake network and database calls with the helpers under \`tests/mocks\`.
- Only update snapshot tests for a deliberate visual change.
- In Playwright tests use \`getByRole\` and \`getByLabel\`; don't depend on CSS selectors.
- The payment form is inside an iframe; in Playwright, reach it with \`frameLocator('#payment-frame')\`.

## API endpoints

- Endpoints return JSON; errors come as \`{ error: string }\` with the right HTTP status.
- The orders endpoint is limited to 30 requests per minute per IP; the counter lives in Redis.
- When adding an endpoint, validate the request body with zod and let the mobile team know.

## Performance

- The mobile LCP target for the product page is under 2.5 seconds.
- A page's first image loads with \`priority\` and the right \`sizes\`.
- Heavy client components (reviews, recommendations) load later with \`dynamic\`.
- Check the bundle size before adding a new dependency.

## Git and PRs

- Branch names start with \`fix/\`, \`feat/\`, \`perf/\`, \`refactor/\`, \`test/\` or \`chore/\`.
- No direct pushes to \`main\`; every change goes through a PR.
- In the PR description: what changed, why, and how it was tested.
- Commit messages are short and in the imperative: "Compute the coupon discount from the subtotal".

## Common mistakes

- \`cookies()\` and \`headers()\` return a Promise since Next.js 16; don't forget to \`await\` them.
- \`useState\` doesn't work in a server component; if you need interaction, split out a small client component.
- Mobile Safari doesn't fire \`click\` while scrolling; use \`pointerdown\` for tap-to-close.
- The shell is zsh: quote arguments that contain globs.
`
