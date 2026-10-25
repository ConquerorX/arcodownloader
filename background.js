'use strict';

const api = typeof browser !== 'undefined' && browser.downloads ? browser : chrome;
const MATCH = /^https:\/\/player\.arcod\.xyz\//;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !MATCH.test(tab.url || '')) {
    await chrome.tabs.create({ url: 'https://player.arcod.xyz/' });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'arcodgrab:toggle' });
    return;
  } catch {
    /* icerik betigi henuz yok (sekme eski kaldi / sayfa yukleniyor) */
  }

  await chrome.tabs.reload(tab.id);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'arcodgrab:toggle' });
      return;
    } catch { /* yeniden dene */ }
  }
});

/* Kullaniciya giden hata metinleri paneldedir (arcod-grab.js, I18N): burada
 * yalnizca kararlı bir 'code' (bad-url | bad-id | unknown) doner; 'error' TR
 * yedek metindir. Tarayicinin kendi hata mesaji (lastError) oldugu gibi gecer. */
/* Chrome'un downloads API'si geri cagirmayi (callback) kullanir ve
 * cagrildiginda undefined doner; Firefox'un browser.downloads API'si ise
 * promise doner. Ikisini de destekleyen tek sarmalayici.
 * DIKKAT: sadece .then() yazmak Chrome'da "Cannot read properties of
 * undefined (reading 'then')" ile tum komutlari patlatiyordu. */
function callApi(fn) {
  return new Promise((resolve) => {
    let settled = false;

    /* Chrome/Firefox geri cagirmasi TEK arguman alir ve o deger sonuctur
     * (or. downloadId); hata chrome.runtime.lastError icinde gelir.
     * Iki arguman verilirse node tarzi (hata, deger) kabul edilir. */
    function done(a, b) {
      if (settled) return;
      settled = true;
      let err = null;
      let val = a;
      if (arguments.length >= 2) { err = a; val = b; }
      let le = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          le = chrome.runtime.lastError;
        }
      } catch { /* yok */ }
      if (err || le) {
        const msg = (le && le.message) || (err && err.message) || err;
        resolve(msg
          ? { ok: false, error: String(msg) }
          : { ok: false, code: 'unknown', error: 'bilinmeyen hata' });
      } else {
        resolve({ ok: true, id: val });
      }
    }

    function fail(e) {                 // her zaman iki arguman: node hatasi
      if (settled) return;
      settled = true;
      const msg = (e && e.message) || e;
      resolve(msg
        ? { ok: false, error: String(msg) }
        : { ok: false, code: 'unknown', error: 'bilinmeyen hata' });
    }

    try {
      const r = fn(done);
      if (r && typeof r.then === 'function') r.then((v) => done(null, v), (e) => fail(e));
      else if (r !== undefined) done(null, r);            // dogrudan deger dondu
      /* undefined donduyse done() icin geri cagirmayi bekliyoruz */
    } catch (e) {
      fail(e);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  const a = msg.args || {};

  if (msg.type === 'arcodgrab:panel-ready') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;
    chrome.action.setBadgeText({ tabId, text: 'ON' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2f6f4f' }).catch(() => {});
    return;
  }

  /* panel kapandi: rozeti temizle (kullanici dugmeye tekrar basana kadar sessiz) */
  if (msg.type === 'arcodgrab:panel-closed') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  /* --- indirme sirasi sayaci: rozet "3" gosterir, sira bosken "ON" kalir --- */
if (msg.type === 'arcodgrab:queue-count') {
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return;
  const n = Number(a.count) || 0;
  chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : 'ON' })
    .catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: n > 0 ? '#3b6ea5' : '#2f6f4f' })
    .catch(() => {});
  return;
}

/* --- 'dl' kipi: akisi tarayicinin kendi indirme yoneticisine devret.
   * Tiket URL'si dosya yoneticisine dogrudan gonderilir; bellekte tutulmaz.
   * Firefox'ta File System Access API olmadigi icin bu tek yoldur. --- */
  if (msg.type === 'arcodgrab:download') {
    if (!/^https:\/\/player\.arcod\.xyz\//.test(a.url || '')) {
      sendResponse({ ok: false, code: 'bad-url', error: 'beklenmeyen adres' });
      return true;
    }
    callApi((cb) => api.downloads.download({
      url: a.url,
      filename: a.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    }, cb)).then(sendResponse);
    return true;
  }

  /* "Aci": indirmeyi isletim sisteminin varsayilan uygulamasinda ac. */
  if (msg.type === 'arcodgrab:open') {
    if (typeof a.id !== 'number') {
      sendResponse({ ok: false, code: 'bad-id', error: 'geçersiz indirme kimliği' });
      return true;
    }
    callApi((cb) => api.downloads.open(a.id, cb)).then(sendResponse);
    return true;
  }

  /* Indirmeler sayfasini ac; orada "Klasorde goster" dugmesi var. */
  if (msg.type === 'arcodgrab:show') {
    if (typeof a.id !== 'number') {
      sendResponse({ ok: false, code: 'bad-id', error: 'geçersiz indirme kimliği' });
      return true;
    }
    callApi((cb) => api.downloads.show(a.id, cb)).then(sendResponse);
    return true;
  }

  /* "Klasorde Goster" -> varsayilan Indirilenler klasorunu dosya yoneticisinde ac.
     (FSA ile kaydettigimizde dosyanin tam yolu JS'e acik degil; bu en yakin
     ve guvenilir yol) */
  if (msg.type === 'arcodgrab:show-folder') {
    callApi((cb) => api.downloads.showDefaultFolder(cb)).then(sendResponse);
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});