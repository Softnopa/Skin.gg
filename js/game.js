/* Game actions. Pages call SR.game.*; two implementations share this interface:
   - local (this file): rules run in the browser, state in localStorage / claude.ai sync. Used when no Supabase config.
   - supabase (game-supabase.js): rules run in Postgres functions (supabase/migrations), the browser only renders.
   Every rule here is mirrored in supabase/migrations/0001_skinrush.sql — change both together. */
(() => {
  const SR = window.SR;
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  SR.gameError = err;

  const MESSAGES = {
    insufficient_funds: 'Not enough money for that.',
    not_owned: 'Some of those skins are no longer in your inventory.',
    bad_request: 'That action isn’t allowed.',
    quiz_not_ready: 'The quiz isn’t open yet.',
    not_signed_in: 'You’re signed out. Reload the page to sign in again.',
    not_admin: 'Only admins can do that.',
    battle_closed: 'That battle already started or was cancelled.',
    already_joined: 'You’re already in this battle.',
    no_such_user: 'No account with that username.',
  };
  SR.errorText = e => MESSAGES[e && e.code] || 'Something went wrong. Check your connection and try again.';

  /* ---------- shared rules ---------- */
  SR.RULES = {
    UPGRADE_MAX_STAKE: 4, UPGRADE_HOUSE: 0.95, UPGRADE_CAP: 0.8,
    TRADE_MAX_GET: 10,
    CONTRACT_MIN: 3, CONTRACT_MAX: 10, CONTRACT_LO: 0.25, CONTRACT_HI: 4, CONTRACT_P: 2.07,
  };
  const R = SR.RULES;
  SR.upgradeChance = (stake, target) => (!stake || !target || target <= stake ? 0 : Math.min(R.UPGRADE_CAP, stake / target * R.UPGRADE_HOUSE));
  // Contract result value = total × 0.25 × 16^(roll^2.07): log-scaled from 0.25× to 4×, average ≈ 0.90×.
  SR.contractMultiplier = r => R.CONTRACT_LO * Math.pow(R.CONTRACT_HI / R.CONTRACT_LO, Math.pow(r, R.CONTRACT_P));
  // The catalog item closest in price to the target value (ties: lowest id, byte order — same as Postgres COLLATE "C").
  SR.nearestItem = value => {
    let best = null, bd = Infinity;
    for (const it of SR.ITEM_LIST) {
      const d = Math.abs(it.price - value);
      if (d < bd || (d === bd && it.id < best.id)) { best = it; bd = d; }
    }
    return best;
  };

  const st = () => SR.store.state;
  const owned = uids => {
    const set = new Set(uids);
    const found = st().inv.filter(e => set.has(e.uid));
    if (found.length !== set.size || set.size !== uids.length) throw err('not_owned');
    return found;
  };
  const value = entries => entries.reduce((s, e) => s + SR.item(e.id).price, 0);

  /* ---------- local implementation ---------- */
  const local = {
    mode: 'local',
    async init() { await SR.fair.init(); },

    async openCase(caseId, count) {
      const c = SR.caseById(caseId);
      if (!c || !(count >= 1 && count <= 5)) throw err('bad_request');
      const total = Math.round(c.price * count * 100) / 100;
      if (!SR.store.spend(total)) throw err('insufficient_funds');
      const results = [];
      for (let i = 0; i < count; i++) {
        const roll = await SR.fair.roll();
        const id = SR.pickWeighted(c.contents, roll.value);
        results.push({ entry: SR.store.addItem(id, 'case:' + c.id), roll });
      }
      const s = st().stats;
      s.opened += count; s.spent += total; s.won += results.reduce((a, r) => a + SR.item(r.entry.id).price, 0);
      SR.store.save();
      return { results };
    },

    async sell(uids) { owned(uids); return SR.store.sell(uids); },

    async buy(itemId) {
      const it = SR.item(itemId);
      if (!it) throw err('bad_request');
      if (!SR.store.spend(it.price)) throw err('insufficient_funds');
      return { entry: SR.store.addItem(it.id, 'market') };
    },

    async upgrade(uids, targetId) {
      if (!uids.length || uids.length > R.UPGRADE_MAX_STAKE) throw err('bad_request');
      const stake = value(owned(uids)), t = SR.item(targetId);
      const chance = SR.upgradeChance(stake, t && t.price);
      if (!chance) throw err('bad_request');
      const roll = await SR.fair.roll();
      const won = roll.value < chance;
      SR.store.take(uids);
      let entry = null;
      if (won) entry = SR.store.addItem(t.id, 'upgrade');
      st().stats.upgrades += 1; if (won) st().stats.upgradesWon += 1;
      SR.store.save();
      return { won, roll, chance, entry };
    },

    async trade(giveUids, getIds) {
      if (getIds.length > R.TRADE_MAX_GET || (!giveUids.length && !getIds.length) || getIds.some(id => !SR.item(id))) throw err('bad_request');
      const diff = getIds.reduce((a, id) => a + SR.item(id).price, 0) - value(owned(giveUids));
      if (diff > 0 && !SR.store.canAfford(diff)) throw err('insufficient_funds');
      SR.store.take(giveUids);
      st().balance = Math.round((st().balance - diff) * 100) / 100;
      getIds.forEach(id => SR.store.addItem(id, 'trade'));
      st().stats.trades += 1;
      SR.store.save();
      return { received: getIds.length, diff };
    },

    async contract(uids) {
      if (uids.length < R.CONTRACT_MIN || uids.length > R.CONTRACT_MAX) throw err('bad_request');
      const total = value(owned(uids));
      const roll = await SR.fair.roll();
      const multiplier = SR.contractMultiplier(roll.value);
      const it = SR.nearestItem(total * multiplier);
      SR.store.take(uids);
      const entry = SR.store.addItem(it.id, 'contract');
      st().stats.contracts = (st().stats.contracts || 0) + 1;
      SR.store.save();
      return { entry, roll, multiplier, total };
    },

    async quizQuestion() {
      if (!SR.quiz.ready()) throw err('quiz_not_ready');
      const q = SR.quiz.question(), it = SR.item(q.id);
      return { options: q.options, sheet: it.sheet, cell: it.cell };
    },
    async quizAnswer(choice) {
      const res = SR.quiz.answer(choice);
      if (!res) throw err('quiz_not_ready');
      return res;
    },

    async rotateSeed() { await SR.fair.rotate(); },
    async setClientSeed(v) { st().fair.client = v; SR.store.save(); },

    /* ---------- case battles (local: you against bots, kept for this visit) ---------- */
    battles: new Map(),
    seeds: new Map(),
    myId: () => 'me',
    subscribeBattles: () => () => {},
    async listBattles() { return [...local.battles.values()].sort((a, b) => b.createdAt - a.createdAt); },
    async getBattle(id) { return local.battles.get(id) || null; },
    async createBattle(cases, mode, crazy) {
      const m = SR.BATTLE.MODES[mode];
      if (!m || !cases.length || cases.length > SR.BATTLE.MAX_ROUNDS || cases.some(id => !SR.caseById(id))) throw err('bad_request');
      const cost = Math.round(cases.reduce((s, id) => s + SR.caseById(id).price, 0) * 100) / 100;
      if (!SR.store.spend(cost)) throw err('insufficient_funds');
      const id = 'local-' + SR.uid(), seed = SR.fair.randHex(32);
      const b = {
        id, creator: 'me', creatorName: 'You', mode, crazy: !!crazy, cases: [...cases], seats: m.seats, cost,
        status: 'open', serverHash: await SR.fair.sha256(seed), seed: null, winnerTeam: null,
        createdAt: Date.now(), startedAt: null, players: [{ seat: 0, userId: 'me', name: 'You', bot: false }], drops: [],
      };
      local.seeds.set(id, seed); local.battles.set(id, b);
      return { battle: b };
    },
    async joinBattle() { throw err('bad_request'); },
    async callBots(id) {
      const b = local.battles.get(id);
      if (!b || b.status !== 'open') throw err('bad_request');
      for (let s = 0; s < b.seats; s++) if (!b.players.some(p => p.seat === s)) b.players.push({ seat: s, userId: null, name: SR.BATTLE.BOT_NAMES[s], bot: true });
      b.players.sort((x, y) => x.seat - y.seat);
      const seed = local.seeds.get(id);
      const { drops, winnerTeam } = await SR.battleOutcome(b, seed);
      drops.filter(d => d.wonBy === 0).forEach(d => SR.store.addItem(d.id, 'battle'));
      st().stats.battles = (st().stats.battles || 0) + 1;
      if (SR.battleTeamOf(b.mode, 0) === winnerTeam) st().stats.battlesWon = (st().stats.battlesWon || 0) + 1;
      SR.store.save();
      Object.assign(b, { drops, winnerTeam, status: 'done', seed, startedAt: Date.now() });
      return { battle: b };
    },
    async cancelBattle(id) {
      const b = local.battles.get(id);
      if (!b || b.status !== 'open') throw err('bad_request');
      b.status = 'cancelled';
      SR.store.credit(b.cost);
      return { battle: b };
    },
  };

  SR.game = local;
})();
