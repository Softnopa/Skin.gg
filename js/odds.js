/* Case odds: "luck tables" instead of one fixed chance list.
   Shared by the browser, scripts/make-seed.js (writes the same tables into Supabase) and the fairness checker.

   Design (borrowed from slot volatility and gacha "soft pity" design):
   - Every item in a case falls in a value band relative to the case price P:
       0: < 0.5P   1: 0.5–1P   2: 1–2P   3: 2–5P   4: 5–20P   5: ≥ 20P
     Bands 2–5 are profit (the drop is worth at least what you paid).
   - Profit chance depends on your luck level 0–5: 34%, 40%, 47%, 55%, 66%, 100%.
     Each open that loses money raises luck by one; any profit resets it to 0.
     So after 5 losing opens in a row, the 6th is guaranteed to profit (hard pity).
   - Inside the profit share the split is 72% / 21% / 6% / 1% across bands 2–5 (small wins common, jackpots rare).
     Inside a band, cheaper items are more likely (weight ∝ 1 / price).
   - The loss share is split between "small loss" and "loss" so the long-run return, luck included, is 97%.
   The resulting per-item chances are published for every luck level; a roll walks the table for your current level. */
(() => {
  const SR = window.SR;
  const BANDS = [0, 0.5, 1, 2, 5, 20, Infinity];
  const HIT = [0.34, 0.40, 0.47, 0.55, 0.66, 1];
  const SHAPE = [0.72, 0.21, 0.06, 0.01];          // profit bands 2..5
  const RTP = 0.97;
  const LEVELS = HIT.length;
  SR.LUCK = { BANDS, HIT, SHAPE, RTP, LEVELS, MAX: LEVELS - 1 };

  const bandOf = (price, P) => { for (let b = 0; b < 6; b++) if (price < P * BANDS[b + 1]) return b; return 5; };
  // Luck after an open: profit resets, a loss climbs one level (capped).
  SR.nextLuck = (luck, value, casePrice) => (value >= casePrice ? 0 : Math.min(LEVELS - 1, (luck || 0) + 1));

  // Long-run share of opens spent at each luck level (Markov chain: hit → 0, miss → +1).
  function stationary(hit) {
    let pi = Array(LEVELS).fill(1 / LEVELS);
    for (let it = 0; it < 400; it++) {
      const nx = Array(LEVELS).fill(0);
      for (let l = 0; l < LEVELS; l++) { nx[0] += pi[l] * hit[l]; nx[Math.min(LEVELS - 1, l + 1)] += pi[l] * (1 - hit[l]); }
      pi = nx;
    }
    return pi;
  }

  SR.buildLuckTables = c => {
    const P = c.price;
    const items = c.contents.map(x => ({ id: x.id, price: SR.ITEMS[x.id].price }));
    items.forEach(it => { it.band = bandOf(it.price, P); });
    const inBand = [0, 1, 2, 3, 4, 5].map(b => items.filter(it => it.band === b));
    // within-band weights ∝ 1/price
    const q = new Map(), mean = [];
    inBand.forEach((list, b) => {
      const tot = list.reduce((s, it) => s + 1 / it.price, 0);
      list.forEach(it => q.set(it.id, (1 / it.price) / tot));
      mean[b] = list.reduce((s, it) => s + q.get(it.id) * it.price, 0);
    });
    const has = b => inBand[b].length > 0;

    // profit shape with empty bands folded into the nearest lower (else higher) band that has items
    const baseShape = k => {
      const s = SHAPE.map(v => Math.pow(v, k));
      const t = s.reduce((a, b) => a + b, 0);
      const out = [0, 0, 0, 0];
      s.forEach((v, i) => {
        let j = i;
        while (j >= 0 && !has(j + 2)) j--;
        if (j < 0) { j = i; while (j < 4 && !has(j + 2)) j++; }
        if (j < 4) out[j] += v / t;
      });
      return out;
    };
    const lossSplit = a => (has(0) && has(1) ? [1 - a, a] : has(0) ? [1, 0] : has(1) ? [0, 1] : [0, 0]);
    const hitFor = () => (has(0) || has(1) ? HIT : HIT.map(() => 1));

    const bandProbs = (l, a, k) => {
      const h = hitFor()[l], ls = lossSplit(a), ws = baseShape(k);
      return [(1 - h) * ls[0], (1 - h) * ls[1], h * ws[0], h * ws[1], h * ws[2], h * ws[3]];
    };
    const rtpFor = (a, k) => {
      const pi = stationary(hitFor());
      let ev = 0;
      for (let l = 0; l < LEVELS; l++) ev += pi[l] * bandProbs(l, a, k).reduce((s, p, b) => s + p * (mean[b] || 0), 0);
      return ev / P;
    };
    const solve = (f, lo, hi, increasing) => {   // find x in [lo, hi] with f(x) = RTP
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if ((f(m) < RTP) === increasing) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    // Keep both loss bands above zero so every skin in the case always has a real chance.
    const A_MIN = 0.02, A_MAX = 0.98;
    let a = 0.5, k = 1;
    if (rtpFor(A_MAX, 1) < RTP) { a = A_MAX; k = solve(x => rtpFor(A_MAX, x), 0.05, 1, false); }       // need bigger wins
    else if (rtpFor(A_MIN, 1) > RTP) { a = A_MIN; k = solve(x => rtpFor(A_MIN, x), 1, 12, false); }   // need fewer big wins
    else a = solve(x => rtpFor(x, 1), A_MIN, A_MAX, true);

    const tables = [];
    for (let l = 0; l < LEVELS; l++) {
      const bp = bandProbs(l, a, k);
      tables.push(c.contents.map(x => +(bp[bandOf(SR.ITEMS[x.id].price, P)] * q.get(x.id) * 100).toPrecision(6)));
    }
    return { tables, rtp: rtpFor(a, k), hit: hitFor().slice(), split: a, tilt: k };
  };

  // Attach tables to every case: contents[i].chance = luck-0 chance (shown by default, used by battles),
  // c.luck[l][i] = chance at luck level l.
  // If a case can't reach the target return at its listed price (its cheapest skins are worth too much,
  // or its best ones too little), its price is nudged until it can.
  SR.applyLuckTables = () => {
    for (const c of SR.CASES) {
      let r = SR.buildLuckTables(c);
      for (let i = 0; i < 40 && Math.abs(r.rtp - RTP) > 0.003; i++) {
        c.price = Math.round(c.price * Math.pow(r.rtp / RTP, 0.7) * 100) / 100;
        r = SR.buildLuckTables(c);
      }
      c.luck = r.tables;
      c.rtp = r.rtp;
      c.hit = r.hit;
      c.contents.forEach((x, i) => { x.chance = r.tables[0][i]; });
    }
  };
  SR.caseTable = (c, luck) => c.contents.map((x, i) => ({ id: x.id, chance: c.luck ? c.luck[luck || 0][i] : x.chance }));
  SR.profitChance = (c, luck) => SR.caseTable(c, luck).reduce((s, x) => s + (SR.ITEMS[x.id].price >= c.price ? x.chance : 0), 0);

  SR.applyLuckTables();
})();
