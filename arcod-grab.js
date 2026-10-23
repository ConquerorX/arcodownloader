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
    { id: 27, label: '24-bit · 192 kHz (en yüksek)', short: '24/192', depth: 24, rate: 192 },
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

  /* Ikon + etiketli dugme (Apple'in birincil eylem kalibi) */
  function iconBtn(cls, name, label, extra) {
    return `<button class="${cls}"${extra || ''}>${ICONS[name]}<span>${label}</span></button>`;
  }

  function setIcon(btn, name, label) {
    btn.innerHTML = ICONS[name];
    btn.classList.add('icon');
    if (label) { btn.title = label; btn.setAttribute('aria-label', label); }
  }

  /* Ikonlu bir dugmenin ETIKETINI degistirir.
   * textContent kullanmak dugmenin icindeki SVG'yi silerdi; bu yuzden
   * ikon + etiket her zaman birlikte yazilir. */
  function setBtnLabel(btn, icon, label) {
    if (!btn) return;
    btn.innerHTML = ICONS[icon] + '<span>' + escapeHtml(label) + '</span>';
  }

  const HIRES_LOGO = 'data:image/png;base64,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';
  const DEFAULT_TEMPLATE = '{n}. {title}{version} - {artist}.flac';

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
    },
    loadCfg(),
  );
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
  let bodyFolded = false; // govde katlandi mi (ayarlar sayfasinda da hatirlanir)
  const st = new Map(); // trackId -> durum nesnesi

  /* ---------------------------------------------------------- yardimcilar */

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }

  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* yoksay */ }
  }

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
      album: (album && album.title) || track.albumName || '',
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

  function removeFromQueue(id) {
    const n = queue.length;
    queue = queue.filter((q) => q.id !== id);
    if (queue.length !== n) saveQueue();
  }

  function clearQueue() {
    if (!queue.length) return;
    queue = [];
    saveQueue();
  }

  /* ara uc rozetinde kuyruk sayisi */
  function syncQueueBadge() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
    try {
      chrome.runtime.sendMessage({ type: 'arcodgrab:queue-count', count: queue.length });
    } catch { /* eklenti disi */ }
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
    if (!f.bits || !f.rate) return { short: 'bilinmiyor', cls: 'q-unk', rank: 0, name: 'kalite bilinmiyor' };
    const khzTxt = khzText(f.rate);
    const short = `${f.bits}-bit • ${khzTxt} kHz`;
    if (f.rate >= 176400) return { short, cls: 'q-max', rank: 4, name: 'hi-res · çok yüksek çözünürlük' };
    if (f.rate >= 96000) return { short, cls: 'q-hires', rank: 3, name: 'hi-res' };
    if (f.rate >= 48000) return { short, cls: 'q-enh', rank: 2, name: 'gelişmiş' };
    return { short, cls: 'q-cd', rank: 1, name: 'CD' };
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
  const PLACEHOLDERS = [
    { key: '{n}', title: 'Sıra numarası (01, 02…)' },
    { key: '{title}', title: 'Şarkı adı' },
    { key: '{version}', title: 'Sürüm / remix notu' },
    { key: '{artist}', title: 'Sanatçı' },
    { key: '{album}', title: 'Albüm adı' },
    { key: '{quality}', title: 'Kalite (24-bit 192 kHz)' },
    { key: '{qualityShort}', title: 'Kalite kısası (24-192)' },
    { key: '{isrc}', title: 'ISRC kodu' },
    { key: '{year}', title: 'Yıl' },
    { key: '{label}', title: 'Plak şirketi' },
  ];

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
      `<span class="qb ${q.cls}" title="${escapeHtml(q.name)}">${escapeHtml(q.short)}</span>` +
      `${hiresImg(f)}`;

    /* Rozetin bit/kHz'i zaten tasiyor; alt satira tekrarlamiyoruz.
     * Siran: sanatci · album · kanal · sure */
    const bits = [
      artist ? escapeHtml(artist) : '',
      t.album_name ? escapeHtml(t.album_name) : (t.album && t.album.name ? escapeHtml(t.album.name) : ''),
      f.ch === 1 ? 'mono' : f.ch === 2 ? 'stereo' : '',
      clock(f.dur),
    ].filter(Boolean);
    el.npSub.innerHTML = bits.join(' · ');
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
    npTrack = t;
    npId = t.id;
    renderNowPlaying();
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
    if (u8.length < 42) return { ok: false, why: 'ilk 42 bayt gelmedi' };
    const magic = String.fromCharCode.apply(null, u8.subarray(0, 4));
    if (magic !== 'fLaC') return { ok: false, why: `imza "${magic}" — fLaC degil` };

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

    if (!stream) return { ok: false, why: 'STREAMINFO blogu yok', blocks };

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

function describeHead(h) {
    if (!h || !h.ok) {
      return 'Okunamadı — ' + (h && h.why ? h.why : 'sebep belirtilmedi');
    }
    const khz = khzText(h.rate).replace('.', ',');
    const ch = h.ch === 1 ? 'mono' : h.ch === 2 ? 'stereo' : h.ch + ' kanal';
    const L = [`Gerçek ses: ${khz} kHz, ${h.bps}-bit, ${ch}, ${clock(h.seconds)}.`];

    if (h.md5Zero) {
      L.push('Dosya yeniden paketlenmiş (iç kontrol değeri sıfırlanmış). '
        + 'Ses sağlam, ama orijinal paket değil.');
    }
    if (!h.hasTags) {
      L.push('Dosyada etiket yok — şarkı adı ve sanatçı gibi bilgiler silinmiş.');
    }
    if (!h.md5Zero && h.hasTags) {
      L.push('Dosya orijinal görünüyor.');
    }
    return L.join(' ');
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
    if (!j || j.success === false || !j.data) throw new Error('album verisi yok');
    return j.data;
  }

async function ticket(id, quality) {
    const q = Number(quality || cfg.quality) || DEFAULT_QUALITY;
    const r = await fetch(`${API}/stream/${id}?quality=${q}`);
    if (!r.ok) throw new Error('ticket HTTP ' + r.status);
    const t = await r.json();
    if (!t || !t.url) throw new Error('ticket içinde url yok');
    return t;
  }

  async function openStream(id, signal) {
    const t = await ticket(id);
    const r = await fetch(t.url, { signal });
    if (!r.ok) {
      throw new Error(
        r.status === 502
          ? 'sunucu 502 verdi — sayfayi normal sekilde ac, sonra tekrar dene'
          : `ses HTTP ${r.status}`
      );
    }
    if (!r.body) throw new Error('akislanabilir govde yok (body null)');
    return {
      ct: r.headers.get('content-type') || '',
      total: Number(r.headers.get('content-length')) || 0,
      quality: t.quality,
      body: r.body,
    };
  }

  /* --------------------------------------------------------------- panel */

  const CSS = `
/* ===================================================================
   ARCOD Grab - Apple tasarim dili (Human Interface Guidelines)
   - Semantik renk jetonlari (acik/koyu otomatik)
   - Materyal yuzeyler (backdrop blur + saturate)
   - Ince (0.5px) ayirici cizgiler
   - Yuvarlak koseler, yumusak katmanli golgeler
   - SF Pro tipografi olcegi
   Not: bu blok bir JS sablon literali icinde yasar; icinde
   backtick veya dollar-suslu parantez acmasi OLMAZ.
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
  --sep:       rgba(84, 84, 88, 0.55);
  --label:     #ffffff;
  --label-2:   rgba(235, 235, 245, 0.72);
  --label-3:   rgba(235, 235, 245, 0.46);
  --accent:    #30d158;
  --accent-d:  #28a745;
  --blue:      #0a84ff;
  --gold:      #ffd60a;

  /* olcek */
  --r-win:  14px;
  --r-card: 12px;
  --r-ctl:   9px;
  --r-pill: 999px;
  --ind:    40px;   /* icerik girintisi: satir no + bosluk */
  --nw:     20px;   /* sira numarasi sutunu */

  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
          system-ui, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;

  color-scheme: dark;
}

/* ARCOD'un kendi arayuzu daima koyu tema. Paneli isletim sistemine
 * gore aciga cevirmek hem siteyle uyusmuyor hem de yerel arac
 * kutularini (acilan liste, kaydirma cubugu) beyaza ceviriyordu.
 * Bu yuzden panel HER ZAMAN koyu; renk semasi de acikca sabitlenir. */
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
  box-shadow: -1px 0 24px rgba(0, 0, 0, 0.28);
  /* Yerel arac kutulari (acilan liste, kaydirma cubugu, tarih secici)
   * bu degerden boyanir; :host'taki deger tek basina yeterli
   * olmadigi icin burada da sabitleniyor. */
  color-scheme: dark;
}

/* ------------------------------------------------------------ ust cubuk */
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 10px 0 12px;
  user-select: none;
  border-bottom: 0.5px solid var(--sep);
  background: var(--bg-solid);
}
.bar:active { cursor: grabbing; }

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
button:hover:not(:disabled) { background: rgba(120, 120, 128, 0.38); }
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
  color: #fff;
  background: var(--accent);
  font-weight: 600;
}
button.go:hover:not(:disabled) { background: var(--accent-d); }

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
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--accent);
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
.np .badges { margin-left: auto; }
.np .rsub { margin-top: 4px; }
/* "Su an caliyor" kartinda sira numarasi sutunu YOK; bu yuzden genel
 * .acts/.stat/.bar2 girintisi (--ind) burada yanlis olur. Kartin kendi
 * ic bosluğu (padding) yeterli. */
.np .acts { margin-top: 9px; padding: 0; }
.np .bar2 { margin: 7px 0 0; }
.np .stat { padding: 0; }

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
  text-align: right;
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
  padding: 0 11px 9px var(--ind);
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
  padding: 0 11px 9px var(--ind);
}

.rdet {
  padding: 10px 12px 11px var(--ind);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--label-2);
  border-top: 0.5px solid var(--sep);
}
.rfil {
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--label-3);
  word-break: break-all;
}
.rfacts { color: var(--label-2); }
.mono {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--label-3);
}

.prow {
  margin-top: 8px;
  padding: 9px 10px;
  font-size: 11.5px;
  line-height: 1.55;
  border-radius: var(--r-ctl);
  background: var(--raise-2);
  box-shadow: inset 0 0 0 0.5px var(--sep);
  color: var(--label);
}
.prow.ok  { color: var(--accent); }
.prow.err { color: #ff6961; }

/* ilerleme */
.stat {
  padding: 0 11px 9px var(--ind);
  font-size: 11.5px;
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.stat.err { color: #ff6961; }
.stat.ok  { color: var(--accent); }

.bar2, .gbar {
  height: 3px;
  border-radius: var(--r-pill);
  background: var(--fill);
  overflow: hidden;
}
.bar2 { margin: 0 11px 9px var(--ind); }
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
  word-break: break-word;
}
.gstat.err { color: #ff6961; }
.gstat.ok  { color: var(--accent); }
.gact { display: flex; gap: 6px; margin-top: 8px; }
.gtip { margin-top: 7px; font-size: 11.5px; color: var(--label-2); }

/* ------------------------------------------------------- kalite rozetleri */
.qb {
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 7px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: -0.01em;
  white-space: nowrap;
  border-radius: var(--r-pill);
}
.q-max   { color: #ffd60a; background: rgba(255, 214, 10, 0.14); }
.q-hires { color: #64d2ff; background: rgba(10, 132, 255, 0.15); }
.q-enh   { color: #30d158; background: rgba(48, 209, 88, 0.14); }
.q-cd    { color: #8e8e93; background: rgba(142, 142, 147, 0.16); }
.q-unk   { color: var(--label-3); background: var(--fill); }

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
  text-align: right;
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
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
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
  /* Bu satiri atlayan listede sistem AÇIK temaya donuyordu. */
  color-scheme: dark;
}
.pgroup > input#tpl {
  font-family: var(--mono);
  font-size: 12.5px;
}
.pgroup > select {
  padding-right: 30px;
  /* ozel ok isareti (aciklama ozelligi: appearance:none ile ok kaybolur) */
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238e8e93' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 10px 6px;
  cursor: pointer;
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
  left: 2px;
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
  color: var(--blue);
  background: rgba(10, 132, 255, 0.12);
}
.chip:hover:not(:disabled) { background: rgba(10, 132, 255, 0.22); }

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
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
:host([data-easy="1"]) .bar { min-height: 62px; padding: 0 14px 0 18px; gap: 12px; }
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
:host([data-easy="1"]) .qb { height: 28px; padding: 0 12px; font-size: 14px; }
:host([data-easy="1"]) .hires { width: 32px; height: 32px; }
:host([data-easy="1"]) .dis { width: 40px; height: 40px; }
:host([data-easy="1"]) .dis svg { width: 18px; height: 18px; }
:host([data-easy="1"]) .racts { padding: 0 15px 12px var(--ind); gap: 10px; }
:host([data-easy="1"]) .acts { padding: 0 15px 12px var(--ind); gap: 10px; }
:host([data-easy="1"]) .rdet { padding: 12px 15px 14px var(--ind); font-size: 15px; }
:host([data-easy="1"]) .stat { padding: 0 15px 12px var(--ind); font-size: 16px; }
:host([data-easy="1"]) .bar2 { margin: 0 15px 12px var(--ind); height: 5px; }
:host([data-easy="1"]) .np .acts { padding: 0; }
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
:host([data-easy="1"]) .swbox::after { width: 30px; height: 30px; top: 3px; left: 3px; }
:host([data-easy="1"]) .sw input:checked + .swbox::after { transform: translateX(26px); }
:host([data-easy="1"]) .swtxt b { font-size: 19px; }
:host([data-easy="1"]) .swtxt span { font-size: 15px; }
:host([data-easy="1"]) .chip { height: 42px; padding: 0 16px; font-size: 16px; border-radius: 12px; }
:host([data-easy="1"]) .chips { gap: 8px; padding: 12px 16px 0; }
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
`;

  let host = null;
  let sh = null;
  let el = {};

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'arcod-grab-host';
    sh = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="bar">
        <span class="dot"></span>
        <span class="title">ARCOD Grab</span>
        <button class="mini hide" id="queueBtn" title="sıradaki tüm parçaları indir">${ICONS.list}<span>Tümünü İndir</span></button>
        <button class="mini hide" id="albumBtn" title="albümün tüm parçalarını klasöre indir">${ICONS.music}<span>albümü indir</span></button>
        <button class="mini" id="cfgBtn"></button>
        <button class="mini" id="foldBtn"></button>
      </div>
<div class="body">
          <div class="np hide" id="npBox">
            <div class="nplabel">şu an çalıyor</div>
            <div class="nphead">
              <span class="npdot"></span>
              <span class="tt" id="npTitle"></span>
              <span class="badges" id="npBadges"></span>
            </div>
            <div class="rsub" id="npSub"></div>
            <div class="acts">
              ${iconBtn('go', 'download', 'indir', ' data-a="npdl"')}
              ${iconBtn('mini', 'queueAdd', 'sıraya ekle', ' data-a="npq"')}
              <span class="racts" data-a="acts"></span>
            </div>
            <div class="bar2 hide"><div class="fill"></div></div>
            <div class="stat"></div>
          </div>
          <div class="meta" id="meta">yükleniyor…</div>
        <div class="gstat" id="gstat"></div>
        <div class="gbar hide" id="gbar"><div class="gfill" id="gfill"></div></div>
        <div class="gact hide" id="gact"></div>
        <div id="rows" class="rows"></div>
        <div class="qbox hide" id="qbox">
          <div class="qhead">
            <span id="qcount">sıra boş</span>
            <button class="mini" id="qclear">${ICONS.trash}<span>temizle</span></button>
          </div>
          <div id="qlist" class="qlist"></div>
        </div>
        </div>

        <!-- ===== AYARLAR SAYFASI (ayri gorunum) ===== -->
        <div class="page hide" id="pageSet">
          <div class="phead">
            <button class="mini" id="setBack">${ICONS.back}<span>geri</span></button>
            <span class="ptitle">ayarlar</span>
          </div>
          <div class="pbody">

            <div class="pgroup">
              <div class="pgt">görünüm</div>

              <label class="sw" for="swEasy">
                <input type="checkbox" id="swEasy">
                <span class="swbox"></span>
                <span class="swtxt">
                  <b>Kolay Mod</b>
                  <span>Görme engelliler için: daha büyük yazı, yüksek kontrast ve
                  büyük dokunma hedefleri. İçerik gizlenmez.</span>
                </span>
              </label>

              <label class="sw" for="swNp">
                <input type="checkbox" id="swNp">
                <span class="swbox"></span>
                <span class="swtxt">
                  <b>Şu an çalıyor kartı</b>
                  <span>Sayfanın altındaki oynatıcıyı izleyip çalan parçayı gösterir.
                  Kapatırsan oynatıcı hiç okunmaz.</span>
                </span>
              </label>
            </div>

            <div class="pgroup">
              <div class="pgt">indirme kalitesi</div>

              <label for="qual">kalite tavanı</label>
              <select id="qual"></select>
              <div class="hint" id="qualHint"></div>
            </div>

            <div class="pgroup">
              <div class="pgt">dosya adı</div>

              <label for="tpl">şablon</label>
              <input id="tpl" spellcheck="false" autocomplete="off">
              <div class="chips" id="chips"></div>
              <div class="pv">
                <span class="pvl">örnek</span>
                <span class="pvf" id="tplPrev">—</span>
              </div>
            </div>

            <div class="pgroup">
              <div class="pgt">nasıl kaydedilsin</div>
              <select id="smode"></select>
              <div class="hint" id="smodeHint"></div>
            </div>

            <div class="pgroup">
              <div class="pgt">hakkında</div>
              <div class="hint">
                ARCOD Grab · <b>Emre Dural</b><br>
                ARCOD’un sayfası içinde çalışan bir indirme yardımcısıdır.
                Hiçbir veri sunucuya gönderilmez.
              </div>
            </div>

          </div>
        </div>

        <div class="credit">ARCOD Grab · <b>Emre Dural</b> tarafından yapıldı</div>`;

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
    setIcon(el.cfgBtn, 'settings', 'ayarlar');
    setIcon(el.foldBtn, 'minus', 'paneli katla');

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
      setGlobal('sıra temizlendi', 'ok');
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
      setGlobal(cfg.easy ? 'Kolay Mod açık' : 'Kolay Mod kapalı', 'ok');
    });

    /* --- su an caliyor karti anahtari --- */
    const swNp = sh.getElementById('swNp');
    swNp.checked = cfg.nowPlaying !== false;
    swNp.addEventListener('change', () => {
      cfg.nowPlaying = swNp.checked;
      saveCfg();
      applyNowPlaying();
      setGlobal(cfg.nowPlaying ? 'çalan takip ediliyor' : 'çalan takibi kapalı', 'ok');
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

    el.tpl.addEventListener('input', () => commitTemplate(false));
    el.tpl.addEventListener('change', () => commitTemplate(true));

    /* Yer tutucu dugmeleri: imlecin bulundugu yere yazar. Boylece kullanici
     * sira istemeden yerlestirebiliyor, sonra textbox'ta serbestce
     * duzenleyebiliyor (orn. {quality}yi {artist} oncesine cekmek). */
    const chipBox = sh.getElementById('chips');
    for (const ph of PLACEHOLDERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = ph.key;
      b.title = ph.title;
      b.addEventListener('click', () => {
        const s0 = el.tpl.selectionStart == null ? el.tpl.value.length : el.tpl.selectionStart;
        const s1 = el.tpl.selectionEnd == null ? s0 : el.tpl.selectionEnd;
        el.tpl.value = el.tpl.value.slice(0, s0) + ph.key + el.tpl.value.slice(s1);
        const at = s0 + ph.key.length;
        el.tpl.focus();
        el.tpl.setSelectionRange(at, at);
        commitTemplate(true);
      });
      chipBox.appendChild(b);
    }

    /* ---- kalite tavani secimi ---- */
    el.qual = sh.getElementById('qual');
    el.qualHint = sh.getElementById('qualHint');
    for (const q of QUALITY_PRESETS) {
      const o = document.createElement('option');
      o.value = String(q.id);
      o.textContent = q.label;
      el.qual.appendChild(o);
    }
    el.qual.value = String(cfg.quality);
    function applyQualityHint() {
      const q = qualityPreset(cfg.quality);
      el.qualHint.innerHTML =
        `Sunucu bu tavanı <b>kaydın kendi çözünürlüğüyle kesiştirir</b>. `
        + `Yani 24/192 istesen bile CD kayıt 16/44.1 gelir; `
        + `24/96 tavanı ise 24/176.4 kaydı yine tam kalitede verir. `
        + `Düşük tavan = daha küçük dosya, daha hızlı indirme.`;
    }
    applyQualityHint();
    el.qual.addEventListener('change', () => {
      cfg.quality = Number(el.qual.value);
      saveCfg();
      previewTemplate();
      setGlobal('kalite tavanı: ' + qualityPreset(cfg.quality).label, 'ok');
    });

    previewTemplate();

    /* kaydetme kipi secicisi (FSA varsa secilebilir) */
    el.smode = sh.getElementById('smode');
    el.smodeHint = sh.getElementById('smodeHint');
    for (const [val, label] of [
      ['auto', `otomatik — bu tarayıcıda ${HAS_FSA ? 'doğrudan diske' : 'tarayıcı indirmesi'}`],
      ...(HAS_FSA ? [['dl', 'tarayıcı indirmesi (doğrudan diske yazmaz)']] : []),
      ...(HAS_FSA ? [['fsa', 'doğrudan diske (hedef seç, kayma yok)']] : []),
    ]) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      el.smode.appendChild(o);
    }
    el.smode.value = cfg.saveMode;
    el.smodeHint.innerHTML = HAS_FSA
      ? 'FSA = doğrudan diske akıtır, <b>kayma olmaz</b>, ama her seferinde hedef seçersin.'
      : 'Bu tarayıcı File System Access API desteklemiyor (Firefox). '
        + 'İndirmeler tarayıcının kendi yöneticisine devredilir: <b>kayma yok, bellek şişmez</b>, '
        + 'Aç düğmesi dosyayı sistemde açar.';
    el.smode.addEventListener('change', () => {
      cfg.saveMode = el.smode.value;
      saveCfg();
    });

    el.foldBtn.addEventListener('click', () => {
      bodyFolded = !bodyFolded;
      sh.querySelector('.body').classList.toggle('hide', bodyFolded);
      setIcon(el.foldBtn, bodyFolded ? 'plus' : 'minus', bodyFolded ? 'paneli aç' : 'paneli katla');
    });

    /* --- su an caliyor kartinin butonlari --- */
    el.npDl.addEventListener('click', () => {
      const t = npTrack;
      if (!t) return;
      if (active && String(active.id) === String(t.id)) cancelActive();
      else download(t, trackArtist(t), nowPlayingRowState());
    });
    el.npQ.addEventListener('click', () => {
      if (!npTrack) return;
      addToQueue(npTrack);
      setBtnLabel(el.npQ, 'queueAdd', 'sıraya eklendi');
      setTimeout(() => { setBtnLabel(el.npQ, 'queueAdd', 'sıraya ekle'); }, 1400);
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

  /* Panel genisligi: ekrana gore. Kolay Mod'da daha genis (daha buyuk
   * yazi icin), dar ekranda da makul bir oran. */
  function panelWidth() {
    const vw = Math.max(320, window.innerWidth || 1200);
    if (cfg.easy) return Math.round(Math.min(760, Math.max(480, vw * 0.42)));
    return Math.round(Math.min(640, Math.max(400, vw * 0.34)));
  }

  function applySplit() {
    if (!host) return;
    const w = panelWidth();
    const doc = document.documentElement;

    /* Panelin kendi genisligini bagla (CSS: .wrap { width: var(--ag-w) }) */
    host.style.setProperty('--ag-w', w + 'px');

    /* -- 1) sayfa stilini enjekte et ---------------------------------- */
    let st = document.getElementById(SPLIT_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = SPLIT_ID;
      (document.head || doc).appendChild(st);
    }
    st.textContent = [
      'html[data-arcod-split] { margin-right: ' + w + 'px !important; }',
      'html[data-arcod-split], html[data-arcod-split] body { overflow-x: hidden !important; }',
      'html[data-arcod-split] body { max-width: 100% !important; }',
    ].join('\n');
    doc.setAttribute('data-arcod-split', '1');
    doc.style.setProperty('--arcod-panel-w', w + 'px');

    /* -- 2) site kabuğunu kaydir -------------------------------------- */
    shiftSiteChrome(w);

    /* SPA gezinince yeni sabit ogeler dogar; degisimleri izle. */
    if (!splitMo) {
      splitMo = new MutationObserver(() => {
        if (splitTimer) return;
        splitTimer = setTimeout(() => { splitTimer = 0; shiftSiteChrome(panelWidth()); }, 250);
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
   *     -> `right` degerini panel kadar kaydir.
   *
   *  2) `width: 100vw` kullanan akis kapsayicilari. 100vw de viewport
   *     birimidir, yine margin'den etkilenmez ve panelin altina tasar.
   *     -> `max-width: 100%` ile ana cudeye sabitleriz.
   *
   * Yalnizca gercekten viewport genisligine sahip ogeleri hedefliyoruz;
   * dar icerikli kutulara dokunmuyoruz. */
  function shiftSiteChrome(w) {
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
      if (n.getAttribute(SPLIT_ATTR) === String(w)) continue;
      let cs, rect;
      try {
        cs = getComputedStyle(n);
        rect = n.getBoundingClientRect();
      } catch { continue; }
      if (cs.position === 'fixed') {
        const r = parseFloat(cs.right);
        if (r === 0 || r === 0.0) { fixRight.push(n); continue; }
      }
      /* viewport'a esit genislikteki akis kapsayicilari (100vw vb.) */
      if (rect.width >= esik) fixWidth.push(n);
    }

    for (let i = 0; i < fixRight.length; i++) {
      const n = fixRight[i];
      n.setAttribute(SPLIT_ATTR, String(w));
      n.style.setProperty('right', w + 'px', 'important');
    }
    for (let i = 0; i < fixWidth.length; i++) {
      const n = fixWidth[i];
      if (host && (n === host || host.contains(n))) continue;
      n.setAttribute(SPLIT_ATTR, String(w));
      n.style.setProperty('max-width', '100%', 'important');
    }
  }

  function removeSplit() {
    const st = document.getElementById(SPLIT_ID);
    if (st) st.remove();
    document.documentElement.removeAttribute('data-arcod-split');
    document.documentElement.style.removeProperty('--arcod-panel-w');
    /* mudahile ettigimiz her seyi geri al */
    let list;
    try { list = document.body ? document.body.querySelectorAll('[' + SPLIT_ATTR + ']') : []; } catch { list = []; }
    for (let i = 0; i < list.length; i++) {
      list[i].removeAttribute(SPLIT_ATTR);
      list[i].style.removeProperty('right');
      list[i].style.removeProperty('max-width');
    }
    if (splitMo) { splitMo.disconnect(); splitMo = null; }
  }

  function toggle() {
    if (host) {
      removeSplit();
      host.remove();
      host = null; sh = null; el = {};
      return false;
    }
    build();
    applySplit();
    loadAlbum(albumIdFromUrl());
    return true;
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
    if (!el.gstat) return;
    el.gstat.innerHTML = html;
    el.gstat.className = 'gstat' + (cls ? ' ' + cls : '');
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
        resolve(d.ok ? d.res : { ok: false, bridgeError: true, error: d.error || 'arka uç yanıt vermedi' });
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ [TAG]: true, type: 'request', id, req: kind, args }, '*');
      setTimeout(() => {
        if (bitti) return;
        window.removeEventListener('message', onMsg);
        /* relay hic yanit vermedi: ya sayfada degil ya da relay.js yüklenmedi */
        resolve({
          ok: false, bridgeError: true,
          error: 'köprü yanıt vermedi — sayfayı F5 ile yenile (relay.js yeniden yüklenir)',
        });
      }, limit);
    });
  }

  /* kopru hatasi icin tek, anlasilir mesaj */
  function bridgeMsg(r, what) {
    if (r && r.bridgeError) return r.error;
    if (r && r.error) return r.error;
    return 'bilinmeyen hata';
  }

  async function showDefaultFolder() {
    const r = await bridgeCall('arcodgrab:show-folder');
    if (r && r.ok) return true;
    setGlobal(
      'Klasör açılamadı: ' + escapeHtml(bridgeMsg(r, 'show-folder')),
      'err');
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
    setGlobal('Açılamadı: ' + escapeHtml(bridgeMsg(r, 'open')), 'err');
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
    ac.innerHTML = ICONS.play + '<span>Aç</span>';
    ac.disabled = !res.handle && res.downloadId == null;
    ac.title = res.handle
      ? 'varsayılan oynatıcıda aç'
      : res.downloadId != null
        ? 'varsayılan oynatıcıda aç'
        : 'dosya tutucusu yok';
    ac.addEventListener('click', () => openResult(res));

    const klas = document.createElement('button');
    klas.className = 'mini';
    klas.innerHTML = ICONS.folder + '<span>Klasörde Göster</span>';
    klas.title = res.downloadId != null
      ? 'indirmeler sayfasını açar (orada Klasörde göster var)'
      : 'varsayılan İndirilenler klasörünü açar';
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
      if (!w) setGlobal('Yeni sekme engellendi — dosya: <b>' + escapeHtml(res.name) + '</b>', 'err');
    } catch (e) {
      setGlobal('Açılamadı: ' + escapeHtml(e.message), 'err');
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
      .join('  ·  ') || (tracks.length ? 'kalite bilgisi yok' : '');

    const top = [...mix.entries()].sort((x, y) => y[1] - x[1])[0];
    const karisik = mix.size > 1;

    const label = str((a.label || {}).name) || '';
    const gl = Array.isArray(a.genres_list) ? a.genres_list : [];
    const genre = gl.length ? (gl[gl.length - 1].name || '') : ((a.genre || {}).name || '');
    const year = releasedYear(a) || '';
    const cover = coverOf(a);

el.meta.innerHTML =
      `<div class="mhead">` +
      (cover ? `<img class="cover" src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer">` : '') +
      `<div class="minfo">` +
      `<div class="mtitle">${escapeHtml(a.title || '')}` +
      (year ? ` <span class="ver">${escapeHtml(year)}</span>` : '') + `</div>` +
      `<div class="martist">${escapeHtml(artist || '')}</div>` +
      `</div>` +
      `</div>` +
      `<div class="bstats">` +
      `<span><b>${tracks.length}</b> parça</span>` +
      `<span><b>${clock(totalSn)}</b> toplam</span>` +
      (a.upc ? `<span class="mono">UPC ${escapeHtml(a.upc)}</span>` : '') +
      `</div>` +
      `<div class="mix ${karisik ? 'warn' : ''}" title="parçaların kalite dağılımı">` +
      escapeHtml(mixTxt) + (unknown ? `  ·  ${unknown}° bilinmiyor` : '') + `</div>` +
      (karisik ? `<div class="mixnote">⚠ kaliteler karışık — hepsi en yüksek kalitede değil</div>` : '') +
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
      if (f.label) facts.push('label ' + escapeHtml(f.label));
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
        `<span class="qb ${q.cls}" title="${escapeHtml(q.name)}">${escapeHtml(q.short)}</span>` +
        `<span class="rinfo">` +
        `${f.bits ? escapeHtml(f.ch === 1 ? 'mono' : f.ch === 2 ? 'stereo' : f.ch + ' kanal') : escapeHtml(specOf(t))}` +
        `${f.isrc ? ` · <span class="mono">${escapeHtml(f.isrc)}</span>` : ''}` +
        `</span></span>` +
        `</span>` +
        `<span class="rmeta">` +
        `${hiresImg(f)}` +
        `<span class="dur">${clock(f.dur)}</span>` +
        iconBtn('mini', 'download', 'indir', ' data-a="dl"') +
        /* Satiri acan dugme AYRI bir kontrol. Satir basligi role=button
         * olsaydi icindeki "indir" dugmesiyle ic ice etkilesimli olurdu
         * (gecersiz ARIA + tiklamada detay panelinin de acilmasi). */
        `<button class="dis" data-a="toggle" aria-expanded="false"` +
        ` aria-label="ayrıntılar" title="ayrıntılar">${ICONS.chevron}</button>` +
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
        ` title="İndirmeden önce akışın gerçek kalitesini okur: bit derinliği, örnekleme hızı ve dosyanın bozulup bozulmadığı">` +
        `${ICONS.check}<span>dosyayı doğrula</span></button>` +
        `<span class="prow hide"></span></div>` +
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
      setStat(active.id, 'durduruldu', 'err');
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
      if (on) setBtnLabel(s.dlBtn, 'download', 'indir');
    }

    /* "su an caliyor" karti st tablosunda degil; ayrica yonetilir */
    if (el.npDl && npTrack) {
      const on = idle || String(npTrack.id) === String(activeId);
      el.npDl.disabled = !on;
      if (el.npQ) el.npQ.disabled = !on;
      if (on) setBtnLabel(el.npDl, 'download', 'indir');
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
    if (s.row) { s.row.classList.add('open'); if (s.det) s.det.classList.remove('hide'); }
    say('Okunuyor…');

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
      say(escapeHtml(describeHead(head)), head.ok ? 'ok' : 'err');
    } catch (e) {
      say('✗ ' + escapeHtml(e.message), 'err');
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
      if (rb) setBtnLabel(rb.dlBtn, 'download', 'durdur');
      msg('indirme yöneticisine devrediliyor…');
      try {
        const r = await saveViaDownloads(t, artist, null);
        if (!r.ok) {
          msg('✗ ' + escapeHtml(r.error), 'err');
        } else {
          msg(`✓ indiriliyor · ${escapeHtml(r.name)} · tarayıcı indirmelerinde`, 'ok');
          lastResult = r;
          if (onRow && s.acts) renderResultButtons(s.acts, r);
          else if (el.gact) { renderResultButtons(el.gact, r); el.gact.classList.remove('hide'); }
        }
      } catch (e) {
        msg('✗ ' + escapeHtml(e.message), 'err');
      } finally {
        if (rb) setBtnLabel(rb.dlBtn, 'download', 'indir');
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
          types: [{ description: 'FLAC ses', accept: { 'audio/flac': ['.flac'] } }],
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
    if (rowBtn) setBtnLabel(rowBtn.dlBtn, 'download', 'durdur');
    bar(0);
    msg('ticket alınıyor…');

    let writable = null;
    const parts = [];
    let written = 0;
    let declared = 0;
    const t0 = performance.now();
    let tick = 0;

    try {
      const stream = await openStream(t.id, ctl.signal);
      declared = stream.total;
      msg(`akış açık · ${mb(declared)} bekleniyor · kalite ${stream.quality}`);

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
            `${isFinite(eta) ? '  kalan ' + clock(eta) : ''}`);
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
        `${ok ? '✓ tamamlandı' : '⚠ boyut uyuşmuyor'} · ${escapeHtml(suggested)} · ` +
        `${mb(written)}${declared ? ' / beyan ' + mb(declared) : ''} · ${secs.toFixed(1)} sn`,
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
        aborted ? `durduruldu · ${mb(written)} yazıldı`
          : '✗ ' + escapeHtml(e.message),
        'err');
    } finally {
      bar(written, false);
      if (rowBtn) setBtnLabel(rowBtn.dlBtn, 'download', 'indir');
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
    span.textContent = 'ARCOD Grab ile indir';

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
      btn.title = 'bu parça zaten sırada';
    } else {
      btn.title = 'listeye ekle, sonra hepsini tek tek indir';
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
    span.textContent = zaten ? 'sırada ✓' : 'İndirme Sırasına Ekle';

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

    if (!host) { build(); }
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

    if (!host) { build(); }
    const eklendi = addToQueue(track);
    renderQueue();
    setGlobal(
      eklendi
        ? `✓ sıraya eklendi · ${escapeHtml(track.title || '')} · ${queue.length} parça`
        : `sırada zaten var · ${escapeHtml(track.title || '')}`,
      eklendi ? 'ok' : 'err');
  }

  /* Uygulama her sag tik icin birden fazla contextmenu olayi yeniden yayinlar ve
   menu acilirken rect animasyon sirasinda kucuk olup "yok" sayilabilir. Bu
   yuzden track bulunamayan olaylarda HICBIR seyi silmiyoruz: gecis noktasi
   degil. Bayat dugme zararsizdir, cunku her attachCtxItem once kendini temizler. */
  document.addEventListener('contextmenu', (ev) => {
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
    el.queueBtn.innerHTML = ICONS.list + '<span>'
      + (albumJob && albumJob.kind === 'queue' ? 'durdur' : 'Tümünü İndir') + '</span>';
    el.queueBtn.title = n ? `${n} parça · en yüksek kalitede (quality 27)` : '';

    el.qbox.classList.toggle('hide', n === 0);
    if (!n) {
      el.qcount.textContent = 'sıra boş';
      el.qlist.textContent = '';
      return;
    }

    el.qcount.textContent = `${n} parça sırada`;

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
      t.textContent = q.title || '(başlıksız)';
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
      rm.innerHTML = ICONS.trash + '<span>çıkar</span>';
      rm.title = 'sıradan çıkar';
      rm.setAttribute('aria-label', 'sıradan çıkar');
      rm.addEventListener('click', () => { removeFromQueue(q.id); renderQueue(); });

      row.append(no, info, qb, rm);
      el.qlist.appendChild(row);
    });

    /* sira toplami: yalnizca sure (boyut bilgisi API'de yok) */
    const tsn = queue.reduce((a, q) => a + (q.dur || 0), 0);
    el.qcount.textContent = `${n} parça sırada` + (tsn ? ` · ${clock(tsn)}` : '');
  }

  /* "Tümünü İndir" — sıradaki her parcayi indirme yoneticisine devreder.
   *
   * Bilerek daima 'dl' yolu kullanilir: 'fsa' kipinde her parca icin ayri
   * dosya secme penceresi acilirdi, 20 parcalik bir sira kullanilamaz olurdu.
   * Indirme yoneticisi klasoru kendisi kurar, hicbir sey sormaz. */
  async function downloadQueue() {
    if (!queue.length) { setGlobal('sıra boş', 'err'); return; }
    if (active || albumJob) return;

    const islem = queue.slice();                  // kopyasini indir, listeden silme
    const ctl = new AbortController();
    albumJob = {
      ctl, total: islem.length, ok: 0, fail: 0,
      folderName: QUEUE_FOLDER, kind: 'queue',
    };
    syncAlbumBtn();
    renderQueue();
    setRowsEnabled(null);
    setGlobal(`sıra indiriliyor → <b>${escapeHtml(QUEUE_FOLDER)}/</b> · 0/${islem.length}`);

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
    syncAlbumBtn();
    setRowsEnabled(null);

    const ozet = `${job.ok}/${job.total} gönderildi` + (job.fail ? `, ${job.fail} hata` : '');
    if (cancelled) setGlobal(`durduruldu · ${ozet} → <b>${escapeHtml(QUEUE_FOLDER)}/</b>`, 'err');
    else if (job.fail) setGlobal(`bitti (hatalı var) · ${ozet} → <b>${escapeHtml(QUEUE_FOLDER)}/</b>`, 'err');
    else setGlobal(`✓ sıra tamam · ${ozet} → <b>${escapeHtml(QUEUE_FOLDER)}/</b> klasöründe`, 'ok');
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
        el.albumBtn.innerHTML = ICONS.music + '<span>'
          + ((albumJob && albumJob.kind !== 'queue') ? 'durdur' : 'albümü indir') + '</span>';
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
      syncAlbumBtn();
      setRowsEnabled(null);
      setGlobal(`albüm indiriliyor → <b>${escapeHtml(folderName)}/</b> · 0/${tracks.length}`);

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
      syncAlbumBtn();
      setRowsEnabled(null);
      const ozet2 = `${job2.ok}/${job2.total} başlatıldı` +
        (job2.fail ? `, ${job2.fail} hata` : '');
      if (cancelled2) setGlobal(`durduruldu · ${ozet2} → <b>${escapeHtml(folderName)}/</b>`, 'err');
      else if (job2.fail) setGlobal(`bitti (hatalı parçalar var) · ${ozet2} → <b>${escapeHtml(folderName)}/</b>`, 'err');
      else setGlobal(`✓ albüm gönderildi · ${ozet2} → <b>${escapeHtml(folderName)}/</b> klasöründe`, 'ok');
      return;
    }

    if (!HAS_FSA) {
      setGlobal('Bu tarayıcı klasör seçmeyi desteklemiyor.', 'err');
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
      setGlobal('Klasör oluşturulamadı: ' + escapeHtml(e.message), 'err');
      return;
    }

    const artist = albumArtist(album);
    const ctl = new AbortController();
    albumJob = { ctl, total: tracks.length, ok: 0, fail: 0, folderName };
    syncAlbumBtn();
    setRowsEnabled(null);
    setGlobalBar(0, true);
    setGlobal(`albüm indiriliyor → <b>${escapeHtml(folderName)}/</b> · 0/${tracks.length}`);

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
    syncAlbumBtn();
    setRowsEnabled(null);
    setGlobalBar(0, false);

    const ozet = `${job.ok}/${total} indirildi` +
      (job.fail ? `, ${job.fail} hata` : '');
    if (cancelled) {
      setGlobal(`durduruldu · ${ozet} → <b>${escapeHtml(fn)}/</b>`, 'err');
    } else if (job.fail) {
      setGlobal(`bitti (hatalı parçalar var) · ${ozet} → <b>${escapeHtml(fn)}/</b>`, 'err');
    } else {
      setGlobal(`✓ albüm tamam · ${ozet} → <b>${escapeHtml(fn)}/</b> klasöründe`, 'ok');
    }

    if (job.ok > 0) {
      el.gact.textContent = '';
      const klas = document.createElement('button');
      klas.className = 'mini';
      klas.innerHTML = ICONS.folder + '<span>Klasörde Göster</span>';
      klas.title = 'varsayılan İndirilenler klasörünü açar';
      klas.addEventListener('click', () => showDefaultFolder());
      el.gact.append(klas);
      el.gact.classList.remove('hide');
    }
  }

  /* -------------------------------------------------------------- SPA gez */

  async function loadAlbum(id) {
    albumId = id;
    syncAlbumBtn();
    if (!id) {
      build();
      syncAlbumBtn();
      album = null;
      el.rows.textContent = '';
      el.meta.textContent = 'parça listesinden bir şarkıya sağ tıkla';
      setGlobal('İndirmek istediğin parçaya <b>sağ tık</b> → <b>ARCOD Grab ile indir</b>.' +
        '<br>Bir albüm açarsan (…/album/&lt;UPC&gt;) liste burada da çıkar.');
      renderQueue();
      syncQueueBadge();
      return;
    }
    build();
    el.meta.textContent = 'albüm yükleniyor…';
    try {
      album = await getAlbum(id);
      render();
      syncAlbumBtn();
    } catch (e) {
      album = null;
      el.meta.innerHTML = `✗ albüm okunamadı: ${escapeHtml(e.message)}`;
      el.rows.textContent = '';
    }
  }

  build();
  applySplit();
  loadAlbum(albumIdFromUrl());

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
    const id = albumIdFromUrl();
    if (id !== albumId) loadAlbum(id);
    else if (album) render();
  }, 700);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__arcodgrab !== true || d.type !== 'toggle') return;
    toggle();
  });

  window.postMessage({ __arcodgrab: true, type: 'ready' }, '*');
})();