# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) izler.
Format [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) temellidir.

## [1.0.1] — 2026-10-26

Çok dilli sürüm. Katkı: **[@tahasureyya](https://github.com/tahasureyya)** (PR #1).

### Eklendi

- **6 dil** — Türkçe, English, Deutsch, Français, Español, Русский. Otomatik algılama (tarayıcı dili) veya elle seçim; seçim kalıcı, panel yenilenmeden uygulanır. README, MIMARI, GIZLILIK ve KURULUM belgeleri de çevrildi.
- **Kalıcı durum** — Panelin açık/kapalı hali sekmeler arası korunur. Eklenti, araç çubuğu düğmesine basılmadıkça kendiliğinden aksiyon almaz; yarım kalan kuyruk yenilemeden sonra duraklatılmış gelir ve "devam et" ile sürdürülür.
- **Boyutlandırma** — Panel kenarındaki tutamaçla sürüklenerek (veya klavye ile) genişletilir; site buna uyar, genişlik kalıcıdır.
- **Kısayollar** — `Ctrl+←/→` önceki/sonraki parça, `Ctrl+↑/↓` ses. Panelden kişiselleştirilebilir; `chrome.commands` ile tarayıcı geneli kapsam isteğe bağlı (`chrome://extensions/shortcuts`).
- **Sağ tık menüsü** — Panel kapalıyken de çalışır, kendiliğinden aksiyon yapmaz.
- **Şablon blok editörü** — Dosya adı şablonu sürükle-bırak parçalarla düzenlenir.
- **`media-hook.js`** — `document_start`'ta çalışan, sayfanın ses elemanlarını ve Web Audio ana çıkışını pasif olarak izleyen dar kanca. Ağ, DOM veya depolama yetkisi vermez.

### Düzeltildi

- **Doğrulama yazısı** — Sonuç kutusu satır içi elemandı ve satırlar üst üste biniyordu; artık blok ve düzgün sarılıyor.
- **Rozet** — Panel kapanınca rozet temizleniyor; kuyruk sayacı ile `ON` durumu birbirini ezmiyor.
- **Hata metinleri** — Arka plan artık kararlı bir kod (`bad-url`, `bad-id`, `unknown`) döndürüyor, kullanıcıya gösterilen metin panelde çevriliyor.

### Değişti

- Panel arayüzü elden geçirildi: açık/koyu tema tutarlılığı, kontrast, dar panel düzenleri, odak halkası, `prefers-reduced-motion` desteği.
- README/MIMARI'ye **Diller** ve **Kısayollar** bölümleri eklendi; CI dört betiği de denetliyor.

## [1.0.0] — 2026-10-18

İlk sürüm.

### Eklendi

- `player.arcod.xyz` içinde açılan sayfa içi indirme paneli (gölge DOM, Apple HIG dilinde arayüz).
- Kalite tavanı ön ayarları: MP3 320, 16/48, 24/96, 24/192.
- Tek parça ve bütün albüm indirme; sıralı kuyruk ve araç çubuğu rozetinde kalan sayı.
- İndirme öncesi FLAC başlık doğrulama: `fLaC` imzası, STREAMINFO, MD5, VORBIS_COMMENT.
- Gerçek kalite rozetleri (bit derinliği / örnekleme hızı) ve Hi-Res sertifika rozeti.
- Dosya adı şablonu: `{n}`, `{title}`, `{version}`, `{artist}`, `{album}`, `{quality}`, `{qualityShort}`, `{isrc}`, `{year}`, `{label}`.
- İki kayıt kipi: doğrudan diske akıtma (File System Access) ve tarayıcı indirme yöneticisi.
- "Şu an çalıyor" kartı: çalan parçayı indir veya kuyruğa ekle.
- Kolay Mod: büyük yazı, yüksek kontrast, geniş dokunma hedefleri (`prefers-contrast: more` ile otomatik).
- MAIN ↔ ISOLATED köprüsü ve MV3 service worker ayrımı.
- Firefox uyumluluğu (`browser.*` / `chrome.*` sarmalayıcısı, callback ve Promise farkları).

### Güvenlik

- Yalnızca `https://player.arcod.xyz/*` host izni.
- Akış biletleri yalnızca bellekte; diske veya günlüğe yazılmaz.
- İndirme adresleri arka planda beyaz listeye karşı doğrulanır.
