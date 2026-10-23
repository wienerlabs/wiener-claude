// The months before the stories: Claude Code has deleted those terminal transcripts, and what is
// left is ~/.claude/history.jsonl, the prompts the developer typed. Oldest first; each entry is one
// session, its prompts in Turkish and English side by side.

export interface EarlySession {
  project: string
  prompts: [string, string][]
}

export const EARLY: EarlySession[] = [
  {
    project: 'carsi-web',
    prompts: [
      ['Next.js App Router ile yeni bir proje kur: TypeScript, Tailwind ve Vitest olsun.', 'Set up a new Next.js App Router project with TypeScript, Tailwind and Vitest.'],
      ["Ana sayfaya geçici bir ürün listesi koy, veriyi şimdilik JSON'dan oku.", 'Put a placeholder product list on the home page; read the data from JSON for now.'],
      ['Lint ve testleri çalıştıran bir GitHub Actions iş akışı ekle.', 'Add a GitHub Actions workflow that runs lint and tests.'],
    ],
  },
  {
    project: 'carsi-infra',
    prompts: [
      ['Terraform ile staging için bir VPC ve Postgres veritabanı tanımla.', 'Define a VPC and a Postgres database for staging with Terraform.'],
      ["State dosyasını S3'te tut, kilit için DynamoDB kullan.", 'Keep the state file in S3 and use DynamoDB for locking.'],
    ],
  },
  {
    project: 'carsi-payments',
    prompts: [
      ['Go ile ödeme servisi için bir iskelet oluştur: net/http, yapılandırma ortam değişkenlerinden.', 'Scaffold a payment service in Go: net/http, config from environment variables.'],
      ["Ödeme ve iade tabloları için ilk migration'ı yaz.", 'Write the first migration for the payments and refunds tables.'],
      ['slog ile yapılandırılmış log ekle.', 'Add structured logging with slog.'],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Ürün detay sayfasını yap: görseller, fiyat, stok durumu ve sepete ekle düğmesi.', 'Build the product detail page: images, price, stock status and an add-to-cart button.'],
      ['Fiyatları kuruş cinsinden tutalım; formatPrice yardımcı fonksiyonunu yaz.', 'Keep prices in kuruş, and write a formatPrice helper.'],
    ],
  },
  {
    project: 'carsi-mobile',
    prompts: [
      ['Expo ile React Native projesi kur; alt sekmeli bir gezinme olsun: Keşfet, Sepet, Hesabım.', 'Set up a React Native project with Expo, with tab navigation: Discover, Cart, Account.'],
      ["API istemcisi web'deki tipleri paylaşsın.", 'Have the API client share the types used by the web app.'],
    ],
  },
  {
    project: 'carsi-data',
    prompts: [
      ['dbt projesi kur; siparişler için staging modellerini yaz.', 'Set up a dbt project and write the staging models for orders.'],
      ['Günlük satış raporu için bir mart modeli ekle.', 'Add a mart model for the daily sales report.'],
    ],
  },
  {
    project: 'carsi-payments',
    prompts: [
      ['Stripe ile ödeme niyeti oluşturan uç noktayı yaz.', 'Write the endpoint that creates a payment intent with Stripe.'],
      ['Bunun için tablo tabanlı testler ekle.', 'Add table-driven tests for it.'],
    ],
  },
  {
    project: 'carsi-docs',
    prompts: [
      ['Docusaurus ile geliştirici dokümanları için bir site kur.', 'Set up a Docusaurus site for the developer docs.'],
      ['Kimlik doğrulama ve hata biçimi için ilk sayfaları yaz.', 'Write the first pages, on authentication and the error format.'],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Sepeti Zustand ile yönet; sayfa yenilenince kaybolmasın.', 'Manage the cart with Zustand so it survives a page reload.'],
      ['Sepet çekmecesi mobilde tam ekran açılsın.', 'Open the cart drawer full screen on mobile.'],
    ],
  },
  {
    project: 'carsi-infra',
    prompts: [
      ['API için bir Kubernetes deployment ve servis tanımı yaz.', 'Write a Kubernetes deployment and service for the API.'],
      ["Prod ve staging için ayrı namespace'ler kullanalım.", 'Use separate namespaces for prod and staging.'],
    ],
  },
  {
    project: 'carsi-mobile',
    prompts: [
      ['Ürün listesine sonsuz kaydırma ekle.', 'Add infinite scrolling to the product list.'],
      ['Görselleri önbelleğe al; liste kaydırılırken titremesin.', "Cache the images so the list doesn't flicker while scrolling."],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Üreticiler için bir kayıt formu yap: ad, şehir, ürün kategorisi.', 'Make a sign-up form for producers: name, city, product category.'],
      ['Formu sunucu tarafında da doğrula.', 'Validate the form on the server too.'],
    ],
  },
  {
    project: 'carsi-data',
    prompts: [
      ["Airflow'da dbt'yi her gece çalıştıran bir DAG yaz.", 'Write an Airflow DAG that runs dbt every night.'],
    ],
  },
  {
    project: 'carsi-payments',
    prompts: [
      ['Ödeme durumları için bir durum makinesi tasarla: bekliyor, ödendi, iade edildi.', 'Design a state machine for payment statuses: pending, paid, refunded.'],
      ['Geçersiz geçişlerde hata dönsün.', 'Return an error on invalid transitions.'],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Kategori sayfalarına fiyat aralığı ve şehir filtresi ekle.', 'Add price range and city filters to the category pages.'],
      ['Filtreler adres çubuğunda kalsın; paylaşılan bağlantı aynı sonucu açsın.', 'Keep the filters in the URL so a shared link opens the same results.'],
    ],
  },
  {
    project: 'carsi-mobile',
    prompts: [
      ["Push bildirimleri için Expo Notifications'ı kur.", 'Set up Expo Notifications for push notifications.'],
    ],
  },
  {
    project: 'carsi-infra',
    prompts: [
      ["Grafana'da API gecikmesi ve hata oranı için bir pano oluştur.", 'Create a Grafana dashboard for API latency and error rate.'],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Ödeme sayfasının ilk sürümünü yap: adres, kargo seçimi, özet.', 'Build the first version of the checkout page: address, shipping option, summary.'],
      ['Kart alanını Stripe Elements ile ekle.', 'Add the card field with Stripe Elements.'],
      ['Ödeme başarısız olursa kullanıcı sepete dönsün, sepet boşalmasın.', 'If payment fails, send the user back to the cart without emptying it.'],
    ],
  },
  {
    project: 'carsi-docs',
    prompts: [
      ['API referansını OpenAPI dosyasından otomatik üret.', 'Generate the API reference from the OpenAPI file.'],
    ],
  },
  {
    project: 'carsi-data',
    prompts: [
      ['Aynı sipariş satırının iki kez gelmesini yakalayan bir test ekle.', 'Add a test that catches the same order row arriving twice.'],
    ],
  },
  {
    project: 'carsi-payments',
    prompts: [
      ["Stripe webhook'larını kuyruğa al; işleme ayrı bir worker'da olsun.", 'Queue the Stripe webhooks and process them in a separate worker.'],
    ],
  },
  {
    project: 'carsi-mobile',
    prompts: [
      ['Sipariş geçmişi ekranını yap.', 'Build the order history screen.'],
      ['Boş durum için bir görsel ve kısa bir metin ekle.', 'Add an illustration and a short message for the empty state.'],
    ],
  },
  {
    project: 'carsi-web',
    prompts: [
      ['Arama için Postgres tam metin aramasını kullan; Türkçe karakterleri de doğru bulsun.', 'Use Postgres full-text search for search, and make it handle Turkish characters.'],
    ],
  },
  {
    project: 'carsi-infra',
    prompts: [
      ['Veritabanını her gece yedekle, yedekleri 14 gün sakla.', 'Back up the database every night and keep the backups for 14 days.'],
    ],
  },
]
