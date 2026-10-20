# Wiener Tools

Claude Code kullanımını kendi bilgisayarında gösteren sade bir panel. `~/.claude` klasörünü okur, hiçbir yere veri göndermez, hesap ya da API anahtarı istemez.

- **Isı haritaları:** bir yıllık takvim, haftanın günü × saat, proje × gün. Mesaj, token, maliyet, oturum ya da hata üzerinden.
- **Gün dökümü:** takvimde bir güne tıklayınca o günün oturumları açılır.
- **Oturumlar:** arama, filtre ve her oturumun tur tur dökümü (istemler, Claude'un yanıtları, araç çağrıları, hatalar, bağlam özetlemeleri).
- **Canlı:** dosyalar değiştikçe panel kendini günceller; açık oturumlar ayrıca listelenir.

## Çalıştırma

Node.js 22.13 veya üstü gerekir (yerleşik SQLite için).

```bash
npm install
npm run build
npm start
```

Seçenekler: `--port <n>` (varsayılan 4747), `--host <h>` (varsayılan 127.0.0.1), `--no-open`. Başka bir Claude profili için `CLAUDE_CONFIG_DIR=~/.claude-work npm start`.

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

Wiener Tools `~/.claude` içine hiçbir şey yazmaz. Kendi indeksini `~/.wiener-tools/index.db` dosyasında tutar. Bu dosya silinirse dökümlerden yeniden kurulur. Claude Code eski dökümleri bir süre sonra siler; indekslenmiş sayılar o dökümlerden sonra da kalır.

## Sayılar nasıl hesaplanıyor

- **Tekrarlar ayıklanır.** Claude Code tek bir API yanıtını içerik bloğu başına ayrı satırlara yazar; bu satırlar her zaman art arda gelmez ve sonrakiler daha büyük token sayısı taşıyabilir. Her yanıt `message.id` ile bir kez, en büyük değeriyle sayılır. Fork'lanan ya da devam ettirilen oturumlara kopyalanan geçmiş de bir kez sayılır.
- **Maliyet liste fiyatıdır.** Fiyat tablosu `server/pricing.ts` içinde. 1 saatlik önbellek yazmaları girdinin 2 katı, 5 dakikalık olanlar 1,25 katı sayılır. Tablo, Claude Code'un kendi `costUSD` değerleriyle karşılaştırılarak doğrulandı. Tabloyu `~/.wiener-tools/pricing.json` ile ezebilirsin (MTok başına dolar):

  ```json
  { "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 } }
  ```

- **Dökümde görünmeyen maliyet.** Claude Code'un kendi sayacı (`cost-state` kayıtları) dökümlere yazılmayan çağrıları da sayar; bu yüzden bazı oturumlarda dökümden hesaplanandan yüksektir. Sayaç yalnızca son süreç çalışmasını tuttuğu için oturum toplamı olarak kullanılamaz; Wiener Tools farkı oturum sayfasında ayrıca gösterir.
- **Aktif süre**, aralarında 10 dakikadan uzun boşluk olmayan etkinliklerin toplamıdır.

## Güvenlik

Sunucu varsayılan olarak yalnızca `127.0.0.1` adresinde dinler ve `Host` başlığını denetler; başka bir sitenin DNS rebinding ile panele erişmesi engellenir. `--host 0.0.0.0` paneli yerel ağa açar.

## Yol haritası

1. **Faz 1 (bu sürüm):** indeksleyici, Genel bakış, Oturumlar.
2. **Faz 2:** Maliyet ve limitler, Projeler (en çok değişen dosyalar), tüm dökümlerde tam metin arama.
3. **Faz 3:** Ortam (memory, plan, görev, skill, MCP, ayarlar), daha fazla içgörü, bütçe.

Desktop oturum klasörünün yolu yalnızca macOS'ta doğrulandı; Windows ve Linux yolları Electron varsayılanlarına göre tahmin ediliyor.
