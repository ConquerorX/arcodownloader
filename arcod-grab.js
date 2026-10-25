/* ARCOD Grab — player.arcod.xyz icin sayfa ici indirme paneli.
 *
 * Neden MAIN world? Sunucu tarayici disi istemcileri (Node, PowerShell, curl)
 * 502 ile reddeder. Bu betik sayfanin kendi origin'inden fetch ettigi icin
 * istek normal sayfa istegi gibi gorunur; CDP ile zorlamaya gerek kalmaz.
 *
 * Kapsam: acik olan albumun parcalarini tek tek, kullanici istegiyle indirir.
 * Ticket jetonu olusturulur, hemen kullanilir, asla saklanmaz ve asla gunluklenmez.
 */
(() => {
  'use strict';

  if (window.__arcodGrabInstalled) return;
  window.__arcodGrabInstalled = true;

const API = '/api/player';
  const PROBE_BYTES = 64 * 1024;
  const TAG = '__arcodgrab';   // MAIN <-> relay <-> background kanali

  /* Kalite tavanlari. ARCOD'un kendi kalite tablosu:
   *   jd = {5:{depth:16,rate:44.1}, 6:{16,48}, 7:{24,96}, 27:{24,192}}
   * Bunlar bir "tavan"dir: sunucu istenen tavani kaydin kendi cozunurluguyle
   * kesisir (ARCOD'un Id() fonksiyonu). Yani 24/192 isteyen bir CD kaydi
   * 16/48 alir; 24/96 isteyen 24/176.4 kaydi yine 24/176.4 alir.
   * Bu yuzden secim "kalitesi dusur" demek, "bu tavanin altinda kal" demek. */
  const QUALITY_PRESETS = [
    { id: 5, label: 'MP3 · 320 kbps', short: 'MP3 320', depth: 16, rate: 44.1 },
    { id: 6, label: '16-bit · 48 kHz', short: '16/48', depth: 16, rate: 48 },
    { id: 7, label: '24-bit · 96 kHz', short: '24/96', depth: 24, rate: 96 },
    /* etiketteki "en yuksek" cevrilir; getter her okunusta gecerli dili kullanir */
    { id: 27, get label() { return '24-bit · 192 kHz (' + T('qHighest') + ')'; }, short: '24/192', depth: 24, rate: 192 },
  ];
  const DEFAULT_QUALITY = 27;
  function qualityPreset(id) {
    return QUALITY_PRESETS.find((q) => q.id === id) || QUALITY_PRESETS[3];
  }

  const BLOCK = {
    0: 'STREAMINFO', 1: 'PADDING', 2: 'APPLICATION', 3: 'SEEKTABLE',
    4: 'VORBIS_COMMENT', 5: 'CUESHEET', 6: 'PICTURE',
  };

  const CFG_KEY = 'arcodgrab.cfg.v1';
  /* Panel kalicilik anahtarlari:
   *  UI_KEY   (localStorage) : { activated, folded, width } — eklenti hic etkinlestirildi mi,
   *                            govde katlandi mi, kullanicinin sectigi panel genisligi (px;
   *                            yoksa otomatik). Tum sekmelerde ortaktir.
   *  OPEN_KEY (sessionStorage): '1' = bu SEKMEDE panel acik. Sekmeye ozel (rozet de
   *                            sekmeye ozel); yenileme/SPA gezinmesinde korunur, yeni
   *                            sekmede ve tarayici yeniden acilinca KAPALI baslar.
   *  JOB_KEY  (localStorage) : yarim kalan toplu indirme kaydi (otomatik devam ETMEZ). */
  const UI_KEY = 'arcodgrab.ui.v1';
  const OPEN_KEY = 'arcodgrab.open.v1';
  const JOB_KEY = 'arcodgrab.job.v1';
  /* Hi-Res Audio sertifika rozeti (Wikimedia). Kalite Hi-Res ve ustundeyse
   * parca adinin yaninda gosterilir. PNG'yi data URI olarak gomuyoruz ki
   * sayfa CSP'si ya da uzak sunucu erisimi hicbir sey bozmasin. */
  /* ------------------------------------------------------------ ikonlar
   * SF Symbols'a benzer, cizgi tabanli SVG'ler. Gercek SF Symbols
   * lisansli oldugu icin kullanilamaz; ayni dilde (stroke, yuvarlak
   * uclar, 1.8 kalinlik, 24x24 kutu) elde cizildi.
   */
  const ICON = (d, extra) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ${extra || ''}>${d}</svg>`;

  const ICONS = {
    settings: ICON('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/>'
      + '<circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
    minus: ICON('<path d="M6 12h12"/>'),
    plus: ICON('<path d="M12 6v12M6 12h12"/>'),
    download: ICON('<path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/>'
      + '<path d="M4.5 19h15"/>'),
    chevron: ICON('<path d="M9 5l7 7-7 7"/>'),
    music: ICON('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/>'
      + '<circle cx="16.5" cy="16" r="2.5"/>'),
    list: ICON('<path d="M8 6h12M8 12h12M8 18h12"/>'
      + '<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/>'
      + '<circle cx="4" cy="18" r="1"/>'),
    check: ICON('<path d="M4.5 12.5l5 5 10-11"/>'),
    back: ICON('<path d="M15 5l-7 7 7 7"/>'),
    queueAdd: ICON('<path d="M3 7h10M3 12h10M3 17h6"/>'
      + '<path d="M17 11v8M13 15h8"/>'),
    trash: ICON('<path d="M4 7h16"/><path d="M9.5 7V5h5v2"/>'
      + '<path d="M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7"/>'),
    folder: ICON('<path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8'
      + 'a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
    play: ICON('<path d="M8 5.5l10 6.5-10 6.5z"/>'),
  };

  /* Ikon + etiketli dugme (Apple'in birincil eylem kalibi).
   * `key` sozluk anahtaridir (bkz. I18N); dil degisince etiket kendiliginden
   * yenilenir (data-i18n). */
  function iconBtn(cls, name, key, extra) {
    return `<button class="${cls}"${extra || ''}>${ICONS[name]}${lbl(key)}</button>`;
  }

  /* Yalnizca ikonlu dugme; title/aria-label sozluk anahtarindan gelir. */
  function setIcon(btn, name, key) {
    btn.innerHTML = ICONS[name];
    btn.classList.add('icon');
    if (key) {
      btn.title = T(key);
      btn.setAttribute('aria-label', T(key));
      btn.setAttribute('data-i18n-title', key);
      btn.setAttribute('data-i18n-aria', key);
    }
  }

  /* Ikonlu bir dugmenin ETIKETINI degistirir.
   * textContent kullanmak dugmenin icindeki SVG'yi silerdi; bu yuzden
   * ikon + etiket her zaman birlikte yazilir. `key` sozluk anahtaridir. */
  function setBtnLabel(btn, icon, key) {
    if (!btn) return;
    btn.innerHTML = ICONS[icon] + lbl(key);
  }

  const HIRES_LOGO = 'data:image/png;base64,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';
  const DEFAULT_TEMPLATE = '{n}. {title}{version} - {artist}.flac';

  /* ------------------------------------------------------------ cok dilli
   * Kullaniciya gorunen TUM metinler bu sozlukte. T('anahtar', {n}) ile
   * okunur; eksik anahtarda once TR'ye, o da yoksa anahtarin kendisine
   * dusulur. Yer tutucular {ad} bicimindedir. Sonu `H` ile biten anahtarlar
   * HTML icerir (th() ile okunur: parametreler kacislanir).
   * Yeni dil eklemek icin bkz. README "Diller". */
  const LANGS = [
    { id: 'tr', name: 'Türkçe' },
    { id: 'en', name: 'English' },
    { id: 'de', name: 'Deutsch' },
    { id: 'fr', name: 'Français' },
    { id: 'es', name: 'Español' },
    { id: 'ru', name: 'Русский' },
  ];

  const I18N = {
    tr: {
      gripLabel: 'Panel genişliği',
      gripTip: 'Sürükle · ← → ile ayarla · çift tıkla: varsayılan',
      barQueueAll: 'Tümünü İndir',
      barQueueAllTip: 'sıradaki tüm parçaları indir',
      barAlbum: 'albümü indir',
      barAlbumTip: 'albümün tüm parçalarını klasöre indir',
      stop: 'durdur',
      resume: 'devam et',
      settings: 'ayarlar',
      foldClose: 'paneli katla',
      foldOpen: 'paneli aç',
      npLabel: 'şu an çalıyor',
      dl: 'indir',
      npQueueAdd: 'sıraya ekle',
      npQueued: 'sıraya eklendi',
      loading: 'yükleniyor…',
      qEmpty: 'sıra boş',
      qClear: 'temizle',
      qCleared: 'sıra temizlendi',
      qCount: '{n} parça sırada',
      qTitleless: '(başlıksız)',
      qRemove: 'çıkar',
      qRemoveTip: 'sıradan çıkar',
      qBtnTip: '{n} parça · en yüksek kalitede (quality 27)',
      back: 'geri',
      settingsTitle: 'ayarlar',
      gLang: 'dil',
      langLabel: 'arayüz dili',
      langAuto: 'otomatik (tarayıcı dili)',
      langHint: 'Değişiklik hemen uygulanır.',
      gAppearance: 'görünüm',
      easyName: 'Kolay Mod',
      easyDesc: 'Görme engelliler için: daha büyük yazı, yüksek kontrast ve büyük dokunma hedefleri. İçerik gizlenmez.',
      npName: 'Şu an çalıyor kartı',
      npDesc: 'Sayfanın altındaki oynatıcıyı izleyip çalan parçayı gösterir. Kapatırsan oynatıcı hiç okunmaz.',
      easyOn: 'Kolay Mod açık',
      easyOff: 'Kolay Mod kapalı',
      npOn: 'çalan takip ediliyor',
      npOff: 'çalan takibi kapalı',
      themeLabel: 'tema',
      themeAuto: 'sistemle aynı',
      themeDark: 'koyu',
      themeLight: 'açık',
      themeHint: 'Kolay Mod açıkken panel her zaman koyu ve yüksek kontrastlıdır.',
      widthTitle: 'panel genişliği',
      widthHint: 'Panelin kenarındaki tutamacı sürükle ya da odaklanıp <b>←</b> / <b>→</b> tuşlarını kullan '
        + '(<b>Shift</b> ile büyük adım, <b>Home</b>/<b>End</b> uç değerler). Çift tıklamak varsayılana döndürür.',
      widthReset: 'varsayılan genişlik',
      widthNow: '{n} piksel',
      gQuality: 'indirme kalitesi',
      qualCeil: 'kalite tavanı',
      qualHintH: 'Sunucu bu tavanı <b>kaydın kendi çözünürlüğüyle kesiştirir</b>. '
        + 'Yani 24/192 istesen bile CD kayıt 16/44.1 gelir; '
        + '24/96 tavanı ise 24/176.4 kaydı yine tam kalitede verir. '
        + 'Düşük tavan = daha küçük dosya, daha hızlı indirme.',
      qualSet: 'kalite tavanı: {q}',
      qHighest: 'en yüksek',
      gFile: 'dosya adı',
      tplLabel: 'şablon metni (gelişmiş)',
      tplExample: 'örnek',
      tplBlocks: 'blok sırası',
      tplBlocksHint: 'Blokları sürükleyip bırakarak sırala; bir bloğa basınca kaldırılır. Klavyede bloğa odaklanıp ← → ile taşı. Bloklar arasındaki ayırıcıları elle yazabilirsin.',
      tplPool: 'eklenebilir bloklar',
      tplPoolAria: '{name}: eklemek veya kaldırmak için bas',
      tplChipAria: '{name}: sürükleyerek veya ← → ile taşı, Enter ile kaldır',
      tplSepAria: 'ayırıcı {n}',
      tplExtAria: 'dosya uzantısı',
      tplEmpty: 'Blok yok. Aşağıdan bir blok ekle.',
      tplMoved: '{name} {pos}. sıraya taşındı',
      tplAdded: '{name} eklendi',
      tplRemoved: '{name} kaldırıldı',
      ph_n: 'Sıra numarası (01, 02…)',
      ph_title: 'Şarkı adı',
      ph_version: 'Sürüm / remix notu',
      ph_artist: 'Sanatçı',
      ph_album: 'Albüm adı',
      ph_quality: 'Kalite (24-bit 192 kHz)',
      ph_qualityShort: 'Kalite kısası (24-192)',
      ph_isrc: 'ISRC kodu',
      ph_year: 'Yıl',
      ph_label: 'Plak şirketi',
      gSave: 'nasıl kaydedilsin',
      saveDlTitle: 'tarayıcı indirmeleri',
      saveDlDesc: 'Dosyalar, tarayıcının İndirilenler klasörüne sormadan iner. Albüm ve sıra, içinde kendi alt klasörüne konur. Her tarayıcıda çalışır.',
      saveFsaTitle: 'klasör seç',
      saveFsaDesc: 'Her indirmede kaydedilecek yeri sen seçersin: tek parçada dosya, albümde bir klasör. Veri doğrudan seçtiğin yere yazılır.',
      saveFsaOff: 'Bu tarayıcı yer seçmeyi desteklemiyor (örneğin Firefox); tarayıcı indirmeleri kullanılır.',
      saveQueueNote: 'Sıradaki parçalar (Tümünü İndir) her zaman tarayıcı indirmeleriyle iner; aksi halde her dosya için ayrı bir seçim penceresi açılırdı.',
      gAbout: 'hakkında',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>ARCOD’un sayfası içinde çalışan bir indirme yardımcısıdır. '
        + 'Hiçbir veri sunucuya gönderilmez.',
      creditH: 'ARCOD Grab · <b>Emre Dural</b> tarafından yapıldı',
      qUnkShort: 'bilinmiyor',
      qUnkName: 'kalite bilinmiyor',
      qMaxName: 'hi-res · çok yüksek çözünürlük',
      qEnhName: 'gelişmiş',
      mono: 'mono',
      stereo: 'stereo',
      chN: '{n} kanal',
      probeBtn: 'dosyayı doğrula',
      probeTip: 'İndirmeden önce akışın gerçek kalitesini okur: bit derinliği, örnekleme hızı ve dosyanın bozulup bozulmadığı',
      probeReading: 'Akış okunuyor…',
      probeFail: 'Okunamadı',
      probeFailWhy: 'sebep belirtilmedi',
      probeOkTitle: 'Dosya okundu',
      probeOriginal: 'Dosya orijinal görünüyor.',
      probeRepacked: 'Dosya yeniden paketlenmiş (iç kontrol değeri sıfırlanmış). Ses sağlam, ama orijinal paket değil.',
      probeNoTags: 'Dosyada etiket yok — şarkı adı ve sanatçı gibi bilgiler silinmiş.',
      kRate: 'Örnekleme',
      kBits: 'Bit derinliği',
      kCh: 'Kanal',
      kDur: 'Süre',
      kMd5: 'İç kontrol (MD5)',
      kMd5Zero: 'sıfırlanmış',
      kBlocks: 'Bloklar',
      probeWhyShort: 'ilk 42 bayt gelmedi',
      probeWhyMagic: 'imza "{m}" — fLaC değil',
      probeWhyNoInfo: 'STREAMINFO bloğu yok',
      errAlbumNoData: 'albüm verisi yok',
      errTicketUrl: 'ticket içinde url yok',
      err502: 'sunucu 502 verdi — sayfayı normal şekilde aç, sonra tekrar dene',
      errAudioHttp: 'ses HTTP {n}',
      errNoBody: 'akışlanabilir gövde yok (body null)',
      errUnknown: 'bilinmeyen hata',
      errBadUrl: 'beklenmeyen adres',
      errBadId: 'geçersiz indirme kimliği',
      errBridgeNoBackend: 'arka uç yanıt vermedi',
      errBridgeTimeout: 'köprü yanıt vermedi — sayfayı F5 ile yenile (relay.js yeniden yüklenir)',
      nTracksH: '<b>{n}</b> parça',
      totalH: '<b>{t}</b> toplam',
      mixNone: 'kalite bilgisi yok',
      mixTip: 'parçaların kalite dağılımı',
      nUnknown: '{n} bilinmiyor',
      mixWarn: '⚠ kaliteler karışık — hepsi en yüksek kalitede değil',
      details: 'ayrıntılar',
      handing: 'indirme yöneticisine devrediliyor…',
      dlStartedH: '✓ indiriliyor · {name} · tarayıcı indirmelerinde',
      ticketing: 'ticket alınıyor…',
      streamOpen: 'akış açık · {size} bekleniyor · kalite {q}',
      etaLeft: 'kalan {t}',
      doneOk: '✓ tamamlandı',
      doneMismatch: '⚠ boyut uyuşmuyor',
      declSize: 'beyan {size}',
      secs: '{n} sn',
      abortedLine: 'durduruldu · {size} yazıldı',
      stopped: 'durduruldu',
      open: 'Aç',
      openTip: 'varsayılan oynatıcıda aç',
      noHandle: 'dosya tutucusu yok',
      showFolder: 'Klasörde Göster',
      showFolderTipDl: 'indirmeler sayfasını açar (orada Klasörde göster var)',
      showFolderTipDir: 'varsayılan İndirilenler klasörünü açar',
      folderFail: 'Klasör açılamadı: {e}',
      openFail: 'Açılamadı: {e}',
      tabBlockedH: 'Yeni sekme engellendi — dosya: <b>{name}</b>',
      queueRunH: 'sıra indiriliyor → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'albüm indiriliyor → <b>{dir}/</b> · 0/{n}',
      sumSent: '{ok}/{total} gönderildi',
      sumStarted: '{ok}/{total} başlatıldı',
      sumDone: '{ok}/{total} indirildi',
      sumFail: ', {n} hata',
      jobStoppedH: 'durduruldu · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'bitti (hatalı parçalar var) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ albüm tamam · {sum} → <b>{dir}/</b> klasöründe',
      albumOkDlH: '✓ albüm gönderildi · {sum} → <b>{dir}/</b> klasöründe',
      queueOkH: '✓ sıra tamam · {sum} → <b>{dir}/</b> klasöründe',
      pausedQueueH: '⏸ sıra duraklatıldı · {done}/{total} gönderilmişti · devam etmek için <b>{btn}</b> düğmesine bas',
      pausedAlbumH: '⏸ albüm indirmesi yarıda kaldı. Baştan başlatmak için <b>{btn}</b> düğmesine bas.',
      noFsaDir: 'Bu tarayıcı klasör seçmeyi desteklemiyor.',
      mkdirFail: 'Klasör oluşturulamadı: {e}',
      fileTypeDesc: 'FLAC ses',
      ctxDownload: 'ARCOD Grab ile indir',
      ctxQueue: 'İndirme Sırasına Ekle',
      ctxQueued: 'sırada ✓',
      ctxQueuedTip: 'bu parça zaten sırada',
      ctxQueueTip: 'listeye ekle, sonra hepsini tek tek indir',
      ctxAddedH: '✓ sıraya eklendi · {title} · {n} parça',
      ctxDupH: 'sırada zaten var · {title}',
      scTitle: 'kısayollar',
      scHintH: 'player.arcod.xyz üzerinde, panel kapalıyken de çalışır. '
        + 'Kutuya tıkla, sonra tuş kombinasyonuna bas. '
        + '<b>Esc</b> vazgeçer, <b>Backspace</b> kısayolu boşaltır.',
      scReset: 'varsayılana dön',
      scScopeLabel: 'kısayol kapsamı',
      scScopePage: 'yalnızca ARCOD sayfasında',
      scScopePageDesc: 'Tuşlar yalnızca player.arcod.xyz sekmesi öndeyken çalışır. Aşağıda atadığın özel tuşlar bu kapsamda geçerlidir.',
      scScopeGlobal: 'tüm tarayıcıda (global)',
      scScopeGlobalDesc: 'Başka bir sekmedeyken de çalışır. Tuşları Chrome’un kısayol sayfasından atarsın; paneldeki özel tuşlar burada geçmez.',
      scGlobalHelpH: 'Chrome en fazla 4 eklenti komutuna izin verir (önceki, sonraki, ses artır, ses kıs). Tuşları <b>chrome://extensions/shortcuts</b> sayfasında ARCOD Grab için ata. Açık bir ARCOD sekmesi yoksa komutlar sessizce yok sayılır.',
      scOpenChrome: 'kısayol ayarlarını aç',
      scCopyAddr: 'adresi kopyala',
      scCopied: 'adres kopyalandı',
      scCopyFail: 'kopyalanamadı; adresi elle yaz: chrome://extensions/shortcuts',
      scCmdListTitle: 'Chrome’da atanan tuşlar',
      scPageOnlyH: 'Paneldeki özel tuşlar yalnızca <b>ARCOD sayfasında</b> çalışır.',
      scPrev: 'Önceki parça',
      scNext: 'Sonraki parça',
      scVolUp: 'Sesi artır',
      scVolDown: 'Sesi kıs',
      scKeyAria: '{a} kısayolu',
      scPress: 'tuşa bas…',
      scNone: 'atanmadı',
      scWarnNone: 'Atanmamış: bu eylem çalışmaz.',
      scWarnConflict: 'Çakışıyor: {names}. Yalnızca listede önce gelen çalışır.',
      scWarnReserved: 'Tarayıcı bu kısayolu kendisi kullanır; çalışmayabilir.',
      keySpace: 'Boşluk',
      volToast: 'Ses %{n}',
      homeMeta: 'parça listesinden bir şarkıya sağ tıkla',
      homeTipH: 'İndirmek istediğin parçaya <b>sağ tık</b> → <b>{item}</b>.'
        + '<br>Bir albüm açarsan (…/album/&lt;UPC&gt;) liste burada da çıkar.',
      albumLoading: 'albüm yükleniyor…',
      albumReadFail: '✗ albüm okunamadı: {e}',
      dec: ',',
    },

    en: {
      gripLabel: 'Panel width',
      gripTip: 'Drag · adjust with ← → · double-click: default',
      barQueueAll: 'Download all',
      barQueueAllTip: 'download every queued track',
      barAlbum: 'download album',
      barAlbumTip: 'download all tracks of the album to a folder',
      stop: 'stop',
      resume: 'resume',
      settings: 'settings',
      foldClose: 'collapse panel',
      foldOpen: 'expand panel',
      npLabel: 'now playing',
      dl: 'download',
      npQueueAdd: 'add to queue',
      npQueued: 'added to queue',
      loading: 'loading…',
      qEmpty: 'queue is empty',
      qClear: 'clear',
      qCleared: 'queue cleared',
      qCount: '{n} in queue',
      qTitleless: '(untitled)',
      qRemove: 'remove',
      qRemoveTip: 'remove from queue',
      qBtnTip: '{n} tracks · highest quality (quality 27)',
      back: 'back',
      settingsTitle: 'settings',
      gLang: 'language',
      langLabel: 'interface language',
      langAuto: 'automatic (browser language)',
      langHint: 'Changes apply instantly.',
      gAppearance: 'appearance',
      easyName: 'Easy Mode',
      easyDesc: 'For low-vision users: larger text, high contrast and big touch targets. Nothing is hidden.',
      npName: 'Now playing card',
      npDesc: 'Watches the player at the bottom of the page and shows the current track. If you turn it off, the player is never read.',
      easyOn: 'Easy Mode on',
      easyOff: 'Easy Mode off',
      npOn: 'following the current track',
      npOff: 'track following off',
      themeLabel: 'theme',
      themeAuto: 'same as system',
      themeDark: 'dark',
      themeLight: 'light',
      themeHint: 'With Easy Mode on, the panel is always dark and high-contrast.',
      widthTitle: 'panel width',
      widthHint: 'Drag the handle on the panel edge, or focus it and use <b>←</b> / <b>→</b> '
        + '(<b>Shift</b> for big steps, <b>Home</b>/<b>End</b> for the limits). Double-click resets to default.',
      widthReset: 'default width',
      widthNow: '{n} pixels',
      gQuality: 'download quality',
      qualCeil: 'quality ceiling',
      qualHintH: 'The server <b>intersects this ceiling with the track’s own resolution</b>. '
        + 'So even if you pick 24/192, a CD track arrives as 16/44.1; '
        + 'a 24/96 ceiling still delivers a 24/176.4 track at full quality. '
        + 'Lower ceiling = smaller file, faster download.',
      qualSet: 'quality ceiling: {q}',
      qHighest: 'highest',
      gFile: 'file name',
      tplLabel: 'template text (advanced)',
      tplExample: 'preview',
      tplBlocks: 'block order',
      tplBlocksHint: 'Drag blocks to reorder them; press a block to remove it. With the keyboard, focus a block and use ← → to move it. You can type the separators between blocks yourself.',
      tplPool: 'available blocks',
      tplPoolAria: '{name}: press to add or remove',
      tplChipAria: '{name}: drag or use ← → to move, Enter to remove',
      tplSepAria: 'separator {n}',
      tplExtAria: 'file extension',
      tplEmpty: 'No blocks. Add one below.',
      tplMoved: '{name} moved to position {pos}',
      tplAdded: '{name} added',
      tplRemoved: '{name} removed',
      ph_n: 'Track number (01, 02…)',
      ph_title: 'Song title',
      ph_version: 'Version / remix note',
      ph_artist: 'Artist',
      ph_album: 'Album title',
      ph_quality: 'Quality (24-bit 192 kHz)',
      ph_qualityShort: 'Short quality (24-192)',
      ph_isrc: 'ISRC code',
      ph_year: 'Year',
      ph_label: 'Record label',
      gSave: 'how to save',
      saveDlTitle: 'browser downloads',
      saveDlDesc: 'Files go to your browser’s Downloads folder without asking. Albums and the queue get their own subfolder. Works in every browser.',
      saveFsaTitle: 'choose a folder',
      saveFsaDesc: 'You pick where to save each time: a file for a single track, a folder for an album. Data is written straight to the place you chose.',
      saveFsaOff: 'This browser cannot pick a save location (for example Firefox); browser downloads are used.',
      saveQueueNote: 'Queued tracks (Download all) always use browser downloads; otherwise a separate dialog would open for every file.',
      gAbout: 'about',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>A download helper that runs inside the ARCOD page. '
        + 'No data is sent to any server.',
      creditH: 'ARCOD Grab · made by <b>Emre Dural</b>',
      qUnkShort: 'unknown',
      qUnkName: 'quality unknown',
      qMaxName: 'hi-res · very high resolution',
      qEnhName: 'enhanced',
      mono: 'mono',
      stereo: 'stereo',
      chN: '{n} channels',
      probeBtn: 'verify file',
      probeTip: 'Reads the stream’s real quality before downloading: bit depth, sample rate and whether the file is intact',
      probeReading: 'Reading stream…',
      probeFail: 'Could not read',
      probeFailWhy: 'no reason given',
      probeOkTitle: 'File read',
      probeOriginal: 'The file looks original.',
      probeRepacked: 'The file was repackaged (internal checksum zeroed). The audio is intact, but it is not the original package.',
      probeNoTags: 'The file has no tags — info like title and artist was stripped.',
      kRate: 'Sample rate',
      kBits: 'Bit depth',
      kCh: 'Channels',
      kDur: 'Duration',
      kMd5: 'Internal check (MD5)',
      kMd5Zero: 'zeroed',
      kBlocks: 'Blocks',
      probeWhyShort: 'first 42 bytes missing',
      probeWhyMagic: 'signature "{m}" — not fLaC',
      probeWhyNoInfo: 'no STREAMINFO block',
      errAlbumNoData: 'no album data',
      errTicketUrl: 'no url in ticket',
      err502: 'server returned 502 — open the page normally, then try again',
      errAudioHttp: 'audio HTTP {n}',
      errNoBody: 'no streamable body (body is null)',
      errUnknown: 'unknown error',
      errBadUrl: 'unexpected address',
      errBadId: 'invalid download id',
      errBridgeNoBackend: 'background did not respond',
      errBridgeTimeout: 'bridge did not respond — refresh the page with F5 (relay.js reloads)',
      nTracksH: '<b>{n}</b> tracks',
      totalH: '<b>{t}</b> total',
      mixNone: 'no quality info',
      mixTip: 'quality distribution of the tracks',
      nUnknown: '{n} unknown',
      mixWarn: '⚠ mixed qualities — not all at the highest quality',
      details: 'details',
      handing: 'handing off to the download manager…',
      dlStartedH: '✓ downloading · {name} · see browser downloads',
      ticketing: 'getting ticket…',
      streamOpen: 'stream open · expecting {size} · quality {q}',
      etaLeft: '{t} left',
      doneOk: '✓ done',
      doneMismatch: '⚠ size mismatch',
      declSize: 'declared {size}',
      secs: '{n} s',
      abortedLine: 'stopped · {size} written',
      stopped: 'stopped',
      open: 'Open',
      openTip: 'open in the default player',
      noHandle: 'no file handle',
      showFolder: 'Show in folder',
      showFolderTipDl: 'opens the downloads page (it has Show in folder)',
      showFolderTipDir: 'opens the default Downloads folder',
      folderFail: 'Could not open folder: {e}',
      openFail: 'Could not open: {e}',
      tabBlockedH: 'New tab blocked — file: <b>{name}</b>',
      queueRunH: 'downloading queue → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'downloading album → <b>{dir}/</b> · 0/{n}',
      sumSent: '{ok}/{total} sent',
      sumStarted: '{ok}/{total} started',
      sumDone: '{ok}/{total} downloaded',
      sumFail: ', {n} failed',
      jobStoppedH: 'stopped · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'finished (some tracks failed) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ album done · {sum} → in folder <b>{dir}/</b>',
      albumOkDlH: '✓ album sent · {sum} → in folder <b>{dir}/</b>',
      queueOkH: '✓ queue done · {sum} → in folder <b>{dir}/</b>',
      pausedQueueH: '⏸ queue paused · {done}/{total} had been sent · press <b>{btn}</b> to continue',
      pausedAlbumH: '⏸ album download was interrupted. Press <b>{btn}</b> to start over.',
      noFsaDir: 'This browser does not support picking a folder.',
      mkdirFail: 'Could not create folder: {e}',
      fileTypeDesc: 'FLAC audio',
      ctxDownload: 'Download with ARCOD Grab',
      ctxQueue: 'Add to download queue',
      ctxQueued: 'in queue ✓',
      ctxQueuedTip: 'this track is already in the queue',
      ctxQueueTip: 'add to the list, then download everything one by one',
      ctxAddedH: '✓ added to queue · {title} · {n} tracks',
      ctxDupH: 'already in queue · {title}',
      scTitle: 'shortcuts',
      scHintH: 'Works on player.arcod.xyz, even when the panel is closed. '
        + 'Click the box, then press the key combination. '
        + '<b>Esc</b> cancels, <b>Backspace</b> clears the shortcut.',
      scReset: 'reset to defaults',
      scScopeLabel: 'shortcut scope',
      scScopePage: 'on the ARCOD page only',
      scScopePageDesc: 'Keys work only while the player.arcod.xyz tab is in front. The custom keys you set below apply to this scope.',
      scScopeGlobal: 'whole browser (global)',
      scScopeGlobalDesc: 'Also works while you are on another tab. You assign the keys on Chrome’s shortcuts page; the custom keys in the panel do not apply here.',
      scGlobalHelpH: 'Chrome allows at most 4 commands per extension (previous, next, volume up, volume down). Assign the keys for ARCOD Grab on <b>chrome://extensions/shortcuts</b>. If no ARCOD tab is open, the commands are silently ignored.',
      scOpenChrome: 'open shortcut settings',
      scCopyAddr: 'copy address',
      scCopied: 'address copied',
      scCopyFail: 'could not copy; type the address yourself: chrome://extensions/shortcuts',
      scCmdListTitle: 'Keys assigned in Chrome',
      scPageOnlyH: 'Custom keys in the panel work on the <b>ARCOD page</b> only.',
      scPrev: 'Previous track',
      scNext: 'Next track',
      scVolUp: 'Volume up',
      scVolDown: 'Volume down',
      scKeyAria: '{a} shortcut',
      scPress: 'press a key…',
      scNone: 'not set',
      scWarnNone: 'Not assigned: this action will not run.',
      scWarnConflict: 'Conflicts with: {names}. Only the first in the list runs.',
      scWarnReserved: 'The browser uses this shortcut itself; it may not work.',
      keySpace: 'Space',
      volToast: 'Volume {n}%',
      homeMeta: 'right-click a track in the list',
      homeTipH: '<b>Right-click</b> the track you want to download → <b>{item}</b>.'
        + '<br>If you open an album (…/album/&lt;UPC&gt;) the list appears here too.',
      albumLoading: 'loading album…',
      albumReadFail: '✗ could not read album: {e}',
      dec: '.',
    },

    de: {
      gripLabel: 'Panelbreite',
      gripTip: 'Ziehen · mit ← → anpassen · Doppelklick: Standard',
      barQueueAll: 'Alle laden',
      barQueueAllTip: 'alle Titel der Warteschlange herunterladen',
      barAlbum: 'Album laden',
      barAlbumTip: 'alle Titel des Albums in einen Ordner laden',
      stop: 'Stopp',
      resume: 'Fortsetzen',
      settings: 'Einstellungen',
      foldClose: 'Panel einklappen',
      foldOpen: 'Panel ausklappen',
      npLabel: 'läuft gerade',
      dl: 'Laden',
      npQueueAdd: 'In Warteschlange',
      npQueued: 'Hinzugefügt',
      loading: 'Lädt …',
      qEmpty: 'Warteschlange leer',
      qClear: 'Leeren',
      qCleared: 'Warteschlange geleert',
      qCount: '{n} in der Warteschlange',
      qTitleless: '(ohne Titel)',
      qRemove: 'Entfernen',
      qRemoveTip: 'Aus der Warteschlange entfernen',
      qBtnTip: '{n} Titel · höchste Qualität (quality 27)',
      back: 'Zurück',
      settingsTitle: 'Einstellungen',
      gLang: 'Sprache',
      langLabel: 'Oberflächensprache',
      langAuto: 'Automatisch (Browsersprache)',
      langHint: 'Änderungen gelten sofort.',
      gAppearance: 'Darstellung',
      easyName: 'Einfacher Modus',
      easyDesc: 'Für Sehbehinderte: größere Schrift, hoher Kontrast und große Bedienflächen. Nichts wird ausgeblendet.',
      npName: 'Karte „Läuft gerade“',
      npDesc: 'Beobachtet den Player am Seitenende und zeigt den aktuellen Titel. Wenn aus, wird der Player nie gelesen.',
      easyOn: 'Einfacher Modus an',
      easyOff: 'Einfacher Modus aus',
      npOn: 'Wiedergabe wird verfolgt',
      npOff: 'Wiedergabe-Verfolgung aus',
      themeLabel: 'Design',
      themeAuto: 'wie System',
      themeDark: 'dunkel',
      themeLight: 'hell',
      themeHint: 'Im Einfachen Modus ist das Panel immer dunkel und kontrastreich.',
      widthTitle: 'Panelbreite',
      widthHint: 'Ziehe den Griff am Panelrand oder fokussiere ihn und nutze <b>←</b> / <b>→</b> '
        + '(<b>Shift</b> für große Schritte, <b>Pos1</b>/<b>Ende</b> für die Grenzen). Doppelklick setzt auf Standard zurück.',
      widthReset: 'Standardbreite',
      widthNow: '{n} Pixel',
      gQuality: 'Download-Qualität',
      qualCeil: 'Qualitätsobergrenze',
      qualHintH: 'Der Server <b>schneidet diese Obergrenze mit der Auflösung des Titels</b>. '
        + 'Auch bei 24/192 kommt ein CD-Titel als 16/44.1; '
        + 'eine 24/96-Grenze liefert einen 24/176.4-Titel dennoch in voller Qualität. '
        + 'Niedrigere Grenze = kleinere Datei, schnellerer Download.',
      qualSet: 'Qualitätsgrenze: {q}',
      qHighest: 'höchste',
      gFile: 'Dateiname',
      tplLabel: 'Vorlagentext (erweitert)',
      tplExample: 'Vorschau',
      tplBlocks: 'Reihenfolge der Blöcke',
      tplBlocksHint: 'Blöcke per Drag-and-drop umsortieren; Antippen entfernt einen Block. Mit der Tastatur einen Block fokussieren und mit ← → verschieben. Die Trennzeichen zwischen den Blöcken kannst du selbst eintippen.',
      tplPool: 'verfügbare Blöcke',
      tplPoolAria: '{name}: drücken zum Hinzufügen oder Entfernen',
      tplChipAria: '{name}: ziehen oder mit ← → verschieben, Enter entfernt',
      tplSepAria: 'Trennzeichen {n}',
      tplExtAria: 'Dateiendung',
      tplEmpty: 'Keine Blöcke. Füge unten einen hinzu.',
      tplMoved: '{name} auf Position {pos} verschoben',
      tplAdded: '{name} hinzugefügt',
      tplRemoved: '{name} entfernt',
      ph_n: 'Titelnummer (01, 02…)',
      ph_title: 'Songtitel',
      ph_version: 'Version / Remix-Hinweis',
      ph_artist: 'Interpret',
      ph_album: 'Albumtitel',
      ph_quality: 'Qualität (24-bit 192 kHz)',
      ph_qualityShort: 'Qualität kurz (24-192)',
      ph_isrc: 'ISRC-Code',
      ph_year: 'Jahr',
      ph_label: 'Plattenlabel',
      gSave: 'Speichern',
      saveDlTitle: 'Browser-Downloads',
      saveDlDesc: 'Dateien landen ohne Rückfrage im Download-Ordner des Browsers. Alben und die Warteschlange bekommen einen eigenen Unterordner. Funktioniert in jedem Browser.',
      saveFsaTitle: 'Ordner wählen',
      saveFsaDesc: 'Du wählst jedes Mal den Speicherort: bei einem Titel eine Datei, bei einem Album einen Ordner. Die Daten werden direkt dorthin geschrieben.',
      saveFsaOff: 'Dieser Browser kann keinen Speicherort wählen (z. B. Firefox); es werden Browser-Downloads verwendet.',
      saveQueueNote: 'Titel aus der Warteschlange (Alle herunterladen) nutzen immer Browser-Downloads; sonst würde für jede Datei ein eigener Dialog erscheinen.',
      gAbout: 'Über',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>Ein Download-Helfer, der direkt in der ARCOD-Seite läuft. '
        + 'Es werden keine Daten an einen Server gesendet.',
      creditH: 'ARCOD Grab · von <b>Emre Dural</b>',
      qUnkShort: 'unbekannt',
      qUnkName: 'Qualität unbekannt',
      qMaxName: 'Hi-Res · sehr hohe Auflösung',
      qEnhName: 'erweitert',
      mono: 'Mono',
      stereo: 'Stereo',
      chN: '{n} Kanäle',
      probeBtn: 'Datei prüfen',
      probeTip: 'Liest vor dem Download die echte Qualität des Streams: Bittiefe, Abtastrate und ob die Datei unversehrt ist',
      probeReading: 'Stream wird gelesen …',
      probeFail: 'Nicht lesbar',
      probeFailWhy: 'kein Grund angegeben',
      probeOkTitle: 'Datei gelesen',
      probeOriginal: 'Die Datei wirkt original.',
      probeRepacked: 'Die Datei wurde neu verpackt (interne Prüfsumme genullt). Das Audio ist intakt, aber nicht das Originalpaket.',
      probeNoTags: 'Die Datei hat keine Tags – Titel, Interpret usw. wurden entfernt.',
      kRate: 'Abtastrate',
      kBits: 'Bittiefe',
      kCh: 'Kanäle',
      kDur: 'Dauer',
      kMd5: 'Interne Prüfsumme (MD5)',
      kMd5Zero: 'genullt',
      kBlocks: 'Blöcke',
      probeWhyShort: 'die ersten 42 Bytes fehlen',
      probeWhyMagic: 'Signatur „{m}“ – nicht fLaC',
      probeWhyNoInfo: 'kein STREAMINFO-Block',
      errAlbumNoData: 'keine Albumdaten',
      errTicketUrl: 'keine URL im Ticket',
      err502: 'Server antwortete mit 502 – Seite normal öffnen und erneut versuchen',
      errAudioHttp: 'Audio-HTTP {n}',
      errNoBody: 'kein streambarer Inhalt (body ist null)',
      errUnknown: 'unbekannter Fehler',
      errBadUrl: 'unerwartete Adresse',
      errBadId: 'ungültige Download-ID',
      errBridgeNoBackend: 'Hintergrunddienst antwortet nicht',
      errBridgeTimeout: 'Brücke antwortet nicht – Seite mit F5 neu laden (relay.js wird neu geladen)',
      nTracksH: '<b>{n}</b> Titel',
      totalH: '<b>{t}</b> gesamt',
      mixNone: 'keine Qualitätsangaben',
      mixTip: 'Qualitätsverteilung der Titel',
      nUnknown: '{n} unbekannt',
      mixWarn: '⚠ gemischte Qualitäten – nicht alle in höchster Qualität',
      details: 'Details',
      handing: 'Übergabe an den Download-Manager …',
      dlStartedH: '✓ wird geladen · {name} · in den Browser-Downloads',
      ticketing: 'Ticket wird geholt …',
      streamOpen: 'Stream offen · erwartet {size} · Qualität {q}',
      etaLeft: 'noch {t}',
      doneOk: '✓ fertig',
      doneMismatch: '⚠ Größe weicht ab',
      declSize: 'angegeben {size}',
      secs: '{n} s',
      abortedLine: 'gestoppt · {size} geschrieben',
      stopped: 'gestoppt',
      open: 'Öffnen',
      openTip: 'im Standard-Player öffnen',
      noHandle: 'kein Datei-Handle',
      showFolder: 'Im Ordner zeigen',
      showFolderTipDl: 'öffnet die Download-Seite (dort gibt es „Im Ordner anzeigen“)',
      showFolderTipDir: 'öffnet den Standard-Downloadordner',
      folderFail: 'Ordner konnte nicht geöffnet werden: {e}',
      openFail: 'Konnte nicht geöffnet werden: {e}',
      tabBlockedH: 'Neuer Tab blockiert – Datei: <b>{name}</b>',
      queueRunH: 'Warteschlange wird geladen → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'Album wird geladen → <b>{dir}/</b> · 0/{n}',
      sumSent: '{ok}/{total} gesendet',
      sumStarted: '{ok}/{total} gestartet',
      sumDone: '{ok}/{total} geladen',
      sumFail: ', {n} Fehler',
      jobStoppedH: 'gestoppt · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'fertig (mit fehlerhaften Titeln) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ Album fertig · {sum} → im Ordner <b>{dir}/</b>',
      albumOkDlH: '✓ Album gesendet · {sum} → im Ordner <b>{dir}/</b>',
      queueOkH: '✓ Warteschlange fertig · {sum} → im Ordner <b>{dir}/</b>',
      pausedQueueH: '⏸ Warteschlange pausiert · {done}/{total} waren gesendet · zum Fortfahren <b>{btn}</b> drücken',
      pausedAlbumH: '⏸ Album-Download wurde unterbrochen. Zum Neustart <b>{btn}</b> drücken.',
      noFsaDir: 'Dieser Browser unterstützt keine Ordnerauswahl.',
      mkdirFail: 'Ordner konnte nicht erstellt werden: {e}',
      fileTypeDesc: 'FLAC-Audio',
      ctxDownload: 'Mit ARCOD Grab laden',
      ctxQueue: 'Zur Download-Warteschlange',
      ctxQueued: 'in Warteschlange ✓',
      ctxQueuedTip: 'dieser Titel ist schon in der Warteschlange',
      ctxQueueTip: 'zur Liste hinzufügen, später alles nacheinander laden',
      ctxAddedH: '✓ zur Warteschlange hinzugefügt · {title} · {n} Titel',
      ctxDupH: 'bereits in der Warteschlange · {title}',
      scTitle: 'Tastenkürzel',
      scHintH: 'Funktioniert auf player.arcod.xyz auch bei geschlossenem Panel. '
        + 'Klicke das Feld und drücke die Tastenkombination. '
        + '<b>Esc</b> bricht ab, <b>Rücktaste</b> leert das Kürzel.',
      scReset: 'Standard wiederherstellen',
      scScopeLabel: 'Geltungsbereich der Kürzel',
      scScopePage: 'nur auf der ARCOD-Seite',
      scScopePageDesc: 'Die Tasten funktionieren nur, solange der Tab player.arcod.xyz vorn ist. Die unten festgelegten eigenen Tasten gelten in diesem Bereich.',
      scScopeGlobal: 'im ganzen Browser (global)',
      scScopeGlobalDesc: 'Funktioniert auch in anderen Tabs. Die Tasten legst du auf der Kürzel-Seite von Chrome fest; die eigenen Tasten aus dem Panel gelten hier nicht.',
      scGlobalHelpH: 'Chrome erlaubt höchstens 4 Befehle pro Erweiterung (zurück, weiter, lauter, leiser). Lege die Tasten für ARCOD Grab auf <b>chrome://extensions/shortcuts</b> fest. Ist kein ARCOD-Tab geöffnet, werden die Befehle stillschweigend ignoriert.',
      scOpenChrome: 'Kürzel-Einstellungen öffnen',
      scCopyAddr: 'Adresse kopieren',
      scCopied: 'Adresse kopiert',
      scCopyFail: 'Kopieren fehlgeschlagen; gib die Adresse selbst ein: chrome://extensions/shortcuts',
      scCmdListTitle: 'In Chrome belegte Tasten',
      scPageOnlyH: 'Eigene Tasten im Panel gelten nur auf der <b>ARCOD-Seite</b>.',
      scPrev: 'Vorheriger Titel',
      scNext: 'Nächster Titel',
      scVolUp: 'Lauter',
      scVolDown: 'Leiser',
      scKeyAria: 'Tastenkürzel: {a}',
      scPress: 'Taste drücken …',
      scNone: 'nicht belegt',
      scWarnNone: 'Nicht belegt: Diese Aktion wird nicht ausgeführt.',
      scWarnConflict: 'Konflikt mit: {names}. Nur der erste Eintrag der Liste wird ausgeführt.',
      scWarnReserved: 'Der Browser nutzt dieses Kürzel selbst; es funktioniert evtl. nicht.',
      keySpace: 'Leertaste',
      volToast: 'Lautstärke {n} %',
      homeMeta: 'Rechtsklick auf einen Titel in der Liste',
      homeTipH: '<b>Rechtsklick</b> auf den Titel, den du laden möchtest → <b>{item}</b>.'
        + '<br>Öffnest du ein Album (…/album/&lt;UPC&gt;), erscheint die Liste auch hier.',
      albumLoading: 'Album wird geladen …',
      albumReadFail: '✗ Album konnte nicht gelesen werden: {e}',
      dec: ',',
    },

    fr: {
      gripLabel: 'Largeur du panneau',
      gripTip: 'Glisser · ajuster avec ← → · double-clic : défaut',
      barQueueAll: 'Tout télécharger',
      barQueueAllTip: 'télécharger tous les titres de la file',
      barAlbum: 'télécharger l’album',
      barAlbumTip: 'télécharger tous les titres de l’album dans un dossier',
      stop: 'arrêter',
      resume: 'reprendre',
      settings: 'réglages',
      foldClose: 'réduire le panneau',
      foldOpen: 'développer le panneau',
      npLabel: 'en cours de lecture',
      dl: 'télécharger',
      npQueueAdd: 'mettre en file',
      npQueued: 'ajouté à la file',
      loading: 'chargement…',
      qEmpty: 'file vide',
      qClear: 'vider',
      qCleared: 'file vidée',
      qCount: '{n} dans la file',
      qTitleless: '(sans titre)',
      qRemove: 'retirer',
      qRemoveTip: 'retirer de la file',
      qBtnTip: '{n} titres · qualité maximale (quality 27)',
      back: 'retour',
      settingsTitle: 'réglages',
      gLang: 'langue',
      langLabel: 'langue de l’interface',
      langAuto: 'automatique (langue du navigateur)',
      langHint: 'Les changements s’appliquent immédiatement.',
      gAppearance: 'apparence',
      easyName: 'Mode facile',
      easyDesc: 'Pour les malvoyants : texte plus grand, fort contraste et grandes zones tactiles. Rien n’est masqué.',
      npName: 'Carte « en cours de lecture »',
      npDesc: 'Surveille le lecteur en bas de la page et affiche le titre en cours. Désactivé, le lecteur n’est jamais lu.',
      easyOn: 'Mode facile activé',
      easyOff: 'Mode facile désactivé',
      npOn: 'suivi de la lecture activé',
      npOff: 'suivi de la lecture désactivé',
      themeLabel: 'thème',
      themeAuto: 'comme le système',
      themeDark: 'sombre',
      themeLight: 'clair',
      themeHint: 'En mode facile, le panneau est toujours sombre et très contrasté.',
      widthTitle: 'largeur du panneau',
      widthHint: 'Faites glisser la poignée au bord du panneau, ou donnez-lui le focus et utilisez <b>←</b> / <b>→</b> '
        + '(<b>Maj</b> pour de grands pas, <b>Début</b>/<b>Fin</b> pour les extrêmes). Un double-clic rétablit la valeur par défaut.',
      widthReset: 'largeur par défaut',
      widthNow: '{n} pixels',
      gQuality: 'qualité de téléchargement',
      qualCeil: 'plafond de qualité',
      qualHintH: 'Le serveur <b>croise ce plafond avec la résolution propre du titre</b>. '
        + 'Même avec 24/192, un titre CD arrive en 16/44.1 ; '
        + 'un plafond 24/96 livre quand même un titre 24/176.4 en pleine qualité. '
        + 'Plafond bas = fichier plus petit, téléchargement plus rapide.',
      qualSet: 'plafond de qualité : {q}',
      qHighest: 'maximum',
      gFile: 'nom du fichier',
      tplLabel: 'texte du modèle (avancé)',
      tplExample: 'aperçu',
      tplBlocks: 'ordre des blocs',
      tplBlocksHint: 'Faites glisser les blocs pour les réordonner ; appuyer sur un bloc le retire. Au clavier, placez le focus sur un bloc et déplacez-le avec ← →. Vous pouvez saisir vous-même les séparateurs entre les blocs.',
      tplPool: 'blocs disponibles',
      tplPoolAria: '{name} : appuyer pour ajouter ou retirer',
      tplChipAria: '{name} : glisser ou ← → pour déplacer, Entrée pour retirer',
      tplSepAria: 'séparateur {n}',
      tplExtAria: 'extension du fichier',
      tplEmpty: 'Aucun bloc. Ajoutez-en un ci-dessous.',
      tplMoved: '{name} déplacé en position {pos}',
      tplAdded: '{name} ajouté',
      tplRemoved: '{name} retiré',
      ph_n: 'Numéro de piste (01, 02…)',
      ph_title: 'Titre du morceau',
      ph_version: 'Version / note de remix',
      ph_artist: 'Artiste',
      ph_album: 'Titre de l’album',
      ph_quality: 'Qualité (24-bit 192 kHz)',
      ph_qualityShort: 'Qualité abrégée (24-192)',
      ph_isrc: 'Code ISRC',
      ph_year: 'Année',
      ph_label: 'Label',
      gSave: 'enregistrement',
      saveDlTitle: 'téléchargements du navigateur',
      saveDlDesc: 'Les fichiers vont dans le dossier Téléchargements du navigateur, sans demander. Les albums et la file ont leur propre sous-dossier. Fonctionne dans tous les navigateurs.',
      saveFsaTitle: 'choisir un dossier',
      saveFsaDesc: 'Vous choisissez l’emplacement à chaque fois : un fichier pour un titre, un dossier pour un album. Les données sont écrites directement à l’endroit choisi.',
      saveFsaOff: 'Ce navigateur ne permet pas de choisir l’emplacement (par exemple Firefox) ; les téléchargements du navigateur sont utilisés.',
      saveQueueNote: 'Les titres de la file (Tout télécharger) passent toujours par les téléchargements du navigateur ; sinon une fenêtre de choix s’ouvrirait pour chaque fichier.',
      gAbout: 'à propos',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>Un assistant de téléchargement qui fonctionne dans la page ARCOD. '
        + 'Aucune donnée n’est envoyée à un serveur.',
      creditH: 'ARCOD Grab · créé par <b>Emre Dural</b>',
      qUnkShort: 'inconnue',
      qUnkName: 'qualité inconnue',
      qMaxName: 'hi-res · très haute résolution',
      qEnhName: 'améliorée',
      mono: 'mono',
      stereo: 'stéréo',
      chN: '{n} canaux',
      probeBtn: 'vérifier le fichier',
      probeTip: 'Lit la qualité réelle du flux avant le téléchargement : profondeur de bits, fréquence d’échantillonnage et intégrité du fichier',
      probeReading: 'Lecture du flux…',
      probeFail: 'Lecture impossible',
      probeFailWhy: 'aucune raison indiquée',
      probeOkTitle: 'Fichier lu',
      probeOriginal: 'Le fichier semble original.',
      probeRepacked: 'Le fichier a été reconditionné (somme de contrôle interne mise à zéro). L’audio est intact, mais ce n’est pas le paquet d’origine.',
      probeNoTags: 'Le fichier n’a aucune balise : titre, artiste, etc. ont été supprimés.',
      kRate: 'Échantillonnage',
      kBits: 'Profondeur de bits',
      kCh: 'Canaux',
      kDur: 'Durée',
      kMd5: 'Contrôle interne (MD5)',
      kMd5Zero: 'mis à zéro',
      kBlocks: 'Blocs',
      probeWhyShort: 'les 42 premiers octets manquent',
      probeWhyMagic: 'signature « {m} » — pas fLaC',
      probeWhyNoInfo: 'aucun bloc STREAMINFO',
      errAlbumNoData: 'aucune donnée d’album',
      errTicketUrl: 'pas d’url dans le ticket',
      err502: 'le serveur a répondu 502 — ouvrez la page normalement, puis réessayez',
      errAudioHttp: 'audio HTTP {n}',
      errNoBody: 'aucun corps en flux (body est null)',
      errUnknown: 'erreur inconnue',
      errBadUrl: 'adresse inattendue',
      errBadId: 'identifiant de téléchargement invalide',
      errBridgeNoBackend: 'l’arrière-plan ne répond pas',
      errBridgeTimeout: 'le pont ne répond pas — rechargez la page avec F5 (relay.js se recharge)',
      nTracksH: '<b>{n}</b> titres',
      totalH: '<b>{t}</b> au total',
      mixNone: 'aucune info de qualité',
      mixTip: 'répartition de la qualité des titres',
      nUnknown: '{n} inconnue(s)',
      mixWarn: '⚠ qualités mélangées — pas toutes en qualité maximale',
      details: 'détails',
      handing: 'transfert au gestionnaire de téléchargement…',
      dlStartedH: '✓ téléchargement en cours · {name} · dans les téléchargements du navigateur',
      ticketing: 'obtention du ticket…',
      streamOpen: 'flux ouvert · {size} attendus · qualité {q}',
      etaLeft: 'reste {t}',
      doneOk: '✓ terminé',
      doneMismatch: '⚠ taille différente',
      declSize: 'annoncé {size}',
      secs: '{n} s',
      abortedLine: 'arrêté · {size} écrits',
      stopped: 'arrêté',
      open: 'Ouvrir',
      openTip: 'ouvrir dans le lecteur par défaut',
      noHandle: 'pas de descripteur de fichier',
      showFolder: 'Afficher dans le dossier',
      showFolderTipDl: 'ouvre la page des téléchargements (avec « Afficher dans le dossier »)',
      showFolderTipDir: 'ouvre le dossier Téléchargements par défaut',
      folderFail: 'Impossible d’ouvrir le dossier : {e}',
      openFail: 'Impossible d’ouvrir : {e}',
      tabBlockedH: 'Nouvel onglet bloqué — fichier : <b>{name}</b>',
      queueRunH: 'téléchargement de la file → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'téléchargement de l’album → <b>{dir}/</b> · 0/{n}',
      sumSent: '{ok}/{total} envoyés',
      sumStarted: '{ok}/{total} lancés',
      sumDone: '{ok}/{total} téléchargés',
      sumFail: ', {n} erreur(s)',
      jobStoppedH: 'arrêté · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'terminé (titres en erreur) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ album terminé · {sum} → dans le dossier <b>{dir}/</b>',
      albumOkDlH: '✓ album envoyé · {sum} → dans le dossier <b>{dir}/</b>',
      queueOkH: '✓ file terminée · {sum} → dans le dossier <b>{dir}/</b>',
      pausedQueueH: '⏸ file en pause · {done}/{total} avaient été envoyés · appuyez sur <b>{btn}</b> pour continuer',
      pausedAlbumH: '⏸ le téléchargement de l’album a été interrompu. Appuyez sur <b>{btn}</b> pour recommencer.',
      noFsaDir: 'Ce navigateur ne permet pas de choisir un dossier.',
      mkdirFail: 'Impossible de créer le dossier : {e}',
      fileTypeDesc: 'Audio FLAC',
      ctxDownload: 'Télécharger avec ARCOD Grab',
      ctxQueue: 'Ajouter à la file de téléchargement',
      ctxQueued: 'dans la file ✓',
      ctxQueuedTip: 'ce titre est déjà dans la file',
      ctxQueueTip: 'ajouter à la liste, puis tout télécharger d’un coup',
      ctxAddedH: '✓ ajouté à la file · {title} · {n} titres',
      ctxDupH: 'déjà dans la file · {title}',
      scTitle: 'raccourcis',
      scHintH: 'Fonctionne sur player.arcod.xyz, même panneau fermé. '
        + 'Cliquez sur la case, puis appuyez sur la combinaison de touches. '
        + '<b>Échap</b> annule, <b>Retour arrière</b> vide le raccourci.',
      scReset: 'rétablir les valeurs par défaut',
      scScopeLabel: 'portée des raccourcis',
      scScopePage: 'uniquement sur la page ARCOD',
      scScopePageDesc: 'Les touches ne fonctionnent que lorsque l’onglet player.arcod.xyz est au premier plan. Les touches personnalisées définies ci-dessous s’appliquent à cette portée.',
      scScopeGlobal: 'dans tout le navigateur (global)',
      scScopeGlobalDesc: 'Fonctionne aussi depuis un autre onglet. Vous attribuez les touches dans la page des raccourcis de Chrome ; les touches personnalisées du panneau ne s’appliquent pas ici.',
      scGlobalHelpH: 'Chrome autorise au plus 4 commandes par extension (précédent, suivant, volume +, volume −). Attribuez les touches d’ARCOD Grab sur <b>chrome://extensions/shortcuts</b>. Sans onglet ARCOD ouvert, les commandes sont ignorées sans bruit.',
      scOpenChrome: 'ouvrir les réglages des raccourcis',
      scCopyAddr: 'copier l’adresse',
      scCopied: 'adresse copiée',
      scCopyFail: 'copie impossible ; saisissez l’adresse vous-même : chrome://extensions/shortcuts',
      scCmdListTitle: 'Touches attribuées dans Chrome',
      scPageOnlyH: 'Les touches personnalisées du panneau ne fonctionnent que sur la <b>page ARCOD</b>.',
      scPrev: 'Titre précédent',
      scNext: 'Titre suivant',
      scVolUp: 'Volume +',
      scVolDown: 'Volume −',
      scKeyAria: 'Raccourci : {a}',
      scPress: 'appuyez sur une touche…',
      scNone: 'non défini',
      scWarnNone: 'Non attribué : cette action ne fonctionnera pas.',
      scWarnConflict: 'En conflit avec : {names}. Seule la première de la liste s’exécute.',
      scWarnReserved: 'Le navigateur utilise ce raccourci lui-même ; il peut ne pas fonctionner.',
      keySpace: 'Espace',
      volToast: 'Volume {n} %',
      homeMeta: 'faites un clic droit sur un titre de la liste',
      homeTipH: 'Faites un <b>clic droit</b> sur le titre à télécharger → <b>{item}</b>.'
        + '<br>Si vous ouvrez un album (…/album/&lt;UPC&gt;), la liste s’affiche aussi ici.',
      albumLoading: 'chargement de l’album…',
      albumReadFail: '✗ lecture de l’album impossible : {e}',
      dec: ',',
    },

    es: {
      gripLabel: 'Ancho del panel',
      gripTip: 'Arrastra · ajusta con ← → · doble clic: predeterminado',
      barQueueAll: 'Descargar todo',
      barQueueAllTip: 'descargar todas las pistas de la cola',
      barAlbum: 'descargar álbum',
      barAlbumTip: 'descargar todas las pistas del álbum en una carpeta',
      stop: 'detener',
      resume: 'reanudar',
      settings: 'ajustes',
      foldClose: 'contraer panel',
      foldOpen: 'expandir panel',
      npLabel: 'sonando ahora',
      dl: 'descargar',
      npQueueAdd: 'añadir a la cola',
      npQueued: 'añadida a la cola',
      loading: 'cargando…',
      qEmpty: 'cola vacía',
      qClear: 'vaciar',
      qCleared: 'cola vaciada',
      qCount: '{n} en la cola',
      qTitleless: '(sin título)',
      qRemove: 'quitar',
      qRemoveTip: 'quitar de la cola',
      qBtnTip: '{n} pistas · máxima calidad (quality 27)',
      back: 'atrás',
      settingsTitle: 'ajustes',
      gLang: 'idioma',
      langLabel: 'idioma de la interfaz',
      langAuto: 'automático (idioma del navegador)',
      langHint: 'Los cambios se aplican al instante.',
      gAppearance: 'apariencia',
      easyName: 'Modo fácil',
      easyDesc: 'Para personas con baja visión: texto más grande, alto contraste y botones grandes. No se oculta nada.',
      npName: 'Tarjeta «sonando ahora»',
      npDesc: 'Vigila el reproductor al pie de la página y muestra la pista actual. Si lo desactivas, el reproductor no se lee nunca.',
      easyOn: 'Modo fácil activado',
      easyOff: 'Modo fácil desactivado',
      npOn: 'siguiendo la reproducción',
      npOff: 'seguimiento desactivado',
      themeLabel: 'tema',
      themeAuto: 'igual que el sistema',
      themeDark: 'oscuro',
      themeLight: 'claro',
      themeHint: 'Con el modo fácil activado, el panel siempre es oscuro y de alto contraste.',
      widthTitle: 'ancho del panel',
      widthHint: 'Arrastra el tirador del borde del panel, o enfócalo y usa <b>←</b> / <b>→</b> '
        + '(<b>Mayús</b> para pasos grandes, <b>Inicio</b>/<b>Fin</b> para los extremos). Doble clic restablece el valor predeterminado.',
      widthReset: 'ancho predeterminado',
      widthNow: '{n} píxeles',
      gQuality: 'calidad de descarga',
      qualCeil: 'límite de calidad',
      qualHintH: 'El servidor <b>cruza este límite con la resolución propia de la pista</b>. '
        + 'Aunque pidas 24/192, una pista de CD llega en 16/44.1; '
        + 'un límite 24/96 sigue entregando una pista 24/176.4 en calidad completa. '
        + 'Límite bajo = archivo más pequeño, descarga más rápida.',
      qualSet: 'límite de calidad: {q}',
      qHighest: 'máxima',
      gFile: 'nombre de archivo',
      tplLabel: 'texto de la plantilla (avanzado)',
      tplExample: 'vista previa',
      tplBlocks: 'orden de los bloques',
      tplBlocksHint: 'Arrastra los bloques para reordenarlos; al pulsar un bloque se quita. Con el teclado, enfoca un bloque y muévelo con ← →. Puedes escribir tú mismo los separadores entre bloques.',
      tplPool: 'bloques disponibles',
      tplPoolAria: '{name}: pulsa para añadir o quitar',
      tplChipAria: '{name}: arrastra o usa ← → para mover, Intro para quitar',
      tplSepAria: 'separador {n}',
      tplExtAria: 'extensión del archivo',
      tplEmpty: 'Sin bloques. Añade uno abajo.',
      tplMoved: '{name} movido a la posición {pos}',
      tplAdded: '{name} añadido',
      tplRemoved: '{name} quitado',
      ph_n: 'Número de pista (01, 02…)',
      ph_title: 'Título de la canción',
      ph_version: 'Versión / nota de remix',
      ph_artist: 'Artista',
      ph_album: 'Título del álbum',
      ph_quality: 'Calidad (24-bit 192 kHz)',
      ph_qualityShort: 'Calidad corta (24-192)',
      ph_isrc: 'Código ISRC',
      ph_year: 'Año',
      ph_label: 'Sello discográfico',
      gSave: 'cómo guardar',
      saveDlTitle: 'descargas del navegador',
      saveDlDesc: 'Los archivos van a la carpeta Descargas del navegador sin preguntar. Los álbumes y la cola tienen su propia subcarpeta. Funciona en cualquier navegador.',
      saveFsaTitle: 'elegir una carpeta',
      saveFsaDesc: 'Eliges dónde guardar cada vez: un archivo para una pista, una carpeta para un álbum. Los datos se escriben directamente donde elijas.',
      saveFsaOff: 'Este navegador no puede elegir la ubicación (por ejemplo Firefox); se usan las descargas del navegador.',
      saveQueueNote: 'Las pistas de la cola (Descargar todo) siempre usan las descargas del navegador; si no, se abriría un cuadro de selección por cada archivo.',
      gAbout: 'acerca de',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>Un ayudante de descarga que funciona dentro de la página de ARCOD. '
        + 'No se envía ningún dato a ningún servidor.',
      creditH: 'ARCOD Grab · creado por <b>Emre Dural</b>',
      qUnkShort: 'desconocida',
      qUnkName: 'calidad desconocida',
      qMaxName: 'hi-res · resolución muy alta',
      qEnhName: 'mejorada',
      mono: 'mono',
      stereo: 'estéreo',
      chN: '{n} canales',
      probeBtn: 'verificar archivo',
      probeTip: 'Lee la calidad real del flujo antes de descargar: profundidad de bits, frecuencia de muestreo y si el archivo está intacto',
      probeReading: 'Leyendo flujo…',
      probeFail: 'No se pudo leer',
      probeFailWhy: 'sin motivo indicado',
      probeOkTitle: 'Archivo leído',
      probeOriginal: 'El archivo parece original.',
      probeRepacked: 'El archivo fue reempaquetado (suma de control interna a cero). El audio está intacto, pero no es el paquete original.',
      probeNoTags: 'El archivo no tiene etiquetas: título, artista, etc. se eliminaron.',
      kRate: 'Muestreo',
      kBits: 'Profundidad de bits',
      kCh: 'Canales',
      kDur: 'Duración',
      kMd5: 'Control interno (MD5)',
      kMd5Zero: 'a cero',
      kBlocks: 'Bloques',
      probeWhyShort: 'faltan los primeros 42 bytes',
      probeWhyMagic: 'firma «{m}» — no es fLaC',
      probeWhyNoInfo: 'no hay bloque STREAMINFO',
      errAlbumNoData: 'sin datos del álbum',
      errTicketUrl: 'el ticket no contiene url',
      err502: 'el servidor respondió 502 — abre la página normalmente y vuelve a intentarlo',
      errAudioHttp: 'audio HTTP {n}',
      errNoBody: 'sin cuerpo transmisible (body es null)',
      errUnknown: 'error desconocido',
      errBadUrl: 'dirección inesperada',
      errBadId: 'id de descarga no válido',
      errBridgeNoBackend: 'el segundo plano no respondió',
      errBridgeTimeout: 'el puente no respondió — recarga la página con F5 (relay.js se vuelve a cargar)',
      nTracksH: '<b>{n}</b> pistas',
      totalH: '<b>{t}</b> en total',
      mixNone: 'sin datos de calidad',
      mixTip: 'distribución de calidad de las pistas',
      nUnknown: '{n} desconocidas',
      mixWarn: '⚠ calidades mezcladas — no todas en máxima calidad',
      details: 'detalles',
      handing: 'cediendo al gestor de descargas…',
      dlStartedH: '✓ descargando · {name} · en las descargas del navegador',
      ticketing: 'obteniendo ticket…',
      streamOpen: 'flujo abierto · se esperan {size} · calidad {q}',
      etaLeft: 'quedan {t}',
      doneOk: '✓ completado',
      doneMismatch: '⚠ el tamaño no coincide',
      declSize: 'declarado {size}',
      secs: '{n} s',
      abortedLine: 'detenido · {size} escritos',
      stopped: 'detenido',
      open: 'Abrir',
      openTip: 'abrir en el reproductor predeterminado',
      noHandle: 'sin manejador de archivo',
      showFolder: 'Mostrar en carpeta',
      showFolderTipDl: 'abre la página de descargas (allí está «Mostrar en carpeta»)',
      showFolderTipDir: 'abre la carpeta Descargas predeterminada',
      folderFail: 'No se pudo abrir la carpeta: {e}',
      openFail: 'No se pudo abrir: {e}',
      tabBlockedH: 'Pestaña nueva bloqueada — archivo: <b>{name}</b>',
      queueRunH: 'descargando la cola → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'descargando álbum → <b>{dir}/</b> · 0/{n}',
      sumSent: '{ok}/{total} enviadas',
      sumStarted: '{ok}/{total} iniciadas',
      sumDone: '{ok}/{total} descargadas',
      sumFail: ', {n} con error',
      jobStoppedH: 'detenido · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'terminado (con pistas fallidas) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ álbum completo · {sum} → en la carpeta <b>{dir}/</b>',
      albumOkDlH: '✓ álbum enviado · {sum} → en la carpeta <b>{dir}/</b>',
      queueOkH: '✓ cola completa · {sum} → en la carpeta <b>{dir}/</b>',
      pausedQueueH: '⏸ cola en pausa · se habían enviado {done}/{total} · pulsa <b>{btn}</b> para continuar',
      pausedAlbumH: '⏸ la descarga del álbum se interrumpió. Pulsa <b>{btn}</b> para empezar de nuevo.',
      noFsaDir: 'Este navegador no admite elegir carpetas.',
      mkdirFail: 'No se pudo crear la carpeta: {e}',
      fileTypeDesc: 'Audio FLAC',
      ctxDownload: 'Descargar con ARCOD Grab',
      ctxQueue: 'Añadir a la cola de descarga',
      ctxQueued: 'en la cola ✓',
      ctxQueuedTip: 'esta pista ya está en la cola',
      ctxQueueTip: 'añadir a la lista y descargar todo después, una a una',
      ctxAddedH: '✓ añadida a la cola · {title} · {n} pistas',
      ctxDupH: 'ya está en la cola · {title}',
      scTitle: 'atajos',
      scHintH: 'Funciona en player.arcod.xyz, incluso con el panel cerrado. '
        + 'Haz clic en la casilla y pulsa la combinación de teclas. '
        + '<b>Esc</b> cancela, <b>Retroceso</b> vacía el atajo.',
      scReset: 'restablecer valores',
      scScopeLabel: 'alcance de los atajos',
      scScopePage: 'solo en la página de ARCOD',
      scScopePageDesc: 'Las teclas solo funcionan mientras la pestaña player.arcod.xyz está al frente. Las teclas personalizadas que defines abajo valen en este alcance.',
      scScopeGlobal: 'en todo el navegador (global)',
      scScopeGlobalDesc: 'También funciona desde otra pestaña. Las teclas se asignan en la página de atajos de Chrome; las teclas personalizadas del panel no valen aquí.',
      scGlobalHelpH: 'Chrome permite como máximo 4 comandos por extensión (anterior, siguiente, subir y bajar volumen). Asigna las teclas de ARCOD Grab en <b>chrome://extensions/shortcuts</b>. Si no hay ninguna pestaña de ARCOD abierta, los comandos se ignoran en silencio.',
      scOpenChrome: 'abrir ajustes de atajos',
      scCopyAddr: 'copiar dirección',
      scCopied: 'dirección copiada',
      scCopyFail: 'no se pudo copiar; escribe la dirección tú mismo: chrome://extensions/shortcuts',
      scCmdListTitle: 'Teclas asignadas en Chrome',
      scPageOnlyH: 'Las teclas personalizadas del panel solo funcionan en la <b>página de ARCOD</b>.',
      scPrev: 'Pista anterior',
      scNext: 'Pista siguiente',
      scVolUp: 'Subir volumen',
      scVolDown: 'Bajar volumen',
      scKeyAria: 'Atajo: {a}',
      scPress: 'pulsa una tecla…',
      scNone: 'sin asignar',
      scWarnNone: 'Sin asignar: esta acción no funcionará.',
      scWarnConflict: 'Entra en conflicto con: {names}. Solo se ejecuta la primera de la lista.',
      scWarnReserved: 'El navegador usa este atajo por sí mismo; puede que no funcione.',
      keySpace: 'Espacio',
      volToast: 'Volumen {n} %',
      homeMeta: 'haz clic derecho en una canción de la lista',
      homeTipH: 'Haz <b>clic derecho</b> en la pista que quieras descargar → <b>{item}</b>.'
        + '<br>Si abres un álbum (…/album/&lt;UPC&gt;), la lista también aparece aquí.',
      albumLoading: 'cargando álbum…',
      albumReadFail: '✗ no se pudo leer el álbum: {e}',
      dec: ',',
    },

    ru: {
      gripLabel: 'Ширина панели',
      gripTip: 'Перетащите · настройка клавишами ← → · двойной щелчок: по умолчанию',
      barQueueAll: 'Скачать всё',
      barQueueAllTip: 'скачать все треки из очереди',
      barAlbum: 'скачать альбом',
      barAlbumTip: 'скачать все треки альбома в папку',
      stop: 'стоп',
      resume: 'продолжить',
      settings: 'настройки',
      foldClose: 'свернуть панель',
      foldOpen: 'развернуть панель',
      npLabel: 'сейчас играет',
      dl: 'скачать',
      npQueueAdd: 'в очередь',
      npQueued: 'добавлено',
      loading: 'загрузка…',
      qEmpty: 'очередь пуста',
      qClear: 'очистить',
      qCleared: 'очередь очищена',
      qCount: 'в очереди: {n}',
      qTitleless: '(без названия)',
      qRemove: 'убрать',
      qRemoveTip: 'убрать из очереди',
      qBtnTip: 'треков: {n} · максимальное качество (quality 27)',
      back: 'назад',
      settingsTitle: 'настройки',
      gLang: 'язык',
      langLabel: 'язык интерфейса',
      langAuto: 'авто (язык браузера)',
      langHint: 'Изменения применяются сразу.',
      gAppearance: 'оформление',
      easyName: 'Простой режим',
      easyDesc: 'Для слабовидящих: крупный шрифт, высокая контрастность и большие элементы управления. Ничего не скрывается.',
      npName: 'Карточка «Сейчас играет»',
      npDesc: 'Следит за плеером внизу страницы и показывает текущий трек. Если выключить, плеер вообще не читается.',
      easyOn: 'Простой режим включён',
      easyOff: 'Простой режим выключен',
      npOn: 'отслеживание включено',
      npOff: 'отслеживание выключено',
      themeLabel: 'тема',
      themeAuto: 'как в системе',
      themeDark: 'тёмная',
      themeLight: 'светлая',
      themeHint: 'В простом режиме панель всегда тёмная и контрастная.',
      widthTitle: 'ширина панели',
      widthHint: 'Перетащите маркер у края панели или выделите его и используйте <b>←</b> / <b>→</b> '
        + '(<b>Shift</b> — крупный шаг, <b>Home</b>/<b>End</b> — крайние значения). Двойной щелчок возвращает значение по умолчанию.',
      widthReset: 'ширина по умолчанию',
      widthNow: '{n} пикс.',
      gQuality: 'качество загрузки',
      qualCeil: 'потолок качества',
      qualHintH: 'Сервер <b>сопоставляет этот потолок с собственным разрешением трека</b>. '
        + 'Даже при выборе 24/192 трек с CD придёт в 16/44.1, '
        + 'а потолок 24/96 всё равно отдаст трек 24/176.4 в полном качестве. '
        + 'Ниже потолок — меньше файл и быстрее загрузка.',
      qualSet: 'потолок качества: {q}',
      qHighest: 'максимум',
      gFile: 'имя файла',
      tplLabel: 'текст шаблона (дополнительно)',
      tplExample: 'пример',
      tplBlocks: 'порядок блоков',
      tplBlocksHint: 'Перетаскивайте блоки, чтобы изменить порядок; нажатие на блок убирает его. С клавиатуры сфокусируйте блок и двигайте его клавишами ← →. Разделители между блоками можно вводить вручную.',
      tplPool: 'доступные блоки',
      tplPoolAria: '{name}: нажмите, чтобы добавить или убрать',
      tplChipAria: '{name}: перетащите или двигайте клавишами ← →, Enter — убрать',
      tplSepAria: 'разделитель {n}',
      tplExtAria: 'расширение файла',
      tplEmpty: 'Блоков нет. Добавьте блок ниже.',
      tplMoved: '{name}: перемещён на позицию {pos}',
      tplAdded: '{name}: добавлен',
      tplRemoved: '{name}: убран',
      ph_n: 'Номер трека (01, 02…)',
      ph_title: 'Название песни',
      ph_version: 'Версия / пометка ремикса',
      ph_artist: 'Исполнитель',
      ph_album: 'Название альбома',
      ph_quality: 'Качество (24-bit 192 kHz)',
      ph_qualityShort: 'Качество кратко (24-192)',
      ph_isrc: 'Код ISRC',
      ph_year: 'Год',
      ph_label: 'Лейбл',
      gSave: 'как сохранять',
      saveDlTitle: 'загрузки браузера',
      saveDlDesc: 'Файлы попадают в папку «Загрузки» браузера без вопросов. Альбомы и очередь кладутся в отдельную подпапку. Работает в любом браузере.',
      saveFsaTitle: 'выбрать папку',
      saveFsaDesc: 'Место сохранения вы выбираете каждый раз: файл для одного трека, папку для альбома. Данные пишутся прямо в выбранное место.',
      saveFsaOff: 'Этот браузер не умеет выбирать место сохранения (например, Firefox); используются загрузки браузера.',
      saveQueueNote: 'Треки из очереди («Скачать все») всегда загружаются средствами браузера; иначе для каждого файла открывалось бы отдельное окно выбора.',
      gAbout: 'о программе',
      aboutH: 'ARCOD Grab · <b>Emre Dural</b><br>Помощник для скачивания, работающий прямо на странице ARCOD. '
        + 'Никакие данные не отправляются на сервер.',
      creditH: 'ARCOD Grab · автор: <b>Emre Dural</b>',
      qUnkShort: 'неизвестно',
      qUnkName: 'качество неизвестно',
      qMaxName: 'hi-res · очень высокое разрешение',
      qEnhName: 'улучшенное',
      mono: 'моно',
      stereo: 'стерео',
      chN: 'каналов: {n}',
      probeBtn: 'проверить файл',
      probeTip: 'Перед загрузкой читает реальное качество потока: разрядность, частоту дискретизации и целостность файла',
      probeReading: 'Чтение потока…',
      probeFail: 'Не удалось прочитать',
      probeFailWhy: 'причина не указана',
      probeOkTitle: 'Файл прочитан',
      probeOriginal: 'Файл выглядит оригинальным.',
      probeRepacked: 'Файл был перепакован (внутренняя контрольная сумма обнулена). Звук цел, но это не оригинальный пакет.',
      probeNoTags: 'В файле нет тегов — название, исполнитель и т. п. удалены.',
      kRate: 'Частота дискретизации',
      kBits: 'Разрядность',
      kCh: 'Каналы',
      kDur: 'Длительность',
      kMd5: 'Внутренняя проверка (MD5)',
      kMd5Zero: 'обнулена',
      kBlocks: 'Блоки',
      probeWhyShort: 'первые 42 байта не получены',
      probeWhyMagic: 'сигнатура «{m}» — не fLaC',
      probeWhyNoInfo: 'нет блока STREAMINFO',
      errAlbumNoData: 'нет данных альбома',
      errTicketUrl: 'в тикете нет url',
      err502: 'сервер ответил 502 — откройте страницу обычным образом и повторите',
      errAudioHttp: 'аудио HTTP {n}',
      errNoBody: 'нет потокового тела (body равно null)',
      errUnknown: 'неизвестная ошибка',
      errBadUrl: 'неожиданный адрес',
      errBadId: 'недопустимый идентификатор загрузки',
      errBridgeNoBackend: 'фоновый процесс не ответил',
      errBridgeTimeout: 'мост не отвечает — обновите страницу клавишей F5 (relay.js перезагрузится)',
      nTracksH: 'треков: <b>{n}</b>',
      totalH: 'всего <b>{t}</b>',
      mixNone: 'нет данных о качестве',
      mixTip: 'распределение качества треков',
      nUnknown: 'неизвестно: {n}',
      mixWarn: '⚠ качество смешанное — не всё в максимальном',
      details: 'подробности',
      handing: 'передача менеджеру загрузок…',
      dlStartedH: '✓ загружается · {name} · в загрузках браузера',
      ticketing: 'получение тикета…',
      streamOpen: 'поток открыт · ожидается {size} · качество {q}',
      etaLeft: 'осталось {t}',
      doneOk: '✓ готово',
      doneMismatch: '⚠ размер не совпал',
      declSize: 'заявлено {size}',
      secs: '{n} с',
      abortedLine: 'остановлено · записано {size}',
      stopped: 'остановлено',
      open: 'Открыть',
      openTip: 'открыть в плеере по умолчанию',
      noHandle: 'нет дескриптора файла',
      showFolder: 'Показать в папке',
      showFolderTipDl: 'открывает страницу загрузок (там есть «Показать в папке»)',
      showFolderTipDir: 'открывает папку загрузок по умолчанию',
      folderFail: 'Не удалось открыть папку: {e}',
      openFail: 'Не удалось открыть: {e}',
      tabBlockedH: 'Новая вкладка заблокирована — файл: <b>{name}</b>',
      queueRunH: 'загрузка очереди → <b>{dir}/</b> · 0/{n}',
      albumRunH: 'загрузка альбома → <b>{dir}/</b> · 0/{n}',
      sumSent: 'отправлено {ok}/{total}',
      sumStarted: 'запущено {ok}/{total}',
      sumDone: 'скачано {ok}/{total}',
      sumFail: ', ошибок: {n}',
      jobStoppedH: 'остановлено · {sum} → <b>{dir}/</b>',
      jobDoneErrH: 'завершено (есть сбойные треки) · {sum} → <b>{dir}/</b>',
      albumOkFsaH: '✓ альбом готов · {sum} → в папке <b>{dir}/</b>',
      albumOkDlH: '✓ альбом отправлен · {sum} → в папке <b>{dir}/</b>',
      queueOkH: '✓ очередь готова · {sum} → в папке <b>{dir}/</b>',
      pausedQueueH: '⏸ очередь приостановлена · было отправлено {done}/{total} · нажмите <b>{btn}</b>, чтобы продолжить',
      pausedAlbumH: '⏸ загрузка альбома прервана. Нажмите <b>{btn}</b>, чтобы начать заново.',
      noFsaDir: 'Этот браузер не поддерживает выбор папки.',
      mkdirFail: 'Не удалось создать папку: {e}',
      fileTypeDesc: 'Аудио FLAC',
      ctxDownload: 'Скачать через ARCOD Grab',
      ctxQueue: 'Добавить в очередь загрузки',
      ctxQueued: 'в очереди ✓',
      ctxQueuedTip: 'этот трек уже в очереди',
      ctxQueueTip: 'добавить в список, затем скачать всё по очереди',
      ctxAddedH: '✓ добавлено в очередь · {title} · треков: {n}',
      ctxDupH: 'уже в очереди · {title}',
      scTitle: 'горячие клавиши',
      scHintH: 'Работают на player.arcod.xyz, даже когда панель закрыта. '
        + 'Щёлкните по полю и нажмите сочетание клавиш. '
        + '<b>Esc</b> — отмена, <b>Backspace</b> — очистить.',
      scReset: 'сбросить',
      scScopeLabel: 'область действия горячих клавиш',
      scScopePage: 'только на странице ARCOD',
      scScopePageDesc: 'Клавиши работают, только пока вкладка player.arcod.xyz активна. Заданные ниже свои клавиши действуют в этой области.',
      scScopeGlobal: 'во всём браузере (глобально)',
      scScopeGlobalDesc: 'Работает и на других вкладках. Клавиши назначаются на странице горячих клавиш Chrome; свои клавиши из панели здесь не действуют.',
      scGlobalHelpH: 'Chrome разрешает не более 4 команд на расширение (предыдущий, следующий, громче, тише). Назначьте клавиши для ARCOD Grab на странице <b>chrome://extensions/shortcuts</b>. Если вкладка ARCOD не открыта, команды молча игнорируются.',
      scOpenChrome: 'открыть настройки горячих клавиш',
      scCopyAddr: 'скопировать адрес',
      scCopied: 'адрес скопирован',
      scCopyFail: 'не удалось скопировать; введите адрес вручную: chrome://extensions/shortcuts',
      scCmdListTitle: 'Клавиши, назначенные в Chrome',
      scPageOnlyH: 'Свои клавиши из панели работают только на <b>странице ARCOD</b>.',
      scPrev: 'Предыдущий трек',
      scNext: 'Следующий трек',
      scVolUp: 'Громче',
      scVolDown: 'Тише',
      scKeyAria: 'Горячая клавиша: {a}',
      scPress: 'нажмите клавишу…',
      scNone: 'не задано',
      scWarnNone: 'Не назначено: это действие не сработает.',
      scWarnConflict: 'Конфликт с: {names}. Сработает только первое в списке.',
      scWarnReserved: 'Браузер сам использует это сочетание; оно может не работать.',
      keySpace: 'Пробел',
      volToast: 'Громкость {n} %',
      homeMeta: 'щёлкните правой кнопкой по треку в списке',
      homeTipH: 'Щёлкните <b>правой кнопкой</b> по нужному треку → <b>{item}</b>.'
        + '<br>Если открыть альбом (…/album/&lt;UPC&gt;), список появится и здесь.',
      albumLoading: 'загрузка альбома…',
      albumReadFail: '✗ не удалось прочитать альбом: {e}',
      dec: ',',
    },
  };

  let LANG = 'tr';   // gecerli dil; setLang() ile (cfg yuklendikten sonra) belirlenir

  /* Gorunen her metin cumle basi buyuk harfle baslar. Sozluk metinleri kasitli
   * olarak kucuk harfle yazilmis olabilir (ayar etiketleri, dugme adlari);
   * ilk harf burada DILE DUYARLI buyutulur (tr: i -> İ, ı -> I). CSS
   * text-transform kullanilmaz: dil kodu panelde degisince sonuc tutarsiz olurdu.
   * Cumle ICINE giren parcalar (ornegin "{how}" ya da ", N hata") buyutulmez. */
  const NOCAP = new Set(['dec', 'etaLeft', 'declSize', 'secs', 'qHighest']);
  function capFirst(s) {
    const c = s.charAt(0);
    if (!c || c === '{' || c === '<') return s;
    let u = c;
    try { u = c.toLocaleUpperCase(LANG); } catch { u = c.toUpperCase(); }
    return u + s.slice(1);
  }

  /* T('anahtar', {n: 3}): gecerli dil -> TR -> anahtarin kendisi.
   * Yer tutucu degeri yoksa {ad} oldugu gibi kalir (sessizce bozulmaz). */
  function T(key, p) {
    let s = I18N[LANG] && I18N[LANG][key];
    if (s === undefined) s = I18N.tr[key];
    if (s === undefined) return key;
    if (!NOCAP.has(key)) s = capFirst(s);
    if (!p) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined ? m : String(p[k])));
  }

  /* HTML icerikli anahtarlar icin: parametreler escapeHtml'den gecer. */
  function th(key, p) {
    let q;
    if (p) { q = {}; for (const k of Object.keys(p)) q[k] = escapeHtml(p[k]); }
    return T(key, q);
  }

  /* Tarayici dili ('tr-TR' -> 'tr'); desteklenmiyorsa TR. */
  function detectLang() {
    const raw = String((typeof navigator !== 'undefined' && navigator.language) || '')
      .toLowerCase().split(/[-_]/)[0];
    return I18N[raw] ? raw : 'tr';
  }

  function resolveLang(pick) {
    return pick && pick !== 'auto' && I18N[pick] ? pick : detectLang();
  }

  /* Statik metin dugumleri veri oznitelikleriyle isaretlenir; dil degisince
   * applyI18n() hepsini yeniden yazar (sayfa yenilemesi gerekmez):
   *   data-i18n       -> textContent      data-i18n-h     -> innerHTML
   *   data-i18n-title -> title            data-i18n-aria  -> aria-label
   *   data-i18n-n     -> {n} parametresi (sayi enjeksiyonu) */
  function applyI18n(root) {
    if (!root) return;
    const nodes = root.querySelectorAll(
      '[data-i18n],[data-i18n-h],[data-i18n-title],[data-i18n-aria]');
    for (const n of nodes) {
      const p = n.hasAttribute('data-i18n-n') ? { n: n.getAttribute('data-i18n-n') } : undefined;
      let k = n.getAttribute('data-i18n');
      if (k) n.textContent = T(k, p);
      k = n.getAttribute('data-i18n-h');
      if (k) n.innerHTML = th(k, p);
      k = n.getAttribute('data-i18n-title');
      if (k) n.title = T(k, p);
      k = n.getAttribute('data-i18n-aria');
      if (k) n.setAttribute('aria-label', T(k, p));
    }
  }

  /* Etiket span'i: metin + yeniden cevrilebilmesi icin anahtar. */
  function lbl(key, n) {
    return '<span data-i18n="' + key + '"' + (n === undefined ? '' : ' data-i18n-n="' + n + '"')
      + '>' + escapeHtml(T(key, n === undefined ? undefined : { n })) + '</span>';
  }

  /* Sistem yuksek kontrast istiyorsa Kolay Mod ilk acilista kendiliginden
 * acik gelsin; kullanici sonra kapatabilir (JS tarafinda sorulur). */
  function prefersHighContrast() {
    try {
      return !!(window.matchMedia
        && window.matchMedia('(prefers-contrast: more)').matches);
    } catch (e) { return false; }
  }

  const cfg = Object.assign(
    {
      template: DEFAULT_TEMPLATE,
      saveMode: 'auto',
      pos: null,
      easy: null,
      nowPlaying: true,
      quality: DEFAULT_QUALITY,
      shortcuts: null,   // { prev, next, volUp, volDown } — bos = varsayilanlar
      theme: 'auto',     // 'auto' | 'dark' | 'light'
      lang: 'auto',      // 'auto' (tarayici dili) | I18N'deki bir dil kodu
      scScope: 'page',   // kisayol kapsami: 'page' (yalnizca ARCOD sayfasi) | 'global' (chrome.commands)
    },
    loadCfg(),
  );
  /* kayitli dil artik desteklenmiyorsa otomatige don; dili simdi coz */
  if (cfg.lang !== 'auto' && !I18N[cfg.lang]) cfg.lang = 'auto';
  if (cfg.scScope !== 'global') cfg.scScope = 'page';
  LANG = resolveLang(cfg.lang);
  /* easy: null = henuz secilmedi -> sisteme sor */
  if (cfg.easy === null || cfg.easy === undefined) {
    cfg.easy = prefersHighContrast();
    saveCfg();
  }
  /* kayitli kalit gecerli mi? (preset listesi degistiyse sifirla) */
  if (!QUALITY_PRESETS.some((q) => q.id === Number(cfg.quality))) {
    cfg.quality = DEFAULT_QUALITY;
  }

  /* --------------------------------------------------- kaydetme yontemi */

  /* 'fsa' : showSaveFilePicker ile dogrudan diske akitma (yalnizca Chrome).
   * 'dl'  : tarayicinin indirme yoneticisine devretme (her yerde; Firefox'da
   *         varsayilan). Gercek akis yapar, bellek kullanmaz, klasor kurar ve
   *         "Aci" dugmesi dosyayi OS varsayilan uygulamasinda acabilir.
   * 'auto': olabiliyorsa fsa, yoksa dl. */
  const HAS_FSA = typeof window.showSaveFilePicker === 'function';
  function saveMode() {
    if (cfg.saveMode === 'fsa' && HAS_FSA) return 'fsa';
    if (cfg.saveMode === 'dl') return 'dl';
    return HAS_FSA ? 'fsa' : 'dl';
  }

  let album = null;
  let albumId = null;
  let active = null;   // { id, controller, row }
  let albumJob = null; // { ctl, total, done }
  let lastResult = null; // son biten dosya: { name, handle }
  let pageOpen = false;   // ayarlar sayfasi acik mi (ust bar eylemleri)
  let bodyFolded = loadUi().folded === true; // govde katlandi mi (ayarlar sayfasinda da hatirlanir)
  const st = new Map(); // trackId -> durum nesnesi

  /* ---------------------------------------------------------- yardimcilar */

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }

  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* yoksay */ }
  }

  /* ------------------------------------------------- panel durumu (kalici) */

  function loadUi() {
    try {
      const u = JSON.parse(localStorage.getItem(UI_KEY));
      return u && typeof u === 'object' ? u : {};
    } catch { return {}; }
  }

  function saveUi(patch) {
    try { localStorage.setItem(UI_KEY, JSON.stringify(Object.assign(loadUi(), patch))); } catch { /* yoksay */ }
  }

  function wasOpenInTab() {
    try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  }

  function setOpenInTab(on) {
    try {
      if (on) sessionStorage.setItem(OPEN_KEY, '1');
      else sessionStorage.removeItem(OPEN_KEY);
    } catch { /* yoksay */ }
  }

  /* Yarim kalan toplu indirme: { kind:'queue'|'album', total, doneIds:[], albumId? }.
   * Sayfa yenilenince OTOMATIK baslamaz; kullanici 'devam et' der. */
  function loadJob() {
    try {
      const j = JSON.parse(localStorage.getItem(JOB_KEY));
      return j && typeof j === 'object' && (j.kind === 'queue' || j.kind === 'album')
        ? j : null;
    } catch { return null; }
  }

  function saveJob(j) {
    try {
      if (j) localStorage.setItem(JOB_KEY, JSON.stringify(j));
      else localStorage.removeItem(JOB_KEY);
    } catch { /* yoksay */ }
  }

  let pausedJob = loadJob();   // acilista bulunan yarim is (duraklatildi)

  /* ------------------------------------------------------- indirme sirasi */

  /* Sira sayfa yenilemeleri ve SPA gezinmeleri sonrasinda korunsun diye
   * localStorage'ta tutulur (ayni origin, ek izni gerekmez).
   * Her kayit indirmek icin gereken minimum bilgiyi tasir:
   *   { id, title, artist, album, spec, url? }
   * url dolarsa (album URL'sinden gelenler) sonradan album'e bakmaya gerek kalir. */
  const QUEUE_KEY = 'arcodgrab.queue.v1';
  const QUEUE_FOLDER = 'ARCOD Grab';

  let queue = loadQueue();

  function loadQueue() {
    try {
      const a = JSON.parse(localStorage.getItem(QUEUE_KEY));
      return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string') : [];
    } catch { return []; }
  }

  function saveQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* yoksay */ }
    syncQueueBadge();
  }

  /* id'ler DOM'dan SAYI gelir ama JSON'a METIN olarak yazilir; hep tek
   * tipe indirgemeliydik, yoksa ayni parca tekrar tekrar eklenirdi ve
   * "sirada" isareti hic gorunmezdi. */
  const inQueue = (id) => {
    const s = String(id);
    return queue.some((q) => q.id === s);
  };

  function addToQueue(track) {
    if (!track || !track.id) return false;
    if (inQueue(track.id)) return false;          // ayni parca iki kez eklenmez
    queue.push({
      id: String(track.id),
      title: track.title || '',
      artist: trackArtist(track),
      album: trackAlbumName(track),
      spec: specOf(track) || '',
      bits: trackFacts(track).bits,
      rate: trackFacts(track).rate,
      dur: trackFacts(track).dur,
      n: typeof track.track_number === 'number' ? track.track_number : null,
      addedAt: Date.now(),
    });
    saveQueue();
    return true;
  }

  /* Parcanin kendi album adi; yoksa acik albumun adi. */
  function trackAlbumName(t) {
    const q = (t && t.qobuzTrack) || {};
    const a = t.album || q.album || {};
    return str(t.album_name, t.albumName, a.title, a.name) || (album && album.title) || '';
  }

  /* Tum "siraya ekle" yollari (sag tik menusu, su an caliyor karti) buradan
   * gecer: ekler, listeyi HEMEN cizer (hangi sayfada olursa olsun; gorunum
   * albume bagli degil) ve sonucu bildirir. Panel kapaliysa liste cizilmez,
   * durum kucuk bildirim olarak gorunur. */
  function queueAdd(track) {
    const eklendi = addToQueue(track);
    renderQueue();
    setGlobal(
      eklendi
        ? th('ctxAddedH', { title: track.title || '', n: queue.length })
        : th('ctxDupH', { title: track.title || '' }),
      eklendi ? 'ok' : 'err');
    return eklendi;
  }

  function removeFromQueue(id) {
    const n = queue.length;
    queue = queue.filter((q) => q.id !== id);
    if (queue.length !== n) saveQueue();
  }

  function clearQueue() {
    if (!queue.length) return;
    queue = [];
    if (pausedJob && pausedJob.kind === 'queue') { pausedJob = null; saveJob(null); }
    saveQueue();
  }

  /* Arac cubugu rozetinde kuyruk sayisi (0 ise "ON"). MAIN world'de
   * chrome.runtime yoktur; relay koprusunden gider. Panel kapaliyken
   * rozete DOKUNULMAZ (kapatinca rozet temizlenir, bkz. toggle). */
  function syncQueueBadge() {
    if (!host) return;
    bridgeCall({ kind: 'arcodgrab:queue-count', count: queue.length }).catch(() => {});
  }

  const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function safeName(s) {
    let n = String(s == null ? '' : s)
      .replace(ILLEGAL, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (!n) n = 'track';
    if (RESERVED.test(n)) n = '_' + n;
    return n.slice(0, 180);
  }

  function mb(b) {
    return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB'
      : b >= 1024 ? (b / 1024).toFixed(1) + ' KB'
      : b + ' B';
  }

  function clock(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
  }

  /* API maximum_sampling_rate degerini kHz cinsinden verir (176400 degil, 176.4).
   * Yine de 1000+ gelirse Hz kabul edip kHz'ye ceviririz. */
  function specOf(t) {
    const bits = t.maximum_bit_depth;
    const raw = Number(t.maximum_sampling_rate);
    if (!raw) return '—';
    const khz = raw >= 1000 ? raw / 1000 : raw;
    return `${bits ? bits + '-bit' : '?'} / ${khz.toFixed(khz % 1 ? 1 : 0)} kHz`;
  }

  /* ------------------------------------------------- parca bilgisi katmani */

  /* ilk bos olmayan metni dondurur */
  function str(...v) {
    for (const x of v) if (typeof x === 'string' && x.trim()) return x.trim();
    return '';
  }

  /* ARCOD ayni alanlari kimi zaman dogrudan, kimi zaman qobuzTrack icinde
   * tasiyor. Indirmeden once gosterecegimiz her sey buradan toplanir; hicbir
   * alan yoksa sessizce atlanir, panel cokmez. */
  function trackFacts(t) {
    const q = (t && t.qobuzTrack) || t || {};
    const ap = q.audioProperties || (t && t.audioProperties) || {};

    const num = (...v) => {
      for (const x of v) {
        const n = Number(x);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 0;
    };

    const bits = num(t.maximum_bit_depth, q.maximum_bit_depth, ap.bitsPerSample, ap.bits_per_sample);

    /* ARCOD `maximum_sampling_rate` degerini kHz cinsinden veriyor.
     * Kalite tablosu bunu dogruluyor: jd = {5:{16,44.1}, 6:{16,48},
     * 7:{24,96}, 27:{24,192}} ve `maximum_sampling_rate <= jd.rate`
     * karsilastirmasi yapiliyor. Yani 176.4 kHz bir kayit icin deger 176.4
     * gelir, 176400 degil.
     *
     * Biz ise butun hesaplari (kalite esigi, rozet, sure/boyut) Hz cinsinden
     * yapiyoruz. 176.4 -> 176400 cevrimi yapilmazsa kalite "0.2 kHz" olarak
     * gorunuyor, Hi-Res rozeti hic girmiyor ve dosya boyutu 1000 kati kucuk
     * hesaplaniyordu. Bir esikle normalizes ediyoruz: 1000'in alti kHz,
     * ustu Hz demektir (gercek bir ses ornekleme hizi 1000 Hz degildir).
     */
    let rate = num(t.maximum_sampling_rate, q.maximum_sampling_rate, ap.samplingFrequency, ap.sample_rate);
    if (rate > 0 && rate < 1000) rate *= 1000;

    const ch = num(ap.channels, ap.channelLayout && ap.channelLayout.length, 2) || 2;
    const dur = num(t.duration, q.duration, ap.duration);

    const alb = q.album || (t && t.album) || {};
    const gl = Array.isArray(alb.genres_list) ? alb.genres_list : [];
    const genre = str(
      gl.length ? gl[gl.length - 1].name : '',
      alb.genre && alb.genre.name, t.genre && t.genre.name, q.genre && q.genre.name,
    );

    const lab = t.label || q.label || alb.label || {};
    const year = str(alb.release_date_original, q.release_date_original, (t && t.release_date_original))
      .slice(0, 4) || releasedYear(alb || {}) || '';

    return {
      bits, rate, ch, dur,
      isrc: str(t.isrc, q.isrc),
      label: typeof lab === 'string' ? lab : str(lab.name),
      genre,
      year,
      hires: t.hires === true || q.hires === true,
      version: str(t.version, q.version) === 'Album Version' ? '' : str(t.version, q.version),
      copyright: str(alb.copyright, q.copyright, t.copyright),
      albumId: str(alb.id, t.albumId),
    };
  }

  /* Kalite rozeti. Renk siniflari: cok yuksek altin, hi-res mavi, gelismis
   * yesil, CD gri.
   *
   * DIKKAT: burada bilerek "DSD" demiyoruz. ARCOD API'si yalnizca PCM
   * `maximum_sampling_rate` (Hz) veriyor ve paket icinde DSD'e dair hicbir
   * alan yok. 176.4 kHz CD x4 PCM ornekleme hizidir, DSD degildir; yanlis
   * etiket birakmayi tercih ettik. ARCOD'un kendi kurali ise
   * `hires = depth > 16 || rate > 48`. */
  /* kHz metnini tek yerden uretir: 192000 -> "192", 176400 -> "176.4".
   * (toFixed(1) her zaman "192.0" yaziyordu; rozetle bilgi satiri
   * birbirinden farkli gorunuyordu.) */
  function khzText(rate) {
    const khz = Number(rate) / 1000;
    if (!isFinite(khz) || khz <= 0) return '';
    return khz % 1 ? khz.toFixed(1) : String(Math.round(khz));
  }

  function qualityOf(f) {
    /* `shortKey`/`nameKey`: sozluk anahtari (yoksa sabit metin); dil degisince
     * rozetler yeniden yazilabilsin diye anahtar da tasinir. */
    if (!f.bits || !f.rate) return { short: T('qUnkShort'), shortKey: 'qUnkShort', cls: 'q-unk', rank: 0, name: T('qUnkName'), nameKey: 'qUnkName' };
    const khzTxt = khzText(f.rate);
    const short = `${f.bits}-bit • ${khzTxt} kHz`;
    if (f.rate >= 176400) return { short, cls: 'q-max', rank: 4, name: T('qMaxName'), nameKey: 'qMaxName' };
    if (f.rate >= 96000) return { short, cls: 'q-hires', rank: 3, name: 'hi-res' };
    if (f.rate >= 48000) return { short, cls: 'q-enh', rank: 2, name: T('qEnhName'), nameKey: 'qEnhName' };
    return { short, cls: 'q-cd', rank: 1, name: 'CD' };
  }

  /* Rozet <span>'i: dil degisince metin/ipucu yeniden yazilsin diye
   * anahtarlar data-i18n* ile isaretlenir. */
  function qbHtml(q, extraCls) {
    return `<span class="qb ${q.cls}${extraCls ? ' ' + extraCls : ''}"`
      + (q.nameKey ? ` data-i18n-title="${q.nameKey}"` : '')
      + (q.shortKey ? ` data-i18n="${q.shortKey}"` : '')
      + ` title="${escapeHtml(q.name)}">${escapeHtml(q.short)}</span>`;
  }

  /* Kanal sayisi metni (mono/stereo/N kanal) — data-i18n ile yeniden cevrilir */
  function chHtml(ch) {
    return ch === 1 ? lbl('mono') : ch === 2 ? lbl('stereo') : lbl('chN', ch);
  }

  /* Dosya boyutu ARTIK GOSTERILMIYOR.
   *
   * ARCOD API'sinde boyut alani yok. Paketin tamamini taradik: file_size,
   * bytes, stream_size, maximum_file_size gibi hicbir alan bulunmuyor
   * (yalnizca duration, imgBytes, cacheSize gibi ilgisizler var). Elimizde
   * sure + ornekleme hizi + bit derinligi + kanal sayisi vardir; bunlardan
   * FLAC sikistirma oranini varsayarak bir sayi uretmek tahmin olurdu ve
   * gercekten yanlisydi: 176.4 kHz kaydinda 176400 yerine 176.4 goruldugu
   * icin 1000 kati kucuk deger hesaplaniyordu (154 KB gibi).
   *
   * Yanlis bir sayi gostermektense hic gostermiyoruz. Gercek boyut yalnizca
   * indirme sirasinda Content-Length basligindan okunabilir ve orada
   * gosterilir. */

  /* Hi-Res rozeti. ARCOD parca uzerinde zaten bir `hires` bayragi tasiyor;
   * varsa ona guveniriz, yoksa kHz/bit esigine bakariz (>=96 kHz, >=20-bit). */
  function isHiRes(f) {
    if (f.hires === true) return true;
    return f.rate >= 96000 && f.bits >= 20;
  }

  function hiresImg(f) {
    if (!isHiRes(f)) return '';
    return `<img class="hires" src="${HIRES_LOGO}" alt="Hi-Res Audio" ` +
      `title="Hi-Res Audio (${escapeHtml(f.bits)}-bit / ${escapeHtml(String(f.rate / 1000))} kHz)">`;
  }

  function releasedYear(alb) {
    const v = alb.released_at;
    if (typeof v === 'number' && v > 31536000) {
      /* UTC ile hesapliyoruz: API epoch saniyesi verir ve yilbasi
       * UTC gece yarisi olur. getFullYear() kullansaydik, Amerika'da
       * 1 Ocak 1982 kaydi 31 Aralik 1981 gorunurdu. */
      return String(new Date(v * 1000).getUTCFullYear());
    }
    const s = v || alb.release_date_original || '';
    /* Bilinmiyorsa bos string donuyoruz; her iki cagri yeri da bunu
     * zaten eliyor. '?' donseydik baslikta cip havada dururdu. */
    return String(s).slice(0, 4);
  }

  /* Sablon yer tutuculari. Sira onemli degildir: kullanici istedigi yere
   yazabilir, yani {quality} {artist} oncesine de gelebilir. */
  /* title: sozluk anahtari (I18N) */
  const PLACEHOLDERS = [
    { key: '{n}', title: 'ph_n' },
    { key: '{title}', title: 'ph_title' },
    { key: '{version}', title: 'ph_version' },
    { key: '{artist}', title: 'ph_artist' },
    { key: '{album}', title: 'ph_album' },
    { key: '{quality}', title: 'ph_quality' },
    { key: '{qualityShort}', title: 'ph_qualityShort' },
    { key: '{isrc}', title: 'ph_isrc' },
    { key: '{year}', title: 'ph_year' },
    { key: '{label}', title: 'ph_label' },
  ];

  /* ---- sablon <-> blok modeli (saf islevler) ----
   * Model: { phs: [yer tutucular], seps: [ayiricilar], ext }; seps[i] i. bloktan
   * ONCE, seps[i+1] sonra gelir (seps.length = phs.length + 1). Siralama
   * yalnizca bloklari yer degistirir; ayiricilar yuvalarinda kalir. */
  const TPL_SPLIT = /(\{(?:n|title|version|artist|album|quality|qualityShort|isrc|year|label|spec)\})/;

  function tplParse(str) {
    let s = String(str == null ? '' : str);
    let ext = '';
    const m = /(\.[A-Za-z0-9]{2,5})$/.exec(s);
    if (m) { ext = m[1]; s = s.slice(0, s.length - ext.length); }
    const parts = s.split(TPL_SPLIT);
    const phs = [];
    const seps = [];
    for (let i = 0; i < parts.length; i++) (i % 2 ? phs : seps).push(parts[i]);
    return { phs, seps, ext };
  }

  function tplBuild(m) {
    let out = m.seps[0] || '';
    for (let i = 0; i < m.phs.length; i++) out += m.phs[i] + (m.seps[i + 1] || '');
    return out + (m.ext || '');
  }

  function tplMove(m, from, to) {
    if (from === to || from < 0 || to < 0 || from >= m.phs.length || to >= m.phs.length) return;
    const k = m.phs.splice(from, 1)[0];
    m.phs.splice(to, 0, k);
  }

  function tplRemoveAt(m, i) {
    const n = m.phs.length;
    if (i < 0 || i >= n) return;
    m.phs.splice(i, 1);
    if (n > 1) {
      /* yanindaki ayiricilardan biri de gider: ilk blokta sonraki, sonuncuda
       * onceki; ortadakinde KISA olan (bos olan: bitisik bloklar korunur). */
      let k = i === 0 ? 1 : i === n - 1 ? n - 1 : (m.seps[i].length < m.seps[i + 1].length ? i : i + 1);
      m.seps.splice(k, 1);
    }
  }

  function tplAdd(m, key) {
    const n = m.phs.length;
    if (!n) { m.phs.push(key); m.seps.push(''); return; }
    const sep = key === '{version}' ? '' : (n >= 2 ? m.seps[n - 1] : ' - ');
    m.phs.push(key);
    m.seps.splice(n, 0, sep);                              // sonekten once
  }

  /* Varsa tum kopyalari cikarir, yoksa sona ekler. */
  function tplToggle(m, key) {
    if (m.phs.indexOf(key) < 0) { tplAdd(m, key); return; }
    for (let i = m.phs.length - 1; i >= 0; i--) if (m.phs[i] === key) tplRemoveAt(m, i);
  }

  /* Dosya adindaki kalite metni. Uzun: "24-bit 192 kHz", kisaltilmis
   * sadece sayi tarafi: "24-192". */
  function qualityText(t) {
    const f = trackFacts(t);
    if (!f.bits || !f.rate) return specOf(t).replace(/[^0-9a-zA-Z]+/g, ' ').trim();
    return `${f.bits}-bit ${khzText(f.rate)} kHz`;
  }

  function qualityShortText(t) {
    const f = trackFacts(t);
    if (!f.bits || !f.rate) return '';
    return `${f.bits}-${khzText(f.rate)}`;
  }

  function fillTemplate(t, artist, alb) {
    const version = t.version && t.version !== 'Album Version'
      ? ` (${t.version})` : '';
    const f = trackFacts(t);
    return safeName(cfg.template
      .replaceAll('{n}', String(t.track_number || 0).padStart(2, '0'))
      .replaceAll('{title}', t.title || 'track')
      .replaceAll('{version}', version)
      .replaceAll('{artist}', artist || '')
      .replaceAll('{album}', alb || '')
      .replaceAll('{quality}', qualityText(t))
      .replaceAll('{qualityShort}', qualityShortText(t))
      .replaceAll('{isrc}', f.isrc || '')
      .replaceAll('{year}', f.year || '')
      .replaceAll('{label}', f.label || '')
      .replaceAll('{spec}', (t.__spec || specOf(t)).replace(/[^0-9a-zA-Z]/g, ''))
      .replace(/[ ]+/g, ' ')
      .trim());
  }

  /* --------------------------------------------- sag tik ile parca bulma */

  /* ARCOD parcalarindaki gercek sayisal track id'yi React fiber agacindan cikarir.
   * CSS sinifina bagli olmadigi icin album, arama, sanatci ve kuyruk ekranlarinda
   * calisir; sadece "su satiri hangi parca?" sorusunu yanitlar. */
  const isTrack = (v) =>
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    typeof v.id === 'number' && typeof v.title === 'string' && v.title.length > 0;

  const fiberOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  };

  function scanFiber(start) {
    const seen = new Set();
    const q = [{ f: start, d: 0 }];
    let n = 0;
    while (q.length && n < 220) {
      const { f, d } = q.shift();
      if (!f || seen.has(f) || d > 4) continue;
      seen.add(f);
      n++;
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        if (isTrack(p.input)) return p.input;
        if (Array.isArray(p.children)) {
          for (const ch of p.children) {
            if (ch && ch.props && isTrack(ch.props.input)) return ch.props.input;
          }
        }
        for (const k of Object.keys(p).slice(0, 16)) {
          if (isTrack(p[k])) return p[k];
        }
      }
      if (f.sibling) q.push({ f: f.sibling, d });
      if (f.child) q.push({ f: f.child, d: d + 1 });
    }
    return null;
  }

  function trackFromNode(node) {
    if (!node || node.nodeType !== 1) return null;
    let el = node;
    for (let up = 0; el && up < 12; up++) {
      const f = fiberOf(el);
      if (f) {
        const t = scanFiber(f);
        if (t) return t;
      }
      el = el.parentElement;
    }
    return null;
  }

  function trackArtist(t) {
    return (t.performer && t.performer.name) ||
      (t.artist && t.artist.name) ||
      (Array.isArray(t.artists) && t.artists[0] && t.artists[0].name) || '';
  }

  /* ------------------------------------------------- su an caliyor tespiti
   *
   * ARCOD oynatici cubugu sayfanin altinda sabit duruyor. Onu sinif adi
   * tahmin ederek degil, ekranin alt seridini gercekten "tiklayan" ogeleri
   * elementsFromPoint ile sorup fiber uzerinden parca cikarmaya calisiyoruz.
   * Boylece bir sayfa yeniden tasarlansa bile oynatici bulunur; sadece
   * yerlesimi degisse (or. yatay mod) kart kaybolur, kirilmaz.
   */

  let npTrack = null;   // su an calan parca (ham API nesnesi)
  let npId = null;      // degisiklik algilamak icin
  let npRowState = null;

  function findNowPlaying() {
    if (!document.body) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 300 || vh < 300) return null;

    const ys = [vh - 26, vh - 52, vh - 80, vh - 110, vh - 16];
    const xs = [vw * 0.5, vw * 0.22, vw * 0.78, vw * 0.36, vw * 0.64];
    const seen = new Set();

    for (const y of ys) {
      if (y < 0) continue;
      for (const x of xs) {
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || py < 0 || px >= vw || py >= vh) continue;

        let stack;
        try { stack = document.elementsFromPoint(px, py) || []; }
        catch (e) { return null; }          /* panel kapatiliyorsa gecici hata */
        if (!stack.length) continue;

        for (const node of stack) {
          if (seen.has(node)) continue;
          seen.add(node);
          if (host && host.contains(node)) continue;   /* kendi panelimiz */

          let t = trackFromNode(node);
          if (t) return t;

          /* bazen fiber sadece bir ustteki degilde; birkaz cocuga da bak */
          let kids;
          try { kids = node.querySelectorAll('span,img,a,div'); }
          catch (e) { continue; }
          for (let i = 0; i < kids.length && i < 40; i++) {
            if (seen.has(kids[i])) continue;
            seen.add(kids[i]);
            t = trackFromNode(kids[i]);
            if (t) return t;
          }
        }
      }
    }
    return null;
  }

  function renderNowPlaying() {
    if (!el.npBox) return;
    const t = npTrack;
    if (!t || !isTrack(t)) {
      el.npBox.classList.add('hide');
      npRowState = null;
      return;
    }
    const f = trackFacts(t);
    const q = qualityOf(f);
    const artist = trackArtist(t);
    const title = (t.title || '—') +
      (f.version ? ` <span class="ver">(${escapeHtml(f.version)})</span>` : '');

    el.npBox.classList.remove('hide');
    el.npTitle.innerHTML = title;
    el.npBadges.innerHTML =
      qbHtml(q) +
      `${hiresImg(f)}`;

    /* Rozetin bit/kHz'i zaten tasiyor; alt satira tekrarlamiyoruz.
     * Siran: sanatci · album · kanal · sure */
    const bits = [
      artist ? escapeHtml(artist) : '',
      t.album_name ? escapeHtml(t.album_name) : (t.album && t.album.name ? escapeHtml(t.album.name) : ''),
      f.ch === 1 ? chHtml(1) : f.ch === 2 ? chHtml(2) : '',
      clock(f.dur),
    ].filter(Boolean);
    el.npSub.innerHTML = bits.join(' · ');
  }

  /* "Bilinmiyor" kalitesi: oynatici cubugundan gelen parca nesnesi bazen
   * maximum_bit_depth / maximum_sampling_rate tasimaz (album nesnesi tasir).
   * Sirayla bakilir: (1) acik albumdaki parca, (2) parcanin kendi albumu
   * (get-album, bellekte tutulur), (3) son care: akistan FLAC basligi. */
  const npFacts = new Map();        // parca kimligi -> { maximum_bit_depth, maximum_sampling_rate }
  const npAlbums = new Map();       // album kimligi -> Promise<album | null>
  const npBusy = new Set();

  function npPick(tr) {
    const f = trackFacts(tr);
    if (!f.bits || !f.rate) return null;
    const r = { maximum_bit_depth: f.bits, maximum_sampling_rate: f.rate / 1000 };
    if (f.dur) r.duration = f.dur;
    return r;
  }

  function npAlbumId(t) {
    const q = (t && t.qobuzTrack) || {};
    const a = t.album || q.album || {};
    return str(String(a.id || ''), String(t.album_id || ''), String(t.albumId || ''));
  }

  const npFind = (alb, id) => {
    const items = alb && alb.tracks && alb.tracks.items;
    return Array.isArray(items) ? items.find((x) => String(x.id) === id) : null;
  };

  async function npLookup(t) {
    const id = String(t.id);
    let hit = npFind(album, id);
    let r = hit && npPick(hit);
    if (r) return r;
    const aid = npAlbumId(t);
    if (aid) {
      if (!npAlbums.has(aid)) npAlbums.set(aid, getAlbum(aid).catch(() => null));
      hit = npFind(await npAlbums.get(aid), id);
      r = hit && npPick(hit);
      if (r) return r;
    }
    const ctl = new AbortController();
    try {
      const { body } = await openStream(id, ctl.signal);
      const reader = body.getReader();
      const parts = [];
      let n = 0;
      while (n < PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
      }
      await reader.cancel().catch(() => {});
      const u8 = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { u8.set(p, o); o += p.length; }
      const head = readFlacHead(u8);
      if (head.ok && head.bps && head.rate) {
        return { maximum_bit_depth: head.bps, maximum_sampling_rate: head.rate / 1000 };
      }
    } catch { /* akis okunamadi: bilinmiyor kalir */ } finally { ctl.abort(); }
    return null;
  }

  async function resolveNpFacts(t) {
    if (!t || npPick(t)) return;
    const id = String(t.id);
    let hit = npFacts.get(id);
    if (!hit && !npBusy.has(id)) {
      npBusy.add(id);
      try { hit = await npLookup(t); } catch { hit = null; } finally { npBusy.delete(id); }
      if (hit) npFacts.set(id, hit);
    }
    if (!hit || !npTrack || String(npTrack.id) !== id) return;   // arada parca degisti
    npTrack = Object.assign({}, npTrack, hit);
    renderNowPlaying();
  }

  function pollNowPlaying() {
    if (!el.npBox) return;
    let t = null;
    try { t = findNowPlaying(); }
    catch (e) { return; }
    if (!t) {
      if (npId !== null) { npTrack = null; npId = null; renderNowPlaying(); }
      return;
    }
    if (String(t.id) === String(npId)) return;    /* ayni parca: dokunma */
    npTrack = npFacts.has(String(t.id)) ? Object.assign({}, t, npFacts.get(String(t.id))) : t;
    npId = t.id;
    renderNowPlaying();
    resolveNpFacts(npTrack);
  }

  let npTimer = null;
  let npMo = null;

  /* Anahtar kapaliyken oynaticiyi hic okumuyoruz: ne aralik ne de
   * MutationObserver calisir. */
  function applyNowPlaying() {
    const want = cfg.nowPlaying !== false;
    if (want && !npTimer) {
      watchNowPlaying();
    } else if (!want && npTimer) {
      clearInterval(npTimer);
      npTimer = null;
    }
    if (npMo) { npMo.disconnect(); npMo = null; }
    if (!want && el.npBox) {
      npTrack = null;
      npId = null;
      el.npBox.classList.add('hide');
    }
  }

  function watchNowPlaying() {
    if (!el.npBox || npTimer) return;
    pollNowPlaying();
    npTimer = setInterval(pollNowPlaying, 1500);
    try {
      npMo = new MutationObserver(() => {
        clearTimeout(watchNowPlaying._t);
        watchNowPlaying._t = setTimeout(pollNowPlaying, 350);
      });
      npMo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* gozlem yoksa sadece aralik calisir */ }
  }

  function nowPlayingRowState() {
    if (!npRowState && el.npBox) {
      npRowState = {
        fill: el.npBox.querySelector('.fill'),
        bar2: el.npBox.querySelector('.bar2'),
        dlBtn: el.npDl,
        prBtn: null,
        stat: el.npBox.querySelector('.stat'),
        acts: el.npBox.querySelector('[data-a="acts"]'),
      };
    }
    return npRowState;
  }

  /* --------------------------------------------------------- FLAC basligi */

  function readFlacHead(u8) {
    /* why: kullaniciya gosterilen metin; whyKey/whyP ile dil degisince yeniden kurulur */
    if (u8.length < 42) return { ok: false, why: T('probeWhyShort'), whyKey: 'probeWhyShort' };
    const magic = String.fromCharCode.apply(null, u8.subarray(0, 4));
    if (magic !== 'fLaC') return { ok: false, why: T('probeWhyMagic', { m: magic }), whyKey: 'probeWhyMagic', whyP: { m: magic } };

    const blocks = [];
    let off = 4;
    let stream = null;
    while (off + 4 <= u8.length && blocks.length < 32) {
      const last = (u8[off] & 0x80) !== 0;
      const type = u8[off] & 0x7f;
      const len = (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3];
      const body = u8.subarray(off + 4, Math.min(off + 4 + len, u8.length));
      blocks.push({ type: BLOCK[type] || `TIP${type}`, len });

      if (type === 0 && body.length >= 34) {
        let p = 0n;
        for (let i = 10; i < 18; i++) p = (p << 8n) | BigInt(body[i]);
        const rate = Number(p >> 44n);
        const ch = Number((p >> 41n) & 7n) + 1;
        const bps = Number((p >> 36n) & 31n) + 1;
        const total = p & 0xfffffffffn;
        let md5 = '';
        for (let i = 18; i < 34; i++) md5 += body[i].toString(16).padStart(2, '0');
        stream = { rate, ch, bps, total: Number(total), seconds: rate ? Number(total) / rate : 0, md5 };
      }
      off += 4 + len;
      if (last) break;
    }

    if (!stream) return { ok: false, why: T('probeWhyNoInfo'), whyKey: 'probeWhyNoInfo', blocks };

    return {
      ok: true,
      blocks,
      rate: stream.rate,
      ch: stream.ch,
      bps: stream.bps,
      total: stream.total,
      seconds: stream.seconds,
      md5: stream.md5,
      md5Zero: /^0+$/.test(stream.md5),
      hasTags: blocks.some((b) => b.type === 'VORBIS_COMMENT'),
    };
  }

  /* Dogrulama sonucunun HTML'i. Metin tek bir uzun cumle degil: baslik,
   * anahtar/deger izgarasi ve ayri notlar. Tum degerler escapeHtml'den gecer. */
  function probeError(why, key, p) {
    const msg = key ? T(key, p) : why;
    return '<div class="pr-head"><span>✗ ' + escapeHtml(T('probeFail')) + '</span></div>'
      + '<div>' + escapeHtml(msg || T('probeFailWhy')) + '</div>';
  }

  function probeHtml(h) {
    if (!h || !h.ok) return probeError(h && h.why, h && h.whyKey, h && h.whyP);
    const khz = khzText(h.rate).replace('.', T('dec'));
    const ch = h.ch === 1 ? T('mono') : h.ch === 2 ? T('stereo') : T('chN', { n: h.ch });
    const names = (h.blocks || []).map((b) => b.type).join(', ');
    const kv = (k, v, cls) => '<dt>' + escapeHtml(k) + '</dt><dd'
      + (cls ? ' class="' + cls + '"' : '') + '>' + escapeHtml(v) + '</dd>';

    let html = '<div class="pr-head">' + ICONS.check + '<span>' + escapeHtml(T('probeOkTitle')) + '</span></div>'
      + '<dl class="pr-grid">'
      + kv(T('kRate'), khz + ' kHz')
      + kv(T('kBits'), h.bps + '-bit')
      + kv(T('kCh'), ch)
      + kv(T('kDur'), clock(h.seconds))
      + kv(T('kMd5'), h.md5Zero ? T('kMd5Zero') : h.md5, h.md5Zero ? '' : 'mono')
      + (names ? kv(T('kBlocks'), names) : '')
      + '</dl>';

    const notes = [];
    if (h.md5Zero) notes.push(['warn', T('probeRepacked')]);
    if (!h.hasTags) notes.push(['warn', T('probeNoTags')]);
    if (!h.md5Zero && h.hasTags) notes.push(['good', T('probeOriginal')]);
    html += '<ul class="pr-notes">'
      + notes.map((n) => '<li class="' + n[0] + '">' + escapeHtml(n[1]) + '</li>').join('')
      + '</ul>';
    return html;
  }

  /* ---------------------------------------------------------------- ag */

  function albumIdFromUrl() {
    const m = /^\/album\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function getAlbum(id) {
    const r = await fetch(`${API}/get-album?album_id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`get-album HTTP ${r.status}`);
    const j = await r.json();
    if (!j || j.success === false || !j.data) throw new Error(T('errAlbumNoData'));
    return j.data;
  }

async function ticket(id, quality) {
    const q = Number(quality || cfg.quality) || DEFAULT_QUALITY;
    const r = await fetch(`${API}/stream/${id}?quality=${q}`);
    if (!r.ok) throw new Error('ticket HTTP ' + r.status);
    const t = await r.json();
    if (!t || !t.url) throw new Error(T('errTicketUrl'));
    return t;
  }

  async function openStream(id, signal) {
    const t = await ticket(id);
    const r = await fetch(t.url, { signal });
    if (!r.ok) {
      throw new Error(
        r.status === 502
          ? T('err502')
          : T('errAudioHttp', { n: r.status })
      );
    }
    if (!r.body) throw new Error(T('errNoBody'));
    return {
      ct: r.headers.get('content-type') || '',
      total: Number(r.headers.get('content-length')) || 0,
      quality: t.quality,
      body: r.body,
    };
  }

  /* --------------------------------------------------------------- panel */

  /* Acik tema jetonlari (iki yerde kullanilir: data-theme="light" ve
   * "auto" + sistem acik). Yazi renkleri WCAG AA (>= 4.5:1) hedefler. */
  const LIGHT_TOKENS = `
  --bg:        rgba(246, 246, 248, 0.86);
  --bg-solid:  #f5f5f7;
  --raise:     #ffffff;
  --raise-2:   rgba(0, 0, 0, 0.035);
  --raise-h:   #ececf1;
  --fill:      rgba(120, 120, 128, 0.16);
  --fill-h:    rgba(120, 120, 128, 0.28);
  --sep:       rgba(60, 60, 67, 0.22);
  --label:     #1c1c1e;
  --label-2:   rgba(60, 60, 67, 0.82);
  --label-3:   rgba(60, 60, 67, 0.64);
  --accent:    #248a3d;
  --accent-d:  #1c7230;
  --on-accent: #ffffff;
  --ok:        #1a7f37;
  --err:       #c4281c;
  --blue:      #0060c7;
  --link:      #0060c7;
  --gold:      #8a5a00;
  --ok-bg:     rgba(26, 127, 55, 0.10);
  --err-bg:    rgba(196, 40, 28, 0.08);
  --q-max:     #6b4600; --q-max-bg:   rgba(255, 190, 0, 0.26);
  --q-hires:   #004f8a; --q-hires-bg: rgba(10, 132, 255, 0.15);
  --q-enh:     #136428; --q-enh-bg:   rgba(36, 138, 61, 0.16);
  --q-cd:      #48484d; --q-cd-bg:    rgba(120, 120, 128, 0.20);
  --shadow:    rgba(0, 0, 0, 0.14);
  color-scheme: light;`;

  const CSS = `
/* ===================================================================
   ARCOD Grab - Apple tasarim dili (Human Interface Guidelines)
   - Semantik renk jetonlari (acik/koyu otomatik)
   - Materyal yuzeyler (backdrop blur + saturate)
   - Ince (0.5px) ayirici cizgiler
   - Yuvarlak koseler, yumusak katmanli golgeler
   - SF Pro tipografi olcegi
   Not: bu blok bir JS sablon literali icinde yasar; icinde
   backtick olmaz. Tek bilincli dollar-suslu parantez, tema jetonlarini
   iki yerde yeniden kullanan LIGHT_TOKENS yerlesimidir.
   =================================================================== */

/* 1) Once sifirlama. "all: initial" tum ozellikleri baslangic degerine
 *    alir; bu yuzden MUTLAKA renk jetonlarindan ve color-scheme'den ONCE
 *    gelmeli, yoksa sonraki kurallar onu ezer. */
:host {
  all: initial;
}

/* 2) Koyu tema jetonlari (varsayilan) */
:host {
  /* --- koyu tema (varsayilan) --- */
  --bg:        rgba(28, 28, 30, 0.74);
  --bg-solid:  #1c1c1e;
  --raise:     rgba(255, 255, 255, 0.075);
  --raise-2:   rgba(255, 255, 255, 0.040);
  --raise-h:   rgba(255, 255, 255, 0.115);   /* hover: daha AÇIK */
  --fill:      rgba(120, 120, 128, 0.24);
  --fill-h:    rgba(120, 120, 128, 0.38);
  --sep:       rgba(84, 84, 88, 0.55);
  --label:     #ffffff;
  --label-2:   rgba(235, 235, 245, 0.72);
  --label-3:   rgba(235, 235, 245, 0.58);
  --accent:    #30d158;   /* dolgu: anahtar, ilerleme, birincil dugme */
  --accent-d:  #28a745;
  --on-accent: #04210f;   /* accent uzerindeki yazi (kontrast >= 7:1) */
  --ok:        #30d158;   /* yazi olarak "basarili" */
  --err:       #ff6961;
  --blue:      #0a84ff;   /* odak halkasi */
  --link:      #64b5ff;   /* mavi yazi (yer tutucu dugmeleri) */
  --gold:      #ffd60a;
  --ok-bg:     rgba(48, 209, 88, 0.12);
  --err-bg:    rgba(255, 105, 97, 0.12);
  --q-max:     #ffd60a; --q-max-bg:   rgba(255, 214, 10, 0.14);
  --q-hires:   #64d2ff; --q-hires-bg: rgba(10, 132, 255, 0.15);
  --q-enh:     #30d158; --q-enh-bg:   rgba(48, 209, 88, 0.14);
  --q-cd:      #a1a1a6; --q-cd-bg:    rgba(142, 142, 147, 0.16);
  --shadow:    rgba(0, 0, 0, 0.28);

  /* olcek */
  --r-win:  14px;
  --r-card: 12px;
  --r-ctl:   9px;
  --r-pill: 999px;
  --ind:    40px;   /* icerik girintisi: satir no + bosluk */
  --nw:     20px;   /* sira numarasi sutunu */
  --gap:     8px;   /* temel aralik; 4 / 8 / 12 / 16 katlari kullanilir */
  --ease:   cubic-bezier(0.32, 0.72, 0, 1);

  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
          system-ui, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;

  color-scheme: dark;
}

/* Tema: data-theme = auto (sistemi izler) | dark | light. ARCOD'un kendi
 * arayuzu koyu oldugu icin kullanici isterse "koyu"ya sabitleyebilir.
 * color-scheme de temaya bagli; yerel arac kutulari (acilan liste,
 * kaydirma cubugu) boylece panelle ayni renkte cizilir. */
@media (prefers-color-scheme: light) {
  :host([data-theme="auto"]) {${LIGHT_TOKENS}
  }
}
:host([data-theme="light"]) {${LIGHT_TOKENS}
}

* { box-sizing: border-box; }

:host {
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* --------------------------------------------------------------- pencere
 * Panel artik kayan bir PENCERE degil; sayfanin saginda tam yukseklikte
 * bir SUTUN. Sayfa sola dogru kuculur (bkz. splitLayout()).
 * Kose yuvarlatmasi, golge ve dis bosluk yok: panel sitenin bir parcasi
 * gibi durur. */
.wrap {
  position: fixed;
  z-index: 2147483000;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--ag-w, 460px);
  max-width: 100vw;
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--label);
  font-size: 13px;
  line-height: 1.45;
  background: var(--bg-solid);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border-radius: 0;
  border-left: 0.5px solid var(--sep);
  box-shadow: -1px 0 24px var(--shadow);
  /* Daraltilmis yerlesimler @container ile (bkz. "dar panel" blogu):
   * kural pencereye degil panelin kendi genisligine bakar. */
  container-type: inline-size;
  container-name: ag;
  animation: agIn 220ms var(--ease) both;
}
@keyframes agIn {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: none; }
}

/* ---------------------------------------------- genislik tutamaci
 * Panelin sol kenarinda 8px'lik dikey serit. DIL YONUNDEN BAGIMSIZ: panel
 * ekranin saginda sabit durur, tutamac ekranin solundaki kenardadir; bu yuzden
 * burada bilerek FIZIKSEL left/right kullanilir.
 * Surukleme yonu clientX (gercek ekran) uzerinden hesaplanir. Gorunur cizgi yalnizca
 * uzerine gelince / odaklaninca / surukleyince belirir. */
.grip {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
  padding: 0;
  margin: 0;
  cursor: ew-resize;
  touch-action: none;
  background: transparent;
  border-radius: 0;
}
.grip::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 140ms ease;
}
.grip:hover::after, .grip:focus-visible::after, .grip.drag::after { opacity: 0.9; }
.grip:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.grip:hover:not(:disabled), .grip:active:not(:disabled) { background: transparent; transform: none; }

/* Surukleme sirasinda butun ekrani kaplayan seffaf kalkan: alttaki
 * iframe'ler olaylari yutmasin, imlec degismesin. */
.shield {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  cursor: ew-resize;
  background: transparent;
}

/* ------------------------------------------------------------ ust cubuk */
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding-block: 0;
  padding-inline: 12px 10px;
  user-select: none;
  border-bottom: 0.5px solid var(--sep);
  background: var(--bg-solid);
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px rgba(48, 209, 88, 0.55);
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--label);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ------------------------------------------------------------- dugmeler */
button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--label);
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: var(--r-ctl);
  background: var(--fill);
  transition: background 120ms ease, transform 80ms ease, opacity 120ms ease;
}

button:hover:not(:disabled) { background: var(--fill-h); }
button:active:not(:disabled) { transform: scale(0.97); }
button:disabled { opacity: 0.35; cursor: default; }
button:disabled,
button.dim,
button[aria-disabled="true"] {
  opacity: 0.42;
  cursor: default;
  pointer-events: none;
}
button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

button svg { width: 15px; height: 15px; flex: none; display: block; }

button.go {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 600;
}
button.go:hover:not(:disabled) { background: var(--accent-d); color: #fff; }

button.mini {
  height: 24px;
  padding: 0 9px;
  font-size: 11.5px;
  font-weight: 500;
}

/* ikon-only dugmeler (SF Symbols benzeri) */
button.icon { width: 28px; padding: 0; }
button.icon.mini { width: 24px; }

/* ---------------------------------------------------------- govde */
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 10px 10px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--fill) transparent;
}
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb {
  background: var(--fill);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ------------------------------------------------- "su an caliyor" kart */
.np {
  margin: 0 0 12px;
  padding: 11px 12px;
  border-radius: var(--r-card);
  background: linear-gradient(180deg,
      rgba(48, 209, 88, 0.10), rgba(48, 209, 88, 0.02));
  box-shadow: inset 0 0 0 0.5px rgba(48, 209, 88, 0.24);
}
.nplabel {
  margin-bottom: 7px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ok);
}
.nphead { display: flex; align-items: center; gap: 8px; }
.npdot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 7px var(--accent);
  animation: npPulse 2s ease-in-out infinite;
}
@keyframes npPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .npdot { animation: none; } }

.np .tt {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.np .badges { margin-inline-start: auto; }
.np .rsub { margin-top: 4px; }
/* "Su an caliyor" kartinda sira numarasi sutunu YOK; bu yuzden genel
 * .acts/.stat/.bar2 girintisi (--ind) burada yanlis olur. Kartin kendi
 * ic bosluğu (padding) yeterli. */
.np .acts { margin-top: 9px; padding: 0; }
.np .bar2 { margin: 7px 0 0; }
.np .stat { padding: 0; }
.np .racts { padding: 0; }
.np .tt { flex: 1 1 auto; min-width: 0; }

/* ------------------------------------------------------- album basligi */
.meta { margin-bottom: 12px; color: var(--label-2); font-size: 12px; }

.mhead {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 11px 12px;
  border-radius: var(--r-card);
  background: var(--raise);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.cover {
  flex: none;
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--raise-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.minfo { flex: 1 1 auto; min-width: 0; }
.mtitle {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--label);
  line-height: 1.25;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.martist {
  margin-top: 1px;
  font-size: 13px;
  color: var(--label-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ver { font-size: 12px; font-weight: 500; color: var(--label-3); }

.bstats {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 12px;
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--label-2);
}
.bstats b { color: var(--label); font-weight: 600; }

.mix {
  margin-top: 7px;
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--label-2);
}
.mix.warn, .mixnote { color: var(--gold); }
.mix, .mixnote, .mfoot, .bstats, .meta, .hint, .swtxt, .qhead span { overflow-wrap: anywhere; }
.qhead span { min-width: 0; }
.mixnote { margin-top: 3px; font-size: 11px; }
.mfoot { margin-top: 3px; font-size: 11px; color: var(--label-3); }

/* ------------------------------------------------------- parca satirlari */
.rows { display: flex; flex-direction: column; }

.row { border-radius: var(--r-card); background: var(--raise); }
.row + .row { margin-top: 6px; }
.row.open { box-shadow: inset 0 0 0 0.5px var(--sep), 0 0 0 1px rgba(48,209,88,0.18); }
.row:hover { background: var(--raise-h); }

.rhead {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 46px;
  padding: 7px 11px;
  cursor: pointer;
}
.rhead:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
  border-radius: var(--r-card);
}

.n {
  flex: 0 0 var(--nw);
  font-family: var(--mono);
  font-size: 11px;
  text-align: end;
  color: var(--label-3);
  font-variant-numeric: tabular-nums;
}

.rcell {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tt {
  display: block;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--label);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rsub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--label-2);
  overflow: hidden;
  white-space: nowrap;
}
.rinfo {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

/* genisletme dugmesi (ayri bir kontrol; satir basligi role=button DEGIL) */
.dis {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--label-3);
}
.dis svg { width: 13px; height: 13px; transition: transform 160ms ease; }
.dis:hover:not(:disabled) { background: var(--fill); color: var(--label); }
.row.open .dis svg { transform: rotate(90deg); }

/* indirme bitince satira eklenen "Aç" / "Klasörde Göster" dugmeleri */
.racts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-block: 0 9px;
  padding-inline: var(--ind) 11px;
}
.racts:empty { display: none; }

.rmeta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
}
.badges { display: inline-flex; align-items: center; gap: 4px; }
.dur {
  font-family: var(--mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--label-2);
}

.acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-block: 0 9px;
  padding-inline: var(--ind) 11px;
}

.rdet {
  min-width: 0;
  padding-block: 10px 12px;
  padding-inline: var(--ind) 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--label-2);
  border-top: 0.5px solid var(--sep);
  overflow-wrap: anywhere;
}
.rdet > button { margin-top: 8px; }
.rfil {
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--label-3);
  word-break: break-all;
}
.rfacts { color: var(--label-2); min-width: 0; }
.mono {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--label-3);
}

/* Dosya dogrulama sonucu. Eskiden <span> idi: satir ici (inline) kutu
 * birden cok satira bolununce dolgu, golge ve satir yuksekligi ust uste
 * biniyor, uzun degerler tasiyordu. Simdi tam genislikte BLOK; baslik,
 * anahtar/deger izgarasi ve notlar ayri, her biri kendi icinde sarilir. */
.prow {
  display: block;
  width: 100%;
  min-width: 0;
  margin-top: 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
  border-radius: var(--r-ctl);
  background: var(--raise-2);
  box-shadow: inset 0 0 0 0.5px var(--sep);
  color: var(--label);
}
.prow.ok  { box-shadow: inset 0 0 0 0.5px var(--ok);  background: var(--ok-bg); }
.prow.err { box-shadow: inset 0 0 0 0.5px var(--err); background: var(--err-bg); }
.pr-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-weight: 600;
  color: var(--label);
}
.pr-head svg { flex: none; width: 15px; height: 15px; margin-top: 1px; }
.prow.ok  .pr-head svg { color: var(--ok); }
.prow.err .pr-head { color: var(--err); }
.pr-grid {
  display: grid;
  grid-template-columns: fit-content(45%) minmax(0, 1fr);   /* uzun cevirilerde etiket sutunu sinirli */
  gap: 4px 12px;
  margin: 8px 0 0;
}
.pr-grid dt { margin: 0; color: var(--label-2); overflow-wrap: anywhere; }
.pr-grid dd { margin: 0; min-width: 0; color: var(--label); font-variant-numeric: tabular-nums; }
.pr-grid dd.mono { font-size: 11px; color: var(--label); }
.pr-notes { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pr-notes li { padding-inline-start: 9px; border-inline-start: 2px solid var(--sep); color: var(--label-2); }
.pr-notes li.warn { border-inline-start-color: var(--gold); color: var(--gold); }
.pr-notes li.good { border-inline-start-color: var(--ok); color: var(--ok); }

/* ilerleme */
.stat {
  padding-block: 0 9px;
  padding-inline: var(--ind) 11px;
  font-size: 11.5px;
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.stat.err { color: var(--err); }
.stat.ok  { color: var(--ok); }

.bar2, .gbar {
  height: 3px;
  border-radius: var(--r-pill);
  background: var(--fill);
  overflow: hidden;
}
.bar2 { margin-block: 0 9px; margin-inline: var(--ind) 11px; }
.fill, .gfill {
  height: 100%;
  width: 0;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width 160ms ease;
}

.gstat {
  margin: 8px 2px 6px;
  font-size: 11.5px;
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.gstat.err { color: var(--err); }
.gstat.ok  { color: var(--ok); }
.gact { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.gtip { margin-top: 7px; font-size: 11.5px; color: var(--label-2); }

/* ------------------------------------------------------- kalite rozetleri */
/* Rozet: yuksek kontrastli renk + ince cerceve (renk ile ayni tonda), 600
 * agirlik. Tum temalarda yazi/arka plan orani WCAG AA (>= 4.5:1). */
.qb {
  display: inline-flex;
  align-items: center;
  height: 21px;
  padding: 0 9px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
  border-radius: var(--r-pill);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 38%, transparent);
}
.q-max   { color: var(--q-max);   background: var(--q-max-bg); }
.q-hires { color: var(--q-hires); background: var(--q-hires-bg); }
.q-enh   { color: var(--q-enh);   background: var(--q-enh-bg); }
.q-cd    { color: var(--q-cd);    background: var(--q-cd-bg); }
.q-unk   { color: var(--label-2); background: var(--fill); }

.hires {
  width: 22px;
  height: 22px;
  flex: none;
  background: #000;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22);
}

/* ------------------------------------------------------------- indirme sirasi */
.qbox { margin-top: 12px; }
.qhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 3px 6px;
  font-size: 11.5px;
  color: var(--label-2);
}
.qlist {
  border-radius: var(--r-card);
  background: var(--raise);
  box-shadow: inset 0 0 0 0.5px var(--sep);
  padding: 2px 11px;
}
.qrow {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 0;
}
.qrow + .qrow { border-top: 0.5px solid var(--sep); }
.qno {
  flex: 0 0 var(--nw);
  font-family: var(--mono);
  font-size: 10.5px;
  text-align: end;
  color: var(--label-3);
}
.qinfo { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.qinfo b {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--label);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.qinfo span {
  font-size: 11px;
  color: var(--label-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.qbadges { display: inline-flex; align-items: center; gap: 4px; flex: none; }

/* ------------------------------------------------------------ ayarlar sayfasi */
.page {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-solid);
}

.phead {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border-bottom: 0.5px solid var(--sep);
}
.ptitle {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--label);
}
.pbody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px 0 20px;
  scrollbar-width: thin;
  scrollbar-color: var(--fill) transparent;
}

/* gruplanmis liste (iOS "inset grouped") */
.pgroup { margin-bottom: 20px; }
.pgt {
  padding: 0 16px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--label-2);
}
/* DIKKAT: anahtarlar (.sw) da bir <label> ve .pgroup icinde duruyor.
 * ".pgroup label" kurali daha genis oldugu icin onu dislayip anahtarlari
 * ayri tutuyoruz; aksi halde .sw flex yerine block olur ve dugmesi
 * yerlestiginden yerinden kayar. Ayni sebeple girdi kurallari da
 * dogrudan cocuklara ("> ") kisitli: gizli switch input'u onlara girmez. */
.pgroup > label:not(.sw) {
  display: block;
  padding: 14px 16px 4px;
  font-size: 11.5px;
  color: var(--label-2);
}
.pgroup > input, .pgroup > select {
  display: block;
  width: calc(100% - 24px);
  margin: 0 12px;
  height: 36px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 14px;
  color: var(--label);
  background: var(--raise);
  border: 0;
  border-radius: var(--r-ctl);
  box-shadow: inset 0 0 0 0.5px var(--sep);
  appearance: none;
}
.pgroup > input#tpl {
  font-family: var(--mono);
  font-size: 12.5px;
}
.pgroup > select {
  padding-inline-end: 30px;
  /* ozel ok isareti (aciklama ozelligi: appearance:none ile ok kaybolur) */
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238e8e93' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 10px 6px;
  cursor: pointer;
}
/* Acilir listeler: yerel acilan liste kendi arka planini cizer; tokenlar
 * yari saydam oldugu icin yazi/arka plan ACIKCA ve opak verilir (aksi halde
 * beyaz zeminde beyaz yazi cikiyordu). color-scheme temaya baglanir. */
.pgroup select { color-scheme: dark; }
@media (prefers-color-scheme: light) {
  :host([data-theme="auto"]) .pgroup select { color-scheme: light; }
}
:host([data-theme="light"]) .pgroup select { color-scheme: light; }
.pgroup select { color: var(--label); }
.pgroup select option,
.pgroup select optgroup {
  color: var(--label);
  background-color: var(--bg-solid);
}
.pgroup > input:focus-visible, .pgroup > select:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 1px;
}
.hint {
  padding: 7px 12px 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--label-2);
}
.hint b { color: var(--label); font-weight: 600; }

/* anahtar (iOS switch) */
.sw {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0 12px;
  padding: 11px 12px;
  cursor: pointer;
  border-radius: var(--r-card);
  background: var(--raise);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.sw + .sw { margin-top: 8px; }
.sw input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}
.swbox {
  flex: 0 0 auto;
  position: relative;
  width: 44px;
  height: 26px;
  margin-top: 1px;
  border-radius: var(--r-pill);
  background: var(--fill);
  box-shadow: inset 0 0 0 0.5px var(--sep);
  transition: background 200ms ease;
}
.swbox::after {
  content: "";
  position: absolute;
  top: 2px;
  inset-inline-start: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.28);
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.sw input:checked + .swbox { background: var(--accent); box-shadow: none; }
.sw input:checked + .swbox::after { transform: translateX(18px); }
.sw input:focus-visible + .swbox {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
.swtxt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.swtxt b { font-size: 14px; font-weight: 500; color: var(--label); }
.swtxt span { font-size: 11.5px; line-height: 1.45; color: var(--label-2); }

/* yer tutucu dugmeleri */
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
.chip {
  height: 26px;
  padding: 0 10px;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--link);
  background: rgba(10, 132, 255, 0.12);
}
.chip:hover:not(:disabled) { background: rgba(10, 132, 255, 0.22); }
.chip.on, .chip.tc { color: var(--on-accent); background: var(--accent); font-weight: 600; }
.chip.on:hover:not(:disabled), .chip.tc:hover:not(:disabled) { background: var(--accent-d); }

/* sablon blok editoru: bloklar + ayirici kutulari; bloklar surukle-birak ile siralanir */
.tstrip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin: 8px 12px 0; padding: 10px; min-height: 52px;
  border-radius: var(--r-card);
  background: var(--raise-2);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.tc { height: 30px; padding: 0 11px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; position: relative; }
.tc::before { content: "⋮⋮"; margin-inline-end: 6px; letter-spacing: -2px; opacity: 0.6; }
.tc.drag { cursor: grabbing; z-index: 3; opacity: 0.92; box-shadow: 0 6px 18px var(--shadow); transition: none; }
.tc.tgt { outline: 2px dashed var(--blue); outline-offset: 2px; }
.sepin {
  height: 30px; min-width: 3ch; padding: 0 4px;
  font-family: var(--mono); font-size: 12px; text-align: center;
  color: var(--label); background: transparent; border: 0; border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--sep);
}
.sepin:hover { background: var(--raise-h); }
.sepin:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.xext { padding: 0 4px; font-family: var(--mono); font-size: 12px; color: var(--label-2); }
.tempty { font-size: 11.5px; color: var(--label-2); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* secenek kartlari (radyo): kaydetme yontemi, kisayol kapsami */
.opts { display: flex; flex-direction: column; gap: 8px; margin: 0 12px; }
.opt {
  position: relative; display: flex; align-items: flex-start; gap: 12px;
  padding: 12px; cursor: pointer;
  border-radius: var(--r-card); background: var(--raise);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.opt input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
.opt .radio {
  flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%;
  box-shadow: inset 0 0 0 2px var(--label-3);
}
.opt.sel { background: var(--ok-bg); box-shadow: inset 0 0 0 2px var(--accent); }
.opt.sel .radio { box-shadow: inset 0 0 0 6px var(--accent); background: var(--on-accent); }
.opt input:focus-visible ~ .radio { outline: 2px solid var(--blue); outline-offset: 2px; }
.opt.off { cursor: not-allowed; opacity: 0.7; }
.otxt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ot { font-size: 14px; font-weight: 600; color: var(--label); }
.od { font-size: 11.5px; line-height: 1.45; color: var(--label-2); }
.onote { font-size: 11.5px; line-height: 1.45; color: var(--gold); }

.pv {
  display: flex;
  gap: 9px;
  margin: 12px 12px 0;
  padding: 10px 11px;
  border-radius: var(--r-card);
  background: var(--raise-2);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.pvl {
  flex: 0 0 auto;
  padding-top: 1px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--label-3);
}
.pvf {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--label);
  word-break: break-all;
}

/* --------------------------------------------------------------- imza */
.credit {
  flex: 0 0 auto;
  padding: 7px 14px 8px;
  font-size: 10.5px;
  color: var(--label-3);
  text-align: center;
  border-top: 0.5px solid var(--sep);
  background: var(--bg-solid);
}
.credit b { color: var(--label-2); font-weight: 600; }

/* Ayrinti / sonuc kutulari acilirken kisa, sade bir belirme. */
.rdet:not(.hide), .prow:not(.hide) { animation: agFade 160ms ease both; }
@keyframes agFade { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
.row { transition: background 120ms ease, box-shadow 120ms ease; }

/* ----------------------------------------------------------- dar panel
 * Kurallar pencereye degil PANELIN kendi genisligine bakar (@container),
 * cunku kullanici paneli surukleyerek daraltabilir. */
@container ag (max-width: 440px) {
  .bar { gap: 6px; padding-block: 0; padding-inline: 10px 8px; }
  .bar button.mini { width: 28px; padding: 0; }
  .bar button.mini > span,
  .qrow button.mini > span {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }
  .qrow button.mini { width: 28px; padding: 0; }
  .qrow { flex-wrap: wrap; row-gap: 4px; }
  .qinfo { flex: 1 1 0; min-width: 90px; }
  .qbadges { order: 4; flex: 1 0 100%; padding-inline-start: calc(var(--nw) + 9px); }
  .body { padding: 8px 8px 12px; }
  .rhead { padding: 7px 8px; gap: 7px; }
  .rmeta { gap: 5px; }
  .racts, .acts, .stat { padding-inline-end: 8px; }
  .bar2 { margin-inline-end: 8px; }
  .rdet { padding-inline-end: 8px; }
  .pv { flex-direction: column; gap: 4px; }
}
@container ag (max-width: 360px) {
  .rmeta .hires { display: none; }
  .rmeta button.mini[data-a="dl"] { width: 28px; padding: 0; }
  .rmeta button.mini[data-a="dl"] > span {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }
  .rcell > .tt {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .mhead { gap: 9px; }
  .cover { width: 48px; height: 48px; }
  .pgroup > label:not(.sw), .pgt { padding-left: 12px; padding-right: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}

.hide { display: none; }

/* ===================================================================
   KOLAY MOD - erisilebilirlik. Icerik gizlenmez, olceklenir:
   punto buyur, dokunma hedefleri 44pt ustu, kontrast artar.
   NOT: data-easy host uzerine yazildigi icin secici :host() ile baslar.
   =================================================================== */
:host([data-easy="1"]) {
  --bg: rgba(0, 0, 0, 0.90);
  --bg-solid: #000000;
  --ind: 55px;   /* 15 (rhead pad) + 28 (sira no) + 12 (bosluk) */
  --nw: 28px;
  --raise: rgba(255, 255, 255, 0.07);
  --raise-2: rgba(255, 255, 255, 0.04);
  --raise-h: rgba(255, 255, 255, 0.12);
  --fill: rgba(120, 120, 128, 0.40);
  --sep: rgba(255, 255, 255, 0.34);
  --label: #ffffff;
  --label-2: rgba(255, 255, 255, 0.78);
  --label-3: rgba(255, 255, 255, 0.55);
  --accent: #30d158;
  --accent-d: #28a745;
  --on-accent: #04210f;
  --ok: #30d158;
  --err: #ff6961;
  --blue: #0a84ff;
  --link: #64b5ff;
  --gold: #ffd60a;
  --fill-h: rgba(120, 120, 128, 0.55);
  --ok-bg: rgba(48, 209, 88, 0.12);
  --err-bg: rgba(255, 105, 97, 0.12);
  --q-max: #ffd60a; --q-max-bg: rgba(255, 214, 10, 0.14);
  --q-hires: #64d2ff; --q-hires-bg: rgba(10, 132, 255, 0.15);
  --q-enh: #30d158; --q-enh-bg: rgba(48, 209, 88, 0.14);
  --q-cd: #a1a1a6; --q-cd-bg: rgba(142, 142, 147, 0.16);
  --shadow: rgba(0, 0, 0, 0.5);
  color-scheme: dark;
}
:host([data-easy="1"]) .wrap {
  width: var(--ag-w, 620px);
  max-width: 100vw;
  max-height: none;
  font-size: 18px;
  border-radius: 0;
  box-shadow: -1px 0 28px rgba(0, 0, 0, 0.5);
}
:host([data-easy="1"]) .bar { min-height: 62px; padding-block: 0; padding-inline: 18px 14px; gap: 12px; }
:host([data-easy="1"]) .dot { width: 13px; height: 13px; }
:host([data-easy="1"]) .title { font-size: 19px; }
:host([data-easy="1"]) button { height: 48px; padding: 0 20px; font-size: 19px; border-radius: 12px; }
:host([data-easy="1"]) button svg { width: 24px; height: 24px; }
:host([data-easy="1"]) button.icon { width: 48px; }
:host([data-easy="1"]) button.icon.mini { width: 44px; }
:host([data-easy="1"]) button.mini { height: 42px; padding: 0 16px; font-size: 17px; }
:host([data-easy="1"]) .body { padding: 14px 14px 16px; }
:host([data-easy="1"]) .mhead { padding: 15px 16px; border-radius: 16px; }
:host([data-easy="1"]) .cover { width: 96px; height: 96px; border-radius: 12px; }
:host([data-easy="1"]) .mtitle { font-size: 26px; white-space: normal; }
:host([data-easy="1"]) .martist { font-size: 19px; }
:host([data-easy="1"]) .bstats { font-size: 16px; }
:host([data-easy="1"]) .mix { font-size: 14px; }
:host([data-easy="1"]) .rhead { min-height: 64px; padding: 10px 15px; gap: 12px; }
:host([data-easy="1"]) .n { font-size: 15px; }
:host([data-easy="1"]) .tt { font-size: 20px; white-space: normal; line-height: 1.35; }
:host([data-easy="1"]) .rsub { font-size: 16px; white-space: normal; }
:host([data-easy="1"]) .rinfo { white-space: normal; }
:host([data-easy="1"]) .dur { font-size: 16px; }
:host([data-easy="1"]) .qb { height: 30px; padding: 0 13px; font-size: 15px; }
:host([data-easy="1"]) .hires { width: 32px; height: 32px; }
:host([data-easy="1"]) .dis { width: 40px; height: 40px; }
:host([data-easy="1"]) .dis svg { width: 18px; height: 18px; }
:host([data-easy="1"]) .racts { padding-block: 0 12px; padding-inline: var(--ind) 15px; gap: 10px; }
:host([data-easy="1"]) .acts { padding-block: 0 12px; padding-inline: var(--ind) 15px; gap: 10px; }
:host([data-easy="1"]) .rdet { padding-block: 12px 14px; padding-inline: var(--ind) 15px; font-size: 15px; }
:host([data-easy="1"]) .stat { padding-block: 0 12px; padding-inline: var(--ind) 15px; font-size: 16px; }
:host([data-easy="1"]) .bar2 { margin-block: 0 12px; margin-inline: var(--ind) 15px; height: 5px; }
:host([data-easy="1"]) .np .acts { padding: 0; }
:host([data-easy="1"]) .np .racts { padding: 0; }
:host([data-easy="1"]) .grip { width: 14px; }
:host([data-easy="1"]) .grip::after { width: 3px; }
:host([data-easy="1"]) .prow { font-size: 15px; }
:host([data-easy="1"]) .pr-grid { gap: 6px 14px; }
:host([data-easy="1"]) .sc-name { font-size: 18px; }
:host([data-easy="1"]) .sc-key { height: 44px; font-size: 16px; min-width: 160px; }
:host([data-easy="1"]) .sc-warn { font-size: 15px; }
:host([data-easy="1"]) .sc-list { margin: 12px 16px 0; }
:host([data-easy="1"]) .sc-foot { margin: 14px 16px 0; }
:host([data-easy="1"]) .sc-sub { font-size: 15px; padding: 16px 20px 6px; }
:host([data-easy="1"]) .sc-assigned { font-size: 16px; }
:host([data-easy="1"]) .wbtn { margin: 14px 16px 0; }
:host([data-easy="1"]) .np .bar2 { margin: 7px 0 0; }
:host([data-easy="1"]) .np .stat { padding: 0; }
:host([data-easy="1"]) .nplabel { font-size: 14px; }
:host([data-easy="1"]) .np .tt { font-size: 20px; white-space: normal; }
:host([data-easy="1"]) .np .rsub { font-size: 16px; }
:host([data-easy="1"]) .pbody { padding: 18px 0 26px; }
:host([data-easy="1"]) .ptitle { font-size: 22px; }
:host([data-easy="1"]) .pgt { font-size: 14px; padding: 0 20px 8px; }
:host([data-easy="1"]) .pgroup > label:not(.sw) { font-size: 15px; padding: 18px 20px 5px; }
:host([data-easy="1"]) .pgroup > input, :host([data-easy="1"]) .pgroup > select {
  height: 52px; margin: 0 16px; font-size: 19px; border-radius: 12px;
}
:host([data-easy="1"]) .hint { font-size: 15px; padding: 9px 20px 0; }
:host([data-easy="1"]) .sw { margin: 0 16px; padding: 16px; border-radius: 16px; gap: 16px; }
:host([data-easy="1"]) .swbox { width: 62px; height: 36px; }
:host([data-easy="1"]) .swbox::after { width: 30px; height: 30px; top: 3px; inset-inline-start: 3px; }
:host([data-easy="1"]) .sw input:checked + .swbox::after { transform: translateX(26px); }
:host([data-easy="1"]) .swtxt b { font-size: 19px; }
:host([data-easy="1"]) .swtxt span { font-size: 15px; }
:host([data-easy="1"]) .chip { height: 42px; padding: 0 16px; font-size: 16px; border-radius: 12px; }
:host([data-easy="1"]) .chips { gap: 8px; padding: 12px 16px 0; }
:host([data-easy="1"]) .tc { height: 44px; }
:host([data-easy="1"]) .sepin { height: 44px; font-size: 16px; }
:host([data-easy="1"]) .tstrip { margin: 10px 16px 0; }
:host([data-easy="1"]) .opts { margin: 0 16px; }
:host([data-easy="1"]) .ot { font-size: 18px; }
:host([data-easy="1"]) .od, :host([data-easy="1"]) .onote { font-size: 15px; }
:host([data-easy="1"]) .pv { margin: 14px 16px 0; padding: 14px; border-radius: 14px; }
:host([data-easy="1"]) .pvf { font-size: 15px; }
:host([data-easy="1"]) .pvl { font-size: 13px; }
:host([data-easy="1"]) .credit { font-size: 14px; padding: 10px 18px 12px; }
:host([data-easy="1"]) .qinfo b { font-size: 17px; }
:host([data-easy="1"]) .qinfo span { font-size: 15px; }
:host([data-easy="1"]) .qno { font-size: 14px; }
:host([data-easy="1"]) .qlist { padding: 2px 18px; }
:host([data-easy="1"]) .mono, :host([data-easy="1"]) .rfil,
:host([data-easy="1"]) .mix { font-size: 14px; }
:host([data-easy="1"]) .prow { font-size: 15px; padding: 12px 14px; border-radius: 12px; }
:host([data-easy="1"]) .pgroup select { color-scheme: dark; }

`;

  let host = null;
  let sh = null;
  let el = {};

  /* Radyo kartlari: options = [{ value, title, desc, off?, note? }]. Gercek
   * <input type=radio> kullanilir (klavye: ok tuslari, ekran okuyucu). */
  function buildChoice(box, name, options, current, onPick) {
    box.textContent = '';
    const labs = [];
    for (const o of options) {
      const lab = document.createElement('label');
      lab.className = 'opt' + (o.off ? ' off' : '');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = name;
      inp.value = o.value;
      inp.checked = o.value === current;
      inp.disabled = !!o.off;
      const dot = document.createElement('span');
      dot.className = 'radio';
      dot.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.className = 'otxt';
      const t = document.createElement('b');
      t.className = 'ot';
      t.textContent = o.title;
      const d = document.createElement('span');
      d.className = 'od';
      d.textContent = o.desc;
      txt.append(t, d);
      if (o.note) {
        const n = document.createElement('span');
        n.className = 'onote';
        n.textContent = o.note;
        txt.append(n);
      }
      lab.append(inp, dot, txt);
      lab.classList.toggle('sel', inp.checked);
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        for (const l of labs) l.classList.toggle('sel', l.firstChild.checked);
        onPick(o.value);
      });
      labs.push(lab);
      box.appendChild(lab);
    }
  }

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'arcod-grab-host';
    /* Panelin icindeki tus olaylari sayfanin (document/window) dinleyicilerine
     * ulasmasin: golge DOM'dan sizan olay sayfada "hedef = host" gorunur ve
     * oynatici kisayollari (Bosluk = oynat/duraklat) tetiklenirdi. Yazi
     * alanlari icin capture asamasindaki engel ayrica asagida (panelTyping). */
    for (const type of ['keydown', 'keyup', 'keypress']) {
      host.addEventListener(type, (ev) => ev.stopPropagation());
    }
    sh = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS + SC_CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    /* Metinler T()/lbl() ile gelir; data-i18n* oznitelikleri dil degisince
     * applyI18n() ile yeniden yazilmalarini saglar. */
    const ea = (k) => escapeHtml(T(k));
    wrap.setAttribute('lang', LANG);
    wrap.innerHTML = `
      <div class="grip" id="grip" role="separator" aria-orientation="vertical" tabindex="0"
        aria-label="${ea('gripLabel')}" title="${ea('gripTip')}"
        data-i18n-aria="gripLabel" data-i18n-title="gripTip"></div>
      <div class="bar">
        <span class="dot"></span>
        <span class="title">ARCOD Grab</span>
        <button class="mini hide" id="queueBtn" title="${ea('barQueueAllTip')}" data-i18n-title="barQueueAllTip">${ICONS.list}${lbl('barQueueAll')}</button>
        <button class="mini hide" id="albumBtn" title="${ea('barAlbumTip')}" data-i18n-title="barAlbumTip">${ICONS.music}${lbl('barAlbum')}</button>
        <button class="mini" id="cfgBtn"></button>
        <button class="mini" id="foldBtn"></button>
      </div>
<div class="body">
          <div class="np hide" id="npBox">
            <div class="nplabel" data-i18n="npLabel">${ea('npLabel')}</div>
            <div class="nphead">
              <span class="npdot"></span>
              <span class="tt" id="npTitle"></span>
              <span class="badges" id="npBadges"></span>
            </div>
            <div class="rsub" id="npSub"></div>
            <div class="acts">
              ${iconBtn('go', 'download', 'dl', ' data-a="npdl"')}
              ${iconBtn('mini', 'queueAdd', 'npQueueAdd', ' data-a="npq"')}
              <span class="racts" data-a="acts"></span>
            </div>
            <div class="bar2 hide"><div class="fill"></div></div>
            <div class="stat"></div>
          </div>
          <div class="meta" id="meta" data-i18n="loading">${ea('loading')}</div>
        <div class="gstat" id="gstat"></div>
        <div class="gbar hide" id="gbar"><div class="gfill" id="gfill"></div></div>
        <div class="gact hide" id="gact"></div>
        <div id="rows" class="rows"></div>
        <div class="qbox hide" id="qbox">
          <div class="qhead">
            <span id="qcount">${ea('qEmpty')}</span>
            <button class="mini" id="qclear">${ICONS.trash}${lbl('qClear')}</button>
          </div>
          <div id="qlist" class="qlist"></div>
        </div>
        </div>

        <!-- ===== AYARLAR SAYFASI (ayri gorunum) ===== -->
        <div class="page hide" id="pageSet">
          <div class="phead">
            <button class="mini" id="setBack">${ICONS.back}${lbl('back')}</button>
            <span class="ptitle" data-i18n="settingsTitle">${ea('settingsTitle')}</span>
          </div>
          <div class="pbody">

            <div class="pgroup">
              <div class="pgt" data-i18n="gLang">${ea('gLang')}</div>
              <label for="langSel" data-i18n="langLabel">${ea('langLabel')}</label>
              <select id="langSel"></select>
              <div class="hint" data-i18n="langHint">${ea('langHint')}</div>
            </div>

            <div class="pgroup">
              <div class="pgt" data-i18n="gAppearance">${ea('gAppearance')}</div>

              <label class="sw" for="swEasy">
                <input type="checkbox" id="swEasy">
                <span class="swbox"></span>
                <span class="swtxt">
                  <b data-i18n="easyName">${ea('easyName')}</b>
                  <span data-i18n="easyDesc">${ea('easyDesc')}</span>
                </span>
              </label>

              <label class="sw" for="swNp">
                <input type="checkbox" id="swNp">
                <span class="swbox"></span>
                <span class="swtxt">
                  <b data-i18n="npName">${ea('npName')}</b>
                  <span data-i18n="npDesc">${ea('npDesc')}</span>
                </span>
              </label>

              <label for="theme" data-i18n="themeLabel">${ea('themeLabel')}</label>
              <select id="theme"></select>
              <div class="hint" data-i18n="themeHint">${ea('themeHint')}</div>
            </div>

            <div class="pgroup">
              <div class="pgt"><span data-i18n="widthTitle">${ea('widthTitle')}</span><span class="wnow" id="wNow"></span></div>
              <div class="hint" data-i18n-h="widthHint">${th('widthHint')}</div>
              <button class="mini wbtn" id="wReset" type="button" data-i18n="widthReset">${ea('widthReset')}</button>
            </div>

            <div class="pgroup">
              <div class="pgt" data-i18n="gQuality">${ea('gQuality')}</div>

              <label for="qual" data-i18n="qualCeil">${ea('qualCeil')}</label>
              <select id="qual"></select>
              <div class="hint" id="qualHint"></div>
            </div>

            <div class="pgroup">
              <div class="pgt" data-i18n="gFile">${ea('gFile')}</div>

              <label id="tplBlocksL" data-i18n="tplBlocks">${ea('tplBlocks')}</label>
              <div class="tstrip" id="tplStrip" role="group" aria-labelledby="tplBlocksL"></div>
              <div class="hint" data-i18n="tplBlocksHint">${ea('tplBlocksHint')}</div>
              <label id="tplPoolL" data-i18n="tplPool">${ea('tplPool')}</label>
              <div class="chips" id="chips" role="group" aria-labelledby="tplPoolL"></div>
              <label for="tpl" data-i18n="tplLabel">${ea('tplLabel')}</label>
              <input id="tpl" spellcheck="false" autocomplete="off">
              <div class="sr" id="tplLive" role="status" aria-live="polite"></div>
              <div class="pv">
                <span class="pvl" data-i18n="tplExample">${ea('tplExample')}</span>
                <span class="pvf" id="tplPrev">—</span>
              </div>
            </div>

            <div class="pgroup">
              <div class="pgt" id="saveT" data-i18n="gSave">${ea('gSave')}</div>
              <div class="opts" id="smode" role="radiogroup" aria-labelledby="saveT"></div>
              <div class="hint" data-i18n="saveQueueNote">${ea('saveQueueNote')}</div>
            </div>

            <div class="pgroup sc-group" id="scGroup"></div>

            <div class="pgroup">
              <div class="pgt" data-i18n="gAbout">${ea('gAbout')}</div>
              <div class="hint" data-i18n-h="aboutH">${th('aboutH')}</div>
            </div>

          </div>
        </div>

        <div class="credit" data-i18n-h="creditH">${th('creditH')}</div>`;

    sh.append(style, wrap);
    document.documentElement.appendChild(host);

    el.wrap = wrap;
    el.meta = sh.getElementById('meta');
    el.npBox = sh.getElementById('npBox');
    el.npTitle = sh.getElementById('npTitle');
    el.npBadges = sh.getElementById('npBadges');
    el.npSub = sh.getElementById('npSub');
    el.npDl = sh.querySelector('[data-a="npdl"]');
    el.npQ = sh.querySelector('[data-a="npq"]');
    el.rows = sh.getElementById('rows');
    el.gstat = sh.getElementById('gstat');
    el.gbar = sh.getElementById('gbar');
    el.gfill = sh.getElementById('gfill');
    el.gact = sh.getElementById('gact');
    el.albumBtn = sh.getElementById('albumBtn');
    el.cfgBtn = sh.getElementById('cfgBtn');
    el.foldBtn = sh.getElementById('foldBtn');
    setIcon(el.cfgBtn, 'settings', 'settings');
    setIcon(el.foldBtn, 'minus', 'foldClose');

    el.albumBtn.addEventListener('click', () => {
      if (albumJob) { cancelActive(); albumJob.ctl.abort(); return; }
      startAlbum();
    });

    el.queueBtn = sh.getElementById('queueBtn');
    el.queueBtn.addEventListener('click', () => {
      if (albumJob) { cancelActive(); albumJob.ctl.abort(); return; }
      downloadQueue();
    });

    el.qbox = sh.getElementById('qbox');
    el.qlist = sh.getElementById('qlist');
    el.qcount = sh.getElementById('qcount');
    sh.getElementById('qclear').addEventListener('click', () => {
      clearQueue();
      renderQueue();
      setGlobal(escapeHtml(T('qCleared')), 'ok');
    });
    el.pageSet = sh.getElementById('pageSet');
    el.body = sh.querySelector('.body');
    el.tpl = sh.getElementById('tpl');
    el.tpl.value = cfg.template;

    /* --- ayarlar sayfasi: liste <-> ayarlar gecisi --- */
    const showPage = (on) => {
      pageOpen = on;
      el.pageSet.classList.toggle('hide', !on);
      /* Govde hem ayarlar sayfasinda hem de katlanmisken gizlenir. */
      el.body.classList.toggle('hide', on || bodyFolded);
      /* Ayarlar ayri bir ekran: ust bardaki indirme eylemleri gizlenir,
       * boylece "geri" butonu tek gezinme araci olarak kalir. */
      el.queueBtn.classList.toggle('hide', on);
      el.albumBtn.classList.toggle('hide', on);
      /* Katlama dugmesi ayarlar ekraninda bir sey ifade etmiyor. */
      el.foldBtn.disabled = on;
      if (on) sh.getElementById('setBack').focus();
      else sh.getElementById('cfgBtn').focus();
    };
    sh.getElementById('cfgBtn').addEventListener('click', () => showPage(true));
    sh.getElementById('setBack').addEventListener('click', () => showPage(false));

    /* --- tema: sistemle ayni | koyu | acik --- */
    const themeSel = sh.getElementById('theme');
    const fillTheme = () => {
      themeSel.textContent = '';
      for (const [val, key] of [['auto', 'themeAuto'], ['dark', 'themeDark'], ['light', 'themeLight']]) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = T(key);
        themeSel.appendChild(o);
      }
      themeSel.value = cfg.theme;
    };
    fillTheme();
    const applyTheme = () => {
      if (['auto', 'dark', 'light'].indexOf(cfg.theme) < 0) cfg.theme = 'auto';
      host.setAttribute('data-theme', cfg.theme);
      themeSel.value = cfg.theme;
    };
    applyTheme();
    themeSel.addEventListener('change', () => {
      cfg.theme = themeSel.value;
      saveCfg();
      applyTheme();
    });

    /* --- panel genisligi: tutamac + ayarlar sayfasindaki sifirlama --- */
    setupResize(sh.getElementById('grip'), sh.getElementById('wReset'), sh.getElementById('wNow'));

    /* --- Kolay Mod --- */
    const swEasy = sh.getElementById('swEasy');
    const applyEasy = () => {
      host.setAttribute('data-easy', cfg.easy ? '1' : '0');
      swEasy.checked = !!cfg.easy;
      /* Kolay Mod sutunu genisletir; siteye ayrica yer acilir. */
      applySplit();
    };
    applyEasy();
    swEasy.addEventListener('change', () => {
      cfg.easy = swEasy.checked;
      saveCfg();
      applyEasy();
      setGlobal(escapeHtml(T(cfg.easy ? 'easyOn' : 'easyOff')), 'ok');
    });

    /* --- su an caliyor karti anahtari --- */
    const swNp = sh.getElementById('swNp');
    swNp.checked = cfg.nowPlaying !== false;
    swNp.addEventListener('change', () => {
      cfg.nowPlaying = swNp.checked;
      saveCfg();
      applyNowPlaying();
      setGlobal(escapeHtml(T(cfg.nowPlaying ? 'npOn' : 'npOff')), 'ok');
    });

    /* ---- dosya adi sablonu: tiklanabilir yer tutucular + canli onizleme ---- */
    const tplPrev = sh.getElementById('tplPrev');
    const ORNEK = {
      id: 7301, track_number: 3, title: 'Wanna Be Startin’ Somethin’',
      version: 'Remastered 2011',
      duration: 364, maximum_bit_depth: 24, maximum_sampling_rate: 176.4,
      isrc: 'USSM19902970', performer: { name: 'Michael Jackson' },
      qobuzTrack: {
        maximum_bit_depth: 24, maximum_sampling_rate: 176.4,
        album: { release_date_original: '1982-11-30', label: { name: 'Epic' } },
      },
    };

    function previewTemplate() {
      try {
        tplPrev.textContent = fillTemplate(ORNEK, 'Michael Jackson', 'Thriller') || '—';
      } catch (e) {
        tplPrev.textContent = '—';
      }
    }

    function commitTemplate(full) {
      cfg.template = el.tpl.value.trim() || DEFAULT_TEMPLATE;
      saveCfg();
      previewTemplate();
      /* full=false: sadece onizleme. Her tus vurusunda tum albumu yeniden
       * cizmek gereksiz; liste yalnizca odak kaybolunca tazelenir. */
      if (full) render();
    }

    /* Sablon = bloklar (yer tutucular) + aralarindaki ayiricilar + uzanti.
     * Blok editoru sirayi surukle-birak ile degistirir; kalici saklama yine
     * ayni METIN sablonudur (cfg.template), tplParse/tplBuild ikisini cevirir. */
    const tplStrip = sh.getElementById('tplStrip');
    const tplLive = sh.getElementById('tplLive');
    const chipBox = sh.getElementById('chips');
    let tplModel = tplParse(cfg.template);

    const say = (key, p) => {
      tplLive.textContent = '';
      setTimeout(() => { tplLive.textContent = T(key, p); }, 30);
    };
    const phTitle = (key) => {
      const p = PLACEHOLDERS.find((x) => x.key === key);
      return p ? T(p.title) : key;
    };

    function tplSync(full, rerender) {
      const built = tplBuild(tplModel);
      el.tpl.value = built;
      commitTemplate(full);
      if (!built.trim()) {                       // bos kaldi: varsayilana donuldu
        el.tpl.value = cfg.template;
        tplModel = tplParse(cfg.template);
        rerender = true;
      }
      if (rerender) renderTpl();
      renderPool();
    }

    function renderPool() {
      for (const b of chipBox.children) {
        const key = b.dataset.key;
        const on = tplModel.phs.indexOf(key) >= 0;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.setAttribute('aria-label', T('tplPoolAria', { name: key }));
        b.title = phTitle(key);
      }
    }

    /* Surukle-birak (pointer events: fare + dokunmatik). 5 px'ten az hareket
     * tiklama sayilir (kaldir). Klavye: odaktaki blokta ← → tasir, Enter/Bosluk
     * ve Delete kaldirir. */
    function chipEl(key, i) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip tc';
      c.textContent = key;
      c.dataset.i = String(i);
      c.title = phTitle(key);
      c.setAttribute('aria-label', T('tplChipAria', { name: key }));
      let drag = null;
      let dragged = false;

      const chips = () => Array.from(tplStrip.querySelectorAll('.tc'));
      const nearest = (x, y) => {
        let best = -1;
        let bd = Infinity;
        chips().forEach((n, j) => {
          const r = n.getBoundingClientRect();
          const d = Math.hypot(x - (r.left + r.width / 2), (y - (r.top + r.height / 2)) * 1.6);
          if (d < bd) { bd = d; best = j; }
        });
        return best;
      };
      const clear = () => { for (const n of chips()) n.classList.remove('tgt'); };

      c.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, moved: false, to: i };
        dragged = false;
        try { c.setPointerCapture(ev.pointerId); } catch { /* yoksay */ }
      });
      c.addEventListener('pointermove', (ev) => {
        if (!drag || ev.pointerId !== drag.id) return;
        const dx = ev.clientX - drag.x0;
        const dy = ev.clientY - drag.y0;
        if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; c.classList.add('drag'); }
        if (!drag.moved) return;
        c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        const j = nearest(ev.clientX, ev.clientY);
        drag.to = j < 0 ? i : j;
        clear();
        if (drag.to !== i) chips()[drag.to].classList.add('tgt');
      });
      const finish = (ev, cancel) => {
        if (!drag || ev.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        try { c.releasePointerCapture(ev.pointerId); } catch { /* yoksay */ }
        c.classList.remove('drag');
        c.style.transform = '';
        clear();
        if (!d.moved) return;
        dragged = true;                                  // ardindan gelen click'i yut
        if (cancel || d.to === i) return;
        tplMove(tplModel, i, d.to);
        tplSync(true, true);
        const moved = tplStrip.querySelectorAll('.tc')[d.to];
        if (moved) moved.focus();
        say('tplMoved', { name: key, pos: d.to + 1 });
      };
      c.addEventListener('pointerup', (ev) => finish(ev, false));
      c.addEventListener('pointercancel', (ev) => finish(ev, true));
      c.addEventListener('click', () => {
        if (dragged) { dragged = false; return; }
        tplRemoveAt(tplModel, i);
        tplSync(true, true);
        say('tplRemoved', { name: key });
      });
      c.addEventListener('keydown', (ev) => {
        const step = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1
          : ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : 0;
        if (step) {
          ev.preventDefault();
          const to = i + step;
          if (to < 0 || to >= tplModel.phs.length) return;
          tplMove(tplModel, i, to);
          tplSync(true, true);
          const moved = tplStrip.querySelectorAll('.tc')[to];
          if (moved) moved.focus();
          say('tplMoved', { name: key, pos: to + 1 });
        } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
          ev.preventDefault();
          tplRemoveAt(tplModel, i);
          tplSync(true, true);
          say('tplRemoved', { name: key });
        }
      });
      return c;
    }

    function sepEl(i) {
      const inp = document.createElement('input');
      inp.className = 'sepin';
      inp.spellcheck = false;
      inp.autocomplete = 'off';
      inp.value = tplModel.seps[i];
      inp.setAttribute('aria-label', T('tplSepAria', { n: i + 1 }));
      const fit = () => { inp.style.width = (Math.max(1, inp.value.length) + 2) + 'ch'; };
      fit();
      inp.addEventListener('input', () => { tplModel.seps[i] = inp.value; fit(); tplSync(false, false); });
      inp.addEventListener('change', () => tplSync(true, false));
      return inp;
    }

    function renderTpl() {
      tplStrip.textContent = '';
      const n = tplModel.phs.length;
      for (let i = 0; i < n; i++) {
        tplStrip.append(sepEl(i), chipEl(tplModel.phs[i], i));
      }
      tplStrip.append(sepEl(n));
      if (!n) {
        const em = document.createElement('span');
        em.className = 'tempty';
        em.textContent = T('tplEmpty');
        tplStrip.append(em);
      }
      if (tplModel.ext) {
        const x = document.createElement('span');
        x.className = 'xext';
        x.textContent = tplModel.ext;
        x.setAttribute('aria-label', T('tplExtAria') + ': ' + tplModel.ext);
        tplStrip.append(x);
      }
    }

    el.tpl.addEventListener('input', () => {
      commitTemplate(false);
      tplModel = tplParse(el.tpl.value);
      renderTpl();
      renderPool();
    });
    el.tpl.addEventListener('change', () => commitTemplate(true));

    /* Havuz: her yer tutucu bir etiket; basinca ekler / cikarir (aria-pressed). */
    for (const ph of PLACEHOLDERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.key = ph.key;
      b.textContent = ph.key;
      b.addEventListener('click', () => {
        const had = tplModel.phs.indexOf(ph.key) >= 0;
        tplToggle(tplModel, ph.key);
        tplSync(true, true);
        say(had ? 'tplRemoved' : 'tplAdded', { name: ph.key });
      });
      chipBox.appendChild(b);
    }
    renderTpl();
    renderPool();

    /* ---- kalite tavani secimi ---- */
    el.qual = sh.getElementById('qual');
    el.qualHint = sh.getElementById('qualHint');
    function fillQual() {
      el.qual.textContent = '';
      for (const q of QUALITY_PRESETS) {
        const o = document.createElement('option');
        o.value = String(q.id);
        o.textContent = q.label;
        el.qual.appendChild(o);
      }
      el.qual.value = String(cfg.quality);
    }
    fillQual();
    function applyQualityHint() {
      el.qualHint.innerHTML = th('qualHintH');
    }
    applyQualityHint();
    el.qual.addEventListener('change', () => {
      cfg.quality = Number(el.qual.value);
      saveCfg();
      previewTemplate();
      setGlobal(escapeHtml(T('qualSet', { q: qualityPreset(cfg.quality).label })), 'ok');
    });

    previewTemplate();

    /* kaydetme yontemi: iki kart (radyo). Secili olan, gercekte kullanilan
     * yontemdir (cfg 'auto' ise tarayicinin yapabildigi). Klasor secme
     * desteklenmiyorsa (showSaveFilePicker yok) kart kapali + sebep notu. */
    el.smode = sh.getElementById('smode');
    function fillSmode() {
      buildChoice(el.smode, 'smode', [
        { value: 'dl', title: T('saveDlTitle'), desc: T('saveDlDesc') },
        { value: 'fsa', title: T('saveFsaTitle'), desc: T('saveFsaDesc'),
          off: !HAS_FSA, note: HAS_FSA ? '' : T('saveFsaOff') },
      ], saveMode(), (v) => { cfg.saveMode = v; saveCfg(); });
    }
    fillSmode();

    /* --- arayuz dili: Otomatik + her dil kendi adiyla. Secim cfg.lang'a
     * yazilir ve panel sayfa yenilemeden yeniden cizilir (applyLang). --- */
    const langSel = sh.getElementById('langSel');
    function fillLang() {
      langSel.textContent = '';
      const o0 = document.createElement('option');
      o0.value = 'auto';
      o0.textContent = T('langAuto');
      langSel.appendChild(o0);
      for (const l of LANGS) {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = l.name;
        o.lang = l.id;
        langSel.appendChild(o);
      }
      langSel.value = cfg.lang;
    }
    fillLang();
    langSel.addEventListener('change', () => {
      cfg.lang = langSel.value;
      saveCfg();
      applyLang();
    });

    /* dil degisince secim listeleri ve ipuclari yeniden yazilir */
    el.onLang = () => {
      fillTheme(); fillQual(); fillSmode(); fillLang();
      renderTpl(); renderPool();
      applyQualityHint();
    };

    el.foldBtn.addEventListener('click', () => {
      bodyFolded = !bodyFolded;
      saveUi({ folded: bodyFolded });
      sh.querySelector('.body').classList.toggle('hide', bodyFolded);
      setIcon(el.foldBtn, bodyFolded ? 'plus' : 'minus', bodyFolded ? 'foldOpen' : 'foldClose');
    });
    /* son katlanma durumu geri yuklenir */
    if (bodyFolded) {
      el.body.classList.add('hide');
      setIcon(el.foldBtn, 'plus', 'foldOpen');
    }

    buildShortcutsSection(sh.getElementById('scGroup'));

    /* --- su an caliyor kartinin butonlari --- */
    el.npDl.addEventListener('click', () => {
      const t = npTrack;
      if (!t) return;
      if (active && String(active.id) === String(t.id)) cancelActive();
      else download(t, trackArtist(t), nowPlayingRowState());
    });
    el.npQ.addEventListener('click', () => {
      if (!npTrack) return;
      queueAdd(npTrack);
      setBtnLabel(el.npQ, 'queueAdd', 'npQueued');
      setTimeout(() => { setBtnLabel(el.npQ, 'queueAdd', 'npQueueAdd'); }, 1400);
    });

    applyNowPlaying();

    /* Artik panel sabit bir sutun; kayan pencere suruklemesi olmuyor.
     * Eski `cfg.pos` degerleri de anlamini yitirdi, temizleniyor. */
    cfg.pos = null;
  }

  /* ===================================================================
   * BOLUNMUS GORUNUM
   * Panel kayan pencere degil; sayfanin saginda tam yukseklikte bir
   * sutun. Sayfa sola dogru kuculur, panelin altinda kalmaz.
   *
   * Uygulama iki parca:
   *  1) Sayfaya (head icine) bir <style> enjekte ediyoruz. Shadow DOM
   *     sayfayi etkileyemedigi icin bu CSS sayfanin kendi stilidir.
   *  2) Sitenin "position: fixed; right: 0" ile saga yaslanmis kabuk
   *     ogelerini (alt oynatici cubugu gibi) saga kaydiriyoruz; yoksa
   *     panelin altinda kalip kontrolleri erisilemez oluyor.
   * =================================================================== */
  const SPLIT_ID = 'arcod-grab-split';
  const SPLIT_ATTR = 'data-arcod-split';
  let splitMo = null;
  let splitTimer = 0;

  /* Panel genisligi.
   * Kullanici bir deger sectiyse (UI_KEY.width) o; yoksa ekrana gore
   * otomatik. Her durumda [min, max] araligina sikistirilir:
   *  - min: panelin dar yerlesimi bozulmadan calisabildigi en kucuk deger
   *  - max: sitenin en az SITE_MIN px'i kalsin; en fazla 900 px */
  const SITE_MIN = 280;
  const W_STEP = 16;
  let curW = 0;                 // uygulanan genislik (px)
  let rzRaf = 0;                // surukleme rAF kimligi
  let rzPending = null;         // rAF'ta uygulanacak genislik
  let rzDrag = null;            // { id, x0, w0 } surukleme durumu
  let rzSaveTimer = 0;

  function widthMin() { return cfg.easy ? 380 : 320; }
  function widthMax() {
    const vw = Math.max(320, window.innerWidth || 1200);
    return Math.max(widthMin(), Math.min(900, vw - SITE_MIN));
  }
  function clampWidth(w) {
    return Math.round(Math.min(widthMax(), Math.max(widthMin(), w)));
  }
  function savedWidth() {
    const w = Number(loadUi().width);
    return Number.isFinite(w) && w > 0 ? w : 0;
  }

  function panelWidth() {
    const kayitli = savedWidth();
    if (kayitli) return clampWidth(kayitli);
    const vw = Math.max(320, window.innerWidth || 1200);
    if (cfg.easy) return clampWidth(Math.min(760, Math.max(480, vw * 0.42)));
    return clampWidth(Math.min(640, Math.max(400, vw * 0.34)));
  }

  /* Genisligi uygular. Yalnizca iki CSS ozel ozelligi yazilir (panel ve
   * <html>); sayfadaki "sag kenara yapisik" ogeler de bu degiskeni
   * kullandigi icin surukleme sirasinda duzen hesabi tek karede biter. */
  function setWidth(w) {
    if (!host) return;
    curW = clampWidth(w);
    host.style.setProperty('--ag-w', curW + 'px');
    document.documentElement.style.setProperty('--arcod-panel-w', curW + 'px');
    const g = sh && sh.getElementById('grip');
    if (g) {
      g.setAttribute('aria-valuemin', String(widthMin()));
      g.setAttribute('aria-valuemax', String(widthMax()));
      g.setAttribute('aria-valuenow', String(curW));
      g.setAttribute('aria-valuetext', T('widthNow', { n: curW }));
    }
    if (el.wNow) el.wNow.textContent = T('widthNow', { n: curW });
  }

  function persistWidth(w) {
    clearTimeout(rzSaveTimer);
    rzSaveTimer = setTimeout(() => saveUi({ width: w || null }), 120);
  }

  function endDrag(g, cancel) {
    if (!rzDrag) return;
    const id = rzDrag.id;
    rzDrag = null;
    if (rzRaf) { cancelAnimationFrame(rzRaf); rzRaf = 0; }
    if (rzPending != null && !cancel) setWidth(rzPending);
    rzPending = null;
    document.documentElement.removeAttribute('data-arcod-drag');
    if (sh) { const sd = sh.getElementById('shield'); if (sd) sd.remove(); }
    if (g) {
      g.classList.remove('drag');
      try { g.releasePointerCapture(id); } catch { /* yoksay */ }
    }
    persistWidth(curW);
  }

  /* Tutamac: pointer events (fare/dokunma/kalem), klavye, cift tikla sifirla.
   * resetBtn ve nowEl ayarlar sayfasindaki ek kontroller (bos olabilir). */
  function setupResize(g, resetBtn, nowEl) {
    if (!g) return;
    el.wNow = nowEl || null;
    const reset = () => {
      saveUi({ width: null });
      setWidth(panelWidth());
    };
    g.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();                       // metin secimini baslatma
      rzDrag = { id: e.pointerId, x0: e.clientX, w0: curW };
      try { g.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      g.classList.add('drag');
      g.focus({ preventScroll: true });
      document.documentElement.setAttribute('data-arcod-drag', '1');
      /* Seffaf kalkan: iframe'ler olaylari yutmasin, imlec sabit kalsin. */
      const sd = document.createElement('div');
      sd.className = 'shield';
      sd.id = 'shield';
      sh.appendChild(sd);
    });
    g.addEventListener('pointermove', (e) => {
      if (!rzDrag || e.pointerId !== rzDrag.id) return;
      /* Panel sagda: sola surukle = genislesin. */
      rzPending = clampWidth(rzDrag.w0 + (rzDrag.x0 - e.clientX));
      if (!rzRaf) {
        rzRaf = requestAnimationFrame(() => {
          rzRaf = 0;
          if (rzPending != null) setWidth(rzPending);
        });
      }
    });
    g.addEventListener('pointerup', () => endDrag(g, false));
    g.addEventListener('pointercancel', () => endDrag(g, false));
    g.addEventListener('lostpointercapture', () => endDrag(g, false));
    g.addEventListener('dblclick', reset);
    g.addEventListener('keydown', (e) => {
      const adim = e.shiftKey ? W_STEP * 4 : W_STEP;
      let w = null;
      if (e.key === 'ArrowLeft') w = curW + adim;
      else if (e.key === 'ArrowRight') w = curW - adim;
      else if (e.key === 'Home') w = widthMin();
      else if (e.key === 'End') w = widthMax();
      else if (e.key === 'Enter') { e.preventDefault(); reset(); return; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      setWidth(w);
      persistWidth(curW);
    });
    if (resetBtn) resetBtn.addEventListener('click', reset);
  }

  const SPLIT_CSS = [
    'html[data-arcod-split] { margin-right: var(--arcod-panel-w) !important; }',
    'html[data-arcod-split], html[data-arcod-split] body { overflow-x: hidden !important; }',
    'html[data-arcod-split] body { max-width: 100% !important; }',
    /* Surukleme: secim ve iframe olaylari kapali, imlec sabit. */
    'html[data-arcod-drag], html[data-arcod-drag] * { user-select: none !important; -webkit-user-select: none !important; cursor: ew-resize !important; }',
    'html[data-arcod-drag] iframe, html[data-arcod-drag] embed, html[data-arcod-drag] object { pointer-events: none !important; }',
  ].join('\n');

  function applySplit() {
    if (!host) return;
    const doc = document.documentElement;

    /* -- 1) sayfa stilini bir kez enjekte et ----------------------------
     * Genislik artik stil metninde degil, --arcod-panel-w degiskeninde;
     * boylece suruklerken stil metni hic yeniden ayristirilmaz. */
    let st = document.getElementById(SPLIT_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = SPLIT_ID;
      st.textContent = SPLIT_CSS;
      (document.head || doc).appendChild(st);
    }
    doc.setAttribute('data-arcod-split', '1');
    setWidth(panelWidth());

    /* -- 2) site kabugunu kaydir (bir kez + degisimlerde) -------------- */
    shiftSiteChrome();

    /* SPA gezinince yeni sabit ogeler dogar; degisimleri izle. */
    if (!splitMo) {
      splitMo = new MutationObserver(() => {
        if (splitTimer) return;
        splitTimer = setTimeout(() => { splitTimer = 0; shiftSiteChrome(); }, 250);
      });
      splitMo.observe(doc, { childList: true, subtree: true });
    }
  }

  /* Sitenin kabugunu daralt.
   *
   * Iki ayri sey var ve ikisi de duzeltilmeli:
   *
   *  1) `position: fixed` + `right: 0` ile saga yaslanmis kabuklar
   *     (alt oynatici cubugu, sag panel). Bunlar viewport'a gore
   *     konumlanir, html margin'inden etkilenmez.
   *     -> `right` degerini var(--arcod-panel-w) yap: genislik degisince
   *        tarayici bunlari kendiliginden yeniden konumlar.
   *
   *  2) `width: 100vw` kullanan akis kapsayicilari. 100vw de viewport
   *     birimidir, yine margin'den etkilenmez ve panelin altina tasar.
   *     -> `max-width: 100%` ile ana cudeye sabitleriz.
   *
   * Yalnizca gercekten viewport genisligine sahip ogeleri hedefliyoruz;
   * dar icerikli kutulara dokunmuyoruz. Isaretli ogeler bir daha taranmaz. */
  function shiftSiteChrome() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (!vw) return;
    let list;
    try {
      list = document.body ? document.body.querySelectorAll('body *') : [];
    } catch { return; }

    /* IKI GECIS: once yalnizca OKUMA (duzeni kur), sonra yaz.
     * Tek gecisde okuma-yazma karisik olsaydi her yazma layout'u
     * gecersiz kilip sonraki olcumde yeniden reflow tetiklerdi;
     * binlerce oge icin bu kilitlenmeye yol acar. */
    const fixRight = [];
    const fixWidth = [];
    const esik = vw - 4;                       /* 4px tolerans */

    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.getAttribute(SPLIT_ATTR) === '1') continue;
      let cs, rect;
      try {
        cs = getComputedStyle(n);
        rect = n.getBoundingClientRect();
      } catch { continue; }
      if (cs.position === 'fixed') {
        const r = parseFloat(cs.right);
        if (r === 0 || r === 0.0) { fixRight.push(n); continue; }
      }
      /* viewport'a esit genislikteki akis kapsayicilari (100vw vb.):
       * margin'den sonra bile panelin altina tasanlar. */
      if (rect.width >= esik) fixWidth.push(n);
    }

    for (let i = 0; i < fixRight.length; i++) {
      const n = fixRight[i];
      if (host && (n === host || host.contains(n))) continue;
      n.setAttribute(SPLIT_ATTR, '1');
      n.style.setProperty('right', 'var(--arcod-panel-w)', 'important');
    }
    for (let i = 0; i < fixWidth.length; i++) {
      const n = fixWidth[i];
      if (host && (n === host || host.contains(n))) continue;
      n.setAttribute(SPLIT_ATTR, '1');
      n.style.setProperty('max-width', '100%', 'important');
    }
  }

  function removeSplit() {
    const st = document.getElementById(SPLIT_ID);
    if (st) st.remove();
    const doc = document.documentElement;
    doc.removeAttribute('data-arcod-split');
    doc.removeAttribute('data-arcod-drag');
    doc.style.removeProperty('--arcod-panel-w');
    clearTimeout(rzSaveTimer);
    if (rzRaf) { cancelAnimationFrame(rzRaf); rzRaf = 0; }
    rzDrag = null; rzPending = null; curW = 0;
    /* mudahile ettigimiz her seyi geri al */
    let list;
    try { list = document.body ? document.body.querySelectorAll('[' + SPLIT_ATTR + ']') : []; } catch { list = []; }
    for (let i = 0; i < list.length; i++) {
      list[i].removeAttribute(SPLIT_ATTR);
      list[i].style.removeProperty('right');
      list[i].style.removeProperty('max-width');
    }
    if (splitMo) { splitMo.disconnect(); splitMo = null; }
    if (splitTimer) { clearTimeout(splitTimer); splitTimer = 0; }
  }

  /* Dil degisti (ayarlardan secim): panel sayfa yenilemeden yeniden yazilir.
   * Devam eden indirmeye DOKUNULMAZ: satirlar yeniden kurulmaz, yalnizca
   * data-i18n isaretli metinler ve dinamik basliklar tazelenir. Gecici durum
   * satirlari (ornegin "12 MB / 40 MB") bir sonraki guncellemede yeni dilde gelir. */
  function applyLang() {
    LANG = resolveLang(cfg.lang);
    if (!host) return;
    el.wrap.setAttribute('lang', LANG);
    applyI18n(sh);
    if (el.onLang) el.onLang();                 // secim listeleri + ipuclari
    setWidth(curW || panelWidth());             // aria-valuetext / piksel metni
    scCapturing = null;
    buildShortcutsSection(sh.getElementById('scGroup'));
    renderNowPlaying();
    if (album) {
      const tracks = (album.tracks && album.tracks.items) || [];
      renderAlbumHeader(albumArtist(album), tracks);
      for (const s of st.values()) {
        if (s.prow && s.prow._h) s.prow.innerHTML = probeHtml(s.prow._h);
      }
    }
    if (!albumId && el.gstat && el.gstat.dataset.home) renderEmptyHome();
    else if (el.gstat && el.gstat.dataset.paused && pausedJob) announcePaused();
    syncAlbumBtn();                             // ust bar etiketleri + sira kutusu
  }

  /* Paneli ac/kapat. Tek giris noktasi: arac cubugu dugmesi (background ->
   * relay -> 'toggle'). Acik/kapali durum bu sekmede kalicidir (OPEN_KEY);
   * kullanici dugmeye tekrar basana kadar kendiliginden degismez. */
  function toggle() {
    if (host) {
      removeSplit();
      host.remove();
      host = null; sh = null; el = {};
      scCapturing = null;
      setOpenInTab(false);
      bridgeCall('arcodgrab:panel-closed').catch(() => {});   // rozeti temizle
      return false;
    }
    openPanel();
    return true;
  }

  function openPanel() {
    setOpenInTab(true);
    saveUi({ activated: true });
    scEnable();                       // kisayollar ilk etkinlestirmeden sonra kayitli
    build();
    applySplit();
    loadAlbum(albumIdFromUrl());
    announcePaused();
    syncQueueBadge();                 // ON ya da kuyruk sayisi
  }

  /* Yarim kalan toplu indirme varsa panelde bekletildigini soyle. */
  function announcePaused() {
    if (!pausedJob || !el.gstat) return;
    if (pausedJob.kind === 'queue' && queue.length) {
      const bitti = (pausedJob.doneIds || []).length;
      setGlobal(th('pausedQueueH', { done: bitti, total: pausedJob.total || queue.length, btn: T('resume') }), 'err');
      el.gstat.dataset.paused = '1';   // dil degisince yeniden yazilsin
    } else if (pausedJob.kind === 'album') {
      setGlobal(th('pausedAlbumH', { btn: T('barAlbum') }), 'err');
      pausedJob = null;
      saveJob(null);
    } else {
      pausedJob = null;
      saveJob(null);
    }
  }

  /* --------------------------------------------------------------- render */

  function setStat(id, html, cls) {
    const s = st.get(id);
    if (!s) return;
    s.stat.innerHTML = html;
    s.stat.className = 'stat' + (cls ? ' ' + cls : '');
  }

  /* Hangi yuzey baslattiysa durumunu odur yaz (album satiri ya da
   * "su an caliyor" karti). setStat yalnizca st tablosunu bildigi icin
   * kart kendi durum nesnesine yazsin. */
  function statTo(s, id, html, cls) {
    const target = (s && s.stat) ? s : st.get(id);
    if (!target || !target.stat) return;
    target.stat.innerHTML = html;
    target.stat.className = 'stat' + (cls ? ' ' + cls : '');
  }

  /* panel geneli durum (sag tik ile baslatilan indirmeler icin) */
  function setGlobal(html, cls) {
    if (!el.gstat) {
      /* Panel kapali (sag tik menusunden baslatilan islem): durum bildirimde. */
      if (!host && html) scToast(htmlText(html), cls === 'err' ? 4200 : 1800);
      return;
    }
    el.gstat.innerHTML = html;
    el.gstat.className = 'gstat' + (cls ? ' ' + cls : '');
    delete el.gstat.dataset.home;   // baska bir mesaj yazildi: ana ekran ipucu degil
    delete el.gstat.dataset.paused;
  }

  function htmlText(html) {
    try { return new DOMParser().parseFromString(String(html), 'text/html').body.textContent || ''; }
    catch { return String(html).replace(/<[^>]*>/g, ''); }
  }

  /* ------------------------------------------------ eklenti koprusu (SW) */

  /* MAIN world chrome.* API'sine erisemez. relay.js uzerinden background'a
 * istek atiyoruz; yanit ayni kanaldan geri gelir.
 *
 * DIKKAT: burada `chrome.runtime` var mi diye KONTROL ETME. Bu kod MAIN
 * world'da calistigi icin chrome.runtime tanimli degildir — ki bu yuzden
 * var olmadigi icin zaten relay'e ihtiyac duyuyoruz. Onceki surumde bu
 * kontrol vardi ve tum kopru isteklerini sessizce null'a dusuruyordu
 * ("eklenti koprusune ulasmadi"). Varligini relay'in yanit vermesiyle
 * anlariz; relay yoksa zaman asimi ile hata doner. */
  /* req: ya 'arcodgrab:xxx' dizesi ya da {kind:'arcodgrab:xxx', ...args} */
  function bridgeCall(req, ms) {
    const limit = ms || 6000;
    return new Promise((resolve) => {
      const kind = typeof req === 'string' ? req : req && req.kind;
      const args = typeof req === 'string' ? {} : Object.assign({}, req);
      delete args.kind;
      const id = 'q' + Math.random().toString(36).slice(2, 9);
      let bitti = false;
      const onMsg = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d[TAG] !== true || d.type !== 'response' || d.id !== id) return;
        bitti = true;
        window.removeEventListener('message', onMsg);
        /* relay hata yolladiysa gercek mesaji tasi — yoksa null yutup
         * kullaniciyi "koprusune ulasmadi" diye yaniltiyorduk. */
        resolve(d.ok ? d.res : { ok: false, bridgeError: true, code: d.error ? '' : 'errBridgeNoBackend', error: d.error || T('errBridgeNoBackend') });
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ [TAG]: true, type: 'request', id, req: kind, args }, '*');
      setTimeout(() => {
        if (bitti) return;
        window.removeEventListener('message', onMsg);
        /* relay hic yanit vermedi: ya sayfada degil ya da relay.js yüklenmedi */
        resolve({
          ok: false, bridgeError: true, code: 'errBridgeTimeout',
          error: T('errBridgeTimeout'),
        });
      }, limit);
    });
  }

  /* kopru hatasi icin tek, anlasilir mesaj */
  /* background.js hata kodu da gonderir (code: 'bad-url' | 'bad-id' | 'unknown');
   * kodlar kullanici diline cevrilir, kodsuz hata metni (tarayici API'sinden)
   * oldugu gibi gosterilir. */
  const BRIDGE_CODES = { 'bad-url': 'errBadUrl', 'bad-id': 'errBadId', unknown: 'errUnknown' };
  function bridgeMsg(r, what) {
    if (r && r.code) {
      if (BRIDGE_CODES[r.code]) return T(BRIDGE_CODES[r.code]);
      if (I18N.tr[r.code]) return T(r.code);
    }
    if (r && r.bridgeError) return r.error;
    if (r && r.error) return r.error;
    return T('errUnknown');
  }

  async function showDefaultFolder() {
    const r = await bridgeCall('arcodgrab:show-folder');
    if (r && r.ok) return true;
    setGlobal(escapeHtml(T('folderFail', { e: bridgeMsg(r, 'show-folder') })), 'err');
    return false;
  }

  /* 'dl' kipi: akisi tarayicinin indirme yoneticisine devrediyoruz.
   * Bellege hic dokunmaz, gercek akis yapar, klasor kurar ve "Aci" dugmesi
   * dosyayi isletim sisteminin varsayilan uygulamasinda acabilir.
   * Firefox'ta varsayilan kip budur (File System Access API yok). */
  async function saveViaDownloads(t, artist, folderName, albumTitle) {
    /* albumTitle verilmezse acik olan albume düşeriz; sira gibi bagimsiz
     * kaynaklar kendi albüm adını geçmeli. */
    const alb = albumTitle !== undefined ? albumTitle : (album ? album.title : '');
    const fname = fillTemplate(t, artist, alb);
    const rel = folderName ? folderName + '/' + fname : fname;
    const tk = await ticket(t.id);
    const r = await bridgeCall({ kind: 'arcodgrab:download', url: tk.url, filename: rel });
    if (!r || !r.ok) {
      return { ok: false, error: bridgeMsg(r, 'download') };
    }
    return { ok: true, name: rel, handle: null, downloadId: r.id, mode: 'dl' };
  }

  async function openDownload(res) {
    const r = await bridgeCall({ kind: 'arcodgrab:open', id: res.downloadId });
    if (r && r.ok) return true;
    setGlobal(escapeHtml(T('openFail', { e: bridgeMsg(r, 'open') })), 'err');
    return false;
  }

  async function showDownload(res) {
    const r = res && res.downloadId != null
      ? await bridgeCall({ kind: 'arcodgrab:show', id: res.downloadId })
      : null;
    if (r && r.ok) return true;                 // indirmeler sayfasi, orada "Klasorde goster" var
    return showDefaultFolder();
  }

  /* ------------------------------------------------------- sonuc butonlari */

  /* res = { handle, name, mode, downloadId }
   *  mode 'fsa' -> handle FileSystemFileHandle; blob uretip yeni sekmede acar
   *  mode 'dl'  -> downloadId; downloads.open ile OS varsayilaninda acar */
  function renderResultButtons(host, res) {
    if (!host) return;
    host.textContent = '';
    if (!res) return;

    const ac = document.createElement('button');
    ac.className = 'mini';
    ac.innerHTML = ICONS.play + lbl('open');
    ac.disabled = !res.handle && res.downloadId == null;
    const acKey = res.handle || res.downloadId != null ? 'openTip' : 'noHandle';
    ac.title = T(acKey);
    ac.setAttribute('data-i18n-title', acKey);
    ac.addEventListener('click', () => openResult(res));

    const klas = document.createElement('button');
    klas.className = 'mini';
    klas.innerHTML = ICONS.folder + lbl('showFolder');
    const klasKey = res.downloadId != null ? 'showFolderTipDl' : 'showFolderTipDir';
    klas.title = T(klasKey);
    klas.setAttribute('data-i18n-title', klasKey);
    klas.addEventListener('click', () => showDownload(res));

    host.append(ac, klas);
  }

  async function openResult(res) {
    if (res.mode === 'dl') return openDownload(res);
    try {
      const file = await res.handle.getFile();
      const url = URL.createObjectURL(file);
      const w = window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 180000);
      if (!w) setGlobal(th('tabBlockedH', { name: res.name }), 'err');
    } catch (e) {
      setGlobal(escapeHtml(T('openFail', { e: e.message })), 'err');
    }
  }

  function setGlobalBar(pct, show) {
    if (!el.gbar) return;
    if (show === false) el.gbar.classList.add('hide');
    else {
      el.gbar.classList.remove('hide');
      el.gfill.style.width = Math.max(0, Math.min(100, pct || 0)).toFixed(1) + '%';
    }
  }

  /* ------------------------------------------------ albüm başlığı (özet) */

  /* Kapak görseli ARCOD'da birkaç yerde olabiliyor; ilk bulduğumuzu kullanır. */
  function coverOf(a) {
    const cands = [a, (a.album || {})];
    for (const o of cands) {
      for (const k of ['coverUrlLarge', 'coverUrl', 'cover', 'image', 'artwork', 'thumbnail']) {
        const v = o[k];
        if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
      }
    }
    const first = ((a.tracks || {}).items || [])[0] || {};
    for (const k of ['coverUrlLarge', 'coverUrl', 'cover', 'image']) {
      const v = first[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    }
    return '';
  }

  function renderAlbumHeader(artist, tracks) {
    const a = album;
    let totalSn = 0;
    const mix = new Map();
    let unknown = 0;

    for (const t of tracks) {
      const f = trackFacts(t);
      totalSn += f.dur;
      if (!f.bits || !f.rate) { unknown++; continue; }
      const k = `${f.bits}-bit ${khzText(f.rate)} kHz`;
      mix.set(k, (mix.get(k) || 0) + 1);
    }

    const mixTxt = [...mix.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([k, n]) => `${n}× ${k}`)
      .join('  ·  ') || (tracks.length ? T('mixNone') : '');

    const top = [...mix.entries()].sort((x, y) => y[1] - x[1])[0];
    const karisik = mix.size > 1;

    const label = str((a.label || {}).name) || '';
    const gl = Array.isArray(a.genres_list) ? a.genres_list : [];
    const genre = gl.length ? (gl[gl.length - 1].name || '') : ((a.genre || {}).name || '');
    const year = releasedYear(a) || '';
    const cover = coverOf(a);

el.meta.removeAttribute('data-i18n');   // artik sabit bir etiket degil
    el.meta.innerHTML =
      `<div class="mhead">` +
      (cover ? `<img class="cover" src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer">` : '') +
      `<div class="minfo">` +
      `<div class="mtitle" title="${escapeHtml(a.title || '')}">${escapeHtml(a.title || '')}` +
      (year ? ` <span class="ver">${escapeHtml(year)}</span>` : '') + `</div>` +
      `<div class="martist">${escapeHtml(artist || '')}</div>` +
      `</div>` +
      `</div>` +
      `<div class="bstats">` +
      `<span>${th('nTracksH', { n: tracks.length })}</span>` +
      `<span>${th('totalH', { t: clock(totalSn) })}</span>` +
      (a.upc ? `<span class="mono">UPC ${escapeHtml(a.upc)}</span>` : '') +
      `</div>` +
      `<div class="mix ${karisik ? 'warn' : ''}" title="${escapeHtml(T('mixTip'))}">` +
      escapeHtml(mixTxt) + (unknown ? '  ·  ' + escapeHtml(T('nUnknown', { n: unknown })) : '') + `</div>` +
      (karisik ? `<div class="mixnote">${escapeHtml(T('mixWarn'))}</div>` : '') +
      (label || genre ? `<div class="mfoot">${escapeHtml([label, genre].filter(Boolean).join(' · '))}</div>` : '');
  }

  function render() {
    build();
    if (!album) return;

    const artist = (album.artist && album.artist.name)
      || (album.artists && album.artists[0] && album.artists[0].name)
      || '';
    const tracks = (album.tracks && album.tracks.items) || [];

    renderAlbumHeader(artist, tracks);

    el.rows.textContent = '';
    st.clear();

    for (const t of tracks) {
      const f = trackFacts(t);
      const q = qualityOf(f);
      const facts = [];
      if (f.isrc) facts.push(`ISRC <span class="mono">${escapeHtml(f.isrc)}</span>`);
      if (f.label) facts.push('Label ' + escapeHtml(f.label));
      if (f.genre) facts.push(escapeHtml(f.genre));
      if (f.year) facts.push(escapeHtml(f.year));
      if (f.hires) facts.push('hi-res');

      const row = document.createElement('div');
      row.className = 'row';
      /* Satir varsayilan olarak minimum: sira no, baslik, kalite rozeti,
       * Hi-Res rozeti, sure ve tek bir "indir" butonu. Dosya adi, ISRC,
       * etiketler ve dogrulama butonu "detay" altinda kalir; Kolay Mod'da
       * hepsi gizlenir. */
      row.innerHTML =
        `<div class="rhead" data-a="rowhead">` +
        `<span class="n">${t.track_number ?? ''}</span>` +
        `<span class="rcell">` +
        `<span class="tt" title="${escapeHtml(t.title || '')}">${escapeHtml(t.title || '')}` +
        `${f.version ? ' <span class="ver">(' + escapeHtml(f.version) + ')</span>' : ''}</span>` +
        /* Apple kalibi: baslik ustte, altinda rozet + kanal/ISRC.
         * Rozet bit/kHz'i zaten tasiyor; tekrar etmeyelim. */
        `<span class="rsub">` +
        qbHtml(q) +
        `<span class="rinfo">` +
        `${f.bits ? chHtml(f.ch) : escapeHtml(specOf(t))}` +
        `${f.isrc ? ` · <span class="mono">${escapeHtml(f.isrc)}</span>` : ''}` +
        `</span></span>` +
        `</span>` +
        `<span class="rmeta">` +
        `${hiresImg(f)}` +
        `<span class="dur">${clock(f.dur)}</span>` +
        iconBtn('mini', 'download', 'dl', ' data-a="dl"') +
        /* Satiri acan dugme AYRI bir kontrol. Satir basligi role=button
         * olsaydi icindeki "indir" dugmesiyle ic ice etkilesimli olurdu
         * (gecersiz ARIA + tiklamada detay panelinin de acilmasi). */
        `<button class="dis" data-a="toggle" aria-expanded="false"` +
        ` aria-label="${escapeHtml(T('details'))}" title="${escapeHtml(T('details'))}"` +
        ` data-i18n-aria="details" data-i18n-title="details">${ICONS.chevron}</button>` +
        `</span></div>` +
        /* Indirme bitince buraya "Aç" / "Klasörde Göster" gelir. */
        `<div class="racts" data-a="acts"></div>` +
        `<div class="rdet hide">` +
        `<div class="rfil" data-a="name"></div>` +
        `<div class="rfacts">${facts.length ? facts.join(' · ') : '—'}` +
        `${f.copyright ? `<br>${escapeHtml(f.copyright)}` : ''}` +
        `<br>track id <span class="mono">${escapeHtml(String(t.id))}</span>` +
        `${album.upc ? ` · UPC <span class="mono">${escapeHtml(album.upc)}</span>` : ''}` +
        `${f.albumId ? ` · album id <span class="mono">${escapeHtml(f.albumId)}</span>` : ''}` +
        `</div>` +
        `<button class="mini" data-a="probe"` +
        ` title="${escapeHtml(T('probeTip'))}" data-i18n-title="probeTip">` +
        `${ICONS.check}${lbl('probeBtn')}</button>` +
        `<div class="prow hide" role="status" aria-live="polite"></div></div>` +
        `<div class="bar2 hide"><div class="fill"></div></div>` +
        `<div class="stat"></div>`;

      const det = row.querySelector('.rdet');
      const head = row.querySelector('[data-a="rowhead"]');
      const tog = row.querySelector('[data-a="toggle"]');
      const flip = () => {
        const open = det.classList.toggle('hide') === false;
        tog.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('open', open);
      };
      /* Satirin bos kismina (basliga) tiklamak ayrintiyi acar - konfor
       * kisayolu. Ama satirin ICINDEKI dugmeler (indir, genislet) bu
       * tiklamayi tetiklemez; aksi halde "indir" bir kez yerine iki kez
       * calisir ve detay paneli de yanlislikla acilir. */
      head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        flip();
      });
      tog.addEventListener('click', (e) => { e.stopPropagation(); flip(); });
      tog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });

      const fill = row.querySelector('.fill');
      const bar2 = row.querySelector('.bar2');
      const dlBtn = row.querySelector('[data-a="dl"]');
      const prBtn = row.querySelector('[data-a="probe"]');
      row.querySelector('[data-a="name"]').textContent = fillFilename(t, artist);

      const s = { fill, bar2, dlBtn, prBtn, stat: row.querySelector('.stat'), acts: row.querySelector('[data-a="acts"]'), prow: row.querySelector('.prow'), det, row };
      st.set(t.id, s);

      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (active && active.id === t.id) cancelActive();
        else download(t, artist, s);
      });
      prBtn.addEventListener('click', (e) => { e.stopPropagation(); probe(t); });

      el.rows.appendChild(row);
    }

    if (active) {
      cancelActive();
      setStat(active.id, escapeHtml(T('stopped')), 'err');
      active = null;
    }
  }

  function fillFilename(t, artist) {
    return fillTemplate(t, artist, album ? album.title : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------ islemler */

  function cancelActive() {
    if (active && active.controller) active.controller.abort();
  }

  /** activeId null ise hicbir indirme yok -> hepsi acilir. */
  function setRowsEnabled(activeId) {
    const idle = activeId == null;
    for (const [id, s] of st) {
      const on = idle || id === activeId;
      s.dlBtn.disabled = !on;
      s.prBtn.disabled = !on;
      if (on) setBtnLabel(s.dlBtn, 'download', 'dl');
    }

    /* "su an caliyor" karti st tablosunda degil; ayrica yonetilir */
    if (el.npDl && npTrack) {
      const on = idle || String(npTrack.id) === String(activeId);
      el.npDl.disabled = !on;
      if (el.npQ) el.npQ.disabled = !on;
      if (on) setBtnLabel(el.npDl, 'download', 'dl');
    }
  }

  async function probe(t) {
    const s = st.get(t.id);
    if (!s || s.prBtn.disabled) return;
    s.prBtn.disabled = true;

    /* Sonucu satirin icindeki ayri alana yaziyoruz; ayrica ayrinti
     * panelini aciyoruz ki kullanici cikan yaziyi gorebilsin. */
    const out = s.prow || null;
    const say = (html, cls) => {
      if (out) {
        out.innerHTML = html;
        out.className = 'prow ' + (cls || '');
        out.classList.remove('hide');
      } else {
        setStat(t.id, html, cls);
      }
    };
    if (s.row) {
      s.row.classList.add('open');
      if (s.det) s.det.classList.remove('hide');
      const tg = s.row.querySelector('[data-a="toggle"]');
      if (tg) tg.setAttribute('aria-expanded', 'true');
    }
    if (out) out._h = null;
    say(escapeHtml(T('probeReading')));

    const ctl = new AbortController();
    try {
      const { body } = await openStream(t.id, ctl.signal);
      const reader = body.getReader();
      const parts = [];
      let n = 0;
      while (n < PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
      }
      await reader.cancel().catch(() => {});
      const u8 = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { u8.set(p, o); o += p.length; }
      const head = readFlacHead(u8);
      if (out) out._h = head;   // dil degisince sonuc yeniden cizilebilsin
      say(probeHtml(head), head.ok ? 'ok' : 'err');
    } catch (e) {
      if (out) out._h = { ok: false, why: e && e.message };
      say(probeError(e && e.message), 'err');
    } finally {
      if (st.get(t.id) === s) setRowsEnabled(active ? active.id : null);
    }
  }

  async function download(t, artist, rowState) {
    const s = rowState || null;
    const onRow = !!s;

    const msg = (html, cls) => (onRow ? statTo(s, t.id, html, cls) : setGlobal(html, cls));
    const bar = (pct, show) => {
      if (onRow) {
        s.bar2.classList.toggle('hide', show === false);
        s.fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
      } else setGlobalBar(pct, show);
    };
    if (onRow && s.dlBtn.disabled) return;
    if (active || albumJob) return;

    const suggested = fillTemplate(t, artist, album ? album.title : '');

    /* --- 'dl' kipi: akisi tarayicinin indirme yoneticisine devrediyoruz.
     *   Firefox'ta varsayilan budur. Akis kendi ekraninda gorunur. --- */
    if (saveMode() === 'dl') {
      const rb = s || st.get(t.id);
      setRowsEnabled(t.id);
      if (rb) setBtnLabel(rb.dlBtn, 'download', 'stop');
      msg(escapeHtml(T('handing')));
      try {
        const r = await saveViaDownloads(t, artist, null);
        if (!r.ok) {
          msg('✗ ' + escapeHtml(r.error), 'err');
        } else {
          msg(th('dlStartedH', { name: r.name }), 'ok');
          lastResult = r;
          if (onRow && s.acts) renderResultButtons(s.acts, r);
          else if (el.gact) { renderResultButtons(el.gact, r); el.gact.classList.remove('hide'); }
        }
      } catch (e) {
        msg('✗ ' + escapeHtml(e.message), 'err');
      } finally {
        if (rb) setBtnLabel(rb.dlBtn, 'download', 'dl');
        setRowsEnabled(null);
      }
      return;
    }

    /* --- 'fsa' kipi: kullanici hareketi showSaveFilePicker'i gecirsin --- */
    let handle = null;
    let writableHandle = null;      // "Aci" icin sakladigimiz FileSystemFileHandle
    if (HAS_FSA) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: T('fileTypeDesc'), accept: { 'audio/flac': ['.flac'] } }],
        });
        writableHandle = handle;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        handle = null; // dosya sistemi acilamadi -> blob yoluna dus
      }
    }

    const ctl = new AbortController();
    active = { id: t.id, controller: ctl, row: onRow };
    const rowBtn = s || st.get(t.id);

    setRowsEnabled(t.id);
    if (rowBtn) setBtnLabel(rowBtn.dlBtn, 'download', 'stop');
    bar(0);
    msg(escapeHtml(T('ticketing')));

    let writable = null;
    const parts = [];
    let written = 0;
    let declared = 0;
    const t0 = performance.now();
    let tick = 0;

    try {
      const stream = await openStream(t.id, ctl.signal);
      declared = stream.total;
      msg(escapeHtml(T('streamOpen', { size: mb(declared), q: stream.quality })));

      if (handle) {
        try {
          writable = await handle.createWritable();
        } catch {
          writable = null; // dogrudan yazamayiz -> bellege biriktir
        }
      }

      const reader = stream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (writable) await writable.write(value);
        else parts.push(value);
        written += value.length;

        const now = performance.now();
        if (now - tick > 150) {
          tick = now;
          const sp = written / ((now - t0) / 1000);
          const pct = declared ? (written / declared) * 100 : 0;
          bar(pct, true);
          const eta = declared && sp > 0 ? (declared - written) / sp : NaN;
          msg(
            `${mb(written)}${declared ? ' / ' + mb(declared) : ''}` +
            `${declared ? `  ${pct.toFixed(1)}%` : ''}  ${mb(sp)}/s` +
            `${isFinite(eta) ? '  ' + escapeHtml(T('etaLeft', { t: clock(eta) })) : ''}`);
        }
      }

      if (writable) await writable.close();
      else {
        const blob = new Blob(parts, { type: stream.ct || 'audio/flac' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = suggested;
        document.documentElement.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 120000);
      }

const secs = (performance.now() - t0) / 1000;
      const ok = !declared || written === declared;
      msg(
        `${escapeHtml(T(ok ? 'doneOk' : 'doneMismatch'))} · ${escapeHtml(suggested)} · ` +
        `${mb(written)}${declared ? ' / ' + escapeHtml(T('declSize', { size: mb(declared) })) : ''} · ${escapeHtml(T('secs', { n: secs.toFixed(1) }))}`,
        ok ? 'ok' : 'err');

      /* "Aci" / "Klasorde Goster" */
      const res = { name: suggested, handle: writableHandle || null, mode: 'fsa' };
      lastResult = res;
      if (onRow && s.acts) renderResultButtons(s.acts, res);
      else {
        const g = el.gact;
        if (g) { renderResultButtons(g, res); g.classList.remove('hide'); }
      }
    } catch (e) {
      if (writable) await writable.abort().catch(() => {});
      const aborted = e && (e.name === 'AbortError' || ctl.signal.aborted);
      msg(
        aborted ? escapeHtml(T('abortedLine', { size: mb(written) }))
          : '✗ ' + escapeHtml(e.message),
        'err');
    } finally {
      bar(written, false);
      if (rowBtn) setBtnLabel(rowBtn.dlBtn, 'download', 'dl');
      if (active && active.id === t.id) active = null;
      setRowsEnabled(null);
    }
  }

  /* ------------------------------------------- uygulamanin menusune ekleme */

  /* ARCOD parca satirlarina zaten bir sag tik menusu aciyor (.context-menu).
   * Onu degistirmiyoruz; acildiktan sonra icine ayni siniflarla kendi
   * dugmemizi ekliyoruz, boylece gorunum butun degismez. */
  const CTX_ITEM_CLASS =
    'flex items-center gap-2.5 px-3 py-2 w-full text-left text-sm transition-colors hover:bg-white/5 arcod-grab-item';
  const CTX_HOOK = 'arcod-grab-item';
  const CTX_Q_CLASS =
    'flex items-center gap-2.5 px-3 py-2 w-full text-left text-sm transition-colors hover:bg-white/5 arcod-grab-q';

  let ctxTrack = null;
  let ctxWatchers = [];

  function removeCtxItem() {
    ctxTrack = null;
    for (const w of ctxWatchers) {
      if (w.type === 'mo') w.handle.disconnect();
      else { clearInterval(w.handle); clearTimeout(w.handle); }
    }
    ctxWatchers = [];
    for (const n of document.querySelectorAll('.' + CTX_HOOK)) n.remove();
    for (const n of document.querySelectorAll('.arcod-grab-q')) n.remove();
  }

  function findCtxMenu() {
    const m = document.querySelector('.context-menu');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) return null;   // gizli / kapanis animasyonu
    return m;
  }

  /* Radix menusu sentetik Escape/pointerdown ile kapanmiyor ve dugumu
   * DOM'dan cikarmak (menu.remove()) uygulamayi kalici olarak bozuyor.
   * Bu yuzden geri alinabilir sekilde gizliyoruz: display:none, ve bir
   * sonraki sag tikte geri acilip icine dugmemizi ekliyoruz. */
  function hideCtxMenu() {
    const m = document.querySelector('.context-menu');
    if (m) m.style.setProperty('display', 'none', 'important');
  }

  function unhideCtxMenu() {
    for (const m of document.querySelectorAll('.context-menu')) {
      if (m.style.getPropertyValue('display') === 'none') m.style.removeProperty('display');
    }
  }

  function buildCtxButton(track) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CTX_ITEM_CLASS;
    btn.title = track.id + ' · ' + (specOf(track) || '');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'lucide lucide-download w-4 h-4 text-muted-foreground');
    svg.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>' +
      '<polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>';

    const span = document.createElement('span');
    span.textContent = T('ctxDownload');

    btn.append(svg, span);
    return btn;
  }

  /* "Indirme Sirasina Ekle" — hemen indirmeyi hem de simdiki durumda
   * sıraya alinmis olup olmadigini gosterir. */
  function buildCtxQueueButton(track) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CTX_Q_CLASS;

    const zaten = inQueue(track.id);
    if (zaten) {
      btn.classList.add('dim');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = T('ctxQueuedTip');
    } else {
      btn.title = T('ctxQueueTip');
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'lucide lucide-list-plus w-4 h-4 text-muted-foreground');
    svg.innerHTML = '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line>' +
      '<line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line>' +
      '<line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>';

    const span = document.createElement('span');
    span.textContent = zaten ? T('ctxQueued') : T('ctxQueue');

    btn.append(svg, span);
    return btn;
  }

  /* Menu DOM'a girmeden once gelir. requestAnimationFrame kullanmiyoruz:
   * pencere arka planda kalinca rAF duruyor ve dugme hic eklenmiyor.
   * Bunun yerine menu hemen bulunur; bulunamazsa MutationObserver + kisa
   * aralikla beklenir (ikisi de arka planda da calisir). */
  function attachCtxItem(track) {
    removeCtxItem();
    ctxTrack = track;

    let done = false;
    const tryInject = () => {
      if (done) return true;
      unhideCtxMenu();
      const menu = findCtxMenu();
      if (!menu) return false;
      for (const n of menu.querySelectorAll('.' + CTX_HOOK)) n.remove();
      for (const n of menu.querySelectorAll('.arcod-grab-q')) n.remove();

      const btn = buildCtxButton(track);
      /* siraya ekle dugmesi hemen altinda olsun */
      const qBtn = buildCtxQueueButton(track);

      const firstBtn = menu.querySelector('button');
      if (firstBtn && firstBtn.parentElement) {
        firstBtn.parentElement.insertBefore(btn, firstBtn);
        btn.after(qBtn);
      } else {
        menu.append(btn, qBtn);
      }
      done = true;
      stop();
      return true;
    };

    let stop = () => { for (const w of ctxWatchers) { if (w.type === 'mo') w.handle.disconnect(); else clearInterval(w.handle); } ctxWatchers = []; };

    if (tryInject()) return;                       // menu zaten DOM'da

    const mo = new MutationObserver(() => { tryInject(); });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class'],
    });
    ctxWatchers.push({ type: 'mo', handle: mo });

    const t0 = performance.now();
    const iv = setInterval(() => {
      if (tryInject() || performance.now() - t0 > 2500) {
        clearInterval(iv);
        mo.disconnect();
        ctxWatchers = ctxWatchers.filter((w) => w.handle !== iv && w.handle !== mo);
      }
    }, 120);
    ctxWatchers.push({ type: 'iv', handle: iv });
  }

  function closeCtxMenu() {
    /* once dogal yollari dene, olmazsa geri alinabilir sekilde gizle */
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
    }));
    setTimeout(() => {
      if (findCtxMenu()) hideCtxMenu();
    }, 120);
  }

  function onCtxItemClick() {
    /* preventDefault/stopPropagation, eventi yakalayan capture dinleyicide
       zaten yapildi; buraya olay gecirilmiyor. */
    const track = ctxTrack;
    removeCtxItem();
    closeCtxMenu();
    if (!track) return;

    /* Panel kapaliysa kurulmaz ve acilmaz; ilerleme bildirimde gorunur. */
    setGlobal('');
    download(track, trackArtist(track), null);
  }

  /* "Indirme Sirasina Ekle" — ayni capture yolundan gecirilir, cunku
   * uygulamanin menusu kendi click'ini stopPropagation ile kesebiliyor. */
  function onCtxQueueClick() {
    const track = ctxTrack;
    removeCtxItem();
    closeCtxMenu();
    if (!track) return;
    queueAdd(track);
  }

  /* Uygulama her sag tik icin birden fazla contextmenu olayi yeniden yayinlar ve
   menu acilirken rect animasyon sirasinda kucuk olup "yok" sayilabilir. Bu
   yuzden track bulunamayan olaylarda HICBIR seyi silmiyoruz: gecis noktasi
   degil. Bayat dugme zararsizdir, cunku her attachCtxItem once kendini temizler. */
  document.addEventListener('contextmenu', (ev) => {
    /* Panel kapaliyken de menu ogeleri eklenir; ama kendiliginden HICBIR sey
     * calismaz: yalnizca kullanici ogeye tiklayinca bir sey olur. */
    if (host && host.contains(ev.target)) return;
    if (ev.target instanceof Element && ev.target.closest('.context-menu')) return;
    const track = trackFromNode(ev.target);
    if (!track) return;
    ev.preventDefault();
    attachCtxItem(track);
  }, true);

  /* Tiklamayi dugmenin kendisine degil document'e capture a evustiruyoruz:
   uygulamanin menusu kendi click'ini stopPropagation ile kesebiliyor, bu
   yuzden asagidaki yol bizim handler'i her zaman once calistirir. */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    /* sira dugmesi once gelir: ikisi de ayni capture dinleyicisinden gecer */
    if (t instanceof Element && t.closest('.arcod-grab-q')) {
      ev.preventDefault();
      ev.stopPropagation();
      onCtxQueueClick();
      return;
    }
    if (t instanceof Element && t.closest('.' + CTX_HOOK)) {
      ev.preventDefault();
      ev.stopPropagation();
      onCtxItemClick();
      return;
    }
    if (ctxTrack) removeCtxItem();     // baska bir yere tiklandi -> bayat dugmeyi topla
  }, true);

  /* ------------------------------------------------------- sira paneli */

  function renderQueue() {
    if (!el.queueBtn) return;

    const n = queue.length;
    el.queueBtn.classList.toggle('hide', (n === 0 && !albumJob) || pageOpen);
    /* textContent ikonu silerdi; ikon + etiket birlikte yazilir. */
    const qKey = albumJob && albumJob.kind === 'queue' ? 'stop'
      : (pausedJob && pausedJob.kind === 'queue' ? 'resume' : 'barQueueAll');
    el.queueBtn.innerHTML = ICONS.list + lbl(qKey);
    /* title: sira doluyken sayili ipucu, bos iken bos (dil degisince yeniden yazilir) */
    el.queueBtn.title = n ? T('qBtnTip', { n }) : '';
    if (n) { el.queueBtn.setAttribute('data-i18n-title', 'qBtnTip'); el.queueBtn.setAttribute('data-i18n-n', n); }
    else { el.queueBtn.removeAttribute('data-i18n-title'); el.queueBtn.removeAttribute('data-i18n-n'); }

    el.qbox.classList.toggle('hide', n === 0);
    if (!n) {
      el.qcount.textContent = T('qEmpty');
      el.qlist.textContent = '';
      return;
    }

    el.qcount.textContent = T('qCount', { n });

    el.qlist.textContent = '';
    queue.forEach((q, i) => {
      const row = document.createElement('div');
      row.className = 'qrow';

      const no = document.createElement('span');
      no.className = 'qno';
      no.textContent = String(i + 1);

      const info = document.createElement('span');
      info.className = 'qinfo';
      const t = document.createElement('b');
      t.textContent = q.title || T('qTitleless');
      const m = document.createElement('span');
      const qq = qualityOf({ bits: q.bits, rate: q.rate });
      m.textContent = [q.artist, q.album, q.dur ? clock(q.dur) : ''].filter(Boolean).join(' · ');
      info.append(t, m);

      const qb = document.createElement('span');
      qb.className = 'qbadges';
      const b1 = document.createElement('span');
      b1.className = 'qb ' + qq.cls;
      b1.textContent = qq.short;
      b1.title = qq.name;
      qb.append(b1);
      const hr = isHiRes({ bits: q.bits, rate: q.rate, hires: q.hires });
      if (hr) {
        const logo = document.createElement('img');
        logo.className = 'hires';
        logo.src = HIRES_LOGO;
        logo.alt = 'Hi-Res Audio';
        logo.title = 'Hi-Res Audio';
        qb.append(logo);
      }
      const rm = document.createElement('button');
      rm.className = 'mini';
      rm.innerHTML = ICONS.trash + lbl('qRemove');
      rm.title = T('qRemoveTip');
      rm.setAttribute('aria-label', T('qRemoveTip'));
      rm.setAttribute('data-i18n-title', 'qRemoveTip');
      rm.setAttribute('data-i18n-aria', 'qRemoveTip');
      rm.addEventListener('click', () => { removeFromQueue(q.id); renderQueue(); });

      row.append(no, info, qb, rm);
      el.qlist.appendChild(row);
    });

    /* sira toplami: yalnizca sure (boyut bilgisi API'de yok) */
    const tsn = queue.reduce((a, q) => a + (q.dur || 0), 0);
    el.qcount.textContent = T('qCount', { n }) + (tsn ? ` · ${clock(tsn)}` : '');
  }

  /* "Tümünü İndir" — sıradaki her parcayi indirme yoneticisine devreder.
   *
   * Bilerek daima 'dl' yolu kullanilir: 'fsa' kipinde her parca icin ayri
   * dosya secme penceresi acilirdi, 20 parcalik bir sira kullanilamaz olurdu.
   * Indirme yoneticisi klasoru kendisi kurar, hicbir sey sormaz. */
  async function downloadQueue() {
    if (!queue.length) { setGlobal(escapeHtml(T('qEmpty')), 'err'); return; }
    if (active || albumJob) return;

    /* Duraklatilmis bir is varsa daha once gonderilenleri atla (devam et). */
    const atla = new Set(pausedJob && pausedJob.kind === 'queue' ? (pausedJob.doneIds || []) : []);
    const doneIds = Array.from(atla);
    let islem = queue.filter((q) => !atla.has(q.id));   // kopyasini indir, listeden silme
    if (!islem.length) { islem = queue.slice(); doneIds.length = 0; }
    const ctl = new AbortController();
    albumJob = {
      ctl, total: islem.length, ok: 0, fail: 0,
      folderName: QUEUE_FOLDER, kind: 'queue',
    };
    pausedJob = null;
    saveJob({ kind: 'queue', total: queue.length, doneIds });   // yenilenirse "duraklatildi" kalir
    syncAlbumBtn();
    renderQueue();
    setRowsEnabled(null);
    setGlobal(th('queueRunH', { dir: QUEUE_FOLDER, n: islem.length }));

    for (let i = 0; i < islem.length; i++) {
      if (ctl.signal.aborted) break;
      const q = islem[i];
      try {
        /* sahte track nesnesi: fillTemplate'in ihtiyacini karsiliyor.
         * {n} sira girdisinde yok; ekledigimizdeki parca numarasi yoksa
         * sıra sırası numara olur (aksi halde her dosya 00. ile baslar). */
        const t = {
          id: q.id,
          title: q.title || '',
          track_number: (typeof q.n === 'number' && q.n) || (i + 1),
          __spec: q.spec && q.spec !== '-' ? q.spec : '',
        };
        const r = await saveViaDownloads(t, q.artist || '', QUEUE_FOLDER, q.album || '');
        if (r.ok) {
          albumJob.ok++;
          doneIds.push(q.id);
          saveJob({ kind: 'queue', total: queue.length, doneIds });
          setGlobal(`✓ ${albumJob.ok}/${islem.length} · ${escapeHtml(r.name)}`, 'ok');
        } else {
          albumJob.fail++;
          setGlobal(`✗ ${escapeHtml(q.title || q.id)}: ${escapeHtml(r.error)}`, 'err');
        }
      } catch (e) {
        albumJob.fail++;
        setGlobal(`✗ ${escapeHtml(q.title || q.id)}: ${escapeHtml(e.message)}`, 'err');
      }
    }

    const job = albumJob;
    const cancelled = ctl.signal.aborted;
    albumJob = null;
    /* Durdurulduysa kayit "duraklatildi" olarak kalir; bittiyse temizlenir. */
    if (cancelled && doneIds.length) {
      pausedJob = { kind: 'queue', total: queue.length, doneIds };
      saveJob(pausedJob);
    } else {
      saveJob(null);
    }
    syncAlbumBtn();
    setRowsEnabled(null);

    const ozet = T('sumSent', { ok: job.ok, total: job.total }) + (job.fail ? T('sumFail', { n: job.fail }) : '');
    if (cancelled) setGlobal(th('jobStoppedH', { sum: ozet, dir: QUEUE_FOLDER }), 'err');
    else if (job.fail) setGlobal(th('jobDoneErrH', { sum: ozet, dir: QUEUE_FOLDER }), 'err');
    else setGlobal(th('queueOkH', { sum: ozet, dir: QUEUE_FOLDER }), 'ok');
  }

  /* ------------------------------------------------------ album indirme */

  function albumArtist(alb) {
    return (alb.artist && alb.artist.name)
      || (alb.artists && alb.artists[0] && alb.artists[0].name)
      || '';
  }

  function syncAlbumBtn() {
    if (el.albumBtn) {
      if (!album) { el.albumBtn.classList.add('hide'); }
      else {
        el.albumBtn.classList.remove('hide');
        if (pageOpen) el.albumBtn.classList.add('hide');
        el.albumBtn.innerHTML = ICONS.music
          + lbl((albumJob && albumJob.kind !== 'queue') ? 'stop' : 'barAlbum');
        el.albumBtn.classList.toggle('go', !!(albumJob && albumJob.kind !== 'queue'));
      }
    }
    renderQueue();
  }

  /* Tum parcalari, secilen klasorun ALTINDA album adindan bir klasore,
   * sirayla akitarak indirir. Tek tek showSaveFilePicker acmaz. */
  async function startAlbum() {
    const tracks = (album && album.tracks && album.tracks.items) || [];
    if (!tracks.length) return;
    if (active || albumJob) return;

    const folderName = safeName(album.title || 'album');

    /* 'dl' kipi: tarayici indirme yoneticisi 'Album/01. x.flac' yolundaki
     * ara klasoru kendisi olusturur; kullanici secmek zorunda degil. */
    if (saveMode() === 'dl') {
      const artist0 = albumArtist(album);
      const ctl = new AbortController();
      albumJob = { ctl, total: tracks.length, ok: 0, fail: 0, folderName };
      saveJob({ kind: 'album', albumId, total: tracks.length });
      syncAlbumBtn();
      setRowsEnabled(null);
      setGlobal(th('albumRunH', { dir: folderName, n: tracks.length }));

      for (let i = 0; i < tracks.length; i++) {
        if (ctl.signal.aborted) break;
        try {
          const r = await saveViaDownloads(tracks[i], artist0, folderName);
          if (r.ok) {
            albumJob.ok++;
            setGlobal(`✓ ${albumJob.ok}/${tracks.length} · ${escapeHtml(r.name)}`, 'ok');
          } else {
            albumJob.fail++;
            setGlobal(`✗ ${escapeHtml(tracks[i].title)}: ${escapeHtml(r.error)}`, 'err');
          }
        } catch (e) {
          albumJob.fail++;
          setGlobal(`✗ ${escapeHtml(tracks[i].title)}: ${escapeHtml(e.message)}`, 'err');
        }
      }

      const job2 = albumJob;
      const cancelled2 = ctl.signal.aborted;
      albumJob = null;
      saveJob(null);
      syncAlbumBtn();
      setRowsEnabled(null);
      const ozet2 = T('sumStarted', { ok: job2.ok, total: job2.total }) +
        (job2.fail ? T('sumFail', { n: job2.fail }) : '');
      if (cancelled2) setGlobal(th('jobStoppedH', { sum: ozet2, dir: folderName }), 'err');
      else if (job2.fail) setGlobal(th('jobDoneErrH', { sum: ozet2, dir: folderName }), 'err');
      else setGlobal(th('albumOkDlH', { sum: ozet2, dir: folderName }), 'ok');
      return;
    }

    if (!HAS_FSA) {
      setGlobal(escapeHtml(T('noFsaDir')), 'err');
      return;
    }

    let dir;
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'arcodgrab-album' });
    } catch { return; }                       // kullanic iptal etti

    let sub;
    try {
      sub = await dir.getDirectoryHandle(folderName, { create: true });
    } catch (e) {
      setGlobal(escapeHtml(T('mkdirFail', { e: e.message })), 'err');
      return;
    }

    const artist = albumArtist(album);
    const ctl = new AbortController();
    albumJob = { ctl, total: tracks.length, ok: 0, fail: 0, folderName };
    saveJob({ kind: 'album', albumId, total: tracks.length });
    syncAlbumBtn();
    setRowsEnabled(null);
    setGlobalBar(0, true);
    setGlobal(th('albumRunH', { dir: folderName, n: tracks.length }));

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (ctl.signal.aborted) break;
      let writable = null;
      try {
        const fname = fillTemplate(t, artist, album.title);
        const fh = await sub.getFileHandle(fname, { create: true });
        writable = await fh.createWritable();

        const stream = await openStream(t.id, ctl.signal);
        const total = stream.total;
        let written = 0;
        const t0 = performance.now();
        let tick = 0;
        const reader = stream.body.getReader();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          written += value.length;
          const now = performance.now();
          if (now - tick > 250) {
            tick = now;
            const pct = total ? (written / total) * 100 : 0;
            const sp = written / ((now - t0) / 1000);
            setGlobalBar(pct, true);
            setGlobal(
              `${i + 1}/${tracks.length} · <b>${escapeHtml(t.title)}</b> · ` +
              `${escapeHtml(specOf(t))} · ${mb(written)}${total ? ' / ' + mb(total) : ''} · ${mb(sp)}/s`);
          }
        }
        await writable.close();
        writable = null;
        albumJob.ok++;
        setGlobalBar(0, true);
        setGlobal(`✓ ${albumJob.ok}/${tracks.length} · ${escapeHtml(fname)}`, 'ok');
      } catch (e) {
        if (writable) await writable.abort().catch(() => {});
        if (ctl.signal.aborted) break;
        albumJob.fail++;          // hatali parca TAMAM sayilmaz
        setGlobal(`✗ ${escapeHtml(t.title)}: ${escapeHtml(e.message)}`, 'err');
      }
    }

    const job = albumJob;
    const { total, folderName: fn } = job;
    const cancelled = ctl.signal.aborted;
    albumJob = null;
    saveJob(null);
    syncAlbumBtn();
    setRowsEnabled(null);
    setGlobalBar(0, false);

    const ozet = T('sumDone', { ok: job.ok, total }) +
      (job.fail ? T('sumFail', { n: job.fail }) : '');
    if (cancelled) {
      setGlobal(th('jobStoppedH', { sum: ozet, dir: fn }), 'err');
    } else if (job.fail) {
      setGlobal(th('jobDoneErrH', { sum: ozet, dir: fn }), 'err');
    } else {
      setGlobal(th('albumOkFsaH', { sum: ozet, dir: fn }), 'ok');
    }

    if (job.ok > 0) {
      el.gact.textContent = '';
      const klas = document.createElement('button');
      klas.className = 'mini';
      klas.innerHTML = ICONS.folder + lbl('showFolder');
      klas.title = T('showFolderTipDir');
      klas.setAttribute('data-i18n-title', 'showFolderTipDir');
      klas.addEventListener('click', () => showDefaultFolder());
      el.gact.append(klas);
      el.gact.classList.remove('hide');
    }
  }

  /* ===================================================================
   * KLAVYE KISAYOLLARI
   * Yalnizca eklenti kullanici tarafindan en az bir kez etkinlestirildiyse
   * kayitlanir (scEnable). Panel kapaliyken de calisir. Siteyi, sayfanin
   * kendi audio/video ogesi ve oynatici dugmeleri uzerinden kontrol eder;
   * bulamazsa SESSIZCE hicbir sey yapmaz (preventDefault da cagrilmaz).
   *
   * Uc grup: (1) saf islevler (ayristirma/eslestirme), (2) oynatici
   * kontrolu + toast + dinleyici, (3) panelin 'Kisayollar' bolumu.
   * =================================================================== */

  /* ---- (1) saf islevler: DOM'a dokunmaz, node ile sinanabilir ---- */
  /* @sc-pure-begin */
  const SC_ACTIONS = [
    /* label: eylem adi (cevrilir; getter her okunusta gecerli dili kullanir).
     * Tus adlari (Ctrl, ←, →…) dilden bagimsizdir. */
    { id: 'prev',    key: 'scPrev',    get label() { return T('scPrev'); },    def: 'Ctrl+ArrowLeft' },
    { id: 'next',    key: 'scNext',    get label() { return T('scNext'); },    def: 'Ctrl+ArrowRight' },
    { id: 'volUp',   key: 'scVolUp',   get label() { return T('scVolUp'); },   def: 'Ctrl+ArrowUp' },
    { id: 'volDown', key: 'scVolDown', get label() { return T('scVolDown'); }, def: 'Ctrl+ArrowDown' },
  ];
  const SC_VOL_STEP = 0.05;
  const SC_MOD_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS', 'Dead', 'Unidentified'];
  /* Tarayicinin kendisinin yakaladigi, sayfadan engellenemeyen birlesimler. */
  const SC_RESERVED = ['Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+T',
    'Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+F4', 'Ctrl+Q'];

  /* Olaydan kanonik birlesim metni: 'Ctrl+Alt+Shift+Meta+Tus'. Harf/rakam
   * e.code'dan okunur (klavye duzeninden bagimsiz); bos metin = gecersiz. */
  function scComboOf(ev) {
    if (!ev || typeof ev.key !== 'string' || !ev.key) return '';
    if (SC_MOD_KEYS.indexOf(ev.key) >= 0) return '';
    let k = ev.key;
    const code = typeof ev.code === 'string' ? ev.code : '';
    const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
    if (m) k = m[1];
    else if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toUpperCase();
    const p = [];
    if (ev.ctrlKey) p.push('Ctrl');
    if (ev.altKey) p.push('Alt');
    if (ev.shiftKey) p.push('Shift');
    if (ev.metaKey) p.push('Meta');
    p.push(k);
    return p.join('+');
  }

  /* Kullaniciya gosterilen metin */
  function scLabel(combo, spaceName) {
    if (!combo) return '';
    const ad = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: spaceName || 'Boşluk' };
    return combo.split('+').map((x) => ad[x] || x).join(' + ');
  }

  /* Kayitli ayari varsayilanlarla birlestir; yalnizca bilinen eylemler,
   * yalnizca metin degerler. '' = kullanici bilerek bosaltti. */
  function scNormalize(raw) {
    const out = {};
    for (const a of SC_ACTIONS) {
      out[a.id] = raw && typeof raw === 'object' && typeof raw[a.id] === 'string'
        ? raw[a.id] : a.def;
    }
    return out;
  }

  /* Birlesime karsilik gelen ilk eylem kimligi; yoksa ''. */
  function scMatch(combo, map) {
    if (!combo) return '';
    for (const a of SC_ACTIONS) if (map[a.id] === combo) return a.id;
    return '';
  }

  /* { eylemId: [ayni birlesimi kullanan diger eylem kimlikleri] } (yalnizca cakisanlar) */
  function scConflicts(map) {
    const out = {};
    for (const a of SC_ACTIONS) {
      if (!map[a.id]) continue;
      const diger = SC_ACTIONS.filter((b) => b.id !== a.id && map[b.id] === map[a.id]).map((b) => b.id);
      if (diger.length) out[a.id] = diger;
    }
    return out;
  }

  /* Yazi alani odaktayken kisayol tetiklenmez (duck typing: saf kalsin). */
  function scIsEditable(n) {
    if (!n || typeof n !== 'object') return false;
    const tag = String(n.tagName || '').toLowerCase();
    if (tag === 'input') {
      /* kaydirici/onay kutusu gibi yazi girmeyen girdiler kisayolu engellemez */
      const ty = String(n.type || 'text').toLowerCase();
      return ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color'].indexOf(ty) < 0;
    }
    if (tag === 'textarea' || tag === 'select') return true;
    if (n.isContentEditable === true) return true;
    const role = typeof n.getAttribute === 'function' ? n.getAttribute('role') : '';
    return role === 'textbox' || role === 'combobox' || role === 'searchbox';
  }

  /* Ses adimi: 0-1 araliginda sikistir, 2 haneye yuvarla (kayan nokta kirini onler). */
  function scStepVolume(v, dir) {
    const cur = Number.isFinite(v) ? v : 1;
    return Math.min(1, Math.max(0, Math.round((cur + dir * SC_VOL_STEP) * 100) / 100));
  }
  /* @sc-pure-end */

  /* ---- (2) oynatici kontrolu, toast, dinleyici ---- */
  let scOn = false;           // dinleyici kayitli mi
  let scCapturing = null;     // panelde tus yakalayan eylem kimligi
  let scToastHost = null;
  let scToastTimer = 0;

  function scMap() { return scNormalize(cfg.shortcuts); }

  function scEnable() {
    if (scOn) return;
    scOn = true;
    window.addEventListener('keydown', scOnKey, true);
  }

  /* Sayfanin ses ogesi: calan > kaynagi olan > ilk. */
  function scMedia() {
    let list = [];
    try { list = Array.from(document.querySelectorAll('audio, video')); } catch { /* yoksay */ }
    /* media-hook.js kaydi: DOM'a eklenmemis (new Audio()) ogeler de gelir */
    const hk = scHook();
    if (hk) {
      try { for (const m of hk.elements()) if (list.indexOf(m) < 0) list.push(m); } catch { /* yoksay */ }
    }
    if (!list.length) return null;
    /* Web Audio'ya alinmis oge (createMediaElementSource) icin .volume etkisiz;
     * o yuzden once yonlendirilmemis ogeler tercih edilir. */
    const dir = hk ? list.filter((m) => { try { return !hk.isRouted(m); } catch { return true; } }) : list;
    const pool = dir.length ? dir : list;
    return pool.find((m) => !m.paused && !m.ended)
      || pool.find((m) => m.currentSrc || m.src)
      || pool[0];
  }

  /* media-hook.js ile tek seferlik el sikisma (ilk talep eden alir). Kanca yoksa
   * (ornegin sayfa yuklenmeden once calismadiysa) null; sonraki cagrilarda
   * yeniden denenmez ama basarisizlik kalici sayilmaz. */
  let scHookApi = null;
  let scHookTried = false;
  function scHook() {
    if (scHookApi) return scHookApi;
    if (scHookTried) return null;
    scHookTried = true;
    try {
      window.dispatchEvent(new CustomEvent('__arcodgrab:media', { detail: { cb: (a) => { scHookApi = a; } } }));
    } catch { /* yoksay */ }
    return scHookApi;
  }
  /* Ana gain (Web Audio) var mi, varsa degeri */
  function scMasterVol() {
    const hk = scHook();
    if (!hk) return null;
    try { return hk.liveMasters().length ? hk.getMaster() : null; } catch { return null; }
  }
  function scIsRouted(m) {
    const hk = scHook();
    try { return !!(hk && m && hk.isRouted(m)); } catch { return false; }
  }

  /* Oynatici dugmesi: aria-label / title / data-testid / ikon sinifi (lucide
   * skip-back vb.) uzerinden. Birden fazla eslesirse en alttaki (oynatici cubugu). */
  const SC_BTN_RE = {
    prev: /(prev|previous|önceki|onceki|skip-?back|step-?back|rewind)/i,
    next: /(next|sonraki|skip-?forward|step-?forward)/i,
  };

  function scFindButton(kind) {
    const re = SC_BTN_RE[kind];
    let list;
    try { list = document.querySelectorAll('button, [role="button"]'); } catch { return null; }
    let best = null;
    let bestTop = -Infinity;
    for (const b of list) {
      if (host && (b === host || host.contains(b))) continue;
      if (b.closest && b.closest('.context-menu')) continue;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      let ipucu = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')
        + ' ' + (b.getAttribute('data-testid') || '');
      const svg = b.querySelector('svg');
      if (svg) ipucu += ' ' + String(svg.getAttribute('class') || '');
      if (!re.test(ipucu)) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;          // gorunmeyen
      if (r.top > bestTop) { best = b; bestTop = r.top; }
    }
    return best;
  }

  function scToast(text, ms) {
    if (!scToastHost) {
      scToastHost = document.createElement('div');
      scToastHost.id = 'arcod-grab-toast';
      const root = scToastHost.attachShadow({ mode: 'closed' });
      const stl = document.createElement('style');
      stl.textContent = SC_TOAST_CSS;
      const box = document.createElement('div');
      box.className = 'sc-toast';
      box.setAttribute('role', 'status');
      root.append(stl, box);
      scToastHost.__box = box;
    }
    scToastHost.__box.textContent = text;
    if (!scToastHost.isConnected) document.documentElement.appendChild(scToastHost);
    clearTimeout(scToastTimer);
    scToastTimer = setTimeout(() => {
      if (scToastHost) scToastHost.remove();
    }, ms || 1300);
  }

  /* Eylemi uygula; gercekten bir sey yapildiysa true (preventDefault icin). */
  function scRun(id, ev) {
    if (id === 'prev' || id === 'next') {
      const b = scFindButton(id);
      if (!b) return false;
      if (!ev.repeat) {                 // tus basili tutulunca parca atlanmasin
        b.click();
        scToast(T(id === 'prev' ? 'scPrev' : 'scNext'));
      }
      return true;
    }
    /* Tek mantiksal ses degeri. Kaynak onceligi (gecerli deger buradan okunur):
     * 1) Web Audio'ya alinmamis ses ogesi (.volume), 2) Web Audio ana gain,
     * 3) sitenin kaydiricisi. Yeni deger ayni anda her mevcut yola uygulanir;
     * Web Audio'ya alinmis ogeye .volume yazilmaz (cift uygulama olmasin). */
    const m = scMedia();
    const mDirect = m && !scIsRouted(m) ? m : null;
    const mg = scMasterVol();
    const ctl = scFindVolumeCtl(mDirect);
    if (!mDirect && mg === null && !ctl) return false;
    const cur = mDirect ? mDirect.volume : (mg !== null ? mg : scCtlFrac(ctl));
    const yeni = scStepVolume(cur, id === 'volUp' ? 1 : -1);
    if (mg !== null) { try { scHook().setMaster(yeni); } catch { /* yoksay */ } }
    /* Once sitenin kendi ses kaydiricisi: uygulama sesi kendi durumundan
     * (state) geri yazdigi icin yalnizca audio.volume atamak kalici olmuyordu.
     * Kaydirici surulunce uygulama durumunu da gunceller. Ardindan
     * audio.volume dogrudan da ayarlanir (kaydirici yoksa tek yol budur). */
    if (ctl) { try { scSetCtl(ctl, yeni); } catch { /* yoksay */ } }
    if (mDirect) {
      try {
        if (Math.abs(mDirect.volume - yeni) > 0.005) mDirect.volume = yeni;
        if (id === 'volUp' && mDirect.muted && yeni > 0) mDirect.muted = false;
      } catch { /* yoksay */ }
    }
    scToast(T('volToast', { n: Math.round(yeni * 100) }));
    return true;
  }

  /* Sitenin ses kaydiricisi: <input type=range> ya da role=slider (Radix /
   * shadcn). Adayin ipucu metni (aria-label, test kimligi, yakin ikon sinifi)
   * "volume/ses" icermeli ve (ses ogesi varsa) degeri audio.volume ile
   * eslesmeli; boylece ilerleme (seek) cubugu ile karismaz. */
  const SC_VOL_RE = /(volume|\bvol\b|sound|speaker|\bses\b)/i;
  const SC_NOT_VOL_RE = /(seek|progress|scrub|position|duration|ilerleme)/i;

  function scCtlFrac(c) {
    if (!c) return 1;
    if (c.tagName === 'INPUT') {
      const lo = Number(c.min) || 0;
      const hi = c.max === '' ? 100 : Number(c.max);
      return hi > lo ? Math.min(1, Math.max(0, (Number(c.value) - lo) / (hi - lo))) : 1;
    }
    const lo = Number(c.getAttribute('aria-valuemin')) || 0;
    const hi = c.hasAttribute('aria-valuemax') ? Number(c.getAttribute('aria-valuemax')) : 100;
    const now = Number(c.getAttribute('aria-valuenow'));
    return hi > lo && isFinite(now) ? Math.min(1, Math.max(0, (now - lo) / (hi - lo))) : 1;
  }

  function scFindVolumeCtl(m) {
    let list;
    try { list = document.querySelectorAll('input[type="range"], [role="slider"]'); } catch { return null; }
    for (const c of list) {
      if (host && (c === host || host.contains(c))) continue;
      const own = [c.getAttribute('aria-label'), c.getAttribute('name'), c.id,
        c.getAttribute('data-testid'), c.getAttribute('title')].join(' ');
      if (SC_NOT_VOL_RE.test(own)) continue;
      let hint = own;
      let x = c;
      for (let i = 0; i < 3 && x; i++, x = x.parentElement) {
        hint += ' ' + [x.getAttribute('aria-label'), x.getAttribute('data-testid'), x.getAttribute('title')].join(' ');
        if (i === 1) for (const s of x.querySelectorAll('svg')) hint += ' ' + String(s.getAttribute('class') || '');
      }
      if (!SC_VOL_RE.test(hint)) continue;
      if (m && Math.abs(scCtlFrac(c) - m.volume) > 0.06) continue;   // ses degeriyle eslesmiyor
      return c;
    }
    return null;
  }

  function scSetCtl(c, frac) {
    if (c.tagName === 'INPUT') {
      const lo = Number(c.min) || 0;
      const hi = c.max === '' ? 100 : Number(c.max);
      const step = Number(c.step);
      let v = lo + frac * (hi - lo);
      if (step > 0 && isFinite(step)) v = lo + Math.round((v - lo) / step) * step;
      /* React'in izledigi deger ayarlayicisi: dogrudan c.value = ... onChange'i tetiklemez */
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(c, String(v));
      c.dispatchEvent(new Event('input', { bubbles: true }));
      c.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    /* role=slider: odaklanip ok tuslariyla hedefe yaklas (adim boyutu bilinmez) */
    const lo = Number(c.getAttribute('aria-valuemin')) || 0;
    const hi = c.hasAttribute('aria-valuemax') ? Number(c.getAttribute('aria-valuemax')) : 100;
    const target = lo + frac * (hi - lo);
    const read = () => Number(c.getAttribute('aria-valuenow'));
    const prev = document.activeElement;
    try { c.focus({ preventScroll: true }); } catch { /* yoksay */ }
    for (let i = 0; i < 110; i++) {
      const cur = read();
      if (!isFinite(cur) || Math.abs(target - cur) < (hi - lo) * 0.02) break;
      c.dispatchEvent(new KeyboardEvent('keydown', {
        key: target > cur ? 'ArrowRight' : 'ArrowLeft', bubbles: true, cancelable: true,
      }));
      if (read() === cur) break;
    }
    try { if (prev && prev !== c && prev.focus) prev.focus({ preventScroll: true }); } catch { /* yoksay */ }
  }

  /* Panelin (kapali golge DOM) icindeki yazi alani odakta mi? Kapali golge
   * kokunde olay yolu disaridan gorunmez; bu yuzden kendi referansimizdan
   * (sh.activeElement) bakariz. */
  function panelTyping() {
    try {
      return !!(host && sh && document.activeElement === host && scIsEditable(sh.activeElement));
    } catch { return false; }
  }

  /* Panelde yazarken (sablon, ayirici, secim listesi) tus olaylari window'un
   * capture asamasinda kesilir: sayfanin document/window dinleyicilerine (ve
   * eklentinin kendi sayfa kisayollarina) ulasmaz, boylece Bosluk oynaticiyi
   * durdurmaz. Varsayilan eylem (karakterin yazilmasi) bundan etkilenmez; yazi
   * alanlarimizin keydown dinleyicisi yok (input/change olaylarini kullanir).
   * Not: eklentiden once kaydolmus bir sayfa capture dinleyicisi yine gorur. */
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (ev) => { if (panelTyping()) ev.stopImmediatePropagation(); }, true);
  }

  /* Global kapsam: background.js (chrome.commands) -> relay.js -> buraya. Yalnizca
   * kullanici panelden 'Tum tarayicida' dediyse (localStorage'dan taze okunur;
   * baska sekmede degismis olabilir) ve eylem bilinen bir eylemse calisir. */
  function scCommand(action) {
    let scope = cfg.scScope;
    try { scope = loadCfg().scScope; } catch { /* yoksay */ }
    if (scope !== 'global') return;
    if (!SC_ACTIONS.some((a) => a.id === action)) return;
    scRun(action, { repeat: false });
  }

  function scOnKey(ev) {
    if (scCapturing) return;                       // panel tus yakaliyor
    if (panelTyping()) return;                     // panelde yaziliyor
    if (scIsEditable(ev.target) || scIsEditable(document.activeElement)) return;
    const id = scMatch(scComboOf(ev), scMap());
    if (!id) return;
    if (scRun(id, ev)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  /* ---- (3) panelin 'Kisayollar' bolumu ---- */
  const SC_TOAST_CSS = `
:host { all: initial; }
.sc-toast {
  position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  z-index: 2147483600; padding: 8px 16px; border-radius: 999px;
  background: rgba(28, 28, 30, 0.92); color: #fff; pointer-events: none;
  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}
`;

  const SC_CSS = `
/* ===== Kisayollar bolumu (ayarlar sayfasinin diger kartlariyla ayni dil) ===== */
.sc-list { display: flex; flex-direction: column; gap: 8px; margin: 10px 12px 0; }
.sc-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px;
  padding: 10px 12px; border-radius: var(--r-card);
  background: var(--raise); box-shadow: inset 0 0 0 0.5px var(--sep);
}
.sc-name { flex: 1 1 120px; min-width: 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 500; color: var(--label); }
.sc-key {
  flex: 0 0 auto; min-width: 128px; max-width: 100%;
  font-family: var(--mono); font-size: 12px; font-weight: 600;
  box-shadow: inset 0 0 0 0.5px var(--sep);
}
.sc-key:focus-visible, .sc-key.sc-cap { outline: 2px solid var(--blue); outline-offset: 2px; }
.sc-key.sc-cap { background: var(--ok-bg); }
.sc-key.sc-empty { color: var(--label-3); font-weight: 400; }
.sc-warn { flex: 1 0 100%; font-size: 11.5px; line-height: 1.45; color: var(--gold); }
.sc-warn:empty { display: none; }
.sc-foot { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 12px 0; }
.sc-sub { padding: 14px 16px 6px; font-size: 11.5px; color: var(--label-2); }
.sc-assigned { flex: 0 0 auto; font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--label); }
.sc-assigned.sc-empty { color: var(--label-3); font-weight: 400; }
.sc-global.hide { display: none; }
.wbtn { margin: 12px 12px 0; }
.wnow { margin-inline-start: 8px; color: var(--label-3); font-variant-numeric: tabular-nums; }
@container ag (max-width: 440px) { .sc-key { flex: 1 1 100%; } }
`;

  function buildShortcutsSection(group) {
    if (!group) return;
    group.innerHTML = `
      <div class="pgt">${escapeHtml(T('scTitle'))}</div>
      <div class="hint">${th('scHintH')}</div>
      <div class="sc-sub" id="scScopeT">${escapeHtml(T('scScopeLabel'))}</div>
      <div class="opts" id="scScope" role="radiogroup" aria-labelledby="scScopeT"></div>
      <div class="sc-global" id="scGlobal">
        <div class="hint">${th('scGlobalHelpH')}</div>
        <div class="sc-sub">${escapeHtml(T('scCmdListTitle'))}</div>
        <div class="sc-list" id="scCmds"></div>
        <div class="sc-foot">
          <button class="mini" id="scOpenChrome" type="button"><span>${escapeHtml(T('scOpenChrome'))}</span></button>
          <button class="mini" id="scCopyAddr" type="button"><span>${escapeHtml(T('scCopyAddr'))}</span></button>
        </div>
        <div class="hint" id="scCopyMsg" role="status" aria-live="polite"></div>
      </div>
      <div class="sc-list" id="scList"></div>
      <div class="hint">${th('scPageOnlyH')}</div>
      <div class="sc-foot">
        <button class="mini" id="scReset" type="button"><span>${escapeHtml(T('scReset'))}</span></button>
      </div>`;
    const list = group.querySelector('#scList');

    /* --- kapsam: sayfa | global --- */
    const globalBox = group.querySelector('#scGlobal');
    const cmdBox = group.querySelector('#scCmds');
    const copyMsg = group.querySelector('#scCopyMsg');
    const SC_CMD_NAMES = { 'arcod-prev': 'prev', 'arcod-next': 'next', 'arcod-vol-up': 'volUp', 'arcod-vol-down': 'volDown' };
    const SC_ADDR = 'chrome://extensions/shortcuts';

    async function refreshCmds() {
      cmdBox.textContent = '';
      const r = await bridgeCall('arcodgrab:commands');
      const got = {};
      if (r && r.ok && Array.isArray(r.commands)) {
        for (const c of r.commands) if (SC_CMD_NAMES[c.name]) got[SC_CMD_NAMES[c.name]] = c.shortcut || '';
      }
      for (const a of SC_ACTIONS) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const nm = document.createElement('span');
        nm.className = 'sc-name';
        nm.textContent = a.label;
        const v = document.createElement('span');
        v.className = 'sc-assigned' + (got[a.id] ? '' : ' sc-empty');
        v.textContent = got[a.id] || T('scNone');
        row.append(nm, v);
        cmdBox.appendChild(row);
      }
    }
    function applyScope() {
      globalBox.classList.toggle('hide', cfg.scScope !== 'global');
      if (cfg.scScope === 'global') refreshCmds();
    }
    buildChoice(group.querySelector('#scScope'), 'scScope', [
      { value: 'page', title: T('scScopePage'), desc: T('scScopePageDesc') },
      { value: 'global', title: T('scScopeGlobal'), desc: T('scScopeGlobalDesc') },
    ], cfg.scScope, (v) => { cfg.scScope = v === 'global' ? 'global' : 'page'; saveCfg(); applyScope(); });

    async function copyAddr() {
      let ok = false;
      try { await navigator.clipboard.writeText(SC_ADDR); ok = true; } catch { /* eski yol */ }
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = SC_ADDR;
          group.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch { ok = false; }
      }
      copyMsg.textContent = ok ? T('scCopied') : T('scCopyFail');
    }
    group.querySelector('#scCopyAddr').addEventListener('click', copyAddr);
    group.querySelector('#scOpenChrome').addEventListener('click', async () => {
      copyMsg.textContent = '';
      const r = await bridgeCall('arcodgrab:open-shortcuts');
      if (!r || !r.ok) copyAddr();     // chrome:// acilamadiysa adres panoya
    });
    applyScope();
    const rows = {};

    for (const a of SC_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'sc-row';
      const name = document.createElement('span');
      name.className = 'sc-name';
      name.textContent = a.label;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'sc-key';
      key.setAttribute('aria-label', T('scKeyAria', { a: a.label }));
      const warn = document.createElement('span');
      warn.className = 'sc-warn';
      row.append(name, key, warn);
      list.appendChild(row);
      rows[a.id] = { key, warn };

      key.addEventListener('click', () => {
        scCapturing = a.id;
        key.classList.add('sc-cap');
        key.textContent = T('scPress');
        key.focus();
      });
      key.addEventListener('blur', () => {
        if (scCapturing === a.id) { scCapturing = null; refresh(); }
      });
      key.addEventListener('keydown', (ev) => {
        if (scCapturing !== a.id) return;
        if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return; // odak serbest
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === 'Escape') { scCapturing = null; refresh(); return; }
        let combo;
        if (ev.key === 'Backspace' || ev.key === 'Delete') combo = '';
        else {
          combo = scComboOf(ev);
          if (!combo) return;                       // yalnizca degistirici tus: bekle
        }
        cfg.shortcuts = Object.assign({}, cfg.shortcuts || {}, { [a.id]: combo });
        saveCfg();
        scCapturing = null;
        refresh();
        key.focus();
      });
    }

    function refresh() {
      const map = scMap();
      const cak = scConflicts(map);
      for (const a of SC_ACTIONS) {
        const r = rows[a.id];
        const v = map[a.id];
        r.key.classList.remove('sc-cap');
        r.key.classList.toggle('sc-empty', !v);
        r.key.textContent = v ? scLabel(v, T('keySpace')) : T('scNone');
        let w = '';
        if (!v) w = T('scWarnNone');
        else if (cak[a.id]) {
          const ad = cak[a.id].map((id) => SC_ACTIONS.find((x) => x.id === id).label).join(', ');
          w = T('scWarnConflict', { names: ad });
        } else if (SC_RESERVED.indexOf(v) >= 0) {
          w = T('scWarnReserved');
        }
        r.warn.textContent = w;
      }
    }

    group.querySelector('#scReset').addEventListener('click', () => {
      cfg.shortcuts = null;
      saveCfg();
      scCapturing = null;
      refresh();
    });

    refresh();
  }

  /* -------------------------------------------------------------- SPA gez */

  /* Ust meta alanina cevrilebilir sabit bir metin yazar (dil degisince yenilenir). */
  function setMeta(key) {
    el.meta.setAttribute('data-i18n', key);
    el.meta.textContent = T(key);
  }

  /* Albume bakilmiyorken (ornegin ana sayfa) gosterilen yonlendirme. */
  function renderEmptyHome() {
    setMeta('homeMeta');
    setGlobal(th('homeTipH', { item: T('ctxDownload') }));
    el.gstat.dataset.home = '1';   // setGlobal baska mesaj yazana kadar dil degisince yenilenir
  }

  async function loadAlbum(id) {
    albumId = id;
    syncAlbumBtn();
    if (!id) {
      build();
      syncAlbumBtn();
      album = null;
      el.rows.textContent = '';
      renderEmptyHome();
      renderQueue();
      syncQueueBadge();
      return;
    }
    build();
    setMeta('albumLoading');
    try {
      album = await getAlbum(id);
      render();
      syncAlbumBtn();
    } catch (e) {
      album = null;
      el.meta.removeAttribute('data-i18n');
      el.meta.innerHTML = escapeHtml(T('albumReadFail', { e: e.message }));
      el.rows.textContent = '';
    }
  }

  /* Acilis: KENDILIGINDEN panel acilmaz. Yalnizca kullanici bu sekmede paneli
   * onceden actiysa (sessionStorage) ayni durum geri yuklenir; aksi halde
   * hicbir sey kurulmaz. Kisayollar yalnizca eklenti bir kez etkinlestirildiyse
   * kayitlanir. Yarim kalan indirme OTOMATIK devam etmez (pausedJob). */
  if (loadUi().activated === true) scEnable();
  if (wasOpenInTab()) openPanel();

  /* Pencere yeniden boyutlaninca sutun genisligi ve site kaymasi
   * guncellensin. */
  let rsTimer = 0;
  addEventListener('resize', () => {
    if (rsTimer) clearTimeout(rsTimer);
    rsTimer = setTimeout(() => { rsTimer = 0; if (host) applySplit(); }, 150);
  });

  let last = location.href;
  setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    if (!host) return;                  // panel kapaliyken SPA gezinmesine tepki yok
    const id = albumIdFromUrl();
    if (id !== albumId) loadAlbum(id);
    else if (album) render();
  }, 700);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__arcodgrab !== true) return;
    if (d.type === 'toggle') { toggle(); return; }
    if (d.type === 'command') { scCommand(d.action); return; }
    /* relay.js MAIN'den sonra yuklenir; acilista gonderilen rozet istegi
     * kaybolmus olabilir. Relay hazir olunca rozet yeniden yazilir. */
    if (d.type === 'relay-up' && host) syncQueueBadge();
  });
})();