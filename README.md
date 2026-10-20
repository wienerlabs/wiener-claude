<div align="center">

<img src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/web/public/favicon.svg" width="52" height="52" alt="" />

# Wiener Tools for Claude Code

Claude Code kullanımın için yerel bir panel: ısı haritaları, oturum dökümleri,<br />
maliyet ve limitler, araç kullanımı ve kanıta dayalı ipuçları.

[![npm](https://img.shields.io/npm/v/wiener-tools-claude?color=1c5cab&label=npm)](https://www.npmjs.com/package/wiener-tools-claude)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-1c5cab)](LICENSE)
[![Node.js 22.13+](https://img.shields.io/badge/node-%E2%89%A5%2022.13-1c5cab)](https://nodejs.org)

**[Canlı demo](https://claude.wienerlabs.xyz)** · [Kurulum](#kurulum) · [Özellikler](#özellikler) · [Gizlilik](#gizlilik-ve-güvenlik) · [English](#english)

</div>

```bash
npx wiener-tools-claude
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/overview-dark.png" />
  <img alt="Genel bakış: bir yıllık etkinlik takvimi, günün özeti ve dönem tablosu" src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/overview-light.png" />
</picture>

Claude Code, her oturumu bilgisayarındaki `~/.claude` klasörüne yazar. Wiener Tools bu dosyaları okuyup tarayıcıda açılan bir panele dönüştürür: ne kadar çalıştığını, paranın nereye gittiğini, Claude'un hangi araçları kullandığını ve nerede takıldığını gösterir. Hesap, API anahtarı ya da bulut yok; veriler makineden çıkmaz.

- **Doğru sayılar.** Claude Code bir yanıtı birden fazla satıra yazar; her yanıt bir kez sayılır. Fiyatlar Claude Code'un kendi `costUSD` değerleriyle doğrulanmıştır.
- **Kanıta dayalı öneriler.** Her ipucu dayandığı oturumları gösterir; tahmini kazancı ve gerekiyorsa kopyalanabilir bir `CLAUDE.md` satırını verir.
- **Tamamen yerel.** Sunucu varsayılan olarak yalnızca `127.0.0.1`'de dinler, `~/.claude` içine hiçbir şey yazmaz, gizli değerleri hiç göstermez.

Wiener Tools, [Wiener Labs](https://wienerlabs.xyz)'in [araç ailesinin](https://tools.wienerlabs.xyz) bir parçasıdır.

## Özellikler

### Genel bakış

Bir yıllık takvim, haftanın günü × saat ve proje × gün ısı haritaları; mesaj, token, maliyet, oturum ya da hata üzerinden. Takvimde bir güne tıklayınca o günün oturumları açılır. "Bu hafta, son 30 gün, tüm zamanlar" tablosu mesajları, token türlerini ve maliyeti yan yana koyar; "Bu hafta ne oldu" kartı haftayı birkaç cümleyle özetler.

### Oturumlar ve arama

<img alt="Oturum dökümü: prompt'lar, Claude'un yanıtları ve araç çağrıları sırasıyla" src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/session.png" />

Her oturumun tur tur dökümü: prompt'lar, yanıtlar, araç çağrıları ve sonuçları, hatalar, compact'ler. Tam metin arama bütün prompt'larda, yanıtlarda ve shell komutlarında çalışır; Türkçe karakter olmadan yazılan aramayı da bulur ("degisiklik" → "değişiklik"). Bir sonuca tıklamak dökümü o mesajda açar. Oturum sayfası Claude Code'un kendi maliyet sayacını dökümle karşılaştırır ve aradaki farkı ayrıca gösterir.

### İpuçları

<img alt="İpuçları: aradan sonra yeniden yazılan cache ve context şişmesi, dayandıkları oturumlarla" src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/tips.png" />

Transcript'lerden yerel kurallarla çıkarılan öneriler, tahmini kazanca göre sıralı:

| İpucu | Neye bakar |
| --- | --- |
| Context şişmesi | 200 bin token'ı aşan context'le yapılan çağrıların maliyetteki payı |
| Yeniden yazılan cache | Aradan sonra bütün konuşmanın cache'e yeniden yazılması |
| Uzun `CLAUDE.md` | Her istekte okunan talimat dosyasının maliyeti |
| Model seçimi | Hafif işler ve subagent'lar için daha küçük modelle fark |
| Fast mode | Fast mode'un fazladan tuttuğu tutar |
| Ortam hataları | Eksik program, zsh farkları gibi makineden gelen tekrar eden hatalar |
| Sık interrupt | Claude'un ne sıklıkla durdurulduğu, plan mode kullanımı |
| Tekrar eden prompt'lar | Slash komutu yapılabilecek, defalarca yazılan istekler |
| Durdurulan çağrılar | Reddedilen ya da auto mode'un engellediği komutlar |
| Kullanılmayan MCP | Yapılandırılmış ama hiç çağrılmayan sunucular |

### Araçlar

<img alt="Araçlar: çağrı sayıları, hata oranları, türlere göre dağılım ve MCP sunucuları" src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/tools.png" />

Claude'un hangi araçları ne sıklıkla kullandığı ve ne kadarının hata döndürdüğü; türlere göre dağılım; MCP sunucuları, skill'ler, subagent'lar ve maliyetteki payları; slash komutları; plan mode ve compact gibi özelliklerin oturumların kaçında kullanıldığı; Claude Code sürümleri.

### Maliyet ve limitler

Seçilen dönemin maliyeti ve önceki dönemle farkı, ay sonu tahmini, aylık bütçe ve bu hızla aşılacağı gün, günlük ya da haftalık maliyet grafiği, paranın token türlerine ve modellere dağılımı, cache tasarrufu, limitin dolduğu anlar ve şu anki 5 saatlik pencere.

### Projeler

Her projenin etkinliği, ana dili, zaman içindeki maliyeti, branch'lere ve dillere göre dağılımı, en çok değişen dosyaları, açılan PR'ları, kullanılan araçlar, modeller, subagent'lar ve MCP sunucuları. Worktree'ler kendi repolarına sayılır.

### Ortam

Claude Code'un hatırladıkları (memory), uyduğu talimatlar (`CLAUDE.md`), yarım kalan görevler, onaya sunulan planlar, skill'ler, plugin'ler, MCP sunucuları ve ayarlar.

### Yıl özeti

<img alt="Yıl özeti kartı: mesajlar, aktif günler, token, maliyet, yıllık ısı haritası, en çok çalışılan projeler" src="https://raw.githubusercontent.com/wienerlabs/wiener-claude/main/docs/images/year-card.png" width="640" />

Bir yılın mesajları, aktif günleri, token'ları, en uzun serisi, en çok çalışılan projeleri ve araçları tek kartta. Kart PNG olarak indirilebilir; proje adları ve maliyet gizlenebilir. Resim tarayıcıda oluşturulur.

Çoğu ekranda "Bu hafta", "Son 30 gün" ve "Tüm zamanlar" filtreleri vardır; seçim adreste durur. Dosyalar değiştikçe panel kendini günceller ve şu an çalışan oturumları ayrıca listeler.

## Kurulum

Node.js 22.13 veya üstü gerekir (yerleşik SQLite için). Claude Code'u kullandığın bilgisayarda çalıştır:

```bash
npx wiener-tools-claude
```

Panel tarayıcıda kendiliğinden açılır. İlk indeksleme geçmişin büyüklüğüne göre birkaç saniye ile yarım dakika arası sürer; sonraki açılışlarda yalnızca yeni kayıtlar okunur. Kapatmak için terminalde Ctrl+C.

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `--port <n>` | `4747` | Dinlenecek port; doluysa bir sonraki denenir |
| `--host <h>` | `127.0.0.1` | `0.0.0.0` paneli yerel ağa açar |
| `--no-open` | | Tarayıcıyı açma |
| `-v`, `--version` | | Sürümü göster |

| Ortam değişkeni | Açıklama |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Başka bir Claude profili: `CLAUDE_CONFIG_DIR=~/.claude-work npx wiener-tools-claude` |
| `WIENER_DATA_DIR` | İndeksin ve ayarların tutulduğu klasör (varsayılan `~/.wiener-tools/claude`) |
| `WIENER_PORT` | Varsayılan port |

Fiyat tablosunu `~/.wiener-tools/claude/pricing.json` ile ezebilirsin (MTok başına dolar):

```json
{ "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 } }
```

## Gizlilik ve güvenlik

- **Veri makineden çıkmaz.** Panel hiçbir dış adrese istek atmaz; analizlerin hepsi yerel kurallarla yapılır.
- **Yalnızca okur.** `~/.claude` içine hiçbir şey yazılmaz. Wiener Tools kendi indeksini `~/.wiener-tools/claude/index.db`, bütçe ayarını `settings.json` dosyasında tutar; indeks silinirse dökümlerden yeniden kurulur. Claude Code eski dökümleri bir süre sonra siler; indekslenmiş sayılar kalır.
- **Yerel ağa kapalı.** Sunucu varsayılan olarak `127.0.0.1`'de dinler ve `Host` başlığını denetler; DNS rebinding ile erişim engellenir. Tek yazma işlemi (bütçe) JSON gövde ister ve `Origin` başlığını denetler.
- **Gizli değerler gösterilmez.** MCP sunucularının ortam değişkenleri, başlıkları ve argümanları, ayarlardaki ortam değişkeni değerleri ve hook argümanları hiçbir zaman gösterilmez. `~/.claude.json` dosyasından e-posta, isim ve kimlikler okunmaz.
- **Dosya erişimi sınırlı.** Dosya içerikleri yalnızca sunucunun kendi listelediği memory ve `CLAUDE.md` dosyaları için verilir; istek bir yol değil, listedeki kimliği taşır.
- **Hata metinleri kısaltılır.** Başarısız araç sonuçlarının yalnızca ilk 400 karakteri, ortam hatalarını test hatalarından ayırmak için yerel indekste tutulur.

<details>
<summary>Nereden ne okunur</summary>

| Kaynak | Ne için |
| --- | --- |
| `~/.claude/projects/<proje>/<oturum>.jsonl` | Mesajlar, token kullanımı, araç çağrıları, başlıklar, PR bağlantıları |
| `~/.claude/projects/<proje>/<oturum>/subagents/**` | Subagent dökümleri; maliyetleri ana oturuma yazılır |
| `~/Library/Application Support/Claude/claude-code-sessions` | Desktop oturumlarının başlığı, branch'i, worktree'si |
| `~/.claude/sessions/*.json` | Şu an çalışan Claude Code süreçleri |
| `~/.claude.json` | Plan adı, son limit ölçümü, skill ve plugin kullanım sayıları, MCP sunucularının adı ve türü |
| `~/.claude/projects/<proje>/memory/*.md` | Memory dosyaları |
| `~/.claude/CLAUDE.md`, `<proje>/CLAUDE.md` | Talimatlar |
| `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` | Ayarlar ve kurulu plugin'ler |

Desktop oturum klasörünün yolu yalnızca macOS'ta doğrulandı; Windows ve Linux yolları Electron varsayılanlarına göre tahmin ediliyor.

</details>

## Sayılar nasıl hesaplanıyor

- **Tekrarlar ayıklanır.** Claude Code tek bir API yanıtını içerik bloğu başına ayrı satırlara yazar; sonraki satırlar daha büyük token sayısı taşıyabilir. Her yanıt `message.id` ile bir kez, en büyük değeriyle sayılır. Fork'lanan ya da devam ettirilen oturumlara kopyalanan geçmiş de bir kez sayılır.
- **Maliyet liste fiyatıdır.** Fiyat tablosu `server/pricing.ts` içindedir. 1 saatlik cache yazmaları input fiyatının 2 katı, 5 dakikalık olanlar 1,25 katı sayılır.
- **Dökümde görünmeyen maliyet.** Claude Code'un kendi sayacı dökümlere yazılmayan çağrıları da sayar. Sayaç yalnızca son süreç çalışmasını tuttuğu için oturum toplamı olarak kullanılamaz; fark oturum sayfasında ayrıca gösterilir.
- **Aktif süre**, aralarında 10 dakikadan uzun boşluk olmayan etkinliklerin toplamıdır.
- **Değişen satırlar** Edit ve Write sonuçlarındaki yamalardan ve shell komutları için tutulan farklardan sayılır. Git işlemlerinin dokunduğu dosyalar ve Claude Code'un geçici klasörleri sayılmaz.
- **Limitler.** Kullanım yüzdesi yerelde tutulmaz; Claude Code'un `/usage` ile kaydettiği son ölçüm yalnızca yeniyse gösterilir. Limitin dolduğu anlar dökümlerden okunur; "şu anki 5 saatlik pencere" yerel isteklerden tahmin edilir.
- **İpuçlarındaki tahminler** liste fiyatıyla hesaplanır ve birbiriyle örtüşebilir; toplanmamalıdır.

## Canlı demo

[claude.wienerlabs.xyz](https://claude.wienerlabs.xyz) panelin kendisini uydurma verilerle gösterir. Panel çalıştığı bilgisayarın `~/.claude` klasörünü okuduğu için bir sunucuda olduğu gibi çalışamaz; demo bunun yerine statik bir sitedir:

1. `scripts/demo/generate.ts` altı hayali proje için son altı aya yayılan transcript'ler, memory, skill, MCP ve ayar dosyaları üretir. Sabit bir tohumla çalışır; gerçek bir makineden hiçbir şey okumaz.
2. `scripts/demo/build.ts` bu sahte ev klasörünü gerçek sunucu koduyla indeksler ve arayüzün isteyebileceği her API cevabını statik dosya olarak yazar. Derleme makinesine ait bir yol çıktıda kalırsa derleme durur.
3. Arayüz `--mode demo` ile derlenir; API yerine bu dosyaları okur, sayfalamayı ve başlıkta aramayı tarayıcıda yapar.

```bash
npm run build:demo                              # dist/demo-site
npx vite preview --outDir ../dist/demo-site
```

Site Vercel'de yayınlanır; ayarlar `vercel.json` dosyasındadır. Demo verisi derlendiği güne göre üretilir; `.github/workflows/demo-refresh.yml`, `VERCEL_DEPLOY_HOOK` secret'ı tanımlıysa her gün yeniden derletir.

## Geliştirme

```bash
git clone https://github.com/wienerlabs/wiener-claude.git
cd wiener-claude
npm install          # arayüzü ve sunucuyu da derler
npm run dev          # API :4747, arayüz http://localhost:5747
```

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Sunucuyu izleme modunda, arayüzü Vite ile çalıştırır |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript denetimi |
| `npm run build` | Arayüzü `dist/web`, sunucuyu `dist/server` altına derler |
| `npm run build:demo` | Canlı demoyu `dist/demo-site` altına derler |
| `npm start` | Derlenmiş paneli çalıştırır |

```
server/    Hono sunucusu, JSONL ayrıştırıcı, artımlı indeksleyici (node:sqlite + FTS5), raporlar
web/       React 19 + Tailwind v4 arayüzü
shared/    Sunucu ve arayüzün ortak tipleri ve yardımcıları
scripts/   Canlı demonun veri üreticisi ve derleyicisi
test/      Vitest testleri ve sentetik transcript kayıtları
```

## Sürümler

| Sürüm | İçerik |
| --- | --- |
| 0.6 | İpuçları |
| 0.5 | Araçlar, proje eğilimleri (branch'ler, diller, maliyet), yıl özeti kartı |
| 0.4 | Dönem filtresi, dönem özeti |
| 0.3 | Ortam (memory, talimatlar, görevler, planlar, skill'ler, plugin'ler, MCP, ayarlar), bütçe, içgörüler |
| 0.2 | Maliyet ve limitler, projeler, tam metin arama |
| 0.1 | İndeksleyici, genel bakış, oturumlar |

## English

**Wiener Tools for Claude Code** is a local dashboard for your Claude Code usage. It reads the files Claude Code writes to `~/.claude` and turns them into activity heatmaps, session replays with full-text search, cost and limit tracking, tool and MCP usage, per-project trends, a shareable year-in-review card and evidence-based tips (context bloat, cache rewrites, repeated prompts, setup errors and more), each backed by the sessions it comes from.

Everything stays on your machine: the server listens on `127.0.0.1` only, never writes to `~/.claude`, sends nothing anywhere and never shows secret values. Run it with `npx wiener-tools-claude` (Node.js 22.13+), or try the [live demo](https://claude.wienerlabs.xyz) with made-up data. The interface is in Turkish for now.

## Lisans

MIT © 2026 Wiener Labs. Ayrıntılar [LICENSE](LICENSE) dosyasında.
