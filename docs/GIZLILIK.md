# Gizlilik

**Özet: ARCOD Grab hiçbir veri toplamaz, hiçbir sunucuya hiçbir şey göndermez.**
Ne geliştiricinin, ne üçüncü tarafların erişebileceği bir arka uç vardır.

## Toplanmayan veriler

- Kişisel bilgi, hesap bilgisi, e-posta, IP
- İndirme geçmişi, dinleme geçmişi, arama geçmişi
- Kullanım istatistikleri, çökme raporları, telemetri
- Çerezler (eklenti hiçbir çerez okumaz veya yazmaz)

## Tarayıcıda kalan veriler

Yalnızca `player.arcod.xyz` origin'inin `localStorage` alanında:

| Anahtar | İçerik |
|---|---|
| `arcodgrab.cfg.v1` | Kalite tavanı, dosya adı şablonu, kayıt kipi, panel konumu, Kolay Mod, "şu an çalıyor" tercihi |
| `arcodgrab.queue.v1` | İndirme kuyruğundaki parçaların kimlikleri ve adları |

Bu iki anahtar tarayıcının site verileriyle birlikte silinir. Eklentiyi kaldırdığında da ARCOD için tutulan site verileriyle birlikte gider. Sunucuya asla gönderilmez.

## Ağ erişimi

Eklenti yalnızca şu adreslerle konuşur:

| Adres | Amaç |
|---|---|
| `https://player.arcod.xyz/api/player/*` | Albüm verisi ve akış bileti |
| ARCOD'un akış CDN'i (biletin döndürdüğü adres) | Ses akışı |

`manifest.json` içindeki tek `host_permissions` kaydı `https://player.arcod.xyz/*`. Başka hiçbir site okunamaz, değiştirilemez.

## Akış adresleri (ticket)

Her indirme için ARCOD'tan kısa ömürlü bir akış adresi alınır. Bu adres:

- yalnızca indirme anında bellekte tutulur,
- diske, `localStorage`'a veya konsola **yazılmaz**,
- indirme bittiğinde referansı bırakılır.

## İzinler

| İzin | Neden |
|---|---|
| `downloads` | Dosyayı tarayıcının indirme yöneticisine devretmek, açmak, klasörü göstermek |
| `host_permissions: player.arcod.xyz` | Sayfaya paneli yerleştirmek ve akışı sayfa origin'inden istemek |

`tabs`, `storage`, `webRequest`, `cookies`, `scripting` gibi izinler **istenmez**. Sekme URL'si yalnızca araç çubuğu tıklamasında, o anki sekmenin adresini doğrulamak için okunur.

## Değişiklikler

Bu politika değişirse sürüm numarası ve `CHANGELOG.md` güncellenir. Kaynak kodun tamamı bu depoda olduğu için her iddia denetlenebilir:

```bash
grep -rn "fetch(" *.js      # yalnızca /api/player ve bilet adresi
grep -rn "sendBeacon\|XMLHttpRequest" *.js
```
