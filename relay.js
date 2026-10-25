'use strict';

// MAIN world ile background arasindaki tek kanal bu darbocezdir.
// MAIN world chrome.* API'sine erisemedigi icin istekleri buradan iletiriz.

const TAG = '__arcodgrab';

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d[TAG] !== true) return;

  if (d.type === 'ready') {
    chrome.runtime.sendMessage({ type: 'arcodgrab:panel-ready' }).catch(() => {});
    return;
  }

  if (d.type === 'request' && d.id) {
    chrome.runtime
      .sendMessage({ type: d.req, args: d.args || {} })
      .then((res) => window.postMessage({ [TAG]: true, type: 'response', id: d.id, ok: true, res: res ?? null }, '*'))
      .catch((err) => window.postMessage({
        [TAG]: true, type: 'response', id: d.id, ok: false,
        error: String((err && err.message) || err),
      }, '*'));
  }
});

/* relay.js, arcod-grab.js'den SONRA yuklenir; panel acilista gonderdigi rozet
 * istegi kaybolmus olabilir. "Hazirim" diyerek MAIN world'e rozeti yeniden
 * yazdirir (veri tasimaz, yalnizca bildirim). */
window.postMessage({ [TAG]: true, type: 'relay-up' }, '*');

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'arcodgrab:toggle') return;
  window.postMessage({ [TAG]: true, type: 'toggle' }, '*');
});