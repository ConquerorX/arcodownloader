'use strict';

/* MAIN world, document_start: sayfanin ses kaynaklarini PASIF olarak kaydeder.
 * Hicbir otomatik aksiyon almaz; sayfa davranisini degistirmez (orijinal
 * fonksiyonlar Proxy ile sarilir: ad/length/prototype/new.target korunur).
 *
 * Yuzey: window'da kalici bir ad/ozellik YOKTUR. Durum bu kapanista yasar;
 * arcod-grab.js tek seferlik bir el sikisma ile erisim alir: CustomEvent
 * '__arcodgrab:media' (detail.cb) -> ilk talep eden alir, sonrakiler yok sayilir.
 * Not: ayni dunyada calisan sayfa betigi eklentiden once talep ederse yuzeyi
 * ele gecirebilir; bu, MAIN world'un dogasi geregi tamamen engellenemez. Yuzey
 * yalnizca ses okuma/ayarlama sunar, ag/depolama/DOM erisimi sunmaz. */
(function () {
  const CLAIM = '__arcodgrab:media';
  if (window[Symbol.for('arcodgrab.media.hook')]) return;     // cift yukleme korumasi
  try {
    Object.defineProperty(window, Symbol.for('arcodgrab.media.hook'), { value: true });
  } catch { /* yoksay */ }

  const els = [];                       // WeakRef<HTMLMediaElement>
  const seen = new WeakSet();
  const routedEls = new WeakSet();      // createMediaElementSource ile Web Audio'ya alinmis
  const masters = new WeakMap();        // ctx -> ana GainNode
  const ctxs = [];                      // WeakRef<AudioContext>
  const viaMaster = new WeakMap();      // dugum -> Set<ctx> (destination yerine master'a bagli)

  function reg(el) {
    try {
      if (!el || seen.has(el)) return;
      seen.add(el);
      els.push(new WeakRef(el));
    } catch { /* yoksay */ }
  }

  function wrap(obj, name, make) {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== 'function') return;
      const desc = Object.getOwnPropertyDescriptor(obj, name);
      if (desc && desc.configurable === false && desc.writable === false) return;
      obj[name] = new Proxy(orig, make(orig));
    } catch { /* yoksay */ }
  }

  /* ---- HTMLMediaElement ---- */
  wrap(HTMLMediaElement.prototype, 'play', () => ({
    apply(t, self, args) { reg(self); return Reflect.apply(t, self, args); },
  }));

  try {
    if (typeof window.Audio === 'function') {
      window.Audio = new Proxy(window.Audio, {
        construct(t, args, nt) {
          const el = Reflect.construct(t, args, nt);
          reg(el);
          return el;
        },
      });
    }
  } catch { /* yoksay */ }

  wrap(Document.prototype, 'createElement', () => ({
    apply(t, self, args) {
      const el = Reflect.apply(t, self, args);
      try {
        const n = el && el.localName;
        if (n === 'audio' || n === 'video') reg(el);
      } catch { /* yoksay */ }
      return el;
    },
  }));

  /* ---- Web Audio ---- */
  const AC = window.AudioContext || window.webkitAudioContext;
  const realCtx = (c) => {
    try { return !!AC && c instanceof AC; } catch { return false; }     // OfflineAudioContext haric
  };

  function masterOf(ctx) {
    let g = masters.get(ctx);
    if (g) return g;
    g = ctx.createGain();
    g.gain.value = 1;
    origConnect.call(g, ctx.destination);       // sarmalayiciyi atlar
    masters.set(ctx, g);
    ctxs.push(new WeakRef(ctx));
    return g;
  }

  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;

  wrap(AudioNode.prototype, 'connect', (orig) => ({
    apply(t, self, args) {
      try {
        const dest = args[0];
        const ctx = self && self.context;
        if (dest && ctx && dest === ctx.destination && realCtx(ctx) && self !== masters.get(ctx)) {
          const g = masterOf(ctx);
          Reflect.apply(t, self, [g, args[1] || 0, 0]);
          let s = viaMaster.get(self);
          if (!s) { s = new Set(); viaMaster.set(self, s); }
          s.add(ctx);
          return dest;                          // connect(node) donusu: hedef dugum
        }
      } catch { /* hata: orijinal davranisa dus */ }
      return Reflect.apply(t, self, args);
    },
  }));

  wrap(AudioNode.prototype, 'disconnect', () => ({
    apply(t, self, args) {
      try {
        const dest = args[0];
        const s = viaMaster.get(self);
        const ctx = self && self.context;
        if (dest && s && ctx && s.has(ctx) && dest === ctx.destination) {
          const g = masters.get(ctx);
          s.delete(ctx);
          return Reflect.apply(t, self, [g, ...args.slice(1, 3)]);
        }
        if (!dest && s) s.clear();              // disconnect(): tum cikislar
      } catch { /* yoksay */ }
      return Reflect.apply(t, self, args);
    },
  }));

  for (const C of [window.AudioContext, window.webkitAudioContext]) {
    if (!C || !C.prototype) continue;
    wrap(C.prototype, 'createMediaElementSource', () => ({
      apply(t, self, args) {
        const r = Reflect.apply(t, self, args);
        try { routedEls.add(args[0]); reg(args[0]); } catch { /* yoksay */ }
        return r;
      },
    }));
  }

  /* ---- dar yuzey ---- */
  const api = Object.freeze({
    /* Yasayan kayitli ogeler (ayrik olanlar dahil) */
    elements() {
      const out = [];
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i].deref();
        if (el) out.unshift(el); else els.splice(i, 1);
      }
      return out;
    },
    isRouted(el) { return routedEls.has(el); },
    liveMasters() {
      const out = [];
      for (let i = ctxs.length - 1; i >= 0; i--) {
        const c = ctxs[i].deref();
        const g = c && c.state !== 'closed' ? masters.get(c) : null;
        if (g) out.unshift(g); else ctxs.splice(i, 1);
      }
      return out;
    },
    getMaster() {
      const m = this.liveMasters();
      return m.length ? m[0].gain.value : null;
    },
    setMaster(v) {
      const x = Math.min(1, Math.max(0, Number(v)));
      if (!Number.isFinite(x)) return 0;
      let n = 0;
      for (const g of this.liveMasters()) {
        try { g.gain.cancelScheduledValues(0); g.gain.value = x; n++; } catch { /* yoksay */ }
      }
      return n;
    },
  });

  let claimed = false;
  window.addEventListener(CLAIM, (e) => {
    if (claimed) return;
    const cb = e && e.detail && e.detail.cb;
    if (typeof cb !== 'function') return;
    claimed = true;
    e.stopImmediatePropagation();
    try { cb(api); } catch { /* yoksay */ }
  }, true);
})();
