/* Supabase mode: same interface as the local game (js/game.js), but every action is a Postgres RPC
   (supabase/migrations/0001_skinrush.sql). The browser renders whatever state the server returns.
   Activated by app.js when js/config.js has a Supabase URL and anon key. */
(() => {
  const SR = window.SR;
  const KNOWN = ['insufficient_funds', 'not_owned', 'bad_request', 'quiz_not_ready', 'not_signed_in'];

  const remote = {
    mode: 'supabase',
    sb: null,
    user: null,

    async init(cfg) {
      this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      let { data: { session } } = await this.sb.auth.getSession();
      if (!session) {
        // Guest account: instant play. Needs "Anonymous sign-ins" enabled in Supabase → Authentication → Providers.
        const { data, error } = await this.sb.auth.signInAnonymously();
        if (error) throw Object.assign(new Error(error.message), { code: 'auth' });
        session = data.session;
      }
      this.user = session.user;
      this.sb.auth.onAuthStateChange((event, s) => {
        const next = s && s.user;
        const switched = next && this.user && next.id !== this.user.id;
        this.user = next || null;
        SR.emit('account');
        if (switched) this.refresh().then(() => SR.emit('reload')).catch(() => {});
      });
      await this.refresh();
      this.live();
    },

    async call(fn, args) {
      const { data, error } = await this.sb.rpc(fn, args || {});
      if (error) {
        const code = KNOWN.find(k => (error.message || '').includes(k)) || 'server';
        throw SR.gameError(code, error.message);
      }
      if (data && data.state) SR.store.apply(data.state);
      return data;
    },
    refresh() { return this.call('get_state'); },

    async openCase(caseId, count) {
      const d = await this.call('open_case', { p_case: caseId, p_count: count });
      return { results: d.results.map(x => ({ entry: { uid: x.uid, id: x.id, ts: x.ts, src: x.src, sold: x.sold }, roll: { value: x.roll, nonce: x.nonce } })) };
    },
    async sell(uids) { const d = await this.call('sell_items', { p_uids: uids }); return { count: d.count, total: Number(d.total) }; },
    async buy(itemId) { const d = await this.call('buy_item', { p_item: itemId }); return { entry: d.entry }; },
    async upgrade(uids, targetId) {
      const d = await this.call('upgrade_item', { p_uids: uids, p_target: targetId });
      return { won: d.won, roll: { value: d.roll, nonce: d.nonce }, chance: d.chance, entry: d.entry };
    },
    async trade(giveUids, getIds) { const d = await this.call('trade_items', { p_give: giveUids, p_get: getIds }); return { received: d.received, diff: Number(d.diff) }; },
    async contract(uids) {
      const d = await this.call('sign_contract', { p_uids: uids });
      return { entry: d.entry, roll: { value: d.roll, nonce: d.nonce }, multiplier: d.multiplier, total: Number(d.total) };
    },
    async quizQuestion() { const d = await this.call('quiz_question'); return d.q; },
    async quizAnswer(choice) { const d = await this.call('quiz_answer', { p_choice: choice }); return { correct: d.correct, answer: d.answer, triesLeft: d.triesLeft }; },
    async rotateSeed(client) { await this.call('rotate_seed', { p_client: client || null }); },
    async setClientSeed(v) { await this.call('set_client_seed', { p_client: v }); },

    /* ---------- account ---------- */
    isGuest() { return !this.user || this.user.is_anonymous || !this.user.email; },
    // Keep a guest's progress by attaching an email (Supabase sends a confirmation link).
    async saveWithEmail(email) {
      const { error } = await this.sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
      if (error) throw error;
    },
    // Sign in to an existing account on this device (magic link).
    async signInWithEmail(email) {
      const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
    },
    async signOut() { await this.sb.auth.signOut(); location.reload(); },

    /* ---------- realtime: real drops + real online count ---------- */
    async live() {
      try {
        const { data } = await this.sb.from('drops').select('item_id, case_id, kind, player').order('id', { ascending: false }).limit(20);
        (data || []).reverse().forEach(d => this.showDrop(d, false));
      } catch (e) { /* feed is optional */ }
      this.sb.channel('drops-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drops' }, p => this.showDrop(p.new, true))
        .subscribe();
      const room = this.sb.channel('online', { config: { presence: { key: this.user.id } } });
      room.on('presence', { event: 'sync' }, () => SR.emit('online', Object.keys(room.presenceState()).length))
        .subscribe(status => { if (status === 'SUBSCRIBED') room.track({ at: Date.now() }); });
    },
    showDrop(d, animate) {
      if (!SR.item(d.item_id)) return;
      if (animate && d.player === SR.store.state.tag) return;   // our own drops are shown locally right away
      SR.drops.push(d.item_id, d.case_id ? SR.caseById(d.case_id) : null, false, animate, d.player);
    },
  };

  SR.remoteGame = remote;
})();
