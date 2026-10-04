/* Core: helpers, money formatting, rarity tiers, persisted store (+ cross-device sync), provably-fair rolls,
   skin quiz, audio, toasts, modals, shared renderers. */
(() => {
  const SR = window.SR;

  /* ---------- helpers ---------- */
  SR.$ = (sel, root = document) => root.querySelector(sel);
  SR.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  SR.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SR.fmt = n => Math.round(n).toLocaleString('en-US');
  SR.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  SR.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  SR.clock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  const listeners = {};
  SR.on = (ev, fn) => {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); };
  };
  SR.emit = (ev, data) => (listeners[ev] || []).slice().forEach(fn => fn(data));
  // Listeners registered by the current page; the router drops them on navigation.
  SR.pageOffs = [];
  SR.onPage = (ev, fn) => SR.pageOffs.push(SR.on(ev, fn));

  /* ---------- money: values are USD; the viewer picks $ or so'm ---------- */
  const usd = n => {
    const v = Math.round(n * 100) / 100;
    return '$' + v.toLocaleString('en-US', v >= 100000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const group = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const uzs = n => {
    const v = Math.round(n * SR.UZS_RATE);
    if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' mlrd so\'m';
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' mln so\'m';
    return group(Math.round(v / 10) * 10) + ' so\'m';
  };
  SR.price = n => (state.cur === 'uzs' ? uzs(n) : usd(n));
  SR.money = n => `<span class="money">${SR.price(n)}</span>`;
  SR.priceAlt = n => (state.cur === 'uzs' ? usd(n) : uzs(n));

  /* ---------- rarity tiers ---------- */
  SR.TIERS = {
    consumer:   { name: 'Consumer',     color: '#b0c3d9', rank: 0 },
    industrial: { name: 'Industrial',   color: '#5e98d9', rank: 1 },
    milspec:    { name: 'Mil-Spec',     color: '#4b69ff', rank: 2 },
    restricted: { name: 'Restricted',   color: '#8847ff', rank: 3 },
    classified: { name: 'Classified',   color: '#d32ce6', rank: 4 },
    covert:     { name: 'Covert',       color: '#eb4b4b', rank: 5 },
    gold:       { name: 'Rare Special', color: '#ffc23a', rank: 6 },
    contraband: { name: 'Contraband',   color: '#ff7a1c', rank: 7 },
  };
  SR.tier = item => SR.TIERS[item.tier] || SR.TIERS.milspec;
  SR.item = id => SR.ITEMS[id];
  SR.caseById = id => SR.CASES.find(c => c.id === id);
  SR.fullName = it => `${it.weapon} | ${it.finish}`;
  SR.ITEM_LIST = Object.values(SR.ITEMS);

  /* Skin picture from the sprite sheets (sprites/s<N>.webp, 10×10 cells of 4:3). */
  SR.picAt = (sheet, cell, cls = '', label = 'Skin') => {
    const { cols, rows } = SR.SPRITE;
    const c = cell % cols, r = Math.floor(cell / cols);
    return `<span class="pic ${cls}" role="img" aria-label="${SR.esc(label)}" style="background-image:url(sprites/s${sheet}.webp);background-position:${(c / (cols - 1)) * 100}% ${(r / (rows - 1)) * 100}%"></span>`;
  };
  SR.pic = (it, cls = '', named = true) => SR.picAt(it.sheet, it.cell, cls, named ? SR.fullName(it) : 'Mystery skin');

  /* ---------- persisted store ---------- */
  const KEY = 'skinrush.v2';
  const START_BALANCE = 2000;
  const QUIZ_MS = 15 * 60 * 1000, QUIZ_REWARD = 1000, QUIZ_TRIES = 3;
  const MAX_INV = 1500;
  SR.QUIZ_REWARD = QUIZ_REWARD;

  const defaults = () => ({
    v: 2,
    balance: START_BALANCE,
    inv: [],                // [{ uid, id, ts, src }]
    stats: { opened: 0, spent: 0, won: 0, best: null, upgrades: 0, upgradesWon: 0, trades: 0, quizWon: 0, contracts: 0 },
    quiz: { nextAt: Date.now() + QUIZ_MS, tries: QUIZ_TRIES, q: null },
    cur: 'usd',
    sound: true,
    fast: false,
    fair: null,
    updatedAt: 0,           // 0 = never saved; any synced copy wins over a fresh one
    synced: false,
  });
  const normalize = s => {
    const d = defaults();
    const out = Object.assign(d, s || {});
    out.stats = Object.assign(defaults().stats, out.stats || {});
    out.quiz = Object.assign(defaults().quiz, out.quiz || {});
    out.inv = (out.inv || []).filter(e => SR.ITEMS[e.id]);
    return out;
  };
  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); }
  catch (e) { state = defaults(); }

  const writeLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: session only */ } };
  const save = () => {
    state.updatedAt = Date.now();
    writeLocal();
    sync.push();
    SR.emit('state', state);
  };

  SR.store = {
    get state() { return state; },
    save,
    canAfford: n => state.balance + 1e-9 >= n,
    spend(n) {
      if (!SR.store.canAfford(n)) return false;
      state.balance = Math.round((state.balance - n) * 100) / 100;
      save();
      return true;
    },
    credit(n) { state.balance = Math.round((state.balance + n) * 100) / 100; save(); },
    addItem(id, src) {
      const it = SR.item(id);
      if (!state.stats.best || it.price > SR.item(state.stats.best).price) state.stats.best = id;
      if (state.inv.length >= MAX_INV) {            // keep the synced record small: auto-sell overflow
        state.balance = Math.round((state.balance + it.price) * 100) / 100;
        save();
        SR.toast(`Inventory full (${MAX_INV}). Sold ${SR.esc(SR.fullName(it))} for ${SR.money(it.price)}`);
        return { uid: SR.uid(), id, ts: Date.now(), src, sold: true };
      }
      const entry = { uid: SR.uid(), id, ts: Date.now(), src };
      state.inv.unshift(entry);
      save();
      return entry;
    },
    take(uids) {
      const set = new Set(uids);
      const taken = state.inv.filter(e => set.has(e.uid));
      state.inv = state.inv.filter(e => !set.has(e.uid));
      return taken;
    },
    sell(uids) {
      const taken = SR.store.take(uids);
      const total = taken.reduce((s, e) => s + SR.item(e.id).price, 0);
      state.balance = Math.round((state.balance + total) * 100) / 100;
      save();
      return { count: taken.length, total };
    },
    invValue: () => state.inv.reduce((s, e) => s + SR.item(e.id).price, 0),
    // Server mode: replace the game part of the state with the server's copy. Viewer prefs (currency, sound) stay.
    apply(s) {
      if (!s) return;
      state.balance = Number(s.balance);
      state.inv = (s.inv || []).filter(e => SR.ITEMS[e.id]);
      state.stats = Object.assign(defaults().stats, s.stats || {});
      state.quiz = Object.assign({}, state.quiz, s.quiz || {});
      if (s.fair) state.fair = s.fair;
      state.tag = s.tag || state.tag;
      SR.emit('state', state);
    },
  };

  /* ---------- cross-device sync (claude.ai artifact db, private per signed-in person) ---------- */
  const sync = {
    ref: null, busy: false, again: false, timer: 0, status: 'local',
    async init() {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!db || !user) return;
        const id = await user.id();
        if (!id) return;
        sync.ref = db.doc(`data/users/${id}/wallet`);
        await sync.pull(true);
        sync.status = 'synced';
        SR.emit('sync', sync.status);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.pull(false); });
      } catch (e) { sync.ref = null; }
    },
    async pull(first) {
      if (!sync.ref) return;
      let snap;
      try { snap = await sync.ref.get(); } catch (e) { return; }
      const remote = snap.exists ? snap.data() : null;
      const fresh = !state.synced && first;
      if (remote && remote.v === 2 && (fresh || (remote.updatedAt || 0) > (state.updatedAt || 0))) {
        state = normalize(JSON.parse(JSON.stringify(remote)));
        state.synced = true;
        writeLocal();
        SR.emit('state', state);
        SR.emit('reload');
      } else {
        state.synced = true;
        if (!remote || (state.updatedAt || 0) > (remote.updatedAt || 0)) sync.push();
      }
    },
    push() {
      if (!sync.ref) return;
      clearTimeout(sync.timer);
      sync.timer = setTimeout(sync.flush, 700);
    },
    async flush() {
      if (!sync.ref) return;
      if (sync.busy) { sync.again = true; return; }
      sync.busy = true;
      try { await sync.ref.set(JSON.parse(JSON.stringify(state))); }
      catch (e) {
        if (e && e.code === 'unavailable') { setTimeout(sync.push, 1500 + Math.random() * 1500); }
        else if (e && e.code !== 'resource_exhausted') { sync.ref = null; sync.status = 'local'; SR.emit('sync', sync.status); }
      }
      sync.busy = false;
      if (sync.again) { sync.again = false; sync.push(); }
    },
  };
  SR.sync = sync;

  /* ---------- provably fair ----------
     roll = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`), first 52 bits / 2^52 → [0,1).
     The server-seed hash is shown before play; the seed itself is revealed on rotation. */
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const randHex = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a.buffer); };
  const subtle = window.crypto && window.crypto.subtle;
  const enc = new TextEncoder();
  async function sha256(str) { return hex(await subtle.digest('SHA-256', enc.encode(str))); }
  async function hmac(key, msg) {
    const k = await subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await subtle.sign('HMAC', k, enc.encode(msg)));
  }

  SR.fair = {
    verified: !!subtle,
    async init(force) {
      if (state.fair && !force) return;
      const server = randHex(32);
      state.fair = {
        server, serverHash: subtle ? await sha256(server) : '(unavailable: open over https or localhost)',
        client: randHex(8), nonce: 0, revealed: (state.fair && state.fair.revealed) || [],
      };
      writeLocal();
    },
    async roll() {
      if (!state.fair) await SR.fair.init();
      const f = state.fair;
      f.nonce += 1;
      const h = subtle ? await hmac(f.server, `${f.client}:${f.nonce}`) : randHex(32);
      save();
      return { value: parseInt(h.slice(0, 13), 16) / 2 ** 52, nonce: f.nonce, hash: h };
    },
    async rotate(newClient) {
      const f = state.fair;
      const old = { server: f.server, serverHash: f.serverHash, client: f.client, nonces: f.nonce };
      const revealed = [old, ...(f.revealed || [])].slice(0, 5);
      state.fair = null;
      await SR.fair.init();
      state.fair.revealed = revealed;
      if (newClient) state.fair.client = newClient;
      save();
      return old;
    },
    async verify(server, client, nonce) {
      const h = await hmac(server, `${client}:${nonce}`);
      return { hash: h, value: parseInt(h.slice(0, 13), 16) / 2 ** 52 };
    },
  };

  /* Weighted pick: walk the case contents in their published order. */
  SR.pickWeighted = (contents, r) => {
    const total = contents.reduce((s, c) => s + c.chance, 0);
    let x = r * total;
    for (const c of contents) { x -= c.chance; if (x < 0) return c.id; }
    return contents[contents.length - 1].id;
  };
  SR.ranges = contents => {
    const total = contents.reduce((s, c) => s + c.chance, 0);
    let acc = 0;
    return contents.map(c => { const from = acc / total; acc += c.chance; return { ...c, from, to: acc / total }; });
  };

  /* ---------- skin quiz: every 15 minutes, 3 tries to name a skin for $1,000 ---------- */
  const rand = n => Math.floor(Math.random() * n);
  const quizPool = SR.ITEM_LIST.filter(i => i.type !== 'Sticker' && !/Blue Gem/.test(i.finish) && i.finish !== 'Vanilla');
  function makeQuestion() {
    const correct = quizPool[rand(quizPool.length)];
    const names = new Set([SR.fullName(correct)]);
    const opts = [correct];
    const same = quizPool.filter(i => i.weapon === correct.weapon && i.finish.split(' (')[0] !== correct.finish.split(' (')[0]);
    if (same.length) { const s = same[rand(same.length)]; opts.push(s); names.add(SR.fullName(s)); }
    while (opts.length < 4) {
      const o = quizPool[rand(quizPool.length)];
      if (names.has(SR.fullName(o))) continue;
      names.add(SR.fullName(o)); opts.push(o);
    }
    for (let i = opts.length - 1; i > 0; i--) { const j = rand(i + 1); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    return { id: correct.id, options: opts.map(o => o.id) };
  }
  SR.quiz = {
    REWARD: QUIZ_REWARD,
    msLeft: () => Math.max(0, state.quiz.nextAt - Date.now()),
    ready: () => Date.now() >= state.quiz.nextAt,
    tries: () => state.quiz.tries,
    question() {
      if (!state.quiz.q) { state.quiz.q = makeQuestion(); save(); }
      return state.quiz.q;
    },
    answer(choice) {
      const q = state.quiz.q;
      if (!q || !SR.quiz.ready()) return null;
      const correct = choice === q.id;
      state.quiz.q = null;
      if (correct) {
        state.quiz.tries = QUIZ_TRIES;
        state.quiz.nextAt = Date.now() + QUIZ_MS;
        state.stats.quizWon += 1;
        state.balance = Math.round((state.balance + QUIZ_REWARD) * 100) / 100;
      } else {
        state.quiz.tries -= 1;
        if (state.quiz.tries <= 0) { state.quiz.tries = QUIZ_TRIES; state.quiz.nextAt = Date.now() + QUIZ_MS; }
      }
      save();
      return { correct, answer: q.id, triesLeft: correct ? 0 : (SR.quiz.ready() ? state.quiz.tries : 0) };
    },
  };

  /* ---------- audio (synthesised, no files) ---------- */
  let ctx = null;
  const ac = () => {
    if (!state.sound) return null;
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function blip(freq, dur, type = 'square', vol = 0.06, when = 0, slideTo) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  SR.audio = {
    tick() { blip(1500 + Math.random() * 300, 0.035, 'square', 0.045, 0, 500); },
    click() { blip(700, 0.05, 'triangle', 0.06); },
    settle() { blip(900, 0.12, 'triangle', 0.05, 0, 1300); },
    coins() { [0, 0.06, 0.12].forEach((w, i) => blip(1200 + i * 260, 0.09, 'triangle', 0.05, w)); },
    win(rank = 2) {
      const notes = [523, 659, 784, 1047, 1319, 1568];
      const n = Math.min(notes.length, 3 + Math.max(0, rank - 3));
      for (let i = 0; i < n; i++) blip(notes[i], 0.22, 'triangle', 0.07, i * 0.085);
      if (rank >= 6) blip(2093, 0.6, 'sine', 0.05, n * 0.085);
    },
    lose() { blip(420, 0.35, 'sawtooth', 0.04, 0, 140); },
    spinUp() { blip(180, 0.5, 'sine', 0.05, 0, 900); },
  };

  /* ---------- toasts ---------- */
  SR.toast = (msg, kind = 'info') => {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.innerHTML = msg;
    SR.$('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  };

  /* ---------- modal ---------- */
  SR.modal = (html, { cls = '', onClose, label = 'Dialog' } = {}) => {
    const root = SR.$('#modal-root');
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${SR.esc(label)}">
      <button class="modal-x" type="button" aria-label="Close" data-close>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" fill="currentColor"/></svg>
      </button>${html}</div>`;
    root.appendChild(wrap);
    document.body.classList.add('no-scroll');
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      wrap.classList.add('out');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { wrap.remove(); if (!root.children.length) document.body.classList.remove('no-scroll'); }, 180);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      onClose && onClose();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    const focusable = wrap.querySelector('.modal [autofocus], .modal .btn');
    setTimeout(() => (focusable || wrap.querySelector('.modal-x')).focus(), 30);
    return { el: wrap.firstElementChild, close };
  };

  /* ---------- shared renderers ---------- */
  SR.itemName = it => `<span class="icard-w">${SR.esc(it.weapon)}${it.wear ? ` <i class="wear">${it.wear}</i>` : ''}</span><span class="icard-f">${SR.esc(it.finish)}</span>`;
  SR.itemCard = (it, { top = '', foot = '', cls = '', attrs = '' } = {}) => {
    const t = SR.tier(it);
    return `<div class="icard ${cls}" style="--tc:${t.color}" ${attrs}>
      ${top ? `<div class="icard-top">${top}</div>` : ''}
      ${SR.pic(it, 'icard-img')}
      <div class="icard-name">${SR.itemName(it)}</div>
      ${foot ? `<div class="icard-foot">${foot}</div>` : ''}
    </div>`;
  };

  /* Crate art: a lid and body drawn in SVG, with the case's best skins rising out between them. */
  SR.crate = (c, { big = false, peek = 2 } = {}) => {
    const top = c.contents.map(x => SR.item(x.id)).sort((a, b) => b.price - a.price).slice(0, peek);
    const g = c.glow;
    const imgs = top.map((it, i) => SR.pic(it, `crate-item crate-item-${i}`)).join('');
    return `<div class="crate ${big ? 'crate-big' : ''}" style="--glow:${g}" aria-hidden="true">
      <div class="crate-halo"></div>
      <svg class="crate-back" viewBox="0 0 220 150">
        <path d="M34 62 L186 62 L172 14 L48 14 Z" fill="#262838" stroke="#3f4259" stroke-width="2"/>
        <path d="M60 22 H160" stroke="${g}" stroke-opacity=".55" stroke-width="2"/>
        <path d="M30 62 H190 L186 72 H34 Z" fill="${g}"/>
      </svg>
      ${imgs}
      <svg class="crate-front" viewBox="0 0 220 150">
        <defs><linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34374b"/><stop offset="1" stop-color="#191a25"/></linearGradient></defs>
        <path d="M20 70 H200 V136 a6 6 0 0 1 -6 6 H26 a6 6 0 0 1 -6 -6 Z" fill="url(#cb)" stroke="#4a4e68" stroke-width="2"/>
        <path d="M20 70 H200" stroke="${g}" stroke-width="3"/>
        <rect x="20" y="104" width="180" height="12" fill="#14151d"/>
        <rect x="34" y="107" width="12" height="6" rx="2" fill="${g}"/><rect x="174" y="107" width="12" height="6" rx="2" fill="${g}"/>
        <rect x="76" y="80" width="68" height="18" rx="3" fill="#14151d" stroke="${g}" stroke-opacity=".6"/>
        <text x="110" y="93" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="10" letter-spacing="1.5" fill="${g}">SKINRUSH</text>
        <path d="M28 124 h12 M180 124 h12" stroke="#4a4e68" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>`;
  };

  SR.caseCard = c => `<a class="case-card" href="#/case/${c.id}" style="--glow:${c.glow}">
      ${SR.crate(c)}
      <span class="case-name">${SR.esc(c.name)}</span>
      <span class="price-tag">${SR.money(c.price)}</span>
    </a>`;
})();
