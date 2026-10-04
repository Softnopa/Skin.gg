/* Pages: home, case, market, inventory, upgrade, trade. Each page = { render(params) → html, mount(root, params) → cleanup? } */
(() => {
  const SR = window.SR;
  const { $, $$, esc, fmt, money } = SR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byPriceDesc = (a, b) => b.price - a.price;
  const pct = c => (c >= 1 ? c.toFixed(2) : c >= 0.01 ? c.toFixed(3) : c >= 0.0001 ? c.toFixed(4) : c.toFixed(9).replace(/0+$/, '')) + '%';

  const pages = {};
  SR.pages = pages;

  /* Shared: when money runs short, point at the next free quiz. */
  const quizBtn = () => SR.quiz.ready()
    ? `<button class="btn btn-sell btn-sm" type="button" data-act="quiz">Win ${money(SR.QUIZ_REWARD)}: name a skin</button>`
    : `<span class="muted">Next free ${money(SR.QUIZ_REWARD)} quiz in <b data-quiz-clock>${SR.clock(SR.quiz.msLeft())}</b></span>`;
  SR.quizBtn = quizBtn;

  const GROUPS = [
    ['color', 'Colour cases', 'Every skin inside matches the case colour. Elite versions add knives and gloves.'],
    ['knife', 'Knives, gloves & rare patterns', 'Blue Gems, Doppler phases, Karambits and Katowice 2014 stickers.'],
    ['weapon', 'Weapon cases', 'One weapon family per case, from cheap finishes to the famous ones.'],
    ['wear', 'Wear cases', 'Every skin inside comes in the same wear.'],
    ['budget', 'Budget & rarity cases', 'Cheap spins, plenty of small wins, the odd big one.'],
  ];

  /* ================= HOME ================= */
  pages.home = {
    title: 'Cases',
    render() {
      const f = SR.caseById('souvenir');
      const lore = f.contents.find(x => x.id === 'awp-dragon-lore');
      const sections = GROUPS.map(([g, title, sub]) => {
        const list = SR.CASES.filter(c => c.group === g);
        if (g !== 'color') list.sort((a, b) => a.price - b.price);
        return `<section class="wrap section" id="g-${g}">
          <div class="section-head"><h2>${title}</h2><p>${sub}</p></div>
          <div class="case-grid">${list.map(SR.caseCard).join('')}</div>
        </section>`;
      }).join('');
      return `
      <section class="hero" style="--glow:${f.glow}">
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <p class="hero-kicker">Featured case</p>
            <h1 class="hero-title">Souvenir</h1>
            <p class="hero-sub">${f.contents.length} drops, from Katowice 2014 stickers to an AWP Dragon Lore at ${pct(lore ? lore.chance : 0.308)}. Every roll is provably fair.</p>
            <div class="hero-cta">
              <a class="btn btn-go btn-lg" href="#/case/souvenir">Open for ${money(f.price)}</a>
              <a class="btn btn-ghost btn-lg" href="#/case/blue-gem">Try the Blue Gem case</a>
            </div>
            <p class="hero-note">You start with ${money(2000)} of demo money. Every 15 minutes you can win ${money(SR.QUIZ_REWARD)} more by naming a skin.</p>
          </div>
          <a class="hero-art" href="#/case/souvenir" aria-label="Open the Souvenir case">${SR.crate(f, { big: true, peek: 3 })}</a>
        </div>
      </section>
      <nav class="wrap jump" aria-label="Case groups">
        ${GROUPS.map(([g, title]) => `<a class="chip" href="#g-${g}" data-jump="g-${g}">${title.split(' ')[0] === 'Knives,' ? 'Knives & patterns' : title.replace(' cases', '')}</a>`).join('')}
      </nav>
      ${sections}`;
    },
    mount(root) {
      root.addEventListener('click', e => {
        const j = e.target.closest('[data-jump]');
        if (!j) return;
        e.preventDefault();
        const el = document.getElementById(j.dataset.jump);
        if (el) el.scrollIntoView({ behavior: SR.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      });
    },
  };

  /* ================= CASE ================= */
  pages.case = {
    title: 'Case',
    render({ id }) {
      const c = SR.caseById(id);
      if (!c) return `<section class="wrap section empty"><h1>That case doesn't exist</h1><a class="btn btn-go" href="#/">See all cases</a></section>`;
      const items = c.contents.map(x => ({ it: SR.item(x.id), chance: x.chance })).sort((a, b) => byPriceDesc(a.it, b.it));
      return `
      <section class="wrap case-page" style="--glow:${c.glow}">
        <div class="case-head">
          <a class="btn btn-ghost btn-sm" href="#/"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="currentColor"/></svg>Back</a>
          <h1>${esc(c.name)} case</h1>
          <button class="btn btn-ghost btn-sm" type="button" data-act="fair">Provably fair</button>
        </div>
        <div class="stage" id="stage"><div class="stage-idle">${SR.crate(c, { big: true, peek: 3 })}</div></div>
        <div class="controls" id="controls"></div>
        <div class="section-head section-head-row">
          <h2>What's inside</h2>
          <button class="btn btn-ghost btn-sm" type="button" data-act="odds">Check odds</button>
        </div>
        <div class="item-grid">${items.map(({ it, chance }) =>
          SR.itemCard(it, { top: `<span>${pct(chance)}</span><span class="muted">${SR.price(it.price)}</span>` })).join('')}</div>
      </section>`;
    },

    mount(root, { id }) {
      const c = SR.caseById(id);
      if (!c) return;
      const st = SR.store.state;
      let count = 1, busy = false, alive = true;
      const controls = $('#controls', root), stage = $('#stage', root);

      const renderControls = () => {
        const total = c.price * count;
        const can = SR.store.canAfford(total);
        controls.innerHTML = `
          <div class="count-picker" role="group" aria-label="How many to open">
            ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="count-btn ${n === count ? 'on' : ''}" data-count="${n}" aria-pressed="${n === count}" ${busy ? 'disabled' : ''}>x${n}</button>`).join('')}
          </div>
          ${can || busy
            ? `<button class="btn btn-go btn-lg open-btn" type="button" data-act="open" ${busy ? 'disabled' : ''}>${busy ? 'Opening…' : `Open${count > 1 ? ` ${count}` : ''} for ${money(total)}`}</button>`
            : `<div class="short"><b>You need ${money(total - st.balance)} more to open this.</b>${quizBtn()}</div>`}
          <label class="switch"><input type="checkbox" data-act="fast" ${st.fast ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span>Fast open</label>`;
      };
      renderControls();
      const onState = () => { if (alive && !busy) renderControls(); };
      SR.onPage('state', onState);

      async function open() {
        if (busy) return;
        busy = true;
        renderControls();
        let results;
        try { ({ results } = await SR.game.openCase(c.id, count)); }
        catch (e) { busy = false; renderControls(); SR.toast(SR.errorText(e), 'bad'); return; }

        stage.innerHTML = `<div class="reels reels-${count}"></div>`;
        const host = stage.firstElementChild;
        const reels = results.map(r => new SR.Reel(host, c, r.entry.id, { compact: count > 1 }));
        const duration = SR.reducedMotion() ? 1200 : SR.store.state.fast ? 2200 : 6500;
        SR.audio.spinUp();
        await Promise.all(reels.map((rl, i) => rl.spin(duration, { sound: i === 0 })));

        results.forEach(r => SR.drops.push(r.entry.id, c, true));
        const best = results.map(r => SR.item(r.entry.id)).sort(byPriceDesc)[0];
        SR.audio.win(SR.tier(best).rank);
        await wait(SR.reducedMotion() ? 100 : 500);
        busy = false;
        if (!alive) return;
        renderControls();
        SR.showDrops(results.map(r => r.entry), { paid: c.price * results.length, paidLabel: results.length > 1 ? 'total' : 'case', againText: 'Open again', onAgain: open });
      }

      root.addEventListener('click', e => {
        const t = e.target.closest('[data-count],[data-act]');
        if (!t) return;
        if (t.dataset.count && !busy) { count = +t.dataset.count; SR.audio.click(); renderControls(); }
        else if (t.dataset.act === 'open') open();
        else if (t.dataset.act === 'odds') showOdds(c);
      });
      root.addEventListener('change', e => {
        if (e.target.matches('[data-act="fast"]')) { st.fast = e.target.checked; SR.store.save(); }
      });

      return () => { alive = false; };
    },
  };

  /* Shared result pop-up for cases and contracts: sell one, sell all, keep, or go again. */
  SR.showDrops = (entries, { paid, paidLabel = 'case', againText, onAgain }) => {
    const single = entries.length === 1;
    const items = entries.map(e => SR.item(e.id));
    const total = items.reduce((s, it) => s + it.price, 0);
    const delta = total - paid;
    const best = [...items].sort(byPriceDesc)[0];
    const bt = SR.tier(best);
    const headline = bt.rank >= 6 ? 'Jackpot!' : bt.rank === 5 ? 'Covert drop' : bt.rank === 4 ? 'Nice pull' : single ? 'You got' : 'Your drops';
    const deltaHtml = `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${SR.price(Math.abs(delta))} vs ${paidLabel} price</span>`;
    const sellable = entries.filter(e => !e.sold);

    const body = single ? `
      <div class="win-art"><div class="win-rays" aria-hidden="true"></div>${SR.pic(best, 'win-img')}</div>
      <div class="win-name"><span>${esc(best.weapon)}${best.wear ? ` · ${best.wear}` : ''}</span><b>${esc(best.finish)}</b></div>`
      : `<div class="win-grid">${entries.map(e => SR.itemCard(SR.item(e.id), {
          foot: e.sold ? '<span class="sold">Auto-sold</span>' : `<button class="btn btn-sell btn-xs" type="button" data-sell-one="${e.uid}">Sell ${money(SR.item(e.id).price)}</button>`,
        })).join('')}</div>`;

    const m = SR.modal(`
      <div class="win ${single ? '' : 'win-multi'}" style="--tc:${bt.color}">
        <p class="win-kicker">${esc(bt.name)}</p>
        <h2 class="win-title">${headline}</h2>
        ${body}
        <p class="win-meta">${money(total)} ${deltaHtml}</p>
        <div class="win-actions">
          ${sellable.length ? `<button class="btn btn-sell" type="button" data-sell-all>Sell ${single ? '' : 'all '}for ${money(sellable.reduce((s, e) => s + SR.item(e.id).price, 0))}</button>` : ''}
          <button class="btn btn-ghost" type="button" data-close>Keep</button>
          ${onAgain ? `<button class="btn btn-go" type="button" data-again>${againText}</button>` : ''}
        </div>
      </div>`, { cls: 'modal-win', label: headline });

    const remaining = new Set(sellable.map(e => e.uid));
    let selling = false;
    m.el.addEventListener('click', async e => {
      const one = e.target.closest('[data-sell-one]');
      const all = e.target.closest('[data-sell-all]');
      if ((one || all) && !selling) {
        const uids = one ? [one.dataset.sellOne] : [...remaining];
        selling = true;
        try {
          const { total: got } = await SR.game.sell(uids);
          SR.audio.coins();
          SR.toast(`Sold for ${money(got)}`, 'good');
          uids.forEach(u => remaining.delete(u));
          if (all) { m.close(); return; }
          one.outerHTML = '<span class="sold">Sold</span>';
          const left = entries.filter(x => remaining.has(x.uid)).reduce((s, x) => s + SR.item(x.id).price, 0);
          const allBtn = $('[data-sell-all]', m.el);
          if (allBtn) { if (remaining.size) allBtn.innerHTML = `Sell all for ${money(left)}`; else allBtn.remove(); }
        } catch (err) { SR.toast(SR.errorText(err), 'bad'); }
        selling = false;
      } else if (e.target.closest('[data-again]')) {
        m.close();
        onAgain();
      }
    });
  };

  function showOdds(c) {
    const rows = SR.ranges(c.contents).map(r => {
      const it = SR.item(r.id), t = SR.tier(it);
      return `<tr>
        <td><span class="dot" style="background:${t.color}"></span>${esc(it.weapon)} <b>${esc(it.finish)}</b></td>
        <td class="num">${SR.price(it.price)}</td>
        <td class="num">${pct(r.chance)}</td>
        <td class="num mono">${r.from.toFixed(6)} – ${r.to.toFixed(6)}</td>
      </tr>`;
    }).join('');
    const ev = c.contents.reduce((s, x) => s + x.chance / 100 * SR.item(x.id).price, 0);
    SR.modal(`
      <h2 class="modal-title">${esc(c.name)} odds</h2>
      <p class="modal-sub">Each open rolls a number from 0 to 1. The row whose range contains it is your drop. Average value per open: ${money(ev)} (case price ${money(c.price)}).</p>
      <div class="table-wrap"><table class="odds">
        <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Chance</th><th class="num">Roll range</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`, { cls: 'modal-wide', label: 'Case odds' });
  }

  /* ================= MARKET ================= */
  const TIER_FILTERS = [
    ['all', 'All'], ['gold', 'Knives & gloves'], ['covert', 'Covert'], ['classified', 'Classified'],
    ['restricted', 'Restricted'], ['milspec', 'Mil-Spec'], ['sticker', 'Stickers'],
  ];
  const matchTier = (it, f) => f === 'all' ? true : f === 'sticker' ? it.type === 'Sticker'
    : f === 'gold' ? (it.tier === 'gold' || it.tier === 'contraband') : (it.tier === f && it.type !== 'Sticker');
  const matchQ = (it, q) => !q || SR.fullName(it).toLowerCase().includes(q.toLowerCase());
  const TYPES = ['all', 'Knife', 'Gloves', 'Rifle', 'Pistol', 'SMG', 'Heavy', 'Sticker'];
  const COLORS = ['all', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black'];
  const PAGE = 60;

  const market = { q: '', tier: 'all', type: 'all', color: 'all', sort: 'desc', limit: PAGE };
  pages.market = {
    title: 'Market',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head"><h1>Market</h1><p>${fmt(SR.ITEM_LIST.length)} skins at current market prices. A purchase lands in your inventory right away.</p></div>
        <div class="toolbar">
          <input class="input" type="search" id="mq" placeholder="Search skins, e.g. Karambit" value="${esc(market.q)}" aria-label="Search skins">
          <select class="input select" id="mtype" aria-label="Type">${TYPES.map(t => `<option value="${t}" ${market.type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t === 'Knife' ? 'Knives' : t === 'Heavy' ? 'Heavy' : t + 's'}</option>`).join('')}</select>
          <select class="input select" id="mcolor" aria-label="Colour">${COLORS.map(c => `<option value="${c}" ${market.color === c ? 'selected' : ''}>${c === 'all' ? 'All colours' : c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select>
          <select class="input select" id="msort" aria-label="Sort">
            <option value="desc" ${market.sort === 'desc' ? 'selected' : ''}>Price: high to low</option>
            <option value="asc" ${market.sort === 'asc' ? 'selected' : ''}>Price: low to high</option>
            <option value="name" ${market.sort === 'name' ? 'selected' : ''}>Name</option>
          </select>
        </div>
        <div class="chips chips-row" role="group" aria-label="Filter by rarity">
          ${TIER_FILTERS.map(([k, l]) => `<button type="button" class="chip ${market.tier === k ? 'on' : ''}" data-tier="${k}" aria-pressed="${market.tier === k}">${l}</button>`).join('')}
        </div>
        <p class="muted result-count" id="mcount"></p>
        <div class="item-grid" id="mgrid"></div>
        <div class="more-row"><button class="btn btn-ghost" type="button" id="mmore" hidden>Show more</button></div>
      </section>`;
    },
    mount(root) {
      const grid = $('#mgrid', root);
      let alive = true;
      const draw = () => {
        let list = SR.ITEM_LIST.filter(it => matchTier(it, market.tier) && matchQ(it, market.q)
          && (market.type === 'all' || it.type === market.type) && (market.color === 'all' || it.color === market.color));
        list.sort(market.sort === 'asc' ? (a, b) => a.price - b.price : market.sort === 'name' ? (a, b) => SR.fullName(a).localeCompare(SR.fullName(b)) : byPriceDesc);
        $('#mcount', root).textContent = `${fmt(list.length)} ${list.length === 1 ? 'skin' : 'skins'}`;
        grid.innerHTML = list.length ? list.slice(0, market.limit).map(it => SR.itemCard(it, {
          top: `<span class="tier-label">${SR.tier(it).name}</span>`,
          foot: `<span class="price">${money(it.price)}</span><button class="btn btn-go btn-xs" type="button" data-buy="${it.id}" ${SR.store.canAfford(it.price) ? '' : 'disabled title="Not enough money"'}>Buy</button>`,
        })).join('') : `<div class="empty-inline">No skins match these filters. Try a shorter search or set a filter back to “All”.</div>`;
        $('#mmore', root).hidden = list.length <= market.limit;
      };
      draw();
      SR.onPage('state', () => alive && draw());
      const reset = () => { market.limit = PAGE; draw(); };
      $('#mq', root).addEventListener('input', e => { market.q = e.target.value; reset(); });
      $('#msort', root).addEventListener('change', e => { market.sort = e.target.value; reset(); });
      $('#mtype', root).addEventListener('change', e => { market.type = e.target.value; reset(); });
      $('#mcolor', root).addEventListener('change', e => { market.color = e.target.value; reset(); });
      $('#mmore', root).addEventListener('click', () => { market.limit += PAGE; draw(); });
      root.addEventListener('click', e => {
        const chip = e.target.closest('[data-tier]');
        if (chip) {
          market.tier = chip.dataset.tier;
          $$('[data-tier]', root).forEach(b => { b.classList.toggle('on', b === chip); b.setAttribute('aria-pressed', b === chip); });
          reset();
        }
        const buy = e.target.closest('[data-buy]');
        if (buy && !buy.disabled) {
          const it = SR.item(buy.dataset.buy);
          buy.disabled = true;
          SR.game.buy(it.id).then(() => {
            SR.audio.coins();
            SR.toast(`Bought ${esc(SR.fullName(it))}`, 'good');
          }).catch(err => { buy.disabled = false; SR.toast(SR.errorText(err), 'bad'); });
        }
      });
      return () => { alive = false; };
    },
  };

  /* ================= INVENTORY ================= */
  pages.inventory = {
    title: 'Inventory',
    render() { return `<section class="wrap section" id="inv"></section>`; },
    mount(root) {
      const host = $('#inv', root);
      let alive = true;
      const st = SR.store.state;
      const draw = () => {
        const inv = st.inv;
        const value = SR.store.invValue();
        const best = st.stats.best && SR.item(st.stats.best);
        host.innerHTML = `
          <div class="page-head page-head-row">
            <div><h1>Inventory</h1><p>${inv.length} ${inv.length === 1 ? 'skin' : 'skins'} worth ${money(value)}</p></div>
            ${inv.length ? `<button class="btn btn-sell" type="button" data-act="sell-all">Sell all for ${money(value)}</button>` : ''}
          </div>
          <dl class="stats">
            <div><dt>Cases opened</dt><dd>${fmt(st.stats.opened)}</dd></div>
            <div><dt>Spent on cases</dt><dd>${money(st.stats.spent)}</dd></div>
            <div><dt>Dropped from cases</dt><dd>${money(st.stats.won)}</dd></div>
            <div><dt>Upgrades won</dt><dd>${st.stats.upgradesWon} of ${st.stats.upgrades}</dd></div>
            <div><dt>Quizzes won</dt><dd>${st.stats.quizWon}</dd></div>
            <div><dt>Contracts signed</dt><dd>${st.stats.contracts || 0}</dd></div>
            <div><dt>Best drop</dt><dd>${best ? `<span style="color:${SR.tier(best).color}">${esc(SR.fullName(best))}</span>` : '—'}</dd></div>
          </dl>
          ${inv.length ? `<div class="item-grid">${inv.slice(0, shown).map(e => {
            const it = SR.item(e.id);
            return SR.itemCard(it, {
              top: `<span class="tier-label">${SR.tier(it).name}</span>`,
              attrs: `title="From: ${srcLabel(e.src)}"`,
              foot: `<span class="price">${money(it.price)}</span>
                <span class="foot-actions">
                  <a class="btn btn-ghost btn-xs" href="#/upgrade?stake=${e.uid}" title="Use in an upgrade">Upgrade</a>
                  <button class="btn btn-sell btn-xs" type="button" data-sell="${e.uid}">Sell</button>
                </span>`,
            });
          }).join('')}</div>
          ${inv.length > shown ? `<div class="more-row"><button class="btn btn-ghost" type="button" data-act="more">Show more (${inv.length - shown} left)</button></div>` : ''}`
          : `<div class="empty">
              <h2>Your inventory is empty</h2>
              <p>Open a case or buy a skin and it will show up here.</p>
              <div class="hero-cta"><a class="btn btn-go" href="#/">Open a case</a><a class="btn btn-ghost" href="#/market">Go to market</a></div>
            </div>`}`;
      };
      let shown = 120;
      draw();
      SR.onPage('state', () => alive && draw());
      host.addEventListener('click', e => {
        const s = e.target.closest('[data-sell]');
        if (s) {
          if (s.disabled) return;
          s.disabled = true;
          SR.game.sell([s.dataset.sell]).then(({ total }) => {
            SR.audio.coins();
            SR.toast(`Sold for ${money(total)}`, 'good');
          }).catch(err => { s.disabled = false; SR.toast(SR.errorText(err), 'bad'); });
          return;
        }
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'sell-all') {
          const m = SR.modal(`<h2 class="modal-title">Sell all ${st.inv.length} skins?</h2>
            <p class="modal-sub">You'll get ${money(SR.store.invValue())} and your inventory will be empty.</p>
            <div class="win-actions"><button class="btn btn-sell" type="button" data-yes>Sell all</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div>`, { label: 'Confirm sell all' });
          $('[data-yes]', m.el).addEventListener('click', async ev => {
            ev.currentTarget.disabled = true;
            try {
              const { total, count } = await SR.game.sell(SR.store.state.inv.map(x => x.uid));
              SR.audio.coins();
              SR.toast(`Sold ${count} skins for ${money(total)}`, 'good');
            } catch (err) { SR.toast(SR.errorText(err), 'bad'); }
            m.close();
          });
        } else if (a.dataset.act === 'more') {
          shown += 120; draw();
        }
      });
      return () => { alive = false; };
    },
  };
  function srcLabel(src = '') {
    if (src.startsWith('case:')) { const c = SR.caseById(src.slice(5)); return c ? `${esc(c.name)} case` : 'Case'; }
    return { market: 'Market', upgrade: 'Upgrade', trade: 'Trade', contract: 'Contract' }[src] || '';
  }

  /* ================= UPGRADE ================= */
  const upg = { stake: [], target: null, q: '' };
  const MAX_STAKE = 4, HOUSE = 0.95, CAP = 0.8;
  const R = 96, CIRC = 2 * Math.PI * R;

  pages.upgrade = {
    title: 'Upgrade',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head"><h1>Upgrade</h1><p>Stake up to ${MAX_STAKE} skins for a chance at a pricier one. The bigger the jump, the lower the chance.</p></div>
        <div class="upg-stage">
          <div class="upg-slot" id="slot-in"></div>
          <div class="upg-dial" id="dial">
            <svg viewBox="0 0 240 240" aria-hidden="true">
              <circle cx="120" cy="120" r="${R}" class="dial-track"/>
              <circle cx="120" cy="120" r="${R}" class="dial-arc" id="arc" transform="rotate(-90 120 120)" stroke-dasharray="0 ${CIRC}"/>
              <g id="needle" class="dial-needle"><path d="M120 8 L111 -6 H129 Z" transform="translate(0 14)"/></g>
            </svg>
            <div class="dial-center"><b id="chance">0%</b><span id="mult">Pick both sides</span></div>
          </div>
          <div class="upg-slot" id="slot-out"></div>
        </div>
        <div class="upg-actions">
          <div class="chips" role="group" aria-label="Quick target">
            ${[1.5, 2, 3, 5, 10].map(m => `<button type="button" class="chip" data-mult="${m}">x${m}</button>`).join('')}
          </div>
          <button class="btn btn-go btn-lg" type="button" id="upg-go" disabled>Upgrade</button>
        </div>
        <div class="pickers">
          <div class="picker">
            <div class="picker-head"><h2>Your skins</h2><span class="muted" id="stake-hint"></span></div>
            <div class="item-grid item-grid-sm" id="pick-in"></div>
          </div>
          <div class="picker">
            <div class="picker-head"><h2>Targets</h2><input class="input input-sm" type="search" id="tq" placeholder="Search" aria-label="Search targets" value="${esc(upg.q)}"></div>
            <div class="item-grid item-grid-sm" id="pick-out"></div>
          </div>
        </div>
      </section>`;
    },

    mount(root, params) {
      const st = SR.store.state;
      let alive = true, spinning = false, needleDeg = 0;
      upg.stake = upg.stake.filter(uid => st.inv.some(e => e.uid === uid));
      if (params.stake && st.inv.some(e => e.uid === params.stake)) { upg.stake = [params.stake]; upg.target = null; }

      const stakeValue = () => upg.stake.reduce((s, uid) => { const e = st.inv.find(x => x.uid === uid); return s + (e ? SR.item(e.id).price : 0); }, 0);
      const chanceOf = () => {
        const v = stakeValue(), t = upg.target && SR.item(upg.target);
        if (!v || !t || t.price <= v) return 0;
        return Math.min(CAP, v / t.price * HOUSE);
      };

      const draw = () => {
        const v = stakeValue();
        if (upg.target && SR.item(upg.target).price <= v) upg.target = null;
        const ch = chanceOf();
        const t = upg.target && SR.item(upg.target);

        $('#slot-in', root).innerHTML = upg.stake.length
          ? `<div class="slot-stack">${upg.stake.map(uid => { const it = SR.item(st.inv.find(x => x.uid === uid).id); return `<span class="slot-stack-item" style="--tc:${SR.tier(it).color}">${SR.pic(it)}</span>`; }).join('')}</div>
             <div class="slot-label"><span>Your stake</span><b>${money(v)}</b></div>`
          : `<div class="slot-empty">Pick skins from your inventory below</div>`;
        $('#slot-out', root).innerHTML = t
          ? `<span class="slot-img" style="--tc:${SR.tier(t).color}">${SR.pic(t)}</span>
             <div class="slot-label"><span>${esc(t.weapon)} · ${esc(t.finish)}</span><b>${money(t.price)}</b></div>`
          : `<div class="slot-empty">Pick a target skin</div>`;

        $('#arc', root).setAttribute('stroke-dasharray', `${ch * CIRC} ${CIRC}`);
        $('#chance', root).textContent = (ch * 100).toFixed(2) + '%';
        $('#mult', root).textContent = t && v ? `x${(t.price / v).toFixed(2)}` : 'Pick both sides';
        $('#upg-go', root).disabled = spinning || !ch;
        $('#stake-hint', root).textContent = `${upg.stake.length}/${MAX_STAKE} selected`;

        $('#pick-in', root).innerHTML = st.inv.length ? st.inv.map(e => {
          const it = SR.item(e.id), on = upg.stake.includes(e.uid);
          return SR.itemCard(it, { cls: `pickable ${on ? 'on' : ''}`, attrs: `role="button" tabindex="0" aria-pressed="${on}" data-stake="${e.uid}"`, foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : `<div class="empty-inline">No skins yet. <a href="#/">Open a case</a> or <a href="#/market">buy one</a> first.</div>`;

        const targets = SR.ITEM_LIST.filter(it => it.price > v && matchQ(it, upg.q)).sort((a, b) => a.price - b.price).slice(0, 80);
        $('#pick-out', root).innerHTML = targets.length ? targets.map(it => {
          const on = upg.target === it.id;
          const c = v ? Math.min(CAP, v / it.price * HOUSE) : 0;
          return SR.itemCard(it, { cls: `pickable ${on ? 'on' : ''}`, attrs: `role="button" tabindex="0" aria-pressed="${on}" data-target="${it.id}"`,
            top: v ? `<span>${(c * 100).toFixed(1)}%</span>` : '', foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : `<div class="empty-inline">Nothing in the catalog is worth more than your stake. Try staking less.</div>`;
      };
      draw();
      SR.onPage('state', () => alive && !spinning && draw());

      root.addEventListener('click', e => {
        if (spinning) return;
        const s = e.target.closest('[data-stake]');
        if (s) {
          const uid = s.dataset.stake;
          if (upg.stake.includes(uid)) upg.stake = upg.stake.filter(x => x !== uid);
          else if (upg.stake.length < MAX_STAKE) upg.stake.push(uid);
          else SR.toast(`You can stake up to ${MAX_STAKE} skins`);
          SR.audio.click(); draw(); return;
        }
        const t = e.target.closest('[data-target]');
        if (t) { upg.target = upg.target === t.dataset.target ? null : t.dataset.target; SR.audio.click(); draw(); return; }
        const m = e.target.closest('[data-mult]');
        if (m) {
          const v = stakeValue();
          if (!v) { SR.toast('Pick skins to stake first'); return; }
          const goal = v * +m.dataset.mult;
          const best = SR.ITEM_LIST.filter(it => it.price > v).sort((a, b) => Math.abs(a.price - goal) - Math.abs(b.price - goal))[0];
          if (best) { upg.target = best.id; SR.audio.click(); draw(); }
        }
      });
      $('#tq', root).addEventListener('input', e => { upg.q = e.target.value; draw(); });
      $('#upg-go', root).addEventListener('click', go);

      async function go() {
        const ch = chanceOf();
        if (!ch || spinning) return;
        spinning = true;
        const dial = $('#dial', root);
        dial.classList.remove('win', 'lose');
        $('#upg-go', root).disabled = true;
        $('#upg-go', root).textContent = 'Rolling…';
        const target = upg.target, stake = [...upg.stake];
        // The outcome is settled before the needle moves, so a reload mid-spin can't dodge it.
        let roll, won;
        try { ({ roll, won } = await SR.game.upgrade(stake, target)); }
        catch (e) {
          spinning = false;
          $('#upg-go', root).textContent = 'Upgrade';
          SR.toast(SR.errorText(e), 'bad');
          upg.stake = []; draw();
          return;
        }

        // Needle lands exactly on the roll: the green arc covers [0, chance) clockwise from the top.
        const from = needleDeg % 360;
        const to = 360 * 5 + roll.value * 360;
        const dur = SR.reducedMotion() ? 600 : 4200;
        const ease = t => 1 - Math.pow(1 - t, 4);
        const needle = $('#needle', root);
        let lastTick = 0, lastSeg = -1;
        await new Promise(res => {
          const t0 = performance.now();
          const f = now => {
            const p = Math.min(1, (now - t0) / dur);
            const d = from + (to - from) * ease(p);
            needle.setAttribute('transform', `rotate(${d} 120 120)`);
            const seg = Math.floor(d / 24);
            if (seg !== lastSeg && now - lastTick > 40) { SR.audio.tick(); lastTick = now; lastSeg = seg; }
            if (p < 1) requestAnimationFrame(f); else res();
          };
          requestAnimationFrame(f);
        });
        needleDeg = to;

        dial.classList.add(won ? 'win' : 'lose');
        $('#chance', root).textContent = won ? 'Won' : 'Lost';
        if (won) { SR.audio.win(SR.tier(SR.item(target)).rank); SR.toast(`Upgraded to ${esc(SR.fullName(SR.item(target)))}`, 'good'); SR.drops.push(target, null, true); }
        else { SR.audio.lose(); SR.toast('Upgrade lost. Your stake is gone.', 'bad'); }
        await wait(1600);
        spinning = false;
        upg.stake = []; upg.target = null;
        dial.classList.remove('win', 'lose');
        $('#upg-go', root).textContent = 'Upgrade';
        if (alive) draw();
      }
      return () => { alive = false; };
    },
  };

  /* ================= TRADE ================= */
  const trade = { give: [], get: [], q: '', limit: PAGE };
  pages.trade = {
    title: 'Trade',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head"><h1>Trade</h1><p>Swap your skins for the bot's. Any difference in value is settled from your balance.</p></div>
        <div class="trade-board">
          <div class="trade-side"><div class="picker-head"><h2>You give</h2><b id="give-total"></b></div><div class="trade-slots" id="give"></div></div>
          <div class="trade-mid" id="trade-mid"></div>
          <div class="trade-side"><div class="picker-head"><h2>You get</h2><b id="get-total"></b></div><div class="trade-slots" id="get"></div></div>
        </div>
        <div class="pickers">
          <div class="picker">
            <div class="picker-head"><h2>Your inventory</h2></div>
            <div class="item-grid item-grid-sm" id="trade-inv"></div>
          </div>
          <div class="picker">
            <div class="picker-head"><h2>Bot stock</h2><input class="input input-sm" type="search" id="trq" placeholder="Search" aria-label="Search bot stock" value="${esc(trade.q)}"></div>
            <div class="item-grid item-grid-sm" id="trade-bot"></div>
            <div class="more-row"><button class="btn btn-ghost btn-sm" type="button" id="trade-more" hidden>Show more</button></div>
          </div>
        </div>
      </section>`;
    },
    mount(root) {
      const st = SR.store.state;
      let alive = true;
      trade.give = trade.give.filter(uid => st.inv.some(e => e.uid === uid));
      const giveVal = () => trade.give.reduce((s, uid) => s + SR.item(st.inv.find(e => e.uid === uid).id).price, 0);
      const getVal = () => trade.get.reduce((s, id) => s + SR.item(id).price, 0);

      const draw = () => {
        trade.give = trade.give.filter(uid => st.inv.some(e => e.uid === uid));
        const g = giveVal(), r = getVal(), diff = r - g;
        $('#give', root).innerHTML = trade.give.length ? trade.give.map(uid => {
          const it = SR.item(st.inv.find(e => e.uid === uid).id);
          return SR.itemCard(it, { cls: 'pickable', attrs: `role="button" tabindex="0" title="Remove" data-ungive="${uid}"`, foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : '<div class="slot-empty">Click your skins below to offer them</div>';
        $('#get', root).innerHTML = trade.get.length ? trade.get.map((id, i) => {
          const it = SR.item(id);
          return SR.itemCard(it, { cls: 'pickable', attrs: `role="button" tabindex="0" title="Remove" data-unget="${i}"`, foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : '<div class="slot-empty">Click skins in the bot stock to request them</div>';
        $('#give-total', root).innerHTML = money(g);
        $('#get-total', root).innerHTML = money(r);

        const empty = !trade.give.length && !trade.get.length;
        const short = diff > 0 && !SR.store.canAfford(diff);
        $('#trade-mid', root).innerHTML = `
          <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><path d="M8 17h28l-7-7 2.8-2.8L43.6 19 31.8 30.8 29 28l7-7H8zM40 31H12l7 7-2.8 2.8L4.4 29l11.8-11.8L19 20l-7 7h28z" fill="currentColor"/></svg>
          <p class="trade-sum">${empty ? 'Add skins to either side' : diff > 0 ? `You pay ${money(diff)}` : diff < 0 ? `You receive ${money(-diff)}` : 'Even trade'}</p>
          ${short ? `<p class="bad-text">You need ${money(diff - st.balance)} more.</p>${quizBtn()}` : ''}
          <button class="btn btn-go" type="button" id="trade-go" ${empty || short ? 'disabled' : ''}>Confirm trade</button>`;

        $('#trade-inv', root).innerHTML = st.inv.length ? st.inv.filter(e => !trade.give.includes(e.uid)).map(e => {
          const it = SR.item(e.id);
          return SR.itemCard(it, { cls: 'pickable', attrs: `role="button" tabindex="0" data-give="${e.uid}"`, foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') || '<div class="empty-inline">Everything is already on the table.</div>'
          : `<div class="empty-inline">No skins yet. <a href="#/">Open a case</a> first, or just buy from the bot.</div>`;

        const stock = SR.ITEM_LIST.filter(it => matchQ(it, trade.q)).sort(byPriceDesc);
        $('#trade-bot', root).innerHTML = stock.slice(0, trade.limit).map(it => SR.itemCard(it, { cls: 'pickable', attrs: `role="button" tabindex="0" data-get="${it.id}"`, foot: `<span class="price">${money(it.price)}</span>` })).join('')
          || `<div class="empty-inline">No skins match “${esc(trade.q)}”.</div>`;
        $('#trade-more', root).hidden = stock.length <= trade.limit;
      };
      draw();
      SR.onPage('state', () => alive && draw());

      root.addEventListener('click', e => {
        const t = e.target.closest('[data-give],[data-ungive],[data-get],[data-unget],#trade-go');
        if (!t) return;
        if (t.id === 'trade-go') return confirm();
        if (t.dataset.give) trade.give.push(t.dataset.give);
        else if (t.dataset.ungive) trade.give = trade.give.filter(x => x !== t.dataset.ungive);
        else if (t.dataset.get) { if (trade.get.length >= 10) { SR.toast('You can request up to 10 skins per trade'); return; } trade.get.push(t.dataset.get); }
        else if (t.dataset.unget) trade.get.splice(+t.dataset.unget, 1);
        SR.audio.click();
        draw();
      });
      $('#trq', root).addEventListener('input', e => { trade.q = e.target.value; trade.limit = PAGE; draw(); });
      $('#trade-more', root).addEventListener('click', () => { trade.limit += PAGE; draw(); });

      let sending = false;
      async function confirm() {
        if (sending) return;
        sending = true;
        const give = trade.give, get = trade.get;
        trade.give = []; trade.get = [];
        try {
          const { received: n } = await SR.game.trade(give, get);
          SR.audio.coins();
          SR.toast(`Trade complete${n ? `. ${n} ${n === 1 ? 'skin' : 'skins'} added to your inventory` : ''}`, 'good');
        } catch (e) {
          trade.give = give.filter(uid => st.inv.some(x => x.uid === uid)); trade.get = get;
          SR.toast(SR.errorText(e), 'bad');
        }
        sending = false;
        if (alive) draw();
      }
      return () => { alive = false; };
    },
  };

  /* ================= CONTRACTS ================= */
  const con = { picked: [] };
  pages.contracts = {
    title: 'Contracts',
    render() {
      const R = SR.RULES;
      return `
      <section class="wrap section">
        <div class="page-head"><h1>Contracts</h1><p>Put ${R.CONTRACT_MIN} to ${R.CONTRACT_MAX} skins into a contract and get one skin back, worth ${R.CONTRACT_LO}× to ${R.CONTRACT_HI}× their total. Lower results are more likely, and the average return is 0.9× the total.</p></div>
        <div class="contract-board">
          <div class="contract-slots" id="con-slots"></div>
          <div class="contract-side" id="con-side"></div>
        </div>
        <div class="stage contract-stage" id="con-stage" hidden></div>
        <div class="picker">
          <div class="picker-head"><h2>Your inventory</h2>
            <span class="picker-tools">
              <button class="btn btn-ghost btn-sm" type="button" data-act="fill">Fill with cheapest</button>
              <button class="btn btn-ghost btn-sm" type="button" data-act="clear">Clear</button>
            </span>
          </div>
          <div class="item-grid item-grid-sm" id="con-inv"></div>
        </div>
      </section>`;
    },
    mount(root) {
      const R = SR.RULES;
      const st = SR.store.state;
      let alive = true, busy = false;
      const totalOf = () => con.picked.reduce((s, uid) => { const e = st.inv.find(x => x.uid === uid); return s + (e ? SR.item(e.id).price : 0); }, 0);

      const draw = () => {
        con.picked = con.picked.filter(uid => st.inv.some(e => e.uid === uid));
        const n = con.picked.length, total = totalOf();
        const slots = [];
        for (let i = 0; i < R.CONTRACT_MAX; i++) {
          const uid = con.picked[i];
          const e = uid && st.inv.find(x => x.uid === uid);
          slots.push(e
            ? SR.itemCard(SR.item(e.id), { cls: 'pickable', attrs: `role="button" tabindex="0" title="Remove" data-unpick="${uid}"`, foot: `<span class="price">${money(SR.item(e.id).price)}</span>` })
            : `<div class="slot-blank ${i < R.CONTRACT_MIN ? 'need' : ''}" aria-hidden="true">${i + 1}</div>`);
        }
        $('#con-slots', root).innerHTML = slots.join('');
        const ready = n >= R.CONTRACT_MIN && !busy;
        $('#con-side', root).innerHTML = `
          <dl class="contract-sum">
            <div><dt>Skins</dt><dd>${n} of ${R.CONTRACT_MAX}</dd></div>
            <div><dt>Contract total</dt><dd>${money(total)}</dd></div>
            <div><dt>You can get</dt><dd>${n ? `${money(total * R.CONTRACT_LO)} – ${money(total * R.CONTRACT_HI)}` : '—'}</dd></div>
          </dl>
          <button class="btn btn-go btn-lg" type="button" data-act="sign" ${ready ? '' : 'disabled'}>${busy ? 'Signing…' : n < R.CONTRACT_MIN ? `Add ${R.CONTRACT_MIN - n} more ${R.CONTRACT_MIN - n === 1 ? 'skin' : 'skins'}` : 'Sign contract'}</button>`;

        const free = st.inv.filter(e => !con.picked.includes(e.uid));
        $('#con-inv', root).innerHTML = st.inv.length
          ? (free.map(e => SR.itemCard(SR.item(e.id), { cls: 'pickable', attrs: `role="button" tabindex="0" data-pick-con="${e.uid}"`, foot: `<span class="price">${money(SR.item(e.id).price)}</span>` })).join('')
            || '<div class="empty-inline">Every skin you own is already in the contract.</div>')
          : `<div class="empty-inline">You need at least ${R.CONTRACT_MIN} skins. <a href="#/">Open a case</a> or <a href="#/market">buy some cheap ones</a>.</div>`;
      };
      draw();
      SR.onPage('state', () => alive && !busy && draw());

      root.addEventListener('click', e => {
        if (busy) return;
        const p = e.target.closest('[data-pick-con]'), u = e.target.closest('[data-unpick]'), a = e.target.closest('[data-act]');
        if (p) {
          if (con.picked.length >= R.CONTRACT_MAX) { SR.toast(`A contract holds up to ${R.CONTRACT_MAX} skins`); return; }
          con.picked.push(p.dataset.pickCon);
        } else if (u) con.picked = con.picked.filter(x => x !== u.dataset.unpick);
        else if (a && a.dataset.act === 'fill') {
          const free = st.inv.filter(x => !con.picked.includes(x.uid)).sort((x, y) => SR.item(x.id).price - SR.item(y.id).price);
          con.picked = con.picked.concat(free.slice(0, R.CONTRACT_MAX - con.picked.length).map(x => x.uid));
        } else if (a && a.dataset.act === 'clear') con.picked = [];
        else if (a && a.dataset.act === 'sign') return sign();
        else return;
        SR.audio.click();
        draw();
      });

      async function sign() {
        if (busy || con.picked.length < R.CONTRACT_MIN) return;
        busy = true;
        const uids = [...con.picked], total = totalOf();
        draw();
        let res;
        try { res = await SR.game.contract(uids); }
        catch (e) { busy = false; draw(); SR.toast(SR.errorText(e), 'bad'); return; }
        con.picked = [];

        // Reel through skins in the contract's range; it lands on the result.
        const lo = total * R.CONTRACT_LO, hi = total * R.CONTRACT_HI;
        let pool = SR.ITEM_LIST.filter(it => it.price >= lo && it.price <= hi);
        if (pool.length < 8) pool = SR.ITEM_LIST.slice().sort((a, b) => Math.abs(a.price - total) - Math.abs(b.price - total)).slice(0, 40);
        const step = Math.max(1, Math.floor(pool.length / 40));
        const sample = pool.filter((_, i) => i % step === 0).slice(0, 40);
        if (!sample.some(it => it.id === res.entry.id)) sample.push(SR.item(res.entry.id));
        const pseudo = { contents: sample.map(it => ({ id: it.id, chance: Math.pow(it.price, -1) })) };
        const stage = $('#con-stage', root);
        stage.hidden = false;
        stage.innerHTML = '<div class="reels reels-1"></div>';
        stage.scrollIntoView({ behavior: SR.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
        const reel = new SR.Reel(stage.firstElementChild, pseudo, res.entry.id);
        SR.audio.spinUp();
        await reel.spin(SR.reducedMotion() ? 1200 : SR.store.state.fast ? 2200 : 5200);
        SR.drops.push(res.entry.id, null, true);
        SR.audio.win(SR.tier(SR.item(res.entry.id)).rank);
        await wait(400);
        busy = false;
        if (!alive) return;
        draw();
        SR.showDrops([res.entry], { paid: total, paidLabel: 'contract', againText: 'New contract', onAgain: () => { stage.hidden = true; } });
      }
      return () => { alive = false; };
    },
  };

  /* ================= SKIN QUIZ (every 15 minutes, 3 tries) ================= */
  SR.showQuiz = () => {
    if (!SR.quiz.ready()) {
      SR.modal(`<div class="quiz">
          <h2 class="modal-title">Next quiz in <span data-quiz-clock>${SR.clock(SR.quiz.msLeft())}</span></h2>
          <p class="modal-sub">Every 15 minutes you get a picture of a skin and four names. Pick the right one to win ${money(SR.QUIZ_REWARD)}. You have 3 tries per round.</p>
          <div class="win-actions"><button class="btn btn-ghost" type="button" data-close>OK</button></div>
        </div>`, { label: 'Skin quiz' });
      return;
    }
    const m = SR.modal(`<div class="quiz"><h2 class="modal-title">Which skin is this?</h2><p class="modal-sub">Loading the next skin…</p></div>`, { label: 'Skin quiz' });
    SR.game.quizQuestion().then(q => {
      const tries = SR.quiz.tries();
      m.el.querySelector('.quiz').innerHTML = `
        <h2 class="modal-title">Which skin is this?</h2>
        <p class="modal-sub">Pick the right name to win ${money(SR.QUIZ_REWARD)}. ${tries} ${tries === 1 ? 'try' : 'tries'} left this round.</p>
        <div class="quiz-art">${SR.picAt(q.sheet, q.cell, 'quiz-img', 'Mystery skin')}</div>
        <div class="quiz-opts">${q.options.map(id => { const o = SR.item(id); return `<button class="quiz-opt" type="button" data-pick="${id}"><span>${esc(o.weapon)}</span><b>${esc(o.finish)}</b></button>`; }).join('')}</div>
        <p class="quiz-result" id="quiz-result" aria-live="polite"></p>
        <div class="win-actions" id="quiz-next"></div>`;
      const first = m.el.querySelector('[data-pick]');
      if (first) first.focus();
    }).catch(err => { m.close(); SR.toast(SR.errorText(err), 'bad'); });

    m.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-pick]');
      if (b && !b.disabled) {
        $$('[data-pick]', m.el).forEach(x => { x.disabled = true; });
        let res;
        try { res = await SR.game.quizAnswer(b.dataset.pick); }
        catch (err) { m.close(); SR.toast(SR.errorText(err), 'bad'); return; }
        $$('[data-pick]', m.el).forEach(x => {
          x.disabled = true;
          if (x.dataset.pick === res.answer) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        const out = $('#quiz-result', m.el), next = $('#quiz-next', m.el);
        if (res.correct) {
          SR.audio.coins(); SR.audio.win(5);
          out.innerHTML = `<b class="good-text">Correct. ${money(SR.QUIZ_REWARD)} added to your balance.</b> Next quiz in 15 minutes.`;
          next.innerHTML = '<button class="btn btn-go" type="button" data-close>Collect</button>';
        } else if (res.triesLeft > 0) {
          SR.audio.lose();
          out.innerHTML = `Not quite. That's the ${esc(SR.fullName(SR.item(res.answer)))}. ${res.triesLeft} ${res.triesLeft === 1 ? 'try' : 'tries'} left.`;
          next.innerHTML = '<button class="btn btn-sell" type="button" data-again>Next skin</button>';
        } else {
          SR.audio.lose();
          out.innerHTML = `That was your last try. It's the ${esc(SR.fullName(SR.item(res.answer)))}. A new quiz opens in 15 minutes.`;
          next.innerHTML = '<button class="btn btn-ghost" type="button" data-close>OK</button>';
        }
        next.querySelector('button').focus();
      } else if (e.target.closest('[data-again]')) {
        m.close();
        setTimeout(SR.showQuiz, 200);
      }
    });
  };

  /* ================= PROVABLY FAIR (modal, opened from header or case page) ================= */
  SR.showFair = async () => {
    if (SR.game.mode === 'local') await SR.fair.init();
    const f = SR.store.state.fair;
    if (!f) { SR.toast('Seeds are still loading. Try again in a moment.'); return; }
    const m = SR.modal(`
      <h2 class="modal-title">Provably fair</h2>
      <p class="modal-sub">Before you play, you see a hash of the server seed. Each roll is HMAC-SHA256(server seed, “client seed:nonce”), turned into a number from 0 to 1. Rotate the seed to reveal it, then check any past roll below.</p>
      ${SR.fair.verified ? '' : '<p class="bad-text">This browser blocks the crypto API on this address, so rolls use plain random numbers. Open the site over https or localhost to verify rolls.</p>'}
      <div class="fair-grid">
        <label>Server seed hash<input class="input mono" readonly value="${f.serverHash}"></label>
        <label>Client seed<input class="input mono" id="fair-client" value="${esc(f.client)}"></label>
        <label>Rolls on this seed<input class="input mono" readonly value="${f.nonce}"></label>
      </div>
      <div class="win-actions"><button class="btn btn-go" type="button" id="fair-rotate">Rotate seed and reveal</button></div>
      ${(f.revealed || []).length ? `<h3 class="modal-h3">Revealed seeds</h3>
        <div class="table-wrap"><table class="odds"><thead><tr><th>Server seed</th><th>Client seed</th><th class="num">Rolls</th></tr></thead>
        <tbody>${f.revealed.map(r => `<tr><td class="mono wrap-any">${r.server}</td><td class="mono">${esc(r.client)}</td><td class="num">${r.nonces}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3 class="modal-h3">Check a roll</h3>
      <div class="fair-grid">
        <label>Server seed<input class="input mono" id="v-server" value="${(f.revealed && f.revealed[0] && f.revealed[0].server) || ''}"></label>
        <label>Client seed<input class="input mono" id="v-client" value="${esc((f.revealed && f.revealed[0] && f.revealed[0].client) || '')}"></label>
        <label>Nonce<input class="input mono" id="v-nonce" type="number" min="1" value="1"></label>
        <label>Case<select class="input select" id="v-case">${SR.CASES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="win-actions"><button class="btn btn-ghost" type="button" id="v-go">Check</button></div>
      <p class="verify-out" id="v-out" aria-live="polite"></p>`, { cls: 'modal-wide', label: 'Provably fair' });

    $('#fair-client', m.el).addEventListener('change', async e => {
      const v = e.target.value.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) { SR.toast('Use 1–64 letters, digits, - or _ for the client seed', 'bad'); return; }
      try { await SR.game.setClientSeed(v); SR.toast('Client seed updated'); }
      catch (err) { SR.toast(SR.errorText(err), 'bad'); }
    });
    $('#fair-rotate', m.el).addEventListener('click', async () => {
      try { await SR.game.rotateSeed(); m.close(); SR.showFair(); }
      catch (err) { SR.toast(SR.errorText(err), 'bad'); }
    });
    $('#v-go', m.el).addEventListener('click', async () => {
      const out = $('#v-out', m.el);
      if (!SR.fair.verified) { out.textContent = 'Checking needs the browser crypto API (https or localhost).'; return; }
      const server = $('#v-server', m.el).value.trim(), client = $('#v-client', m.el).value.trim(), nonce = +$('#v-nonce', m.el).value;
      if (!server || !client || !nonce) { out.textContent = 'Fill in the server seed, client seed and nonce.'; return; }
      const { value } = await SR.fair.verify(server, client, nonce);
      const c = SR.caseById($('#v-case', m.el).value);
      const it = SR.item(SR.pickWeighted(c.contents, value));
      out.innerHTML = `Roll ${value.toFixed(8)} → <b style="color:${SR.tier(it).color}">${esc(SR.fullName(it))}</b> in the ${esc(c.name)} case.<br>
        <span class="muted">For an upgrade, you win when the roll is below your chance. For a contract, the result is worth ${SR.contractMultiplier(value).toFixed(3)}× the contract total.</span>`;
    });
  };
})();
