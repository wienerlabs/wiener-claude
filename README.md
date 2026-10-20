# Wiener Tools

Claude Code kullanımını kendi bilgisayarında gösteren sade bir panel. `~/.claude` klasörünü okur, hiçbir yere veri göndermez, hesap ya da API anahtarı istemez.

- **Isı haritaları:** bir yıllık takvim, haftanın günü × saat, proje × gün. Mesaj, token, maliyet, oturum ya da hata üzerinden.
- **Gün dökümü:** takvimde bir güne tıklayınca o günün oturumları açılır.
- **Oturumlar:** her oturumun tur tur dökümü (istemler, Claude'un yanıtları, araç çağrıları, hatalar, bağlam özetlemeleri).
- **Tam metin arama:** bütün istemlerde, yanıtlarda ve kabuk komutlarında arar; Türkçe harfsiz yazılan aramayı da bulur ("degisiklik" → "değişiklik", "kisa" → "kısa"). Bir sonuca tıklayınca döküm o mesajda açılır.
- **Projeler:** her projenin yıllık etkinliği, en çok değişen dosyaları, açılan PR'ları, kullanılan araçlar ve modeller. Worktree'ler kendi repolarına sayılır.
- **Maliyet ve limitler:** aylık harcama ve ay sonu tahmini, son 30 günün günlük maliyeti, paranın token türlerine ve modellere dağılımı, limitin dolduğu anlar, şu anki 5 saatlik pencere ve tasarruf fırsatları.
- **Bütçe:** aylık bir tutar belirlersen bu hızla hangi gün aşılacağı Maliyet'te ve Genel bakış'ta görünür.
- **Ortam:** Claude Code'un hatırladıkları (memory), uyduğu talimatlar (`CLAUDE.md`), yarım kalan görevler ve onaya sunulan planlar, skill'ler, eklentiler, subagent türleri, MCP sunucuları ve ayarlar.
- **İçgörüler:** "Bu hafta ne oldu" kartı bütçe temposunu, limit olaylarını, değişen satırları, yarım kalan görevleri ve araç hatalarını tek cümlelerle özetler; her biri ilgili ekrana bağlanır.
- **Canlı:** dosyalar değiştikçe panel kendini günceller; açık oturumlar ayrıca listelenir.

## Kurulum ve kullanım

Node.js 22.13 veya üstü gerekir (yerleşik SQLite için). Claude Code'u kullandığın bilgisayarda çalıştırılır; verini o makinedeki `~/.claude` klasöründen okur.

**Repoya erişimi olanlar için tek komut:**

```bash
npx github:mehmethayirli/wiener-tools
```

İlk seferde repo indirilir ve derlenir (bir dakika kadar). Panel tarayıcıda kendiliğinden açılır; ilk indeksleme geçmişin büyüklüğüne göre birkaç saniye ile yarım dakika arası sürer, ilerlemesi sol altta görünür. Sonraki açılışlarda yalnızca yeni kayıtlar okunur.

**Klonlayarak:**

```bash
git clone https://github.com/mehmethayirli/wiener-tools.git
cd wiener-tools
npm install
npm start
```

`npm install` derlemeyi de yapar. Kapatmak için terminalde Ctrl+C.

Seçenekler: `--port <n>` (varsayılan 4747, doluysa bir sonraki), `--host <h>` (varsayılan 127.0.0.1), `--no-open`. Başka bir Claude profili için `CLAUDE_CONFIG_DIR=~/.claude-work npm start`.

## Geliştirme

```bash
npm run dev        # API 4747'de, arayüz http://localhost:5747 adresinde
npm test           # vitest
npm run typecheck
```

## Nereden ne okunur

| Kaynak | Ne için |
| --- | --- |
| `~/.claude/projects/<proje>/<oturum>.jsonl` | Mesajlar, token kullanımı, araç çağrıları, başlıklar, PR bağlantıları |
| `~/.claude/projects/<proje>/<oturum>/subagents/**` | Subagent dökümleri; maliyetleri ana oturuma yazılır |
| `~/Library/Application Support/Claude/claude-code-sessions` | Desktop oturumlarının başlığı, branch'i, worktree'si |
| `~/.claude/sessions/*.json` | Şu an çalışan Claude Code süreçleri |
| `~/.claude.json` | Plan adı, son limit ölçümü, skill ve eklenti kullanım sayıları, MCP sunucularının adı ve türü. E-posta, isim ve kimlikler okunmaz. |
| `~/.claude/projects/<proje>/memory/*.md` | Memory dosyaları |
| `~/.claude/CLAUDE.md`, `<proje>/CLAUDE.md` | Talimatlar |
| `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` | Ayarlar ve kurulu eklentiler |

Wiener Tools `~/.claude` içine hiçbir şey yazmaz. Kendi indeksini `~/.wiener-tools/index.db`, bütçe ayarını `~/.wiener-tools/settings.json` dosyasında tutar. Bu dosya silinirse dökümlerden yeniden kurulur. Claude Code eski dökümleri bir süre sonra siler; indekslenmiş sayılar o dökümlerden sonra da kalır.

## Sayılar nasıl hesaplanıyor

- **Tekrarlar ayıklanır.** Claude Code tek bir API yanıtını içerik bloğu başına ayrı satırlara yazar; bu satırlar her zaman art arda gelmez ve sonrakiler daha büyük token sayısı taşıyabilir. Her yanıt `message.id` ile bir kez, en büyük değeriyle sayılır. Fork'lanan ya da devam ettirilen oturumlara kopyalanan geçmiş de bir kez sayılır.
- **Maliyet liste fiyatıdır.** Fiyat tablosu `server/pricing.ts` içinde. 1 saatlik önbellek yazmaları girdinin 2 katı, 5 dakikalık olanlar 1,25 katı sayılır. Tablo, Claude Code'un kendi `costUSD` değerleriyle karşılaştırılarak doğrulandı. Tabloyu `~/.wiener-tools/pricing.json` ile ezebilirsin (MTok başına dolar):

  ```json
  { "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 } }
  ```

- **Dökümde görünmeyen maliyet.** Claude Code'un kendi sayacı (`cost-state` kayıtları) dökümlere yazılmayan çağrıları da sayar; bu yüzden bazı oturumlarda dökümden hesaplanandan yüksektir. Sayaç yalnızca son süreç çalışmasını tuttuğu için oturum toplamı olarak kullanılamaz; Wiener Tools farkı oturum sayfasında ayrıca gösterir.
- **Aktif süre**, aralarında 10 dakikadan uzun boşluk olmayan etkinliklerin toplamıdır.
- **Değişen satırlar** Edit ve Write sonuçlarındaki yamalardan ve Claude Code'un kabuk komutları için tuttuğu farklardan sayılır. Git işlemlerinin (checkout, pull, merge) dokunduğu dosyalar ve Claude Code'un kendi geçici klasörleri sayılmaz.
- **Limitler.** Kullanım limitinin yüzdesi yerelde tutulmaz; Claude Code'un `/usage` ile kaydettiği son ölçüm yalnızca yeniyse gösterilir. Limitin dolduğu anlar dökümlerden okunur. "Şu anki 5 saatlik pencere" yerel isteklerden tahmin edilir; "son 7 gün" karşılaştırması limitin en son dolduğu haftayla yapılır ve kesin bir yüzde değildir.

## Güvenlik

- Sunucu varsayılan olarak yalnızca `127.0.0.1` adresinde dinler ve `Host` başlığını denetler; başka bir sitenin DNS rebinding ile panele erişmesi engellenir. `--host 0.0.0.0` paneli yerel ağa açar.
- Tek yazma işlemi (bütçe) JSON gövde ister ve `Origin` başlığını denetler; başka bir sitenin tarayıcın üzerinden ayar değiştirmesi engellenir.
- MCP sunucularının ortam değişkenleri, başlıkları ve komut argümanları; ayarlardaki ortam değişkeni değerleri ve hook komutlarının argümanları hiçbir zaman gösterilmez. Yalnızca program adı, paket adı ve uzak sunucunun alan adı görünür.
- Dosya içerikleri yalnızca sunucunun kendi listelediği memory ve `CLAUDE.md` dosyaları için verilir; istek bir yol değil, o listedeki kimliği taşır.

## Yol haritası

1. **Faz 1:** indeksleyici, Genel bakış, Oturumlar.
2. **Faz 2:** Maliyet ve limitler, Projeler, tam metin arama.
3. **Faz 3 (bu sürüm):** Ortam (memory, talimatlar, görevler ve planlar, skill'ler, eklentiler, MCP, ayarlar), bütçe, daha fazla içgörü.

Desktop oturum klasörünün yolu yalnızca macOS'ta doğrulandı; Windows ve Linux yolları Electron varsayılanlarına göre tahmin ediliyor.
