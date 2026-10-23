<div align="center">

<img src="logo.svg" alt="ARCOD Grab" width="180"/>

# 🎵 ARCOD Grab

**player.arcod.xyz** için sayfa içi indirme paneli — tek parça ya da albüm FLAC/MP3 indirir, başlığı doğrular.

[![Chrome 111+](https://img.shields.io/badge/Chrome-111%2B-4285F4?logo=googlechrome&logoColor=white)](#kurulum)
[![Firefox](https://img.shields.io/badge/Firefox-115%2B-FF7139?logo=firefox&logoColor=white)](#kurulum)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)](#)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

*Emre Dural tarafından yapıldı.*

</div>

---

## ✨ Özellikler

| | |
|---|---|
| 🎧 **Kalite ön ayarları** | MP3 · 320 kbps, 16-bit · 48 kHz, 24-bit · 96 kHz, **24-bit · 192 kHz Hi-Res** |
| 💿 **Tek parça veya albüm** | Açık olan albümün parçalarını tek tek ya da topluca indir |
| ✅ **Başlık doğrulama** | İndirilen dosyanın STREAMINFO meta verisi okunur ve parça adıyla eşleştiği doğrulanır |
| 🏷️ **Hi-Res rozeti** | Kayıt Hi-Res ve üstüyse parça adının yanında sertifika rozeti gösterilir |
| 📥 **Kuyruk yönetimi** | Sıralı indirme kuyruğu; araç çubuğu rozeti kuyruktaki sayıyı gösterir |
| 🚀 **Basit kurulum** | Manifest V3, sunucu bağımlılığı yok — sadece eklentiyi yükle |

## 🔧 Nasıl Çalışır?

Eklenti üç katmandan oluşur:

```
arcod-grab.js (MAIN world)  →  relay.js (ISOLATED)  →  background.js (service worker)
      sayfa içinde                  köprü kanalı              downloads API
```

- **`arcod-grab.js`** sayfanın kendi origin'inden istek attığı için akış normal bir sayfa isteği gibi görünür — sunucu tarayıcı dışı istemcileri (curl, PowerShell) 502 ile reddettiğinden en güvenilir yol budur.
- **`relay.js`** MAIN world'ün `chrome.*` API'sine erişemediği yerde, sayfa ile arka plan arasında tek geçit olan dar boğaz kanalıdır.
- **`background.js`** indirmeyi tarayıcının kendi indirme yöneticisine devreder: dosya adresi doğrudan dosya yöneticisine gider — bellekte hiçbir şey tutulmaz.

Ayrıca jeton mantığı tek kullanımlıktır: her istek için bilet oluşturulur, hemen harcanır, **hiçbir zaman ne saklanır ne günlüğe yazılır**.

## 📦 Kurulum

### Chrome

1. Repo'yu indirin: **Code → Download ZIP** (veya `git clone`)
2. ZIP'i bir klasöre açın
3. `chrome://extensions` adresine gidin
4. Sağ üstten **Geliştirici Modu**'nu açın
5. **Paketlenmemiş öğe yükle** deyin ve klasörü seçin
6. [player.arcod.xyz](https://player.arcod.xyz/) sayfasında araç çubuğundaki 🎵 simgesine tıklayın — panel açılır!

### Firefox

1. `about:debugging#/runtime/this-firefox` → **Geçici Eklenti Yükle** → `manifest.json` seçin (Firefox 115+, `world: "MAIN"` desteği)

## 🎚️ Kalite Seçimi Nasıl Çalışır?

Kalite ayarı bir **tavandır**: sunucu, istenen tavanı kaydın kendi çözünürlüğüyle kesiştirir.

| Ön ayar | Tavan | Örnek |
|---|---|---|
| MP3 · 320 kbps | 16 bit / 44.1 kHz | CD kaydı → 320 MP3 |
| 16/48 | 16 bit / 48 kHz | CD kaydı → kaynağın kendisi |
| 24/96 | 24 bit / 96 kHz | Hi-Res kayıt → kaynağın kendisi |
| 24/192 | 24 bit / 192 kHz | En yüksek tavan |

> Yani **"24/192" seçmek, "en yüksek kalite" demektir** — kayıt düşük çözünürlüklüyse zaten tavandan aşağı iner.

## 🗂️ Dosya Yapısı

```
arcod-grab/
├── manifest.json      # MV3 manifesti, izinler ve içerik betikleri
├── arcod-grab.js      # Panel + indirme motoru (MAIN world)
├── relay.js           # MAIN ↔ background köprüsü (ISOLATED world)
├── background.js      # downloads API, rozet, komut yönlendirme
├── policies.json      # (İsteğe bağlı) kurumsal force-install örneği
└── icon16/32/48/128   # Eklenti ikonları
```

## 📄 Lisans

[MIT](LICENSE) — Emre Dural
