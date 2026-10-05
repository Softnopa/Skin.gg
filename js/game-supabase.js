/* Supabase mode: same interface as the local game (js/game.js), but every action is a Postgres RPC
   (supabase/migrations/0001_skinrush.sql). The browser renders whatever state the server returns.
   Activated by app.js when js/config.js has a Supabase URL and anon key. */
(() => {
  const SR = window.SR;
  const KNOWN = ['insufficient_funds', 'not_owned', 'bad_request', 'quiz_not_ready', 'not_signed_in', 'not_admin', 'no_such_user', 'battle_closed', 'already_joined'];

  const remote = {
    mode: 'supabase',
    sb: null,
    user: null,

    async init(cfg) {
      this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const { data: { session } } = await this.sb.auth.getSession();
      // No saved session: show the login / register screen and wait until it signs someone in.
      this.user = session ? session.user : await SR.showLogin(this);
      this.sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') location.reload(); });
      await this.refresh();
      this.live();
    },

    /* ---------- accounts: username + password ----------
       Supabase Auth needs an email, so a username maps to <username>@skinrush.local. Nothing is ever emailed;
       "Confirm email" must be off in Supabase → Authentication → Sign In / Providers → Email. */
    USERNAME: /^[a-z0-9_]{3,20}$/,
    emailFor: name => `${name}@skinrush.local`,
    async login(username, password) {
      const { data, error } = await this.sb.auth.signInWithPassword({ email: this.emailFor(username), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? 'Wrong username or password.' : error.message);
      return data.user;
    },
    async register(username, password) {
      const { data, error } = await this.sb.auth.signUp({ email: this.emailFor(username), password });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) throw new Error('That username is taken. Pick another one.');
        if (/password/i.test(error.message)) throw new Error('Use a password with at least 6 characters.');
        throw new Error(error.message);
      }
      if (!data.session) throw new Error('Account created, but sign-in is blocked: the site owner must turn off “Confirm email” in Supabase.');
      return data.user;
    },
    async signOut() { await this.sb.auth.signOut(); location.reload(); },

    /* ---------- case battles (server-run, everyone sees the same battle) ---------- */
    myId() { return this.user && this.user.id; },
    normBattle(b) {
      if (!b) return null;
      return { ...b, cost: Number(b.cost), drops: (b.drops || []).map(d => ({ ...d, price: Number(d.price) })) };
    },
    async listBattles() { const d = await this.call('list_battles'); return (d || []).map(b => this.normBattle(b)); },
    async getBattle(id) { return this.normBattle(await this.call('get_battle', { p_id: id })); },
    async createBattle(cases, mode, crazy) { const d = await this.call('create_battle', { p_cases: cases, p_mode: mode, p_crazy: !!crazy }); return { battle: this.normBattle(d.battle) }; },
    async joinBattle(id) { const d = await this.call('join_battle', { p_id: id }); return { battle: this.normBattle(d.battle) }; },
    async callBots(id) { const d = await this.call('call_bots', { p_id: id }); return { battle: this.normBattle(d.battle) }; },
    async cancelBattle(id) { const d = await this.call('cancel_battle', { p_id: id }); return { battle: this.normBattle(d.battle) }; },
    // Realtime: any change to battles or seats calls fn({ id } or { battle_id }). Returns an unsubscribe function.
    subscribeBattles(fn) {
      const ch = this.sb.channel('battles-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'battles' }, p => fn(p.new || p.old))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_seats' }, p => fn(p.new || p.old))
        .subscribe();
      return () => { try { this.sb.removeChannel(ch); } catch (e) { /* already gone */ } };
    },

    /* ---------- admin ---------- */
    async adminDeposit(username, amount) {
      const d = await this.call('admin_deposit', { p_username: username, p_amount: amount });
      return { username: d.username, amount: Number(d.amount), balance: Number(d.balance) };
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
