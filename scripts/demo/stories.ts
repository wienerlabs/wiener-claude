// What the demo's sessions are about. Each story is one piece of work, told the way it goes in
// Claude Code: read the code, watch a test fail, change a few lines, see it pass, sum up.
// Everything is invented; the projects, issues and numbers belong to no one.

import { WEB_EXTRA } from './stories-web.ts'

export interface Edit {
  file: string
  old: string
  new: string
}

export interface Test {
  command: string
  fail?: string
  pass: string
}

export interface FollowUp {
  prompt: string
  edit: Edit
  reply: string
}

export interface Story {
  title: string
  branch: string
  prompt: string
  read: string[]
  grep?: string
  /** The first grep goes out unquoted and zsh rejects the glob, as it does. */
  zshGlob?: boolean
  issue?: { id: string; text: string }
  web?: { kind: 'search' | 'fetch'; value: string; result: string }
  explore?: string
  skill?: string
  plan?: string
  ask?: { question: string; options: string[]; answer: string }
  /** Claude starts on the wrong file; the person stops it and says where to look. */
  interrupt?: { file: string; prompt: string }
  /** A cache wipe auto mode won't run, and the script Claude uses instead. */
  blocked?: { command: string; instead: string }
  /** A command Claude's machine doesn't have. */
  missingTool?: boolean
  todos?: string[]
  edits: Edit[]
  test: Test
  summary: string
  followUps?: FollowUp[]
  pr?: boolean
  /** Review comments on the PR, answered in a later session. */
  review?: { comment: string; edit: Edit; reply: string }
  model?: 'sonnet'
  bigContext?: boolean
  fast?: boolean
}

export interface Question {
  title: string
  prompt: string
  answer: string
}

export interface ProjectStories {
  name: string
  repo: string
  /** Shown when a file is read: the opening lines of the files Claude reads most. */
  snippets: Record<string, string>
  stories: Story[]
  questions: Question[]
}

const vitestFail = (file: string, name: string, line: number, message: string) =>
  ` FAIL  ${file} > ${name}\n${message}\n ❯ ${file}:${line}:24\n\n Test Files  1 failed | 11 passed (12)\n      Tests  1 failed | 86 passed (87)\n   Duration  2.38s`
const vitestPass = (tests: number) => ` Test Files  12 passed (12)\n      Tests  ${tests} passed (${tests})\n   Duration  2.41s`
const goFail = (pkg: string, test: string, file: string, line: number, message: string) =>
  `--- FAIL: ${test} (0.03s)\n    ${file}:${line}: ${message}\nFAIL\nFAIL\tgithub.com/carsi-app/carsi-payments/internal/${pkg}\t0.241s\nFAIL`
const goPass = (pkg: string) => `ok  \tgithub.com/carsi-app/carsi-payments/internal/${pkg}\t0.233s`

export const STORIES: ProjectStories[] = [
  {
    name: 'carsi-web',
    repo: 'carsi-app/carsi-web',
    snippets: {
      'src/lib/pricing.ts': "import type { CartItem, Coupon } from './types'\n\n/** Kuruş cinsinden ara toplam. */\nexport function subtotal(items: CartItem[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)\n}",
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
      'emails/README.md': '# E-postalar\n\nŞablonlar React Email ile yazılır; önizleme için `npm run email:dev`.',
      'src/lib/format.ts': "const try2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })",
      'src/components/CartDrawer.tsx': "'use client'\n\nimport { useCart } from '@/lib/cart'\n\nexport function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {",
      'src/components/CartSummary.tsx': "import { formatPrice } from '@/lib/format'\n\nexport function CartSummary({ total }: { total: number }) {",
    },
    stories: [
      {
        title: 'Kupon indiriminde 1 kuruş sapma',
        branch: 'fix/coupon-rounding',
        prompt: 'Sepette %15 kupon uygulanınca toplam 1 kuruş eksik çıkıyor: 42,50 olması gereken yerde 42,49 görüyorum. Sebebini bul ve düzelt.',
        read: ['src/lib/pricing.ts', 'src/lib/cart.ts', 'tests/pricing.test.ts'],
        grep: 'applyCoupon',
        edits: [
          { file: 'src/lib/pricing.ts', old: '  const discount = items.reduce((sum, item) => sum + Math.round(item.price * item.quantity * coupon.rate), 0)', new: '  // Rounding per item drifts by a kuruş on larger carts; round once, on the subtotal.\n  const discount = Math.round(subtotal(items) * coupon.rate)' },
          { file: 'tests/pricing.test.ts', old: "  it('applies a percentage coupon', () => {", new: "  it('rounds a percentage coupon once, on the subtotal', () => {\n    expect(applyCoupon(threeItems, percent15).total).toBe(4250)\n  })\n\n  it('applies a percentage coupon', () => {" },
        ],
        test: { command: 'npm run test -- pricing', fail: vitestFail('tests/pricing.test.ts', 'applyCoupon > rounds a percentage coupon once, on the subtotal', 31, 'AssertionError: expected 4249 to be 4250 // Object.is equality'), pass: vitestPass(88) },
        summary: 'Sebep bulundu: indirim her ürün için ayrı ayrı yuvarlanıp toplanıyordu, üç ürünlü sepette toplam 1 kuruş sapıyordu. İndirimi artık ara toplamdan tek seferde hesaplıyorum. Hatayı yakalayan testi ekledim; 88 testin hepsi geçiyor.',
        followUps: [
          { prompt: 'Sabit tutarlı kuponlarda toplam negatife düşebiliyor mu? Düşmesin.', edit: { file: 'src/lib/pricing.ts', old: '  return subtotal(items) - discount', new: '  return Math.max(0, subtotal(items) - discount)' }, reply: 'Düşebiliyordu: 100 TL’lik kupon 80 TL’lik sepette -20 TL veriyordu. Toplamı sıfırda sabitledim ve bu durum için bir test ekledim.' },
        ],
        pr: true,
        review: { comment: '@deniz: applyCoupon içindeki yorum İngilizce kalsın ama sabit tutarlı kupon için de bir test görelim; ikisi aynı sepette uygulanırsa ne oluyor?', edit: { file: 'tests/pricing.test.ts', old: "  it('applies a percentage coupon', () => {", new: "  it('never lets a fixed coupon push the total below zero', () => {\n    expect(applyCoupon(smallCart, fixed100).total).toBe(0)\n  })\n\n  it('applies a percentage coupon', () => {" }, reply: 'Sabit tutarlı kupon için testi ekledim. Aynı sepette iki kupon zaten engelleniyor (tek kupon kuralı), bunu da PR açıklamasına not düştüm.' },
      },
      {
        title: 'Ödeme sayfasında adres doğrulaması',
        branch: 'feat/address-validation',
        prompt: 'Ödeme sayfasına adres doğrulaması ekle: posta kodu 5 hane, il ve ilçe zorunlu. Hatalar ilgili alanın altında görünsün.',
        read: ['src/app/(shop)/checkout/page.tsx', 'src/components/AddressForm.tsx', 'src/lib/validation.ts'],
        skill: 'frontend-design:frontend-design',
        todos: ['Adres şemasını yaz', 'Formda hataları göster', 'Testleri ekle'],
        edits: [
          { file: 'tests/AddressForm.test.tsx', old: '', new: "import { render, screen } from '@testing-library/react'\nimport userEvent from '@testing-library/user-event'\nimport { describe, expect, it } from 'vitest'\nimport { AddressForm } from '@/components/AddressForm'\n\ndescribe('AddressForm', () => {\n  it('posta kodu 4 haneyse hata gösterir', async () => {\n    render(<AddressForm onSubmit={() => {}} />)\n    await userEvent.type(screen.getByLabelText('Posta kodu'), '3400')\n    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))\n    expect(await screen.findByText('Posta kodu 5 haneli olmalı')).toBeVisible()\n  })\n\n  it('il seçilmeden ilçe listesini açmaz', () => {\n    render(<AddressForm onSubmit={() => {}} />)\n    expect(screen.getByLabelText('İlçe')).toBeDisabled()\n  })\n})" },
          { file: 'src/lib/validation.ts', old: 'export const addressSchema = z.object({\n  line1: z.string().min(1),', new: "export const addressSchema = z.object({\n  line1: z.string().min(1, 'Adres satırı zorunlu'),\n  city: z.string().min(1, 'İl seçin'),\n  district: z.string().min(1, 'İlçe seçin'),\n  postalCode: z.string().regex(/^\\d{5}$/, 'Posta kodu 5 haneli olmalı')," },
          { file: 'src/components/AddressForm.tsx', old: '      <input {...register(\'postalCode\')} />', new: "      <input {...register('postalCode')} aria-invalid={!!errors.postalCode} />\n      {errors.postalCode ? <p className=\"field-error\">{errors.postalCode.message}</p> : null}" },
        ],
        test: { command: 'npm run test -- AddressForm', fail: vitestFail('tests/AddressForm.test.tsx', 'AddressForm > posta kodu 4 haneyse hata gösterir', 22, "TestingLibraryElementError: Unable to find an element with the text: Posta kodu 5 haneli olmalı"), pass: vitestPass(91) },
        summary: 'Adres şeması artık il, ilçe ve 5 haneli posta kodunu zorunlu tutuyor; hatalar ilgili alanın hemen altında çıkıyor. Üç yeni test ekledim, hepsi geçiyor.',
        followUps: [
          { prompt: 'Hata mesajlarını ekran okuyucu da okusun.', edit: { file: 'src/components/AddressForm.tsx', old: '      <input {...register(\'postalCode\')} aria-invalid={!!errors.postalCode} />', new: "      <input {...register('postalCode')} aria-invalid={!!errors.postalCode} aria-describedby=\"postalCode-error\" />" }, reply: 'Her alan artık hata metnine aria-describedby ile bağlı; ekran okuyucu alana gelince hatayı da okuyor.' },
        ],
        pr: true,
        review: { comment: '@ece: İlçe listesi il seçilmeden açılmasın; şu an boş liste görünüyor.', edit: { file: 'src/components/AddressForm.tsx', old: "      <select {...register('district')}>", new: "      <select {...register('district')} disabled={!city}>" }, reply: 'İlçe seçimi il seçilene kadar kapalı ve yer tutucusu "Önce il seçin" diyor. Testi de güncelledim.' },
      },
      {
        title: 'Sipariş API’sine rate limit',
        branch: 'feat/orders-rate-limit',
        prompt: 'Sipariş API’sine IP başına dakikada 30 istek sınırı koy. Aşılınca 429 ve Retry-After başlığı dönsün.',
        read: ['src/app/api/orders/route.ts', 'src/lib/ratelimit.ts'],
        edits: [
          { file: 'tests/orders.route.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { POST } from '@/app/api/orders/route'\n\nconst order = () => new Request('http://test/api/orders', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, body: JSON.stringify(sampleOrder) })\n\ndescribe('POST /api/orders', () => {\n  it('31. istekte 429 döner', async () => {\n    for (let i = 0; i < 30; i++) expect((await POST(order())).status).toBe(201)\n    const res = await POST(order())\n    expect(res.status).toBe(429)\n    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)\n  })\n})" },
          { file: 'src/app/api/orders/route.ts', old: 'export async function POST(req: Request) {', new: "export async function POST(req: Request) {\n  const limit = await ordersLimiter.check(clientIp(req))\n  if (!limit.ok) {\n    return NextResponse.json({ error: 'Çok fazla istek' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } })\n  }" },
        ],
        test: { command: 'npm run test -- orders', fail: vitestFail('tests/orders.route.test.ts', 'POST /api/orders > 31. istekte 429 döner', 44, 'AssertionError: expected 201 to be 429 // Object.is equality'), pass: vitestPass(93) },
        summary: 'Sipariş ucu IP başına dakikada 30 istekle sınırlı; aşılınca 429 ve kaç saniye sonra tekrar denenebileceğini söyleyen Retry-After dönüyor. Sınır sayacı mevcut Redis bağlantısını kullanıyor, yeni bağımlılık yok.',
        pr: true,
        review: { comment: '@mert: Kurumsal müşteriler tek IP arkasından geliyor; API anahtarı varsa sınırı anahtara göre uygulayalım.', edit: { file: 'src/app/api/orders/route.ts', old: '  const limit = await ordersLimiter.check(clientIp(req))', new: "  const limit = await ordersLimiter.check(req.headers.get('x-api-key') ?? clientIp(req))" }, reply: 'API anahtarı varsa sınır anahtar başına, yoksa IP başına uygulanıyor. Kurumsal hesaplar için ayrı bir kota gerekirse sonraki adımda ekleyebiliriz.' },
      },
      {
        title: 'Misafir ödeme için uçtan uca test',
        branch: 'test/guest-checkout-e2e',
        prompt: 'Misafir kullanıcı kuponla ödeme yapıyor senaryosu için bir Playwright testi yaz.',
        read: ['tests/e2e/checkout.spec.ts', 'playwright.config.ts'],
        edits: [
          { file: 'tests/e2e/guest-checkout.spec.ts', old: '', new: "test('misafir kullanıcı kuponla ödeme yapar', async ({ page }) => {\n  await page.goto('/urun/ayvalik-zeytinyagi-1l')\n  await page.getByRole('button', { name: 'Sepete ekle' }).click()\n  await page.getByLabel('Kupon kodu').fill('YAZ15')\n  await page.getByRole('button', { name: 'Ödemeye geç' }).click()\n  await expect(page.frameLocator('#payment-frame').getByLabel('Kart numarası')).toBeVisible()\n})" },
        ],
        test: { command: 'npx playwright test guest-checkout', fail: "  1) guest-checkout.spec.ts:3:1 › misafir kullanıcı kuponla ödeme yapar\n\n    Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n    Locator: getByLabel('Kart numarası')\n\n  1 failed", pass: '  3 passed (14.2s)' },
        summary: 'Test yazıldı. İlk denemede kart alanı bulunamadı çünkü ödeme formu bir iframe içinde; frameLocator ile içeri girince geçti. Senaryo sepet, kupon ve ödeme adımlarını uçtan uca dolaşıyor.',
      },
      {
        title: 'Next.js 16’ya geçiş',
        branch: 'chore/next-16',
        prompt: 'Next.js 16’ya geçelim. Önce kırılacakları listele, sonra adım adım düzelt.',
        read: ['package.json', 'next.config.ts', 'src/app/api/orders/route.ts'],
        web: { kind: 'fetch', value: 'https://nextjs.org/docs/app/guides/upgrading/version-16', result: 'Breaking changes: async request APIs (cookies, headers, params) are now Promise-only; experimental.ppr renamed; Node.js 20.9+ required.' },
        plan: '## Next.js 16 geçişi\n\n1. next, react ve react-dom sürümlerini yükselt\n2. cookies() ve headers() çağrılarını await’e çevir\n3. next.config.ts içindeki eski experimental anahtarlarını kaldır\n4. Typecheck ve build’i temiz geçir\n5. Ürün, sepet ve ödeme sayfalarını elle kontrol et',
        todos: ['Sürümleri yükselt', 'Async request API’lerini güncelle', 'Config’i temizle', 'Build’i geçir'],
        edits: [
          { file: 'src/app/api/orders/route.ts', old: "  const session = cookies().get('session')", new: "  const session = (await cookies()).get('session')" },
          { file: 'next.config.ts', old: '  experimental: { ppr: true },', new: '  cacheComponents: true,' },
        ],
        test: { command: 'npm run typecheck', fail: "src/app/api/orders/route.ts(12,28): error TS2339: Property 'get' does not exist on type 'Promise<ReadonlyRequestCookies>'.\nsrc/app/(shop)/cart/page.tsx(9,31): error TS2339: Property 'get' does not exist on type 'Promise<ReadonlyRequestCookies>'.\n\nFound 2 errors in 2 files.", pass: 'tsc --noEmit\n(no errors)' },
        summary: 'Geçiş tamam. Kırılan iki şey vardı: cookies() artık Promise döndürüyor (6 çağrıyı await’e çevirdim) ve experimental.ppr kaldırıldı (yerine cacheComponents). Typecheck temiz, build geçiyor; ürün, sepet ve ödeme sayfalarını elle de kontrol ettim.',
        pr: true,
        review: { comment: '@deniz: middleware.ts de proxy.ts olarak yeniden adlandırılmalı, uyarı veriyor.', edit: { file: 'src/proxy.ts', old: '', new: "export { middleware as proxy } from './middleware-impl'\nexport const config = { matcher: ['/((?!_next|favicon.ico).*)'] }" }, reply: 'middleware.ts proxy.ts oldu; build uyarısı gitti. Davranış değişmedi, yönlendirme testleri geçiyor.' },
        bigContext: true,
        blocked: { command: 'rm -rf .next/cache node_modules/.cache', instead: 'npm run clean' },
      },
      {
        title: 'Ürün sayfasının LCP süresi',
        branch: 'perf/product-lcp',
        prompt: 'Ürün sayfasının LCP’si mobilde 4 saniyenin üstünde. Sebebini bul ve 2,5 saniyenin altına indir.',
        read: ['src/app/(shop)/product/[slug]/page.tsx', 'src/components/ProductGallery.tsx'],
        explore: 'LCP öğesi galerideki ilk görsel. Görsel loading="lazy" ile yükleniyor ve 2400px genişliğinde tek bir dosya; sizes tanımlı değil. Ayrıca yorumlar bileşeni ilk boyamayı engelleyen 180 KB’lık bir istemci paketi yüklüyor.',
        edits: [
          { file: 'src/components/ProductGallery.tsx', old: '        <Image src={images[0].url} alt={images[0].alt} fill loading="lazy" />', new: '        <Image src={images[0].url} alt={images[0].alt} fill priority sizes="(max-width: 768px) 100vw, 50vw" />' },
          { file: 'src/app/(shop)/product/[slug]/page.tsx', old: "import { Reviews } from '@/components/Reviews'", new: "const Reviews = dynamic(() => import('@/components/Reviews'))" },
        ],
        test: { command: 'npm run build', pass: '✓ Compiled successfully in 18.4s\nRoute (app)                 Size  First Load JS\n┌ ○ /                    5.21 kB         118 kB\n├ ● /product/[slug]      7.84 kB         121 kB' },
        summary: 'İki sebep vardı: LCP görseli lazy yükleniyordu ve sizes eksikti, yorumlar bileşeni de ilk yüklemeye 180 KB ekliyordu. Görseli priority yaptım ve sizes ekledim, yorumları sonradan yükleniyor. Yerel Lighthouse ölçümünde mobil LCP 4,1 sn’den 2,2 sn’ye indi.',
        fast: true,
      },
      {
        title: 'Mobilde kapanmayan sepet çekmecesi',
        branch: 'fix/cart-drawer-close',
        prompt: 'Mobilde sepet çekmecesi dışarı dokununca kapanmıyor. Düzelt.',
        read: ['src/components/CartSummary.tsx'],
        interrupt: { file: 'src/components/CartSummary.tsx', prompt: 'Hayır, sorun özette değil, çekmecenin kendisinde: CartDrawer’daki dokunma olayına bak.' },
        edits: [
          { file: 'src/components/CartDrawer.tsx', old: '    <div className="overlay" onClick={onClose} />', new: '    <div className="overlay" onPointerDown={onClose} />' },
        ],
        test: { command: 'npm run test -- CartDrawer', pass: vitestPass(94) },
        summary: 'Haklıydın, sorun CartDrawer’daydı: arka plan yalnızca click dinliyordu ve iOS Safari kaydırma sırasında click üretmiyor. pointerdown’a çevirdim; masaüstü ve mobilde test ettim.',
      },
      {
        title: 'Fiyatlar için tek formatter',
        branch: 'refactor/format-price',
        prompt: 'Fiyatlar her yerde farklı biçimde yazılıyor. Tek bir formatPrice yaz ve her yerde onu kullan.',
        read: ['src/lib/format.ts'],
        grep: 'toFixed(2)',
        zshGlob: true,
        edits: [
          { file: 'tests/format.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { formatPrice } from '@/lib/format'\n\ndescribe('formatPrice', () => {\n  it('kuruşu Türk lirası olarak yazar', () => {\n    expect(formatPrice(123450)).toBe('₺1.234,50')\n  })\n\n  it('sıfırı da biçimlendirir', () => {\n    expect(formatPrice(0)).toBe('₺0,00')\n  })\n})" },
          { file: 'src/lib/format.ts', old: '', new: "const try2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })\n\n/** Kuruş cinsinden tutarı \"1.234,50 ₺\" biçiminde yazar. */\nexport const formatPrice = (kurus: number) => try2.format(kurus / 100)" },
          { file: 'src/components/CartSummary.tsx', old: '        <span>{(total / 100).toFixed(2)} TL</span>', new: '        <span>{formatPrice(total)}</span>' },
          { file: 'src/components/ProductCard.tsx', old: '      <p className="price">₺{(product.price / 100).toFixed(2)}</p>', new: '      <p className="price">{formatPrice(product.price)}</p>' },
        ],
        test: { command: 'npm run test', pass: vitestPass(96) },
        summary: 'formatPrice eklendi ve 7 dosyadaki toFixed(2) kullanımlarının hepsi buna geçti; artık her yerde "1.234,50 ₺" biçimi var. Snapshot testlerini güncelledim.',
        bigContext: true,
      },
      {
        title: 'Sepette stok kontrolü',
        branch: 'fix/cart-stock',
        prompt: 'Sepete stoktan fazla ürün eklenebiliyor. Miktar stoğu aşmasın, aşarsa kullanıcıya söyleyelim.',
        read: ['src/lib/cart.ts', 'src/components/CartSummary.tsx'],
        edits: [
          { file: 'src/lib/cart.ts', old: '    set({ items: upsert(get().items, product, quantity) })', new: "    const allowed = Math.min(quantity, product.stock)\n    set({ items: upsert(get().items, product, allowed) })\n    if (allowed < quantity) toast(`Stokta yalnızca ${product.stock} adet var`)" },
        ],
        test: { command: 'npm run test -- cart', fail: vitestFail('tests/cart.test.ts', 'addItem > miktarı stokla sınırlar', 27, 'AssertionError: expected 3 to be 2 // Object.is equality'), pass: vitestPass(98) },
        summary: 'Miktar artık stokla sınırlı; stoktan fazlası istenirse eklenebilen kadar ekleniyor ve kullanıcıya kaç adet kaldığı söyleniyor. Sunucu tarafındaki sipariş doğrulaması zaten stoğu kontrol ediyordu, bu yalnızca arayüzü onunla uyumlu hale getiriyor.',
      },
      {
        title: 'Eksik İngilizce çeviriler',
        branch: 'fix/i18n-missing-keys',
        prompt: 'İngilizce sitede bazı yerlerde anahtar adları görünüyor. Eksik çevirileri bul ve tamamla.',
        read: ['messages/tr.json', 'messages/en.json', 'scripts/i18n-check.ts'],
        edits: [
          { file: 'messages/en.json', old: '    "address": {', new: '    "address": {\n      "postalCode": "Postal code must be 5 digits",\n      "district": "Choose a district",' },
        ],
        test: { command: 'npm run i18n:check', fail: 'Missing keys in en.json (3):\n  checkout.address.postalCode\n  checkout.address.district\n  cart.stockLimit', pass: 'All 412 keys present in tr.json and en.json.' },
        summary: 'Üç eksik anahtar vardı, hepsi son iki özellikte (adres doğrulaması ve stok kontrolü) eklenmiş Türkçe metinlerdi. Çevirileri ekledim; i18n:check artık CI’da da çalışıyor, bir dahaki eksik build’i durduracak.',
        model: 'sonnet',
      },
      {
        title: 'Arama sonuçlarında sunucu tarafı sayfalama',
        branch: 'perf/search-pagination',
        prompt: 'Arama sayfası bütün sonuçları tek seferde çekiyor; 2000 ürünlü kategorilerde çok yavaş. Sunucuda sayfalayalım, sonsuz kaydırma kalsın.',
        read: ['src/app/(shop)/search/page.tsx', 'src/lib/search.ts'],
        edits: [
          { file: 'tests/search.test.ts', old: '', new: "import { describe, expect, it } from 'vitest'\nimport { search } from '@/lib/search'\n\ndescribe('search', () => {\n  it('24’lük sayfalar döner ve devamı olduğunu söyler', async () => {\n    const page = await search({ category: 'zeytinyagi' })\n    expect(page.items).toHaveLength(24)\n    expect(page.next).toBeTruthy()\n  })\n\n  it('imleçten sonraki sayfayı tekrarsız getirir', async () => {\n    const first = await search({ category: 'zeytinyagi' })\n    const second = await search({ category: 'zeytinyagi', after: first.next })\n    expect(second.items[0].id).not.toBe(first.items.at(-1)?.id)\n  })\n})" },
          { file: 'src/lib/search.ts', old: '  return db.product.findMany({ where })', new: '  return db.product.findMany({ where, take: PAGE_SIZE + 1, cursor: after ? { id: after } : undefined, skip: after ? 1 : 0, orderBy: { id: "asc" } })' },
        ],
        test: { command: 'npm run test -- search', pass: vitestPass(101) },
        summary: 'Arama artık 24’lük sayfalarla, imleç tabanlı sayfalama yapıyor; bir fazla kayıt çekip "daha var mı" bilgisini ayrı bir sayım sorgusu olmadan buluyoruz. 2000 ürünlü kategoride ilk yanıt 1,8 sn’den 210 ms’ye indi.',
        bigContext: true,
        pr: true,
        review: { comment: '@ece: Geri dönünce kaydırma konumu kayboluyor, sayfa başına atıyor.', edit: { file: 'src/app/(shop)/search/page.tsx', old: '  const [pages, setPages] = useState<Page[]>([first])', new: '  const [pages, setPages] = useSessionState<Page[]>(`search:${query}`, [first])' }, reply: 'Yüklenen sayfalar artık oturum boyunca saklanıyor; ürüne gidip geri gelince liste ve kaydırma konumu yerinde.' },
      },
      ...WEB_EXTRA,
    ],
    questions: [
      {
        title: 'Server action mı route handler mı',
        prompt: 'Next.js’te bir formu gönderirken server action ile route handler arasında neye göre seçmeliyim?',
        answer: 'Kısa kural: formu yalnızca kendi arayüzün gönderiyorsa server action, dışarıdan da çağrılacak bir uç gerekiyorsa route handler.\n\nServer action form durumu, hata gösterimi ve revalidatePath ile iyi entegre olur; ayrı bir fetch katmanı yazmazsın. Route handler ise mobil uygulama, webhook ya da başka bir servis aynı ucu kullanacaksa doğru seçim; HTTP sözleşmesi açık ve sürümlenebilir olur. Sizin durumunuzda ödeme formu için server action, mobil uygulamanın da kullandığı sipariş ucu için route handler mantıklı.',
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
        title: 'Çift işlenen iadeler',
        branch: 'fix/refund-race',
        prompt: 'Aynı iade isteği arka arkaya gelince iki kez işlenebiliyor. Yarış durumunu bul ve düzelt.',
        issue: { id: 'PAY-218', text: 'Destek ekibi: aynı siparişe iki iade yansımış. Müşteri butona iki kez basmış olabilir. Ledger’da aynı payment_id için iki refund kaydı var.' },
        read: ['internal/refund/service.go', 'internal/ledger/ledger.go', 'internal/refund/service_test.go'],
        edits: [
          { file: 'internal/refund/service.go', old: '\tp, err := s.payments.Get(ctx, tx, req.PaymentID)', new: '\t// Lock the payment row so a second request waits instead of refunding again.\n\tp, err := s.payments.GetForUpdate(ctx, tx, req.PaymentID)' },
          { file: 'internal/refund/service.go', old: '\tif p.Status == StatusRefunded {', new: '\tif p.Status == StatusRefunded || p.Status == StatusRefunding {' },
        ],
        test: { command: 'go test ./internal/refund/...', fail: goFail('refund', 'TestRefund_ConcurrentRequests', 'service_test.go', 58, 'ledger entries = 2, want 1'), pass: goPass('refund') },
        summary: 'Sebep: iki istek ödeme satırını aynı anda okuyup ikisi de "henüz iade edilmemiş" görüyordu. Satırı artık SELECT … FOR UPDATE ile kilitliyorum ve "iade ediliyor" durumunu da kontrol ediyorum. Eşzamanlı iki istekle yazdığım test artık tek ledger kaydı görüyor.',
        pr: true,
        review: { comment: '@selin: Kilit beklerken istek ne kadar bekliyor? Bir zaman aşımı koyalım.', edit: { file: 'internal/refund/service.go', old: '\tp, err := s.payments.GetForUpdate(ctx, tx, req.PaymentID)', new: '\tlockCtx, cancel := context.WithTimeout(ctx, 3*time.Second)\n\tdefer cancel()\n\tp, err := s.payments.GetForUpdate(lockCtx, tx, req.PaymentID)' }, reply: 'Kilit için 3 saniyelik zaman aşımı ekledim; süre dolarsa istek 409 ile dönüyor ve istemci yeniden deneyebiliyor.' },
      },
      {
        title: 'Stripe webhook imza doğrulaması',
        branch: 'feat/webhook-signature',
        prompt: 'Stripe webhook’larında imza doğrulaması yok. Ekle ve geçersiz imzada 400 dönsün.',
        read: ['internal/webhooks/stripe.go', 'internal/http/router.go'],
        web: { kind: 'search', value: 'stripe-go webhook ConstructEvent tolerance', result: 'webhook.ConstructEventWithOptions(payload, header, secret, ConstructEventOptions{Tolerance: 5 * time.Minute}) verifies the Stripe-Signature header.' },
        edits: [
          { file: 'internal/webhooks/stripe.go', old: '\tvar event stripe.Event\n\tif err := json.Unmarshal(payload, &event); err != nil {', new: '\tevent, err := webhook.ConstructEventWithOptions(payload, r.Header.Get("Stripe-Signature"), h.secret,\n\t\twebhook.ConstructEventOptions{Tolerance: 5 * time.Minute})\n\tif err != nil {\n\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)\n\t\treturn\n\t}' },
        ],
        test: { command: 'go test ./internal/webhooks/...', fail: goFail('webhooks', 'TestStripeWebhook_InvalidSignature', 'stripe_test.go', 31, 'status = 200, want 400'), pass: goPass('webhooks') },
        summary: 'Webhook’lar artık Stripe-Signature başlığıyla doğrulanıyor; geçersiz ya da 5 dakikadan eski imzada 400 dönüyor. Gizli anahtar ortam değişkeninden okunuyor, koda yazılmadı.',
        pr: true,
        review: { comment: '@selin: Geçersiz imzaları loglayalım ama gövdeyi değil, sadece event id ve IP.', edit: { file: 'internal/webhooks/stripe.go', old: '\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)', new: '\t\th.log.Warn("stripe webhook: invalid signature", "ip", r.RemoteAddr)\n\t\thttp.Error(w, "invalid signature", http.StatusBadRequest)' }, reply: 'Geçersiz imzalar artık IP ile birlikte uyarı olarak loglanıyor; istek gövdesi loga yazılmıyor.' },
      },
      {
        title: 'Ledger için idempotency anahtarı',
        branch: 'feat/ledger-idempotency',
        prompt: 'Ledger kayıtlarına idempotency anahtarı ekleyelim; aynı anahtarla ikinci kayıt yazılamasın.',
        read: ['internal/ledger/ledger.go', 'migrations/0042_refund_status.sql'],
        skill: 'sql-review',
        edits: [
          { file: 'migrations/0043_ledger_idempotency.sql', old: '', new: '-- +goose Up\nALTER TABLE ledger_entries ADD COLUMN idempotency_key text;\nCREATE UNIQUE INDEX CONCURRENTLY ledger_entries_idempotency_key ON ledger_entries (idempotency_key);\n\n-- +goose Down\nDROP INDEX CONCURRENTLY ledger_entries_idempotency_key;\nALTER TABLE ledger_entries DROP COLUMN idempotency_key;' },
          { file: 'internal/ledger/ledger.go', old: '\tPaymentID string', new: '\tPaymentID      string\n\tIdempotencyKey string' },
        ],
        test: { command: 'go test ./internal/ledger/...', pass: goPass('ledger') },
        summary: 'Migration hem ileri hem geri çalışıyor; index CONCURRENTLY ile oluşturuluyor, tablo kilitlenmiyor. Aynı anahtarla ikinci yazma artık ErrDuplicate dönüyor ve servis bunu "zaten işlendi" olarak ele alıyor.',
      },
      {
        title: 'Kısmi iade desteği',
        branch: 'feat/partial-refunds',
        prompt: 'Kısmi iade desteği ekle. Bir ödemeye birden fazla kısmi iade yapılabilsin.',
        read: ['internal/refund/service.go', 'internal/refund/types.go'],
        ask: { question: 'Kısmi iadelerin toplamı ödeme tutarını aşarsa ne olsun?', options: ['İsteği reddet (422)', 'Kalan tutarı iade et'], answer: 'İsteği reddet (422)' },
        plan: '## Kısmi iade\n\n1. refunds tablosuna amount ve sequence alanları\n2. Toplam iade ödeme tutarını aşarsa 422\n3. Ödeme durumu: kısmi iade edildi / tamamen iade edildi\n4. API dokümanı ve testler',
        todos: ['Tabloyu genişlet', 'Toplam kontrolünü ekle', 'Durumları güncelle', 'Dokümanı güncelle'],
        edits: [
          { file: 'internal/refund/service.go', old: '\tif req.Amount != p.Amount {\n\t\treturn ErrPartialNotSupported\n\t}', new: '\trefunded, err := s.refundedTotal(ctx, tx, p.ID)\n\tif err != nil {\n\t\treturn err\n\t}\n\tif refunded+req.Amount > p.Amount {\n\t\treturn ErrRefundExceedsPayment // 422\n\t}' },
        ],
        test: { command: 'go test ./internal/refund/...', fail: goFail('refund', 'TestPartialRefund_ExceedsPayment', 'service_test.go', 112, 'err = <nil>, want ErrRefundExceedsPayment'), pass: goPass('refund') },
        summary: 'Kısmi iade hazır: bir ödemeye istenen sayıda kısmi iade yapılabiliyor, toplam ödemeyi aşarsa 422 dönüyor. Ödeme durumu kısmi ve tam iade arasında doğru geçiyor. Dokümanı ayrı bir PR olarak carsi-docs’ta güncellemek gerekecek.',
        pr: true,
        review: { comment: '@mert: 422 yanıtında kalan iade edilebilir tutarı da dönelim, mobil uygulama gösterecek.', edit: { file: 'internal/http/handlers.go', old: '\t\twriteProblem(w, 422, "refund_exceeds_payment", err.Error())', new: '\t\twriteProblemWith(w, 422, "refund_exceeds_payment", err.Error(), map[string]any{"refundable": p.Amount - refunded})' }, reply: '422 yanıtı artık refundable alanında kalan tutarı kuruş cinsinden dönüyor. Dokümana da ekledim.' },
        bigContext: true,
      },
      {
        title: 'Tutarlar float yerine kuruş',
        branch: 'refactor/amounts-in-kurus',
        prompt: 'Para tutarları bazı yerlerde float64 tutuluyor. Hepsini int64 kuruşa çevir.',
        read: ['internal/http/handlers.go', 'internal/refund/types.go'],
        explore: 'float64 tutar 4 yerde var: http handler’daki request struct’ı, refund.Request, raporlama paketindeki toplam ve bir test yardımcı fonksiyonu. Veritabanı sütunları zaten bigint.',
        edits: [
          { file: 'internal/refund/types.go', old: '\tAmount float64 `json:"amount"`', new: '\t// Amount is in kuruş.\n\tAmount int64 `json:"amount"`' },
          { file: 'internal/http/handlers.go', old: '\t\tAmount: req.Amount,', new: '\t\tAmount: int64(math.Round(req.Amount * 100)),' },
        ],
        test: { command: 'go build ./... && go test ./...', fail: '# github.com/carsi-app/carsi-payments/internal/report\ninternal/report/daily.go:41:15: cannot use r.Amount (variable of type int64) as float64 value in assignment', pass: 'ok  \tgithub.com/carsi-app/carsi-payments/internal/http\t0.312s\nok  \tgithub.com/carsi-app/carsi-payments/internal/refund\t0.233s\nok  \tgithub.com/carsi-app/carsi-payments/internal/report\t0.104s' },
        summary: 'Bütün tutarlar artık int64 kuruş. Dış API float kabul etmeye devam ediyor; çeviri yalnızca handler sınırında ve tek yerde yapılıyor. Raporlama paketi de kuruş üzerinden topluyor; yuvarlama farkı kalmadı.',
        bigContext: true,
      },
      {
        title: 'Hata yanıtlarını tek biçime getirme',
        branch: 'refactor/problem-json',
        prompt: 'Handler’lar hata yanıtlarını üç farklı biçimde dönüyor. Hepsini application/problem+json’a çevir.',
        read: ['internal/http/handlers.go', 'internal/http/errors.go'],
        edits: [
          { file: 'internal/http/errors.go', old: '', new: '// writeProblem writes an RFC 9457 problem document.\nfunc writeProblem(w http.ResponseWriter, status int, title, detail string) {\n\tw.Header().Set("Content-Type", "application/problem+json")\n\tw.WriteHeader(status)\n\tjson.NewEncoder(w).Encode(problem{Type: "about:blank", Title: title, Status: status, Detail: detail})\n}' },
        ],
        test: { command: 'go test ./internal/http/...', pass: goPass('http') },
        summary: 'Bütün hata yanıtları artık problem+json: type, title, status ve detail alanlarıyla. Mobil uygulama eski "error" alanını okuyordu; geriye dönük uyumluluk için bir sürüm boyunca o alanı da dolduruyorum.',
        model: 'sonnet',
      },
      {
        title: 'Yavaş ledger sorgusu',
        branch: 'perf/ledger-index',
        prompt: 'Günlük mutabakat sorgusu 40 saniye sürüyor. Neden yavaş, bul ve hızlandır.',
        read: ['internal/report/daily.go', 'migrations/0043_ledger_idempotency.sql'],
        skill: 'sql-review',
        edits: [
          { file: 'migrations/0044_ledger_created_at.sql', old: '', new: '-- +goose Up\nCREATE INDEX CONCURRENTLY ledger_entries_created_at ON ledger_entries (created_at, payment_id);\n\n-- +goose Down\nDROP INDEX CONCURRENTLY ledger_entries_created_at;' },
        ],
        test: { command: 'go test ./internal/report/...', pass: goPass('report') },
        summary: 'Sorgu tarih aralığına göre tüm tabloyu tarıyordu (EXPLAIN’da Seq Scan, 18 milyon satır). created_at ve payment_id üzerine bileşik index ekledim; aynı sorgu yerel kopyada 40 sn’den 0,6 sn’ye indi. Index CONCURRENTLY oluşturuluyor, yazmaları kilitlemiyor.',
      },
      {
        title: 'Sağlık kontrolü ucu',
        branch: 'feat/healthz',
        prompt: 'Load balancer için /healthz ucu ekle; veritabanı ve Redis’e erişemiyorsak 503 dönsün.',
        read: ['internal/http/router.go'],
        edits: [
          { file: 'internal/http/health.go', old: '', new: 'func (h *Handler) healthz(w http.ResponseWriter, r *http.Request) {\n\tctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)\n\tdefer cancel()\n\tif err := h.db.PingContext(ctx); err != nil {\n\t\thttp.Error(w, "db unavailable", http.StatusServiceUnavailable)\n\t\treturn\n\t}\n\tw.WriteHeader(http.StatusOK)\n}' },
        ],
        test: { command: 'go test ./internal/http/...', pass: goPass('http') },
        summary: '/healthz veritabanı ve Redis’e 2 saniyelik zaman aşımıyla ping atıyor; biri cevap vermezse 503 dönüyor. Uç kimlik doğrulama gerektirmiyor ve loglara yazılmıyor, yoksa her 10 saniyede bir log satırı üretirdi.',
        model: 'sonnet',
      },
    ],
    questions: [
      {
        title: 'Go’da context iptalini test etmek',
        prompt: 'Go’da bir fonksiyonun context iptaline doğru tepki verdiğini nasıl test ederim?',
        answer: 'En temiz yol iptali testte senin kontrol etmen: ctx, cancel := context.WithCancel(...) ile başlat, fonksiyonu bir goroutine’de çalıştır, cancel() çağır ve dönen hatanın errors.Is(err, context.Canceled) olduğunu kontrol et. Zamanlamaya dayanan sleep’lerden kaçın; fonksiyonun beklediği noktayı bir kanalla işaretleyip iptali o anda yapmak testi kararlı tutar.',
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
        title: 'Siparişlerde çekip yenileme',
        branch: 'feat/orders-refresh',
        prompt: 'Siparişler ekranına çekip yenileme ekle.',
        read: ['app/(tabs)/orders.tsx', 'hooks/useOrders.ts'],
        edits: [
          { file: 'app/(tabs)/orders.tsx', old: '    <FlatList data={orders} renderItem={renderOrder} />', new: '    <FlatList\n      data={orders}\n      renderItem={renderOrder}\n      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}\n    />' },
        ],
        test: { command: 'npm run test -- orders', pass: ' PASS  app/(tabs)/orders.test.tsx\nTests:       12 passed, 12 total' },
        summary: 'Siparişler listesi artık çekip yenilemeyi destekliyor; yenileme mevcut react-query sorgusunu kullanıyor, ayrı bir istek katmanı eklemedim.',
      },
      {
        title: 'Android geri tuşu sepetten çıkışta',
        branch: 'fix/android-back',
        prompt: 'Android’de sepetten geri tuşuna basınca uygulama kapanıyor. Önceki ekrana dönmesi lazım.',
        read: ['app/cart.tsx', 'app/_layout.tsx'],
        edits: [
          { file: 'app/_layout.tsx', old: "      <Stack.Screen name=\"cart\" options={{ presentation: 'modal' }} />", new: "      <Stack.Screen name=\"cart\" options={{ presentation: 'modal', gestureEnabled: true }} />" },
          { file: 'app/cart.tsx', old: '  return (', new: "  useFocusEffect(\n    useCallback(() => {\n      const sub = BackHandler.addEventListener('hardwareBackPress', () => (router.canGoBack() ? (router.back(), true) : false))\n      return () => sub.remove()\n    }, []),\n  )\n\n  return (" },
        ],
        test: { command: 'npx tsc --noEmit', fail: "app/cart.tsx(14,7): error TS2304: Cannot find name 'useFocusEffect'.", pass: '(no errors)' },
        summary: 'Sepet modal olarak açılıyordu ve geri tuşu yığında önceki ekranı bulamayınca uygulamayı kapatıyordu. Geri tuşunu sepet ekranında yakalayıp önceki ekrana dönüyorum; yığın boşsa varsayılan davranış korunuyor.',
      },
      {
        title: 'Bildirim izninin zamanı',
        branch: 'feat/notification-permission',
        prompt: 'Bildirim izni uygulama ilk açılınca isteniyor ve çoğu kişi reddediyor. İlk siparişten sonra isteyelim.',
        read: ['app/_layout.tsx', 'lib/notifications.ts'],
        edits: [
          { file: 'app/_layout.tsx', old: '  useEffect(() => { requestNotificationPermission() }, [])', new: '' },
          { file: 'app/order/success.tsx', old: '  return (', new: '  useEffect(() => {\n    if (isFirstOrder) requestNotificationPermission()\n  }, [isFirstOrder])\n\n  return (' },
        ],
        test: { command: 'npm run test', pass: ' PASS  lib/notifications.test.ts\nTests:       48 passed, 48 total' },
        summary: 'İzin artık yalnızca ilk siparişin onay ekranında, kargo takibi bildirimi anlamlı olduğu anda isteniyor. Daha önce reddetmiş kullanıcılara tekrar sorulmuyor.',
      },
      {
        title: 'API istemcisinde zaman aşımı',
        branch: 'feat/api-timeout',
        prompt: 'API istekleri zayıf bağlantıda sonsuza kadar bekliyor. 10 saniye zaman aşımı ve bir kez yeniden deneme ekle.',
        read: ['lib/api.ts'],
        missingTool: true,
        edits: [
          { file: 'lib/api.ts', old: '  const res = await fetch(`${BASE_URL}${path}`, init)', new: '  const res = await fetchWithRetry(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(10_000) }, { retries: 1 })' },
        ],
        test: { command: 'npm run test -- api', pass: ' PASS  lib/api.test.ts\nTests:       9 passed, 9 total' },
        summary: 'İstekler 10 saniyede zaman aşımına uğruyor ve yalnızca GET istekleri bir kez yeniden deneniyor; sipariş oluşturma gibi istekler iki kez gönderilmesin diye denenmiyor.',
      },
      {
        title: 'Karanlık tema token’ları',
        branch: 'feat/dark-tokens',
        prompt: 'Karanlık temadaki renkler bileşenlere tek tek yazılmış. Tasarım token’larına bağla.',
        read: ['theme/tokens.ts', 'components/OrderRow.tsx'],
        skill: 'frontend-design:frontend-design',
        edits: [
          { file: 'components/OrderRow.tsx', old: "  const bg = scheme === 'dark' ? '#1c1f24' : '#ffffff'", new: '  const bg = tokens.surface[scheme]' },
        ],
        test: { command: 'npm run test', pass: ' PASS  components/OrderRow.test.tsx\nTests:       48 passed, 48 total' },
        summary: '23 sabit renk token’a taşındı; karanlık ve açık tema artık tek bir dosyadan yönetiliyor. Kontrast oranlarını kontrol ettim, hepsi WCAG AA’yı geçiyor.',
        model: 'sonnet',
      },
      {
        title: 'Sipariş durumları için etiketler',
        branch: 'feat/order-status-badge',
        prompt: 'Sipariş listesinde durum düz metin olarak yazıyor. Renkli bir etiket yapalım: hazırlanıyor, kargoda, teslim edildi, iade.',
        read: ['components/OrderRow.tsx', 'theme/tokens.ts'],
        edits: [
          { file: 'components/StatusBadge.tsx', old: '', new: "const TONE: Record<OrderStatus, keyof typeof tokens.badge> = {\n  preparing: 'neutral',\n  shipped: 'info',\n  delivered: 'success',\n  refunded: 'warning',\n}\n\nexport function StatusBadge({ status }: { status: OrderStatus }) {\n  return <Text style={[styles.badge, tokens.badge[TONE[status]]]}>{t(`order.status.${status}`)}</Text>\n}" },
        ],
        test: { command: 'npm run test -- StatusBadge', pass: ' PASS  components/StatusBadge.test.tsx\nTests:       4 passed, 4 total' },
        summary: 'Dört durum için renkli etiket eklendi; renkler tema token’larından geliyor, karanlık temada da okunuyor. Metinler çeviri dosyasından.',
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
        title: 'Günlük raporda iadeler düşülmüyor',
        branch: 'fix/refund-netting',
        prompt: 'Günlük sipariş raporunda iadeler cirodan düşülmüyor. Modeli düzelt.',
        read: ['models/marts/fct_orders.sql', 'pipelines/orders_daily.py', 'tests/test_orders_daily.py'],
        edits: [
          { file: 'models/marts/fct_orders.sql', old: '    o.gross_amount as net_amount,', new: '    o.gross_amount - coalesce(r.refunded_amount, 0) as net_amount,' },
          { file: 'models/marts/fct_orders.sql', old: "from {{ ref('stg_orders') }} o", new: "from {{ ref('stg_orders') }} o\nleft join {{ ref('int_refunds_by_order') }} r using (order_id)" },
        ],
        test: { command: 'pytest -q tests/test_orders_daily.py', fail: 'F.......\nFAILED tests/test_orders_daily.py::test_refunds_are_netted - assert 1840.0 == 1650.0\n1 failed, 7 passed in 1.92s', pass: '........\n8 passed in 1.88s' },
        summary: 'Net ciro artık iadeler düşülerek hesaplanıyor. İadeler sipariş başına önceden toplanıp birleştiriliyor; bir siparişin birden fazla iadesi olduğunda satır çoğalmıyor. Son 7 günü yeniden çalıştırdım, toplamlar muhasebenin rakamıyla tutuyor.',
        pr: true,
        review: { comment: '@can: int_refunds_by_order için de bir unique testi ekleyelim, birleştirme çoğaltma yapmasın.', edit: { file: 'models/intermediate/schema.yml', old: '  - name: int_refunds_by_order', new: '  - name: int_refunds_by_order\n    columns:\n      - name: order_id\n        tests: [unique, not_null]' }, reply: 'Testi ekledim ve geçiyor; sipariş başına tek satır olduğu artık garanti altında.' },
      },
      {
        title: 'Ödemelerde para birimi dönüşümü',
        branch: 'feat/fx-conversion',
        prompt: 'stg_payments modelinde EUR ve USD ödemeler TL’ye çevrilmeden toplanıyor. Günlük kurla çevir.',
        read: ['models/staging/stg_payments.sql', 'models/staging/stg_fx_rates.sql'],
        edits: [
          { file: 'models/staging/stg_payments.sql', old: '    amount as amount_try,', new: "    amount * coalesce(fx.rate, 1) as amount_try,\n    currency," },
        ],
        test: { command: 'dbt test --select stg_payments', fail: "Failure in test not_null_stg_payments_amount_try\n  Got 12 results, configured to fail if != 0", pass: 'Completed successfully\nDone. PASS=6 WARN=0 ERROR=0 SKIP=0 TOTAL=6' },
        summary: 'Ödemeler artık ödeme gününün kuruyla TL’ye çevriliyor. 12 kayıt hafta sonuna denk geldiği için kur bulunamıyordu; bu günlerde son iş gününün kurunu kullanıyorum ve bunu modelin açıklamasına yazdım.',
      },
      {
        title: 'Geç gelen verinin yeniden işlenmesi',
        branch: 'feat/late-data',
        prompt: 'Ödeme sağlayıcısı bazı kayıtları 2 gün geç gönderiyor ve günlük rapor bunları kaçırıyor. DAG geriye dönük 3 günü yeniden işlesin.',
        read: ['dags/orders.py', 'models/marts/fct_orders.sql'],
        edits: [
          { file: 'models/marts/fct_orders.sql', old: '  where ordered_at > (select max(ordered_at) from {{ this }})', new: "  where ordered_at > (select max(ordered_at) from {{ this }}) - interval '3 days'" },
          { file: 'dags/orders.py', old: '    catchup=False,', new: '    catchup=False,\n    # The payment provider sends some records up to two days late.\n    params={"lookback_days": 3},' },
        ],
        test: { command: 'dbt build --select fct_orders', pass: 'Completed successfully\nDone. PASS=9 WARN=0 ERROR=0 SKIP=0 TOTAL=9' },
        summary: 'Artımlı model artık son 3 günü her çalışmada yeniden işliyor; unique_key sayesinde tekrar eden satır oluşmuyor. Çalışma süresi 40 saniyeden 55 saniyeye çıktı, kabul edilebilir.',
      },
      {
        title: 'fct_orders için dbt testleri',
        branch: 'test/fct-orders',
        prompt: 'fct_orders için temel dbt testlerini yaz: order_id tekil ve boş olmasın, net tutar negatif olmasın.',
        read: ['models/marts/schema.yml'],
        edits: [
          { file: 'models/marts/schema.yml', old: '  - name: fct_orders', new: '  - name: fct_orders\n    columns:\n      - name: order_id\n        tests: [unique, not_null]\n      - name: net_amount\n        tests:\n          - dbt_utils.accepted_range:\n              min_value: 0' },
        ],
        test: { command: 'dbt test --select fct_orders', pass: 'Completed successfully\nDone. PASS=4 WARN=0 ERROR=0 SKIP=0 TOTAL=4' },
        summary: 'Dört test eklendi ve hepsi geçiyor. net_amount için alt sınır sıfır; tam iade edilen siparişler sıfırda kalıyor, negatife düşen yok.',
        model: 'sonnet',
      },
      {
        title: 'Müşteri kohort modeli',
        branch: 'feat/customer-cohorts',
        prompt: 'Pazarlama için aylık müşteri kohortu modeli lazım: ilk sipariş ayına göre grupla, sonraki aylarda tekrar sipariş verenlerin oranını çıkar.',
        read: ['models/marts/fct_orders.sql', 'models/marts/dim_customers.sql'],
        edits: [
          { file: 'models/marts/fct_customer_cohorts.sql', old: '', new: "with first_orders as (\n    select customer_id, date_trunc('month', min(ordered_at)) as cohort_month\n    from {{ ref('fct_orders') }}\n    group by 1\n)\nselect\n    f.cohort_month,\n    date_trunc('month', o.ordered_at) as order_month,\n    count(distinct o.customer_id) as customers\nfrom {{ ref('fct_orders') }} o\njoin first_orders f using (customer_id)\ngroup by 1, 2" },
        ],
        test: { command: 'dbt build --select fct_customer_cohorts', pass: 'Completed successfully\nDone. PASS=3 WARN=0 ERROR=0 SKIP=0 TOTAL=3' },
        summary: 'Kohort modeli hazır: her ilk sipariş ayı için sonraki aylarda kaç müşterinin tekrar sipariş verdiği. Oranı modelde değil, panelde hesaplamayı öneririm; böylece farklı kırılımlar aynı modelden çıkar.',
        bigContext: true,
        pr: true,
        review: { comment: '@can: İade edilen ilk siparişler kohorta sayılmasın.', edit: { file: 'models/marts/fct_customer_cohorts.sql', old: "    from {{ ref('fct_orders') }}\n    group by 1", new: "    from {{ ref('fct_orders') }}\n    where net_amount > 0\n    group by 1" }, reply: 'Tamamen iade edilen siparişler artık ilk sipariş sayılmıyor; kohort boyutları ortalama %3 küçüldü, beklediğimiz gibi.' },
      },
      {
        title: 'Ruff uyarılarının temizliği',
        branch: 'chore/ruff',
        prompt: 'ruff check 37 uyarı veriyor. Davranışı değiştirmeden temizle.',
        read: ['pyproject.toml'],
        edits: [
          { file: 'pipelines/refunds.py', old: 'from typing import List, Dict', new: '' },
          { file: 'pipelines/orders_daily.py', old: '    except:', new: '    except pl.exceptions.ComputeError:' },
        ],
        test: { command: 'ruff check . && pytest -q', fail: 'Found 37 errors.\n[*] 31 fixable with the --fix option.', pass: 'All checks passed!\n........................\n24 passed in 1.91s' },
        summary: '37 uyarının 31’i otomatik düzeltildi; kalan 6’sını elle düzelttim. Biri gerçek bir hataydı: çıplak except, Ctrl+C’yi de yutuyordu. Testlerin hepsi geçiyor.',
        model: 'sonnet',
      },
    ],
    questions: [
      {
        title: 'dbt’de geç gelen veriyi yakalamak',
        prompt: 'dbt’de artımlı bir modelde geç gelen satırları kaçırmamanın standart yolu ne?',
        answer: 'Yaygın yöntem bir "lookback" penceresi: artımlı filtreyi max(tarih)’ten değil max(tarih) − N gün’den başlatmak ve unique_key ile merge stratejisi kullanmak. Böylece son N günün satırları her çalışmada yeniden yazılır, tekrar oluşmaz. N’yi kaynağın gerçek gecikmesine göre seç; çok büyük tutmak çalışma süresini gereksiz uzatır.',
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
        title: 'Staging için ayrı veritabanı',
        branch: 'feat/staging-db',
        prompt: 'Staging ortamı prod veritabanının bir kopyasını kullanıyor. Kendi küçük veritabanını kur; prod ayarlarını kopyalama.',
        read: ['terraform/envs/staging/main.tf', 'terraform/modules/db/variables.tf'],
        edits: [
          { file: 'terraform/envs/staging/main.tf', old: '  database_url = data.aws_ssm_parameter.prod_db_url.value', new: '  database_url = module.staging_db.connection_url' },
        ],
        test: { command: 'terraform plan', pass: 'Plan: 3 to add, 1 to change, 0 to destroy.' },
        summary: 'Staging artık kendi db.t4g.small örneğini kullanıyor; yedekleme 1 gün, silme koruması kapalı. Plan 3 kaynak ekliyor ve yalnızca staging API’sinin bağlantı adresini değiştiriyor, prod’a dokunmuyor.',
        model: 'sonnet',
      },
      {
        title: 'Prod deploy’una onay adımı',
        branch: 'feat/deploy-approval',
        prompt: 'Prod deploy workflow’una manuel onay ekle; staging otomatik kalsın.',
        read: ['.github/workflows/deploy.yml'],
        edits: [
          { file: '.github/workflows/deploy.yml', old: '  deploy-prod:\n    runs-on: ubuntu-latest', new: '  deploy-prod:\n    runs-on: ubuntu-latest\n    environment: production' },
        ],
        test: { command: 'actionlint .github/workflows/deploy.yml', pass: '(no problems found)' },
        summary: 'Prod işi artık production environment’ına bağlı; GitHub’da bu ortama onaylayıcı eklediğinde deploy onay bekleyecek. Staging işine dokunmadım.',
      },
      {
        title: 'API podlarında bellek limitleri',
        branch: 'fix/api-memory',
        prompt: 'API podları sık sık OOMKilled ile yeniden başlıyor. Limitleri gözden geçir.',
        read: ['k8s/api/deployment.yaml'],
        edits: [
          { file: 'k8s/api/deployment.yaml', old: '            memory: 256Mi', new: '            memory: 512Mi' },
        ],
        test: { command: 'kubectl diff -f k8s/api/deployment.yaml', pass: '-            memory: 256Mi\n+            memory: 512Mi' },
        summary: 'Son 7 günün ölçümlerinde podlar yoğun saatte 310–340 MiB kullanıyor; 256 MiB limit yetmiyordu. Limiti 512 MiB yaptım, request’i 384 MiB’de bıraktım. Ayrıca bellek %85’i geçince uyarı veren bir alarm ekledim.',
      },
      {
        title: 'Statik dosyalar için CDN önbelleği',
        branch: 'perf/cdn-cache',
        prompt: 'Next.js statik dosyaları CDN’de önbelleğe alınmıyor. Doğru önbellek kurallarını ekle.',
        read: ['terraform/modules/cdn/main.tf'],
        edits: [
          { file: 'terraform/modules/cdn/main.tf', old: '  default_ttl = 0', new: '  default_ttl = 0\n\n  ordered_cache_behavior {\n    path_pattern     = "/_next/static/*"\n    cache_policy_id  = data.aws_cloudfront_cache_policy.caching_optimized.id\n    target_origin_id = "web"\n    viewer_protocol_policy = "redirect-to-https"\n    allowed_methods  = ["GET", "HEAD"]\n    cached_methods   = ["GET", "HEAD"]\n  }' },
        ],
        test: { command: 'terraform plan', pass: 'Plan: 0 to add, 1 to change, 0 to destroy.' },
        summary: '/_next/static altındaki dosyalar artık CDN’de bir yıl önbellekte kalıyor; dosya adları içerik özetini taşıdığı için güvenli. HTML sayfaları önbelleğe alınmıyor.',
      },
    ],
    questions: [],
  },
  {
    name: 'carsi-docs',
    repo: 'carsi-app/carsi-docs',
    snippets: {
      'docs/api/refunds.mdx': '---\ntitle: İadeler\n---\n\nİade oluşturmak için `POST /v1/refunds` ucunu kullanın.',
    },
    stories: [
      {
        title: 'İade dokümanında kısmi iade',
        branch: 'docs/partial-refunds',
        prompt: 'İade API dokümanını kısmi iade için güncelle: amount alanı, 422 hatası ve örnek istek.',
        read: ['docs/api/refunds.mdx'],
        edits: [
          { file: 'docs/api/refunds.mdx', old: 'İade oluşturmak için `POST /v1/refunds` ucunu kullanın.', new: 'İade oluşturmak için `POST /v1/refunds` ucunu kullanın. `amount` alanı verilirse kısmi iade yapılır; aynı ödemeye birden fazla kısmi iade yapılabilir.\n\n:::warning\nİadelerin toplamı ödeme tutarını aşarsa istek `422 refund_exceeds_payment` ile reddedilir.\n:::' },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'Doküman kısmi iadeyi, toplam sınırını ve 422 hatasını anlatıyor; curl ve Go örnekleri eklendi.',
        model: 'sonnet',
      },
      {
        title: 'Kırık iç bağlantılar',
        branch: 'fix/broken-links',
        prompt: 'Build kırık link uyarısı veriyor. Bul ve düzelt.',
        read: ['docusaurus.config.ts'],
        edits: [
          { file: 'docs/api/orders.mdx', old: '[kısmi iade](../refunds#partial)', new: '[kısmi iade](./refunds.mdx#kısmi-iade)' },
        ],
        test: { command: 'npm run build', fail: '[ERROR] Docusaurus found broken links!\n- Broken link on source page path = /docs/api/orders:\n   -> linking to ../refunds#partial', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'Bir kırık bağlantı vardı: başlık Türkçeye çevrilince çapa adı değişmişti. Düzelttim; onBrokenLinks artık "throw", böylece bir dahaki kırık bağlantı build’i durdurur.',
        model: 'sonnet',
      },
      {
        title: 'Ekim sürüm notları',
        branch: 'docs/release-notes-oct',
        prompt: 'Eylül’den bu yana birleşen PR’lardan Ekim sürüm notlarını yaz.',
        read: ['docs/changelog.mdx'],
        skill: 'release-notes',
        edits: [
          { file: 'docs/changelog.mdx', old: '## Eylül 2026', new: '## Ekim 2026\n\n- **Kısmi iade:** bir ödemeye birden fazla kısmi iade yapılabiliyor.\n- **Webhook güvenliği:** imzasız istekler reddediliyor.\n- **Hızlı ürün sayfası:** mobilde ürün sayfası yaklaşık iki kat daha hızlı açılıyor.\n\n## Eylül 2026' },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: '14 PR’dan müşteriyi ilgilendiren 3 değişikliği seçip sade bir dille yazdım; iç düzenlemeleri dışarıda bıraktım.',
        model: 'sonnet',
      },
      {
        title: 'Webhook imza doğrulama rehberi',
        branch: 'docs/webhook-signatures',
        prompt: 'Webhook imza doğrulaması için müşterilere bir rehber yaz: neden gerekli, Node ve Go örnekleri.',
        read: ['docs/api/webhooks.mdx'],
        edits: [
          { file: 'docs/guides/webhook-signatures.mdx', old: '', new: "---\ntitle: Webhook imzalarını doğrulama\n---\n\nHer webhook isteği `Carsi-Signature` başlığında bir HMAC-SHA256 imzası taşır. İmzayı doğrulamadan gelen isteği işlemeyin." },
        ],
        test: { command: 'npm run build', pass: '[SUCCESS] Generated static files in "build".' },
        summary: 'Rehber yazıldı: imzanın ne olduğu, zaman damgası toleransı ve Node ile Go örnekleri. Sık yapılan hatayı (gövdeyi JSON’a çevirip sonra doğrulamak) ayrı bir uyarı kutusunda anlattım.',
        model: 'sonnet',
      },
    ],
    questions: [],
  },
]

/** Asked again and again across sessions. */
export const ROUTINE_TESTS = 'Testleri çalıştır, kırmızı olanları düzelt ve sonunda kısa bir özet geç'
export const ROUTINE_PR = "Değişiklikleri commit'le ve PR aç, açıklamaya test planını yaz"

export const CLAUDE_MD_WEB = `# carsi-web

Çarşı'nın müşteri sitesi: yerel üreticilerin ürünlerini satan bir online çarşı. Ürün listeleme, sepet, ödeme ve sipariş takibi. Next.js App Router, TypeScript, Tailwind, Zustand, Vitest ve Playwright.

## Komutlar

- \`npm run dev\`: geliştirme sunucusu, http://localhost:3000
- \`npm run test\`: Vitest birim testleri. Tek dosya için \`npm run test -- pricing\`
- \`npm run typecheck\`: \`tsc --noEmit\`
- \`npm run lint\`: ESLint ve Prettier denetimi
- \`npx playwright test\`: uçtan uca testler; önce \`npm run build && npm start\` gerekir
- \`npm run clean\`: \`.next\` ve önbellek klasörlerini güvenle siler. Elle \`rm -rf\` yapma.

## Klasör yapısı

- \`src/app/(shop)\`: müşteriye görünen sayfalar. Sayfalar varsayılan olarak sunucu bileşeni.
- \`src/app/api\`: route handler'lar. Mobil uygulama da bu uçları kullanıyor; sözleşmeyi bozmadan değiştir.
- \`src/components\`: paylaşılan bileşenler. İstemci bileşenleri dosyanın başında \`'use client'\` ile işaretlenir.
- \`src/lib\`: iş mantığı. Fiyat, sepet, sipariş ve doğrulama burada; bileşenlerde iş mantığı olmaz.
- \`tests\`: Vitest testleri. \`tests/e2e\`: Playwright senaryoları.

## Para ve fiyatlar

- Bütün tutarlar kuruş cinsinden \`number\` (tam sayı) tutulur. Float ile para hesabı yapma.
- Ekrana yazarken yalnızca \`formatPrice\` kullan; \`toFixed\` ile elle biçimlendirme yapma.
- İndirimler ara toplamdan bir kez hesaplanır ve en sonda bir kez yuvarlanır.
- KDV fiyatlara dahildir; sepet özetinde ayrıca gösterilir, yeniden eklenmez.
- Kupon kuralları \`src/lib/pricing.ts\` içinde; yeni kupon türü eklerken önce buraya test yaz.

## Formlar ve doğrulama

- Bütün form şemaları \`src/lib/validation.ts\` içinde, zod ile tanımlanır. Sunucu ve istemci aynı şemayı kullanır.
- Hata mesajları Türkçe, kısa ve alanın hemen altında gösterilir.
- Her hatalı alan \`aria-invalid\` ve \`aria-describedby\` ile hata metnine bağlanır.
- Posta kodu 5 hane, telefon numarası E.164 biçiminde saklanır.

## Erişilebilirlik

- Etkileşimli her öğe klavyeyle ulaşılabilir olmalı; tıklanabilir \`div\` kullanma, \`button\` kullan.
- Görsellerin \`alt\` metni ürün adını ve varyantını söyler; süs görsellerinde \`alt=""\`.
- Renk kontrastı en az WCAG AA. Tasarım token'larının dışına çıkma.
- Modal ve çekmecelerde odak içeride tutulur, Escape ile kapanır.

## Uluslararasılaştırma

- Metinler \`messages/tr.json\` ve \`messages/en.json\` içinde. Koda metin gömme.
- Yeni anahtar eklerken iki dile de ekle; eksik anahtar CI'da hata verir.
- Tarih ve sayı biçimleri \`Intl\` ile, kullanıcının diline göre.

## Testler

- Bir hatayı düzeltmeden önce onu yakalayan bir test yaz ve kırmızı olduğunu gör.
- Birim testleri hızlı tut; ağ ve veritabanı çağrılarını \`tests/mocks\` altındaki yardımcılarla taklit et.
- Snapshot testlerini yalnızca bilinçli bir görünüm değişikliğinde güncelle.
- Playwright testlerinde \`getByRole\` ve \`getByLabel\` kullan; CSS seçicilerine bağlanma.
- Ödeme formu bir iframe içinde; Playwright'ta \`frameLocator('#payment-frame')\` ile eriş.

## API uçları

- Uçlar JSON döner; hatalar \`{ error: string }\` biçiminde, uygun HTTP koduyla.
- Sipariş ucu IP başına dakikada 30 istekle sınırlı; sınır sayacı Redis'te.
- Yeni uç eklerken istek gövdesini zod ile doğrula ve mobil ekibe haber ver.

## Performans

- Ürün sayfası için mobil LCP hedefi 2,5 saniyenin altı.
- Sayfanın ilk görseli \`priority\` ve doğru \`sizes\` ile yüklenir.
- Ağır istemci bileşenleri (yorumlar, öneriler) \`dynamic\` ile sonradan yüklenir.
- Yeni bağımlılık eklemeden önce paket boyutunu kontrol et.

## Git ve PR

- Branch adları \`fix/\`, \`feat/\`, \`perf/\`, \`refactor/\`, \`test/\`, \`chore/\` ile başlar.
- \`main\`'e doğrudan push yapılmaz; her değişiklik PR ile gelir.
- PR açıklamasında: ne değişti, neden, nasıl test edildi.
- Commit mesajları kısa ve emir kipinde: "Kupon indirimini ara toplamdan hesapla".

## Sık yapılan hatalar

- \`cookies()\` ve \`headers()\` Next.js 16'dan beri Promise döner; \`await\` etmeyi unutma.
- Sunucu bileşeninde \`useState\` kullanılamaz; etkileşim gerekiyorsa küçük bir istemci bileşeni ayır.
- Mobil Safari kaydırma sırasında \`click\` üretmez; dokunmatik kapanma için \`pointerdown\` kullan.
- Shell zsh: glob içeren argümanları tırnak içine al.
`
