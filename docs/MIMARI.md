🇹🇷 **Türkçe** · [English](en/MIMARI.md) · [Deutsch](de/MIMARI.md) · [Français](fr/MIMARI.md) · [Español](es/MIMARI.md) · [Русский](ru/MIMARI.md)

# Mimari

Eklenti bilerek üç küçük katmandan oluşur. Her katman tek bir iş yapar ve diğerinin yetkisini genişletmez.

```
┌─────────────────────────────────────────────────────────────────────┐
│  player.arcod.xyz                                                   │
│                                                                     │
│  ┌───────────────────────┐        ┌──────────────────────────────┐  │
│  │ arcod-grab.js         │        │ relay.js                     │  │
│  │ MAIN world            │◄──────►│ ISOLATED world               │  │
│  │                       │postMsg │                              │  │
│  │ • panel + CSS         │        │ • iki yönlü köprü            │  │
│  │ • fetch + FLAC okuma  │        │ • chrome.runtime erişimi     │  │
│  │ • kuyruk + şablon     │        │                              │  │
│  └───────────────────────┘        └───────────────┬──────────────┘  │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ sendMessage
                                    ┌───────────────▼──────────────┐
                                    │ background.js                │
                                    │ MV3 service worker           │
                                    │ • downloads API              │
                                    │ • rozet (ON / kuyruk sayısı) │
                                    │ • sekme yaşam döngüsü        │
                                    └───────────────┬──────────────┘
                                                    │
                                          tarayıcı indirme yöneticisi
```

## Katmanlar

### 1. `arcod-grab.js` — MAIN world

Sayfanın kendi JavaScript bağlamında çalışır. Bunun tek sebebi var: **istek sayfanın origin'inden çıkmalı.** ARCOD, tarayıcı dışı istemcileri (curl, PowerShell, Node) 502 ile reddediyor; bu yüzden `fetch` çağrısı CDP ile zorlanmış bir istek gibi değil, normal bir sayfa isteği gibi görünmeli.

Görevleri:

- Gölge DOM (`attachShadow`) içinde paneli kurmak — sayfanın CSS'i paneli, panelin CSS'i sayfayı etkilemez.
- `/api/player/get-album` ve `/api/player/stream/{id}` uçlarını çağırmak.
- Akışın ilk ~64 KB'ını okuyup FLAC başlığını ayrıştırmak (`readFlacHead`).
- Kalite, dosya adı şablonu ve kuyruğu `localStorage`'da tutmak (ARCOD origin'i).
- İndirmeyi ya doğrudan diske akıtmak (`showSaveFilePicker`) ya da `background.js`'e devretmek.

### 2. `relay.js` — ISOLATED world

MAIN world `chrome.*` API'lerine erişemez, service worker da sayfaya doğrudan yazamaz. `relay.js` bu iki taraf arasındaki **tek ve dar kanaldır**:

```js
// sayfa  →  eklenti
window.postMessage({ __arcodgrab: true, type: 'request', id, req, args })
// eklenti  →  sayfa
window.postMessage({ __arcodgrab: true, type: 'response', id, ok, res })
```

Yalnızca beyaz listedeki `arcodgrab:*` mesaj türleri iletilir; sayfadaki herhangi bir betik rastgele bir `chrome.*` çağrısı yapamaz. Araç çubuğu düğmesine basıldığında `arcodgrab:toggle` yine bu kanaldan aşağı iner.

### 3. `background.js` — service worker

- `chrome.downloads.download` / `open` / `show` / `showDefaultFolder` çağrılarını yürütür.
- Yalnızca `https://player.arcod.xyz/` adreslerini kabul eder.
- Sekme rozetini yönetir: panel açıkken **ON**, kuyrukta iş varsa sayı.
- Chrome (callback) ve Firefox (Promise) `downloads` API farklarını tek bir `callApi` sarmalayıcısıyla kapatır.

## Mesaj protokolü

| Tür | Yön | İş |
|---|---|---|
| `arcodgrab:toggle` | background → sayfa | Paneli aç/kapat |
| `arcodgrab:panel-ready` | sayfa → background | Rozeti `ON` yap |
| `arcodgrab:queue-count` | sayfa → background | Rozete kuyruk sayısını yaz (`0` ise `ON`) |
| `arcodgrab:download` | sayfa → background | Akış adresini indirme yöneticisine devret |
| `arcodgrab:open` | sayfa → background | İndirileni işletim sisteminde aç |
| `arcodgrab:show` | sayfa → background | İndirmeyi listede göster |
| `arcodgrab:show-folder` | sayfa → background | İndirilenler klasörünü aç |
| `arcodgrab:commands` | sayfa → background | Atanmış `commands` tuşlarını listeler |
| `arcodgrab:open-shortcuts` | sayfa → background | Tarayıcının kısayol ayar sekmesini açar |
| `arcodgrab:command` | background → sayfa | Atanmış bir komutu sayfaya iletir (`prev`, `next`, `volUp`, `volDown`) |

## İndirme akışı

```text
ticket()            →  /api/player/stream/{id}?quality={q}
                       ↓  { url, quality }
fetch(ticket.url)   →  akış (ReadableStream)
                       ↓
  saveMode = 'fsa'  →  showSaveFilePicker → writable.write(chunk) …
  saveMode = 'dl'   →  chrome.downloads.download({ url, filename })
```

`dl` kipinde akış hiç belleğe alınmaz: adres doğrudan tarayıcının indirme yöneticisine gider, dosyayı tarayıcı yazar. `fsa` kipinde parçalar akış halinde diske yazılır; dosyanın tam yolu JS'e açık olmadığı için "klasörde göster" işlevi tarayıcının indirme klasörünü açar.

## Kalite modeli

ARCOD'un kalite tablosu bir **tavan** tanımlar:

| Kanal | Bit | kHz |
|---|---|---|
| `5` | 16 | 44.1 |
| `6` | 16 | 48 |
| `7` | 24 | 96 |
| `27` | 24 | 192 |

Sunucu, istenen tavanı kaydın kendi çözünürlüğüyle kesiştirir. Bu yüzden 24/192 istemek bir yükseltme değil, "mümkün olan en iyi" demektir. Panel, indirmeden önce akıştan okunan **gerçek** değerleri göstererek bu farkı görünür kılar.

## Doğrulama

`readFlacHead(u8)` ilk baytlarda şunları arar:

1. `fLaC` büyülü imzası,
2. metadata blok zinciri (`STREAMINFO`, `PADDING`, `SEEKTABLE`, `VORBIS_COMMENT`, `PICTURE`…),
3. STREAMINFO gövdesinden örnekleme hızı, kanal, bit derinliği, toplam örnek sayısı ve MD5.

Sonuç üç durumdan biri olarak raporlanır: **orijinal**, **yeniden paketlenmiş** (MD5 sıfır), **etiketleri silinmiş** (VORBIS_COMMENT yok).

## Tasarım

Panel Apple HIG dilini izler: semantik renk jetonları (açık/koyu otomatik), `backdrop-filter` materyal yüzeyler, 0.5 px ayırıcılar, 8 pt ızgara. Kolay Mod, `prefers-contrast: more` ile ilk açılışta kendiliğinden devreye girer.

## Kısayollar ve girdi

- **Kısayol akışı:** manifestteki `commands` (`arcod-prev`, `arcod-next`, `arcod-vol-up`, `arcod-vol-down`) varsayılan tuş içermez; `chrome://extensions/shortcuts` sayfasından atanır. `background.js` `onCommand` olayını alır ve hedef sekmeyi şu öncelikle seçer: ses çalan, etkin, en son kullanılan. ARCOD sekmesi yoksa sessiz kalır. Komut `relay.js` üzerinden `arcodgrab:command` olarak (beyaz liste: `prev`, `next`, `volUp`, `volDown`) MAIN world'e `type: 'command'` mesajıyla iner ve `scCommand` işler. Yeni izin gerekmez.
- **Kapsam:** `cfg.scScope` `'page'` (varsayılan) ya da `'global'` olur. Global kapsamda yalnızca `commands` tuşları çalışır; panelde atanan özel tuşlar yalnızca sayfada geçerlidir.
- **Klavye yalıtımı:** panelde yazarken tuşlar (Space dahil) sayfaya sızmaz; sayfa kısayolları panelde yazarken tetiklenmez.
- **Sağ tık menüsü** panel kapalıyken de etkindir; kendiliğinden aksiyon yapmaz, paneli kurmaz, durumu toast ile gösterir. Kuyruğa ekleme tek `queueAdd()` yolundan geçer.
- **Dosya adı şablonu** blok (chip) editörüyle sürükle-bırak düzenlenir; `cfg.template` string olarak kalır, `tplParse`/`tplBuild` dönüştürür. Kayıt yöntemi `cfg.saveMode`: `'dl'` | `'fsa'` | `'auto'`; kuyruk her zaman tarayıcı indirmesiyle iner.
- **Ses:** önce site ses kaydırıcısı denenir, olmazsa `audio.volume` kullanılır.

## Diller

Kullanıcıya görünen bütün metinler `arcod-grab.js` içindeki tek `I18N` sözlüğünde durur (`tr`, `en`, `de`, `fr`, `es`, `ru`). `t('anahtar', { n })` okur; eksik anahtar önce Türkçeye, o da yoksa anahtarın kendisine düşer. Statik düğümler `data-i18n*` öznitelikleriyle işaretlenir, dil değişince `applyI18n()` hepsini sayfa yenilemeden yeniden yazar. `background.js` hata metni yerine kararlı bir `code` döndürür; çeviri panelde yapılır. `T()` ilk harfi dile duyarlı büyütür. Ekleme adımları: [README → Diller](../README.md#-diller).

## Neden tek dosya?

`arcod-grab.js` panel, CSS ve indirme motorunu tek bir IIFE içinde tutar. MAIN world'e enjekte edilen betiklerde modül yükleme yoktur ve her ek dosya sayfa başına ek bir istek olur. Bu yüzden bilinçli bir tercih: **tek betik, sıfır bağımlılık, sıfır derleme.**
