/* Case battles: rules shared by local mode and the in-browser verifier, plus the lobby, builder and battle pages.
   Mirrors supabase/migrations/0002_case_battles.sql — change both together.

   Rules
   - 2–4 seats (1v1, 1v1v1, 1v1v1v1, 2v2). Every seat opens the same cases, one round per case.
   - Drop for round r (1-based), seat s (0-based) = case pick of HMAC_SHA256(battle seed, "<id>:<r>:<s>").
   - Team total = sum of its seats' drops (2v2: seats 0+1 vs 2+3). Highest total wins; crazy mode: lowest wins.
   - Tie: the tied teams in ascending order, pick index floor(HMAC(seed, "<id>:tie") × count).
   - The winning team takes every drop. Drops are dealt most-expensive first (then round, seat) to the
     winning seat with the smallest haul so far (lowest seat on ties). A bot's share goes to the house. */
(() => {
  const SR = window.SR;
  const { $, $$, esc, money } = SR;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const MODES = {
    '1v1': { seats: 2, label: '1 v 1' },
    '1v1v1': { seats: 3, label: '1 v 1 v 1' },
    '1v1v1v1': { seats: 4, label: '1 v 1 v 1 v 1' },
    '2v2': { seats: 4, label: '2 v 2' },
  };
  SR.BATTLE = { MODES, MAX_ROUNDS: 25, BOT_NAMES: ['Bot Ace', 'Bot Blitz', 'Bot Clutch', 'Bot Dust'] };
  const teamOf = (mode, seat) => (mode === '2v2' ? Math.floor(seat / 2) : seat);
  SR.battleTeamOf = teamOf;
  const cents = n => Math.round(n * 100);

  SR.battleOutcome = async (b, seed) => {
    const drops = [];
    for (let r = 1; r <= b.cases.length; r++) {
      const c = SR.caseById(b.cases[r - 1]);
      for (let s = 0; s < b.seats; s++) {
        const id = SR.pickWeighted(c.contents, await SR.fair.rollMsg(seed, `${b.id}:${r}:${s}`));
        drops.push({ round: r, seat: s, id, price: SR.item(id).price, wonBy: null });
      }
    }
    const totals = new Map();
    for (const d of drops) totals.set(teamOf(b.mode, d.seat), (totals.get(teamOf(b.mode, d.seat)) || 0) + cents(d.price));
    const teams = [...totals.keys()].sort((x, y) => x - y);
    const vals = teams.map(t => totals.get(t));
    const best = b.crazy ? Math.min(...vals) : Math.max(...vals);
    const tied = teams.filter(t => totals.get(t) === best);
    const winnerTeam = tied[Math.floor((await SR.fair.rollMsg(seed, `${b.id}:tie`)) * tied.length)];
    const winners = [...Array(b.seats).keys()].filter(s => teamOf(b.mode, s) === winnerTeam);
    const haul = winners.map(() => 0);
    [...drops].sort((x, y) => cents(y.price) - cents(x.price) || x.round - y.round || x.seat - y.seat).forEach(d => {
      let k = 0;
      for (let j = 1; j < winners.length; j++) if (haul[j] < haul[k]) k = j;
      haul[k] += cents(d.price);
      d.wonBy = winners[k];
    });
    return { drops, winnerTeam };
  };

  /* ---------- helpers for pages ---------- */
  const casesCost = ids => Math.round(ids.reduce((s, id) => s + SR.caseById(id).price, 0) * 100) / 100;
  const seatTotal = (b, seat, upToRound = Infinity) => b.drops.filter(d => d.seat === seat && d.round <= upToRound).reduce((s, d) => s + d.price, 0);
  const potValue = b => b.drops.reduce((s, d) => s + d.price, 0);
  const myId = () => (SR.game.myId ? SR.game.myId() : 'me');
  const mySeat = b => { const p = b.players.find(x => x.userId === myId()); return p ? p.seat : -1; };
  const initial = name => esc((name || '?').replace(/^Bot /, '').slice(0, 1).toUpperCase());
  const modeLabel = b => `${MODES[b.mode].label}${b.crazy ? ' · Crazy' : ''}`;
  const caseStrip = (ids, max = 6) => {
    const counts = [];
    ids.forEach(id => { const last = counts[counts.length - 1]; if (last && last.id === id) last.n++; else counts.push({ id, n: 1 }); });
    const shown = counts.slice(0, max);
    return `<span class="bcases">${shown.map(({ id, n }) => {
      const c = SR.caseById(id), top = c.contents.map(x => SR.item(x.id)).sort((a, b) => b.price - a.price)[0];
      return `<span class="bcase" style="--glow:${c.glow}" title="${esc(c.name)} case${n > 1 ? ` ×${n}` : ''}">${SR.pic(top, 'bcase-img')}${n > 1 ? `<i>×${n}</i>` : ''}</span>`;
    }).join('')}${counts.length > max ? `<span class="bcase-more">+${counts.length - max}</span>` : ''}</span>`;
  };

  /* ================= LOBBY ================= */
  SR.pages.battles = {
    title: 'Case battles',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head page-head-row">
          <div><h1>Case battles</h1><p>Open the same cases as other players, round by round. The highest total takes every skin. In Crazy mode, the lowest total wins.</p></div>
          <a class="btn btn-go btn-lg" href="#/battles/new">Create battle</a>
        </div>
        <h2 class="blist-title">Waiting for players</h2>
        <div class="blist" id="b-open"><p class="muted">Loading battles…</p></div>
        <h2 class="blist-title">Recent battles</h2>
        <div class="blist" id="b-done"></div>
      </section>`;
    },
    mount(root) {
      let alive = true;
      const row = b => {
        const filled = b.players.length, me = mySeat(b) >= 0;
        const seats = [...Array(b.seats).keys()].map(s => {
          const p = b.players.find(x => x.seat === s);
          const won = b.status === 'done' && teamOf(b.mode, s) === b.winnerTeam;
          return p ? `<span class="bavatar ${p.bot ? 'bot' : ''} ${won ? 'won' : ''}" title="${esc(p.name)}">${initial(p.name)}</span>` : '<span class="bavatar open" aria-hidden="true"></span>';
        });
        if (b.mode === '2v2') seats.splice(2, 0, '<span class="bvs">vs</span>');
        const action = b.status === 'open'
          ? (me ? `<a class="btn btn-ghost btn-sm" href="#/battle/${b.id}">Open</a>` : `<a class="btn btn-go btn-sm" href="#/battle/${b.id}">Join ${money(b.cost)}</a>`)
          : `<a class="btn btn-ghost btn-sm" href="#/battle/${b.id}">Watch</a>`;
        const winners = b.status === 'done' ? b.players.filter(p => teamOf(b.mode, p.seat) === b.winnerTeam).map(p => esc(p.name)).join(' & ') : '';
        return `<div class="brow">
          <span class="bmode">${modeLabel(b)}<small>${b.cases.length} ${b.cases.length === 1 ? 'round' : 'rounds'}</small></span>
          ${caseStrip(b.cases)}
          <span class="bseats">${seats.join('')}</span>
          <span class="bprice">${b.status === 'done' ? `<small>${winners} won</small>${money(potValue(b))}` : `<small>${filled}/${b.seats} players</small>${money(b.cost)}`}</span>
          ${action}
        </div>`;
      };
      const draw = async () => {
        let list;
        try { list = await SR.game.listBattles(); } catch (e) { if (alive) $('#b-open', root).innerHTML = `<p class="bad-text">${esc(SR.errorText(e))}</p>`; return; }
        if (!alive) return;
        const open = list.filter(b => b.status === 'open'), done = list.filter(b => b.status === 'done').slice(0, 12);
        $('#b-open', root).innerHTML = open.length ? open.map(row).join('')
          : `<div class="empty-inline">No battles are waiting. <a href="#/battles/new">Create one</a> and others can join, or fill the seats with bots.</div>`;
        $('#b-done', root).innerHTML = done.length ? done.map(row).join('') : '<div class="empty-inline">Finished battles show up here.</div>';
      };
      draw();
      const off = SR.game.subscribeBattles(() => alive && draw());
      const timer = setInterval(() => alive && !document.hidden && draw(), 15000);
      return () => { alive = false; off(); clearInterval(timer); };
    },
  };

  /* ================= BUILDER ================= */
  const builder = { mode: '1v1', crazy: false, picks: [], q: '' };
  SR.pages.battleNew = {
    title: 'Create battle',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head"><a class="btn btn-ghost btn-sm" href="#/battles">Back to battles</a><h1 class="mt-sm">Create a battle</h1></div>
        <div class="bbuild">
          <div class="bbuild-main">
            <div class="bopt">
              <span class="bopt-label">Players</span>
              <div class="chips" role="group" aria-label="Players">${Object.entries(MODES).map(([k, m]) => `<button type="button" class="chip ${builder.mode === k ? 'on' : ''}" data-mode="${k}" aria-pressed="${builder.mode === k}">${m.label}</button>`).join('')}</div>
            </div>
            <label class="switch bopt"><input type="checkbox" id="b-crazy" ${builder.crazy ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span>Crazy mode: the lowest total wins</label>
            <div class="picker-head"><h2>Add cases</h2><input class="input input-sm" type="search" id="b-q" placeholder="Search cases" value="${esc(builder.q)}" aria-label="Search cases"></div>
            <div class="bcase-grid" id="b-grid"></div>
          </div>
          <aside class="bbuild-side" id="b-side"></aside>
        </div>
      </section>`;
    },
    mount(root) {
      let alive = true, busy = false;
      const drawGrid = () => {
        const list = SR.CASES.filter(c => !builder.q || c.name.toLowerCase().includes(builder.q.toLowerCase()));
        $('#b-grid', root).innerHTML = list.map(c => {
          const n = builder.picks.filter(x => x === c.id).length;
          return `<div class="bpick ${n ? 'on' : ''}" style="--glow:${c.glow}">
            ${SR.crate(c)}
            <span class="case-name">${esc(c.name)}</span>
            <span class="price-tag">${money(c.price)}</span>
            <span class="bstep">
              <button type="button" class="bstep-btn" data-sub="${c.id}" aria-label="Remove one ${esc(c.name)} case" ${n ? '' : 'disabled'}>−</button>
              <b>${n}</b>
              <button type="button" class="bstep-btn" data-add="${c.id}" aria-label="Add one ${esc(c.name)} case">+</button>
            </span>
          </div>`;
        }).join('') || '<div class="empty-inline">No cases match that search.</div>';
      };
      const drawSide = () => {
        const cost = builder.picks.length ? casesCost(builder.picks) : 0;
        const can = builder.picks.length && SR.store.canAfford(cost) && !busy;
        $('#b-side', root).innerHTML = `
          <dl class="contract-sum">
            <div><dt>Players</dt><dd>${MODES[builder.mode].label}</dd></div>
            <div><dt>Rounds</dt><dd>${builder.picks.length} of ${SR.BATTLE.MAX_ROUNDS}</dd></div>
            <div><dt>Winner</dt><dd>${builder.crazy ? 'Lowest total' : 'Highest total'}</dd></div>
            <div><dt>Cost per player</dt><dd>${money(cost)}</dd></div>
          </dl>
          ${builder.picks.length ? caseStrip(builder.picks, 8) : '<p class="muted">Add at least one case.</p>'}
          <button class="btn btn-go btn-lg" type="button" id="b-create" ${can ? '' : 'disabled'}>${busy ? 'Creating…' : `Create for ${money(cost)}`}</button>
          ${builder.picks.length && !SR.store.canAfford(cost) ? `<p class="bad-text">You need ${money(cost - SR.store.state.balance)} more.</p>` : ''}
          ${builder.picks.length ? '<button class="link-btn" type="button" id="b-clear">Remove all cases</button>' : ''}`;
      };
      drawGrid(); drawSide();
      SR.onPage('state', () => alive && drawSide());
      root.addEventListener('click', async e => {
        const m = e.target.closest('[data-mode]'), add = e.target.closest('[data-add]'), sub = e.target.closest('[data-sub]');
        if (m) {
          builder.mode = m.dataset.mode;
          $$('[data-mode]', root).forEach(b => { b.classList.toggle('on', b === m); b.setAttribute('aria-pressed', b === m); });
          drawSide(); return;
        }
        if (add) {
          if (builder.picks.length >= SR.BATTLE.MAX_ROUNDS) { SR.toast(`A battle has up to ${SR.BATTLE.MAX_ROUNDS} rounds`); return; }
          builder.picks.push(add.dataset.add);
        } else if (sub) {
          const i = builder.picks.lastIndexOf(sub.dataset.sub);
          if (i >= 0) builder.picks.splice(i, 1);
        } else if (e.target.closest('#b-clear')) builder.picks = [];
        else if (e.target.closest('#b-create')) {
          if (busy) return;
          busy = true; drawSide();
          try {
            // Group identical cases so rounds read like the case strip.
            const order = SR.CASES.map(c => c.id);
            const picks = [...builder.picks].sort((a, b) => order.indexOf(a) - order.indexOf(b));
            const { battle } = await SR.game.createBattle(picks, builder.mode, builder.crazy);
            builder.picks = [];
            location.hash = `#/battle/${battle.id}`;
          } catch (err) { SR.toast(SR.errorText(err), 'bad'); }
          busy = false; if (alive) drawSide();
          return;
        } else return;
        SR.audio.click();
        drawGrid(); drawSide();
      });
      $('#b-crazy', root).addEventListener('change', e => { builder.crazy = e.target.checked; drawSide(); });
      $('#b-q', root).addEventListener('input', e => { builder.q = e.target.value; drawGrid(); });
      return () => { alive = false; };
    },
  };

  /* ================= BATTLE ROOM ================= */
  const SPIN_MS = 3000, PAUSE_MS = 1100;
  const ROUND_MS = SPIN_MS + 650 + 380 + PAUSE_MS;      // spin + settle glide + pause

  SR.pages.battle = {
    title: 'Battle',
    render() {
      return `<section class="wrap section battle-page" id="battle"><p class="muted">Loading battle…</p></section>`;
    },
    mount(root, { id }) {
      let alive = true, b = null, played = false, busy = false;
      const host = $('#battle', root);

      const shell = () => {
        const me = mySeat(b);
        const isCreator = b.creator === myId();
        const statusText = b.status === 'open' ? `Waiting for players: ${b.players.length} of ${b.seats}` : b.status === 'cancelled' ? 'Cancelled. Everyone was refunded.' : 'Finished';
        const cols = [...Array(b.seats).keys()].map(s => {
          const p = b.players.find(x => x.seat === s);
          const seatBtn = !p && b.status === 'open'
            ? (me < 0 ? `<button class="btn btn-go btn-sm" type="button" data-join>Join ${money(b.cost)}</button>` : isCreator ? '<button class="btn btn-ghost btn-sm" type="button" data-bots>Call bots</button>' : '<span class="muted">Waiting…</span>')
            : '';
          return `<div class="bcol" data-seat="${s}">
            <div class="bplayer">
              <span class="bavatar big ${p && p.bot ? 'bot' : ''} ${p ? '' : 'open'}">${p ? initial(p.name) : ''}</span>
              <span class="bname">${p ? esc(p.name) + (p.seat === me && p.name !== 'You' ? ' <em>(you)</em>' : '') : 'Open seat'}</span>
              <span class="btotal" data-total="${s}">${money(0)}</span>
              ${seatBtn}
            </div>
            <div class="breel" data-reel="${s}"></div>
            <div class="bwon" data-won="${s}"></div>
          </div>`;
        });
        if (b.mode === '2v2') cols.splice(2, 0, '<div class="bteam-vs" aria-hidden="true">VS</div>');
        host.innerHTML = `
          <div class="bhead">
            <a class="btn btn-ghost btn-sm" href="#/battles">Back</a>
            <div class="bhead-mid">
              <h1>${modeLabel(b)} battle</h1>
              <p class="muted" id="b-status">${statusText}</p>
            </div>
            <div class="bhead-right"><span class="muted">Cost per player</span><b>${money(b.cost)}</b></div>
          </div>
          <div class="bround-strip" id="b-rounds">${b.cases.map((cid, i) => {
            const c = SR.caseById(cid), top = c.contents.map(x => SR.item(x.id)).sort((x, y) => y.price - x.price)[0];
            return `<span class="bround" data-round="${i + 1}" style="--glow:${c.glow}" title="Round ${i + 1}: ${esc(c.name)} case">${SR.pic(top, 'bcase-img')}<i>${i + 1}</i></span>`;
          }).join('')}</div>
          <div class="bcols bcols-${b.seats} ${b.mode === '2v2' ? 'bcols-2v2' : ''}" id="b-cols">${cols.join('')}</div>
          <div class="bfoot">
            ${b.status === 'open' && isCreator ? `<button class="btn btn-ghost btn-sm" type="button" data-bots>Fill empty seats with bots</button><button class="link-btn" type="button" data-cancel>Cancel battle and refund</button>` : ''}
            <span class="muted mono bseed">Seed hash ${esc(b.serverHash.slice(0, 16))}…${b.seed ? ` · seed ${esc(b.seed.slice(0, 16))}…` : ''}</span>
            ${b.seed ? '<button class="link-btn" type="button" data-verify>Verify this battle</button>' : ''}
          </div>`;
      };

      const setRound = r => $$('.bround', host).forEach(el => {
        const n = +el.dataset.round;
        el.classList.toggle('now', n === r); el.classList.toggle('past', n < r);
      });
      const addWon = (d) => {
        const it = SR.item(d.id), box = $(`[data-won="${d.seat}"]`, host);
        box.insertAdjacentHTML('afterbegin', `<div class="bitem" style="--tc:${SR.tier(it).color}" title="${esc(SR.fullName(it))}">${SR.pic(it, 'bitem-img')}<span>${SR.price(it.price)}</span></div>`);
      };
      const setTotals = upTo => { for (let s = 0; s < b.seats; s++) { const el = $(`[data-total="${s}"]`, host); if (el) el.innerHTML = money(seatTotal(b, s, upTo)); } };

      const finish = () => {
        setRound(b.cases.length + 1);
        setTotals(Infinity);
        $$('.bcol', host).forEach(col => {
          const s = +col.dataset.seat;
          const won = teamOf(b.mode, s) === b.winnerTeam;
          col.classList.toggle('winner', won); col.classList.toggle('loser', !won);
          if (won) $('.bplayer', col).insertAdjacentHTML('afterbegin', '<span class="bwin-tag">Winner</span>');
        });
        $('#b-status', host).textContent = `Finished. ${b.players.filter(p => teamOf(b.mode, p.seat) === b.winnerTeam).map(p => p.name).join(' & ')} won ${SR.price(potValue(b))}.`;
      };

      // Play rounds from `fromRound`; earlier rounds appear instantly (you arrived late).
      async function play(fromRound) {
        played = true;
        for (let r = 1; r <= b.cases.length; r++) {
          if (!alive) return;
          const c = SR.caseById(b.cases[r - 1]);
          const roundDrops = b.drops.filter(d => d.round === r);
          setRound(r);
          $('#b-status', host).textContent = `Round ${r} of ${b.cases.length}`;
          const reels = roundDrops.map(d => {
            const box = $(`[data-reel="${d.seat}"]`, host);
            box.innerHTML = '';
            return new SR.Reel(box, c, d.id, { vertical: true, length: 34, winIndex: 28 });
          });
          if (r < fromRound) { reels.forEach(rl => rl.showResult()); }
          else {
            if (r === fromRound) SR.audio.spinUp();
            await Promise.all(reels.map((rl, i) => rl.spin(SR.reducedMotion() ? 400 : SPIN_MS, { sound: i === 0 })));
            const best = roundDrops.map(d => SR.item(d.id)).sort((x, y) => y.price - x.price)[0];
            if (SR.tier(best).rank >= 5) SR.audio.win(SR.tier(best).rank);
          }
          roundDrops.forEach(addWon);
          setTotals(r);
          if (r >= fromRound && r < b.cases.length) await wait(SR.reducedMotion() ? 200 : PAUSE_MS);
        }
        if (!alive) return;
        finish();
        const me = mySeat(b);
        if (me >= 0 && fromRound <= b.cases.length) {
          const mine = b.drops.filter(d => d.wonBy === me);
          if (mine.length) { SR.audio.coins(); SR.toast(`You won the battle: ${mine.length} skins worth ${SR.price(mine.reduce((s, d) => s + d.price, 0))} added to your inventory`, 'good'); }
          else { SR.audio.lose(); SR.toast(`You lost this battle. ${b.players.filter(p => teamOf(b.mode, p.seat) === b.winnerTeam).map(p => p.name).join(' & ')} took the pot.`, 'bad'); }
        }
      }

      const show = (fresh) => {
        shell();
        if (b.status !== 'done') return;
        // Everyone watching sees the same round at the same time: work out where the battle is now.
        const elapsed = Date.now() - (b.startedAt || 0);
        const atRound = fresh ? 1 : Math.floor(elapsed / ROUND_MS) + 1;
        if (atRound > b.cases.length) {
          for (let r = 1; r <= b.cases.length; r++) b.drops.filter(d => d.round === r).forEach(addWon);
          b.drops.filter(d => d.round === b.cases.length).forEach(d => {
            const box = $(`[data-reel="${d.seat}"]`, host);
            const rl = new SR.Reel(box, SR.caseById(b.cases[b.cases.length - 1]), d.id, { vertical: true, length: 34, winIndex: 28 });
            requestAnimationFrame(() => rl.showResult());
          });
          finish();
        } else play(atRound);
      };

      const load = async (fresh = false) => {
        try { b = await SR.game.getBattle(id); } catch (e) { b = null; }
        if (!alive) return;
        if (!b) { host.innerHTML = '<div class="empty"><h1>That battle doesn’t exist</h1><a class="btn btn-go" href="#/battles">See all battles</a></div>'; return; }
        if (!played) show(fresh);
      };
      load();

      const act = async (fn, label) => {
        if (busy) return;
        busy = true;
        try {
          const r = await fn();
          if (r && r.battle) { b = r.battle; if (!played) show(true); }
        } catch (e) { SR.toast(SR.errorText(e), 'bad'); load(); }
        busy = false;
      };
      host.addEventListener('click', e => {
        if (e.target.closest('[data-join]')) act(() => SR.game.joinBattle(id));
        else if (e.target.closest('[data-bots]')) act(() => SR.game.callBots(id));
        else if (e.target.closest('[data-cancel]')) act(async () => { const r = await SR.game.cancelBattle(id); SR.toast(`Battle cancelled. ${SR.price(b.cost)} refunded.`); return r; });
        else if (e.target.closest('[data-verify]')) verify();
      });
      async function verify() {
        const { drops, winnerTeam } = await SR.battleOutcome(b, b.seed);
        const okHash = (await SR.fair.sha256(b.seed)) === b.serverHash;
        const same = drops.every(d => { const s = b.drops.find(x => x.round === d.round && x.seat === d.seat); return s && s.id === d.id && s.wonBy === d.wonBy; }) && winnerTeam === b.winnerTeam;
        SR.modal(`<h2 class="modal-title">Battle check</h2>
          <p class="modal-sub">The seed's SHA-256 ${okHash ? '<b class="good-text">matches</b>' : '<b class="bad-text">does not match</b>'} the hash shown before the battle. Re-rolling every round from the seed in your browser ${same ? '<b class="good-text">gives the same drops and winner</b>' : '<b class="bad-text">gives a different result</b>'}.</p>
          <p class="mono wrap-any">Seed: ${esc(b.seed)}</p>
          <div class="win-actions"><button class="btn btn-ghost" type="button" data-close>OK</button></div>`, { label: 'Battle check' });
      }
      // Live: another player joins, bots arrive or the battle starts.
      const off = SR.game.subscribeBattles(p => { if (alive && !played && (!p || p.id === id || p.battle_id === id)) load(true); });
      return () => { alive = false; off(); };
    },
  };
})();
