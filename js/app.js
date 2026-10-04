/* App shell: router, header, live drops strip, global actions. */
(() => {
  const SR = window.SR;
  const { $, $$, esc } = SR;
  const app = $('#app');

  /* ---------- router ---------- */
  let cleanup = null;
  function route() {
    const raw = location.hash.slice(1) || '/';
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    let name = 'home';
    if (parts[0] === 'case') { name = 'case'; params.id = parts[1]; }
    else if (SR.pages[parts[0]]) name = parts[0];

    if (cleanup) cleanup();
    SR.pageOffs.splice(0).forEach(off => off());
    const page = SR.pages[name];
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = page.render(params);
    app.replaceChildren(view);
    cleanup = page.mount ? page.mount(view, params) : null;

    const c = name === 'case' && SR.caseById(params.id);
    document.title = `${c ? c.name + ' case' : page.title} · SkinRush demo`;
    $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (name === 'case' ? 'home' : name)));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- header ---------- */
  const balEl = $('#balance');
  let lastBal = null;
  function drawHeader() {
    const st = SR.store.state;
    balEl.textContent = SR.price(st.balance);
    balEl.title = SR.priceAlt(st.balance);
    $$('[data-cur]').forEach(b => { const on = b.dataset.cur === st.cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    drawQuiz();
    if (lastBal !== null && st.balance !== lastBal) {
      balEl.classList.remove('bump-up', 'bump-down');
      void balEl.offsetWidth;
      balEl.classList.add(st.balance > lastBal ? 'bump-up' : 'bump-down');
    }
    lastBal = st.balance;
    $('#inv-count').textContent = st.inv.length;
    const btn = $('#btn-sound');
    btn.setAttribute('aria-pressed', st.sound);
    btn.innerHTML = st.sound
      ? '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9zm18.4 6.6L19 13.2l-2.4 2.4-1.4-1.4 2.4-2.4-2.4-2.4 1.4-1.4 2.4 2.4 2.4-2.4 1.4 1.4-2.4 2.4 2.4 2.4z" fill="currentColor"/></svg>';
  }
  SR.on('state', drawHeader);

  // Free-money quiz button: a countdown until it opens, then a call to action.
  const quizEl = $('#btn-quiz');
  let quizWasReady = null;
  function drawQuiz() {
    const ready = SR.quiz.ready();
    quizEl.classList.toggle('ready', ready);
    quizEl.querySelector('span').textContent = ready ? `Win ${SR.price(SR.QUIZ_REWARD)}` : SR.clock(SR.quiz.msLeft());
    quizEl.title = ready ? 'Name a skin to win free money' : 'Time until the next free-money quiz';
    $$('[data-quiz-clock]').forEach(el => { el.textContent = SR.clock(SR.quiz.msLeft()); });
    const changed = quizWasReady !== null && ready !== quizWasReady;
    quizWasReady = ready;
    if (changed) SR.emit('state', SR.store.state);   // let pages swap their "next quiz" hints
  }
  setInterval(drawQuiz, 1000);

  document.addEventListener('click', e => {
    const t = e.target.closest('#btn-quiz, #btn-sound, #btn-fair, [data-act="quiz"], [data-act="fair"], [data-cur], .skip');
    if (!t) return;
    if (t.matches('.skip')) { e.preventDefault(); app.focus(); return; }
    if (t.dataset.cur) { const st = SR.store.state; if (st.cur !== t.dataset.cur) { st.cur = t.dataset.cur; SR.store.save(); route(); } }
    else if (t.id === 'btn-quiz' || t.dataset.act === 'quiz') SR.showQuiz();
    else if (t.id === 'btn-sound') { const st = SR.store.state; st.sound = !st.sound; SR.store.save(); if (st.sound) SR.audio.click(); }
    else if (t.id === 'btn-fair' || t.dataset.act === 'fair') SR.showFair();
  });

  // Cards marked role="button" respond to Enter/Space like real buttons.
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------- live drops ---------- */
  const NICKS = ['rush_b', 'eco_round', 'smoke_wizard', 'one_tap', 'clutch_mode', 'awp_dreamer', 'pistol_round', 'molly_lineup',
    'tec9_spammer', 'bhop_king', 'flick_n_pray', 'ct_spawn', 'anubis_main', 'mirage_mid', 'force_buy', 'save_round', 'jumpthrow', 'peek_pro'];
  const track = $('#drops');
  const MAX_DROPS = 26;

  SR.drops = {
    push(id, c, mine = false, animate = true, player) {
      const it = SR.item(id), t = SR.tier(it);
      const who = mine ? 'You' : player || NICKS[Math.floor(Math.random() * NICKS.length)];
      const el = document.createElement(c ? 'a' : 'div');
      if (c) el.href = `#/case/${c.id}`;
      el.className = `drop ${mine ? 'mine' : ''} ${animate ? 'enter' : ''}`;
      el.style.setProperty('--tc', t.color);
      el.title = `${who} · ${SR.fullName(it)}${c ? ` · ${c.name} case` : ' · upgrade'}`;
      el.innerHTML = `${SR.pic(it, 'drop-img')}
        <span class="drop-name">${esc(it.finish)}</span>
        <span class="drop-who">${esc(who)}</span>`;
      track.prepend(el);
      while (track.children.length > MAX_DROPS) track.lastElementChild.remove();
    },
  };

  // Demo mode only: simulated other players (cheaper cases get opened more often) and a simulated online count.
  // Supabase mode shows real drops and a real online count instead (game-supabase.js).
  function simulateActivity() {
    const weights = SR.CASES.map(c => 1 / Math.sqrt(c.price));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const fakeDrop = (animate = true) => {
      let x = Math.random() * wsum, i = 0;
      while ((x -= weights[i]) > 0 && i < weights.length - 1) i++;
      const c = SR.CASES[i];
      SR.drops.push(SR.pickWeighted(c.contents, Math.random()), c, false, animate);
    };
    for (let i = 0; i < 18; i++) fakeDrop(false);
    (function loop() { setTimeout(() => { if (!document.hidden) fakeDrop(); loop(); }, 2200 + Math.random() * 2800); })();
    let online = 700 + Math.floor(Math.random() * 80);
    $('#online').textContent = online;
    setInterval(() => {
      online = Math.max(620, Math.min(860, online + Math.round((Math.random() - 0.5) * 12)));
      $('#online').textContent = online;
    }, 4000);
  }
  SR.on('online', n => { $('#online').textContent = n; });

  /* ---------- account (Supabase mode) ---------- */
  function drawAccount() {
    const btn = $('#btn-account');
    const st = SR.store.state;
    if (SR.game.mode !== 'supabase') { btn.hidden = true; $('#admin-bar').hidden = true; return; }
    btn.hidden = false;
    btn.title = st.username ? `Signed in as ${st.username}` : 'Account';
    $('#admin-bar').hidden = !st.isAdmin;
    document.body.classList.toggle('has-admin-bar', !!st.isAdmin);
  }
  SR.on('state', drawAccount);

  // Full-screen login / register. Resolves with the signed-in user.
  SR.showLogin = game => new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'login';
    el.innerHTML = `
      <form class="login-card" id="login-form" novalidate>
        <div class="login-brand">
          <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--ember)"/><path d="M22 9h-9l-4 4 4 4h6l-3 3H9v3h9l4-4-4-4h-6l3-3h7z" fill="var(--ink)"/></svg>
          <span>SkinRush</span>
        </div>
        <div class="login-tabs" role="tablist">
          <button type="button" role="tab" class="on" aria-selected="true" data-tab="login">Log in</button>
          <button type="button" role="tab" aria-selected="false" data-tab="register">Create account</button>
        </div>
        <label for="login-user">Username</label>
        <input class="input" id="login-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
        <label for="login-pass">Password</label>
        <input class="input" id="login-pass" name="password" type="password" autocomplete="current-password" minlength="6" required>
        <p class="login-hint" id="login-hint">Welcome back. New here? Choose “Create account”.</p>
        <p class="login-error" id="login-error" aria-live="polite"></p>
        <button class="btn btn-go btn-lg" type="submit" id="login-go">Log in</button>
        <p class="login-note">Demo site. Money here is pretend and can't be deposited or withdrawn.</p>
      </form>`;
    document.body.appendChild(el);
    document.body.classList.add('no-scroll');
    let mode = 'login';
    const user = $('#login-user', el), pass = $('#login-pass', el), err = $('#login-error', el), go = $('#login-go', el);
    const setMode = m => {
      mode = m;
      $$('[data-tab]', el).forEach(b => { b.classList.toggle('on', b.dataset.tab === m); b.setAttribute('aria-selected', b.dataset.tab === m); });
      go.textContent = m === 'login' ? 'Log in' : 'Create account';
      pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      $('#login-hint', el).textContent = m === 'login'
        ? 'Welcome back. New here? Choose “Create account”.'
        : `Usernames use 3–20 lowercase letters, digits or _. Passwords need at least 6 characters. You start with ${SR.price(2000)}.`;
      err.textContent = '';
    };
    el.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) setMode(t.dataset.tab); });
    setTimeout(() => user.focus(), 50);
    $('#login-form', el).addEventListener('submit', async e => {
      e.preventDefault();
      const name = user.value.trim().toLowerCase(), pw = pass.value;
      if (!game.USERNAME.test(name)) { err.textContent = 'Usernames use 3–20 letters, digits or _ (no spaces).'; user.focus(); return; }
      if (pw.length < 6) { err.textContent = 'Passwords need at least 6 characters.'; pass.focus(); return; }
      go.disabled = true; err.textContent = '';
      go.textContent = mode === 'login' ? 'Logging in…' : 'Creating account…';
      try {
        const u = mode === 'login' ? await game.login(name, pw) : await game.register(name, pw);
        el.remove();
        document.body.classList.remove('no-scroll');
        resolve(u);
      } catch (ex) {
        err.textContent = ex.message || 'That didn’t work. Try again.';
        go.disabled = false;
        go.textContent = mode === 'login' ? 'Log in' : 'Create account';
      }
    });
  });

  SR.showAccount = () => {
    const st = SR.store.state;
    const m = SR.modal(`
      <h2 class="modal-title">${esc(st.username || 'Your account')}</h2>
      <p class="modal-sub">${st.isAdmin ? 'Admin account. ' : ''}Log in with this username and your password on any device to get the same balance and skins.</p>
      <div class="win-actions"><button class="btn btn-ghost" type="button" id="acc-out">Log out</button></div>`, { label: 'Account' });
    $('#acc-out', m.el).addEventListener('click', () => SR.game.signOut());
  };
  document.addEventListener('click', e => { if (e.target.closest('#btn-account')) SR.showAccount(); });

  // Admin bar: give free money to any account by username (empty = yourself). The server checks admin rights.
  $('#admin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#admin-go'), out = $('#admin-msg');
    const who = $('#admin-user').value.trim().toLowerCase(), amount = Number($('#admin-amount').value);
    if (!(amount > 0 && amount <= 1000000)) { out.textContent = 'Enter an amount from 0.01 to 1,000,000.'; return; }
    btn.disabled = true; out.textContent = '';
    try {
      const r = await SR.game.adminDeposit(who, amount);
      out.textContent = `Added ${SR.price(r.amount)} to ${r.username}`;
      SR.audio.coins();
      $('#admin-amount').value = '';
    } catch (ex) { out.textContent = SR.errorText(ex); }
    btn.disabled = false;
  });
  $('#admin-toggle').addEventListener('click', () => {
    const bar = $('#admin-bar'), open = bar.classList.toggle('collapsed');
    $('#admin-toggle').setAttribute('aria-expanded', String(!open));
  });

  /* ---------- boot ---------- */
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  async function boot() {
    SR.on('reload', route);
    drawHeader();
    const cfg = window.SR_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      app.innerHTML = '<section class="wrap section empty"><h1>Connecting…</h1><p>Signing you in and loading your inventory.</p></section>';
      $('#online').textContent = '–';   // real count arrives from Realtime presence
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js');
        await SR.remoteGame.init(cfg);
        SR.game = SR.remoteGame;
        document.body.classList.add('mode-supabase');
      } catch (e) {
        app.innerHTML = `<section class="wrap section empty"><h1>Can't reach the game server</h1>
          <p>${esc(e.message || 'Check your connection.')}</p>
          <button class="btn btn-go" type="button" onclick="location.reload()">Try again</button></section>`;
        return;
      }
    } else {
      await SR.game.init();
      simulateActivity();
      SR.sync.init();      // claude.ai artifact: per-person cross-device sync (no-op elsewhere)
    }
    drawAccount();
    drawHeader();
    route();
  }
  boot();
})();
