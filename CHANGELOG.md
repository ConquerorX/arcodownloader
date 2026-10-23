# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) izler.
Format [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) temellidir.

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
