# Kurulum

## Hızlı yol (kaynak klasöründen)

1. Depoyu indir: **Code ▸ Download ZIP** veya `git clone https://github.com/ConquerorX/arcodownloader.git`
2. ZIP'i kalıcı bir klasöre aç (masaüstünde geçici bir klasör kullanma, silersen eklenti kaybolur).
3. Tarayıcıda uzantılar sayfasını aç:

   | Tarayıcı | Adres |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. **Geliştirici modu**nu aç.
5. **Paketlenmemiş öğe yükle** ▸ `manifest.json` dosyasının bulunduğu klasörü seç.

> Klasörün içinde `manifest.json` doğrudan görünmeli. ZIP'in içinden çıkan bir üst klasörü seçersen tarayıcı "manifest bulunamadı" der.

## Chrome / Edge

Chrome 111 ve üzeri gerekir (`content_scripts.world: "MAIN"` desteği için). Edge, Chromium tabanlı olduğu için aynı sürüm kuralı geçerlidir.

Kurulumdan sonra:

1. <https://player.arcod.xyz/> adresini aç.
2. Araç çubuğundaki ARCOD simgesine bas. Pinned değilse puzzle menüsünün içinde olur; simgeye sağ tıklayıp **Sabitle**.
3. Albüm sayfasında panel sağ üstte belirir.

## Firefox (deneysel)

Gereksinim: **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Geçici Eklenti Yükle  ▸  manifest.json
```

`Geçici` yükleme tarayıcı kapanınca silinir. Kalıcı kurulum için imzalı bir `.xpi` gerekir:

```bash
# depo kökünde
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Ardından `about:config` ▸ `xpinstall.signatures.required` → `false` (yalnızca geliştirici sürümünde) veya Firefox Add-ons'a imzalat.

Firefox'ta `showSaveFilePicker` bulunmadığı için eklenti otomatik olarak tarayıcının indirme yöneticisini kullanır.

## Kurumsal / toplu dağıtım

`policies.json` ile zorunlu kurulum yapılabilir. Dosya, tarayıcı kurulum dizinine yerleştirilir:

- Windows: `%ProgramFiles%\Google\Chrome\Application\policies.json` (veya kayıt defteri `HKLM\SOFTWARE\Policies\Google\Chrome`)
- macOS: `/Library/Application Support/Google/Chrome/policies/managed/`
- Linux: `/etc/opt/chrome/policies/managed/`

```json
{
  "policies": {
    "ExtensionSettings": {
      "arcodgrab@localhost": {
        "installation_mode": "force_installed",
        "update_url": "https://example.com/arcodownloader/updates.xml"
      }
    }
  }
}
```

> Depodaki `policies.json` yalnızca geliştirme sırasında kullanılan yerel bir örnektir ve mutlak yol içerdiği için `.gitignore` ile hariç tutulur.

## Güncelleme

```bash
git pull
```

Sonra uzantılar sayfasında eklentinin kartındaki **↻** düğmesine bas. ZIP ile kurduysan yeni ZIP'i aynı klasöre açıp yine ↻.

## Kaldırma

Uzantılar sayfasında **Kaldır**. Ayarlar ve kuyruk ARCOD origin'inin `localStorage`'ında tutulduğu için, tam temizlik istiyorsan ARCOD sekmesinde site verilerini de sil.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Panel açılmıyor | Sayfayı yenile, sonra simgeye bas. Eklenti sekmeyi bir kez otomatik yeniler. |
| Simge gri / pasif | Sekme `player.arcod.xyz` dışında. Simgeye basmak ARCOD'u açar. |
| "manifest bulunamadı" | Yanlış klasör seçildi; `manifest.json` doğrudan görünen klasörü seç. |
| İndirme 502 | Sayfayı yenile, oynatıcıyı bir kez çalıştır, tekrar dene. |
| Dosya adı bozuk | Windows'ta `? : * \| " < >` yasak; şablonu sadeleştir. |
| "Bu eklenti bozuk" (Chrome) | Klasördeki dosyalar eksik; ZIP'i yeniden çıkar. |
