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
    let winnerTeam = null, winners;
    if (b.share) {
      // Sharing mode: no winner and no skins handed out; the pot is split equally in coins (see SR.shareEach).
      return { drops, winnerTeam: null };
    } else {
      const totals = new Map();
      for (const d of drops) totals.set(teamOf(b.mode, d.seat), (totals.get(teamOf(b.mode, d.seat)) || 0) + cents(d.price));
      const teams = [...totals.keys()].sort((x, y) => x - y);
      const vals = teams.map(t => totals.get(t));
      const best = b.crazy ? Math.min(...vals) : Math.max(...vals);
      const tied = teams.filter(t => totals.get(t) === best);
      winnerTeam = tied[Math.floor((await SR.fair.rollMsg(seed, `${b.id}:tie`)) * tied.length)];
      winners = [...Array(b.seats).keys()].filter(s => teamOf(b.mode, s) === winnerTeam);
    }
    const haul = winners.map(() => 0);
    [...drops].sort((x, y) => cents(y.price) - cents(x.price) || x.round - y.round || x.seat - y.seat).forEach(d => {
      let k = 0;
      for (let j = 1; j < winners.length; j++) if (haul[j] < haul[k]) k = j;
      haul[k] += cents(d.price);
      d.wonBy = winners[k];
    });
    return { drops, winnerTeam };
  };

  // Sharing mode payout per seat (coins credited to every player; bots' shares go to the house).
  SR.shareEach = b => Math.round(b.drops.reduce((s, d) => s + d.price, 0) / b.seats * 100) / 100;

  /* ---------- helpers for pages ---------- */
  const casesCost = ids => Math.round(ids.reduce((s, id) => s + SR.caseById(id).price, 0) * 100) / 100;
  const seatTotal = (b, seat, upToRound = Infinity) => b.drops.filter(d => d.seat === seat && d.round <= upToRound).reduce((s, d) => s + d.price, 0);
  const potValue = b => b.drops.reduce((s, d) => s + d.price, 0);
  const myId = () => (SR.game.myId ? SR.game.myId() : 'me');
  const mySeat = b => { const p = b.players.find(x => x.userId === myId()); return p ? p.seat : -1; };
  const initial = name => esc((name || '?').replace(/^Bot /, '').slice(0, 1).toUpperCase());
  const modeLabel = b => `${MODES[b.mode].label}${b.share ? ' · Sharing' : b.crazy ? ' · Crazy' : ''}`;
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
  const ICONS = {
    normal: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3l7.5 7.5-1.4 1.4L2 4.8V3h1zm18 0v1.8l-7.1 7.1-1.4-1.4L20 3h1zM6.2 14.4l3.4 3.4-2.1 2.1 1.4 1.4-1.4 1.4-2.8-2.8-2.1 2.1L1.2 20.6l2.1-2.1L.5 15.7l1.4-1.4 1.4 1.4 2.9-1.3zm11.6 0l2.9 1.3 1.4-1.4 1.4 1.4-2.8 2.8 2.1 2.1-1.4 1.4-2.1-2.1-2.8 2.8-1.4-1.4 1.4-1.4-2.1-2.1 3.4-3.4zM12 9.2L16.3 5h2.8L13.4 10.6 12 9.2z" fill="currentColor"/></svg>',
    crazy: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-4 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM6.5 14h11a5.5 5.5 0 0 1-11 0z" fill="currentColor"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2l3 3h-2v4.1a5 5 0 0 1 3.6 2.6L20 10l-.7 4.2-3.6-2.2 1-.6a3 3 0 0 0-5.4 0l1 .6-3.6 2.2L8 10l3.4 1.7A5 5 0 0 1 11 9.1V5H9l3-3zM5 15h4v7H5v-7zm10 0h4v7h-4v-7z" fill="currentColor"/></svg>',
  };
  const kindOf = b => (b.share ? 'share' : b.crazy ? 'crazy' : 'normal');
  const isWinnerSeat = (b, s) => b.status === 'done' && (b.share || teamOf(b.mode, s) === b.winnerTeam);
  // Where a battle is right now: waiting for players, playing round N (everyone watches the same round), or ended.
  const progress = b => {
    if (b.status === 'open') return { state: 'waiting' };
    if (b.status !== 'done') return { state: 'ended' };
    const r = Math.floor((Date.now() - (b.startedAt || 0)) / ROUND_MS) + 1;
    return r <= b.cases.length ? { state: 'live', round: r } : { state: 'ended' };
  };
  const lobby = { kind: 'all', players: 'all', sort: 'high' };

  SR.pages.battles = {
    title: 'Case battles',
    render() {
      const pl = [['1v1', '2'], ['1v1v1', '3'], ['1v1v1v1', '4'], ['2v2', '2x2']];
      return `
      <section class="wrap section blobby">
        <div class="page-head page-head-row">
          <div><h1>Case battles</h1><p>Everyone opens the same cases, round by round. Normal: the highest total takes every skin. Crazy: the lowest total wins. Sharing: everyone splits the pot equally.</p></div>
          <a class="btn btn-go btn-lg" href="#/battles/new">Create battle</a>
        </div>
        <div class="bl-filters">
          <span class="bl-flabel">Mode</span>
          <div class="bl-group" role="group" aria-label="Mode">
            ${['normal', 'crazy', 'share'].map(k => `<button type="button" class="bl-icon ${lobby.kind === k ? 'on' : ''}" data-kind="${k}" aria-pressed="${lobby.kind === k}" title="${{ normal: 'Normal', crazy: 'Crazy mode', share: 'Sharing mode' }[k]}">${ICONS[k]}</button>`).join('')}
          </div>
          <span class="bl-flabel">Players</span>
          <div class="bl-group" role="group" aria-label="Players">
            ${pl.map(([m, l]) => `<button type="button" class="bl-num ${lobby.players === m ? 'on' : ''}" data-players="${m}" aria-pressed="${lobby.players === m}">${l}</button>`).join('')}
          </div>
          <select class="bl-sort" id="bl-sort" aria-label="Sort">
            <option value="high" ${lobby.sort === 'high' ? 'selected' : ''}>Highest price</option>
            <option value="low" ${lobby.sort === 'low' ? 'selected' : ''}>Lowest price</option>
            <option value="new" ${lobby.sort === 'new' ? 'selected' : ''}>Newest</option>
          </select>
          <button type="button" class="bl-reset" data-reset><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/></svg>Reset</button>
        </div>
        <div class="bl-table">
          <div class="bl-th" aria-hidden="true"><span>Rounds</span><span>Battle scenario</span><span></span><span>Cost</span><span>Players</span><span></span></div>
          <div id="bl-rows"><p class="muted bl-empty">Loading battles…</p></div>
        </div>
      </section>`;
    },
    mount(root) {
      let alive = true, list = [], timer = null;
      const row = b => {
        const pr = progress(b), me = mySeat(b) >= 0, filled = b.players.length;
        const roundsLabel = pr.state === 'live' ? 'Round' : b.cases.length === 1 ? 'Round' : 'Rounds';
        const scenario = b.cases.map((cid, i) => {
          const c = SR.caseById(cid), r = i + 1;
          const cls = pr.state === 'live' ? (r < pr.round ? 'past' : r === pr.round ? 'now' : '') : pr.state === 'ended' ? 'past' : '';
          return `<div class="bl-case ${cls}" style="--glow:${c.glow}">${SR.crate(c)}<span>${esc(c.name)}</span></div>`;
        }).join('');
        const seats = [...Array(b.seats).keys()].map(s => {
          const p = b.players.find(x => x.seat === s);
          return p ? `<span class="bavatar ${p.bot ? 'bot' : ''} ${isWinnerSeat(b, s) && pr.state === 'ended' ? 'won' : ''}" title="${esc(p.name)}">${initial(p.name)}</span>` : '<span class="bavatar open" aria-hidden="true"></span>';
        });
        if (b.mode === '2v2') seats.splice(2, 0, '<span class="bvs">vs</span>');
        const kind = kindOf(b);
        const tag = kind === 'share' ? 'Sharing mode' : kind === 'crazy' ? 'Crazy mode' : b.mode === '2v2' ? '2 vs 2' : '';
        const action = b.status === 'open' && !me
          ? `<a class="skew-btn bl-join" href="#/battle/${b.id}">Join ${money(b.cost)}</a>`
          : `<a class="skew-btn bl-watch" href="#/battle/${b.id}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="currentColor"/></svg>${me && b.status === 'open' ? 'Open' : 'Watch'}</a>`;
        return `<div class="bl-row is-${pr.state} kind-${kind}">
          <div class="bl-rounds">
            <span class="bl-status ${pr.state}">${pr.state === 'live' ? 'Live' : pr.state === 'waiting' ? 'Waiting' : 'Ended'}</span>
            <span class="bl-hex"><b>${pr.state === 'live' ? pr.round : b.cases.length}</b></span>
            <small>${roundsLabel}</small>
          </div>
          <div class="bl-scenario">${scenario}</div>
          <a class="bl-details" href="#/battle/${b.id}" title="Battle details">Details</a>
          <div class="bl-cost">${money(b.cost)}</div>
          <div class="bl-players">
            <span class="bl-count">${filled} / ${b.seats}</span>
            <span class="bseats">${seats.join('')}</span>
            ${tag ? `<span class="bl-tag ${kind}">${tag}</span>` : ''}
          </div>
          <div class="bl-act">${action}</div>
        </div>`;
      };
      const paint = () => {
        const order = { live: 0, waiting: 1, ended: 2 };
        let rows = list.filter(b => b.status !== 'cancelled')
          .filter(b => lobby.kind === 'all' || kindOf(b) === lobby.kind)
          .filter(b => lobby.players === 'all' || b.mode === lobby.players);
        const ended = rows.filter(b => progress(b).state === 'ended').slice(0, 12);
        rows = rows.filter(b => progress(b).state !== 'ended').concat(ended);
        rows.sort((a, b) => order[progress(a).state] - order[progress(b).state]
          || (lobby.sort === 'high' ? b.cost - a.cost : lobby.sort === 'low' ? a.cost - b.cost : b.createdAt - a.createdAt));
        $('#bl-rows', root).innerHTML = rows.length ? rows.map(row).join('')
          : `<div class="empty-inline bl-empty">No battles match. <a href="#/battles/new">Create one</a>, then invite others or fill the seats with bots.</div>`;
        // Live rows move round by round; repaint every second while any battle is live.
        clearTimeout(timer);
        if (alive) timer = setTimeout(paint, rows.some(b => progress(b).state === 'live') ? 1000 : 15000);
      };
      const load = async () => {
        try { list = await SR.game.listBattles(); }
        catch (e) { if (alive) $('#bl-rows', root).innerHTML = `<p class="bad-text bl-empty">${esc(SR.errorText(e))}</p>`; return; }
        if (alive) paint();
      };
      load();
      root.addEventListener('click', e => {
        const k = e.target.closest('[data-kind]'), pl = e.target.closest('[data-players]');
        if (k) lobby.kind = lobby.kind === k.dataset.kind ? 'all' : k.dataset.kind;
        else if (pl) lobby.players = lobby.players === pl.dataset.players ? 'all' : pl.dataset.players;
        else if (e.target.closest('[data-reset]')) { lobby.kind = 'all'; lobby.players = 'all'; lobby.sort = 'high'; $('#bl-sort', root).value = 'high'; }
        else return;
        $$('[data-kind]', root).forEach(b => { const on = b.dataset.kind === lobby.kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        $$('[data-players]', root).forEach(b => { const on = b.dataset.players === lobby.players; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        SR.audio.click();
        paint();
      });
      $('#bl-sort', root).addEventListener('change', e => { lobby.sort = e.target.value; paint(); });
      const off = SR.game.subscribeBattles(() => alive && load());
      const refresh = setInterval(() => alive && !document.hidden && load(), 15000);
      return () => { alive = false; off(); clearInterval(refresh); clearTimeout(timer); };
    },
  };

  /* ================= BUILDER ================= */
  const builder = { mode: '1v1', kind: 'normal', picks: [], q: '' };
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
            <div class="bopt">
              <span class="bopt-label">Mode</span>
              <div class="chips" role="group" aria-label="Battle mode">${[['normal', 'Normal: highest total wins'], ['crazy', 'Crazy: lowest total wins'], ['share', 'Sharing: everyone splits the pot']].map(([k, l]) => `<button type="button" class="chip ${builder.kind === k ? 'on' : ''}" data-kind="${k}" aria-pressed="${builder.kind === k}">${l}</button>`).join('')}</div>
            </div>
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
            <div><dt>Winner</dt><dd>${builder.kind === 'crazy' ? 'Lowest total' : builder.kind === 'share' ? 'Everyone shares' : 'Highest total'}</dd></div>
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
        const m = e.target.closest('[data-mode]'), add = e.target.closest('[data-add]'), sub = e.target.closest('[data-sub]'), kd = e.target.closest('[data-kind]');
        if (kd) {
          builder.kind = kd.dataset.kind;
          $$('[data-kind]', root).forEach(b => { b.classList.toggle('on', b === kd); b.setAttribute('aria-pressed', b === kd); });
          drawSide(); return;
        }
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
            const { battle } = await SR.game.createBattle(picks, builder.mode, builder.kind === 'crazy', builder.kind === 'share');
            builder.picks = [];
            location.hash = `#/battle/${battle.id}`;
          } catch (err) { SR.toast(SR.errorText(err), 'bad'); }
          busy = false; if (alive) drawSide();
          return;
        } else return;
        SR.audio.click();
        drawGrid(); drawSide();
      });
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
        box.insertAdjacentHTML('afterbegin', `<div class="bitem" style="--tc:${SR.tier(it).color}" title="${esc(SR.fullName(it))}">${SR.pic(it, 'bitem-img')}<span>${SR.money(it.price)}</span></div>`);
      };
      const setTotals = upTo => { for (let s = 0; s < b.seats; s++) { const el = $(`[data-total="${s}"]`, host); if (el) el.innerHTML = money(seatTotal(b, s, upTo)); } };

      const finish = () => {
        setRound(b.cases.length + 1);
        setTotals(Infinity);
        $$('.bcol', host).forEach(col => {
          const s = +col.dataset.seat;
          const won = isWinnerSeat(b, s);
          col.classList.toggle('winner', won); col.classList.toggle('loser', !won);
          if (won) $('.bplayer', col).insertAdjacentHTML('afterbegin', `<span class="bwin-tag">${b.share ? 'Shared' : 'Winner'}</span>`);
        });
        $('#b-status', host).textContent = b.share
          ? `Finished. The pot of ${SR.price(potValue(b))} was split: everyone got ${SR.price(SR.shareEach(b))}.`
          : `Finished. ${b.players.filter(p => teamOf(b.mode, p.seat) === b.winnerTeam).map(p => p.name).join(' & ')} won ${SR.price(potValue(b))}.`;
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
          if (b.share) { SR.audio.coins(); SR.toast(`Your share: ${SR.money(SR.shareEach(b))} added to your balance`, 'good'); return; }
          const mine = b.drops.filter(d => d.wonBy === me);
          if (mine.length) { SR.audio.coins(); SR.toast(`${b.share ? 'Your share' : 'You won the battle'}: ${mine.length} skins worth ${SR.price(mine.reduce((s, d) => s + d.price, 0))} added to your inventory`, 'good'); }
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
