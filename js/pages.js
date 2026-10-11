/* Pages: home, case, market, inventory, upgrade, trade. Each page = { render(params) → html, mount(root, params) → cleanup? } */
(() => {
  const SR = window.SR;
  const { $, $$, esc, fmt, money } = SR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byPriceDesc = (a, b) => b.price - a.price;
  const pct = c => (!c ? '0' : c >= 1 ? c.toFixed(2) : c >= 0.01 ? c.toFixed(3) : c >= 0.0001 ? c.toFixed(4) : c.toFixed(9).replace(/0+$/, '')) + '%';

  const pages = {};
  SR.pages = pages;

  /* Shared: when money runs short, point at the next free quiz. */
  const quizBtn = () => SR.quiz.ready()
    ? `<button class="btn btn-sell btn-sm" type="button" data-act="quiz">Win ${money(SR.QUIZ_REWARD)}: name a skin</button>`
    : `<span class="muted">Next free ${money(SR.QUIZ_REWARD)} quiz in <b data-quiz-clock>${SR.clock(SR.quiz.msLeft())}</b></span>`;
  SR.quizBtn = quizBtn;

  const GROUPS = [
    ['premium', 'Premium cases', 'Souvenir and the wear cases, from Battle-Scarred to Factory New Premium.'],
    ['color', 'Colour cases', 'Every skin inside matches the case colour. Elite versions add knives and gloves.'],
    ['knife', 'Knives, gloves & rare patterns', 'Platinum Knife, Blue Gems, Doppler phases, Karambits and Katowice 2014 stickers.'],
    ['weapon', 'Weapon cases', 'One weapon family per case, from cheap finishes to the famous ones.'],
    ['wear', 'Wear cases', 'Every skin inside comes in the same wear.'],
    ['budget', 'Quick cases', 'Cheap spins, plenty of small wins, the odd big one.'],
  ];
  // Sections the viewer collapsed (per browser).
  const HIDDEN_KEY = 'skinrush.hidden';
  const hiddenGroups = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch (e) { return new Set(); } };
  const saveHidden = set => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch (e) { /* session only */ } };

  /* ================= HOME ================= */
  pages.home = {
    title: 'Cases',
    render() {
      const f = SR.caseById('souvenir');
      const lore = SR.caseTable(f, SR.store.state.luck || 0).find(x => x.id === 'awp-dragon-lore');
      const hidden = hiddenGroups();
      const sections = GROUPS.map(([g, title, sub]) => {
        const list = SR.CASES.filter(c => c.group === g);
        if (!list.length) return '';
        if (g === 'premium') list.sort((a, b) => SR.CASE_ORDER.indexOf(a.id) - SR.CASE_ORDER.indexOf(b.id));
        else if (g !== 'color') list.sort((a, b) => a.price - b.price);
        const isHidden = hidden.has(g);
        return `<section class="wrap section case-section ${isHidden ? 'is-hidden' : ''}" id="g-${g}">
          <div class="section-head section-head-row">
            <h2>${title}</h2>
            <button class="hide-btn" type="button" data-hide="${g}" aria-expanded="${!isHidden}" aria-controls="grid-${g}">${isHidden ? 'Show' : 'Hide'}<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M7 14l5-5 5 5z" fill="currentColor"/></svg></button>
          </div>
          <p class="section-sub">${sub}</p>
          <div class="case-grid ${g === 'premium' ? 'case-grid-premium' : ''}" id="grid-${g}" ${isHidden ? 'hidden' : ''}>${list.map(SR.caseCard).join('')}</div>
        </section>`;
      }).join('');
      return `
      <section class="hero" style="--glow:${f.glow}">
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <p class="hero-kicker">Featured case</p>
            <h1 class="hero-title">Souvenir</h1>
            <p class="hero-sub">${f.contents.length} drops, from Katowice 2014 stickers to an AWP Dragon Lore at ${pct(lore ? lore.chance : 0.3)}. Every roll is provably fair.</p>
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
        ${GROUPS.filter(([g]) => SR.CASES.some(c => c.group === g)).map(([g, title]) => `<a class="chip" href="#g-${g}" data-jump="g-${g}">${title.split(' ')[0] === 'Knives,' ? 'Knives & patterns' : title.replace(' cases', '')}</a>`).join('')}
      </nav>
      ${sections}`;
    },
    mount(root) {
      root.addEventListener('click', e => {
        const h = e.target.closest('[data-hide]');
        if (h) {
          const g = h.dataset.hide, set = hiddenGroups(), grid = $(`#grid-${g}`, root), sec = $(`#g-${g}`, root);
          const hide = !set.has(g);
          if (hide) set.add(g); else set.delete(g);
          saveHidden(set);
          grid.hidden = hide;
          sec.classList.toggle('is-hidden', hide);
          h.setAttribute('aria-expanded', String(!hide));
          h.firstChild.textContent = hide ? 'Show' : 'Hide';
          return;
        }
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
      return `
      <section class="wrap case-page" style="--glow:${c.glow}">
        <div class="case-head">
          <a class="btn btn-ghost btn-sm" href="#/"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="currentColor"/></svg>Back</a>
          <h1>${esc(c.name)} case</h1>
          <button class="btn btn-ghost btn-sm" type="button" data-act="fair">Provably fair</button>
        </div>
        <div class="stage" id="stage"><div class="stage-idle">${SR.crate(c, { big: true, peek: 3 })}</div></div>
        <div class="controls" id="controls"></div>
        <div class="luck" id="luck"></div>
        <div class="section-head section-head-row">
          <h2>What's inside</h2>
          <button class="btn btn-ghost btn-sm" type="button" data-act="odds">Check odds</button>
        </div>
        <div class="item-grid" id="case-items"></div>
      </section>`;
    },

    mount(root, { id }) {
      const c = SR.caseById(id);
      if (!c) return;
      const st = SR.store.state;
      let count = 1, busy = false, alive = true;
      const controls = $('#controls', root), stage = $('#stage', root);
      // Luck shown on screen only moves once the reel has stopped (the server already knows the new level).
      let shownLuck = st.luck || 0;
      const drawLuck = () => {
        const L = shownLuck, MAX = SR.LUCK.MAX, pc = SR.profitChance(c, L);
        $('#luck', root).innerHTML = `<div class="luck-meter ${L === MAX ? 'max' : ''}">
          <span class="luck-title">Luck</span>
          <span class="luck-pips" role="img" aria-label="Luck level ${L} of ${MAX}">${[...Array(MAX + 1).keys()].map(i => `<i class="${i <= L ? 'on' : ''}"></i>`).join('')}</span>
          <span class="luck-text">${L === MAX ? '<b>Your next open is guaranteed to profit</b>' : `Chance your next open profits: <b>${pc.toFixed(0)}%</b>`}</span>
          <span class="luck-hint">Each open that loses money raises your luck. A profit resets it. After 5 losses in a row, the 6th open always profits.</span>
        </div>`;
      };
      const drawItems = () => {
        const table = SR.caseTable(c, shownLuck);
        const items = table.map(x => ({ it: SR.item(x.id), chance: x.chance })).sort((a, b) => byPriceDesc(a.it, b.it));
        $('#case-items', root).innerHTML = items.map(({ it, chance }) => {
          const mult = it.price / c.price;
          return SR.itemCard(it, { cls: mult >= 1 ? 'is-profit' : '', top: `<span>${pct(chance)}</span>${mult >= 1 ? `<span class="mult">x${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}</span>` : `<span class="muted">${SR.money(it.price)}</span>`}` });
        }).join('');
      };
      drawLuck(); drawItems();

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
      const onState = () => { if (alive && !busy) { renderControls(); if (shownLuck !== (SR.store.state.luck || 0)) { shownLuck = SR.store.state.luck || 0; drawLuck(); drawItems(); } } };
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
        const duration = SR.reducedMotion() ? 1200 : SR.store.state.fast ? 2200 : 8500;
        SR.audio.spinUp();
        await Promise.all(reels.map((rl, i) => rl.spin(duration, { sound: i === 0 })));
        shownLuck = SR.store.state.luck || 0;
        if (alive) { drawLuck(); drawItems(); }

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
        else if (t.dataset.act === 'odds') showOdds(c, shownLuck);
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
    const deltaHtml = `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${SR.money(Math.abs(delta))} vs ${paidLabel} price</span>`;
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

  function showOdds(c, luck = 0) {
    const base = new Map(c.contents.map(x => [x.id, x.chance]));
    const rows = SR.ranges(SR.caseTable(c, luck)).map(r => {
      const it = SR.item(r.id), t = SR.tier(it);
      return `<tr>
        <td><span class="dot" style="background:${t.color}"></span>${esc(it.weapon)} <b>${esc(it.finish)}</b></td>
        <td class="num">${SR.money(it.price)}</td>
        <td class="num">${pct(r.chance)}</td>
        <td class="num muted">${pct(base.get(r.id))}</td>
        <td class="num mono">${r.from.toFixed(6)} – ${r.to.toFixed(6)}</td>
      </tr>`;
    }).join('');
    const ev = SR.caseTable(c, luck).reduce((s, x) => s + x.chance / 100 * SR.item(x.id).price, 0);
    SR.modal(`
      <h2 class="modal-title">${esc(c.name)} odds at luck ${luck}</h2>
      <p class="modal-sub">Each open rolls a number from 0 to 1, and the row whose range contains it is your drop. The chances depend on your luck level (0–5): a losing open raises it, a profit resets it. Chance this open profits: <b>${SR.profitChance(c, luck).toFixed(1)}%</b>. Average value at this level: ${money(ev)} (case price ${money(c.price)}). Over many opens, luck included, cases return about ${Math.round((c.rtp || 0.97) * 100)}%.</p>
      <div class="table-wrap"><table class="odds">
        <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Chance now</th><th class="num">At luck 0</th><th class="num">Roll range</th></tr></thead>
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

  const market = { q: '', tier: 'all', type: 'all', color: 'all', wear: 'all', sort: 'desc', limit: PAGE };
  pages.market = {
    title: 'Market',
    render() {
      return `
      <section class="wrap section">
        <div class="page-head"><h1>Market</h1><p>${fmt(SR.ITEM_LIST.filter(i => i.main).length)} skins in every wear the market prices (${fmt(SR.ITEM_LIST.length)} items), each wear at its own price. A purchase lands in your inventory right away.</p></div>
        <div class="toolbar">
          <input class="input" type="search" id="mq" placeholder="Search skins, e.g. Karambit" value="${esc(market.q)}" aria-label="Search skins">
          <select class="input select" id="mtype" aria-label="Type">${TYPES.map(t => `<option value="${t}" ${market.type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t === 'Knife' ? 'Knives' : t === 'Heavy' ? 'Heavy' : t + 's'}</option>`).join('')}</select>
          <select class="input select" id="mwear" aria-label="Wear">${['all', 'FN', 'MW', 'FT', 'WW', 'BS'].map(w => `<option value="${w}" ${market.wear === w ? 'selected' : ''}>${w === 'all' ? 'All wears' : SR.WEAR_NAMES[w]}</option>`).join('')}</select>
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
          && (market.type === 'all' || it.type === market.type) && (market.color === 'all' || it.color === market.color)
          && (market.wear === 'all' || it.wear === market.wear));
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
      $('#mwear', root).addEventListener('change', e => { market.wear = e.target.value; reset(); });
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
            <div><dt>Battles won</dt><dd>${st.stats.battlesWon || 0} of ${st.stats.battles || 0}</dd></div>
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
    return { market: 'Market', upgrade: 'Upgrade', trade: 'Trade', contract: 'Contract', battle: 'Case battle' }[src] || '';
  }

  /* ================= UPGRADE ================= */
  const upg = { stake: [], target: null, q: '', wear: 'all', side: 'under', history: [] };
  const MAX_STAKE = 4, CAP = 0.8;
  const R = 92, CIRC = 2 * Math.PI * R;
  const TICKS = 72;
  const GHOST = 'ak-47-redline';      // silhouette shown in empty slots

  const chanceLabel = ch => (!ch ? ['Pick both sides', ''] : ch < 0.25 ? ['Risky chance', 'risky'] : ch < 0.5 ? ['Fair chance', 'fair'] : ['Safe chance', 'safe']);

  pages.upgrade = {
    title: 'Upgrade',
    render() {
      const ticks = [...Array(TICKS).keys()].map(i => {
        const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2, r1 = 104, r2 = i % 6 === 0 ? 114 : 109;
        return `<line class="tk" data-tk="${i}" x1="${(130 + r1 * Math.cos(a)).toFixed(1)}" y1="${(130 + r1 * Math.sin(a)).toFixed(1)}" x2="${(130 + r2 * Math.cos(a)).toFixed(1)}" y2="${(130 + r2 * Math.sin(a)).toFixed(1)}"/>`;
      }).join('');
      return `
      <section class="wrap section upg2">
        <div class="upg-top"><button class="upg-how" type="button" data-act="how"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-1-5h2v2h-2zm0-8h2v6h-2z" fill="currentColor"/></svg>How does it work?</button></div>
        <div class="upg-stage">
          <div class="upg-wing upg-wing-l" aria-hidden="true"></div>
          <div class="upg-panel">
            <div class="upg-slot" id="slot-in"></div>
            <div class="upg-btns">
              <button class="skew-btn" type="button" data-act="random">Random</button>
              <button class="skew-btn" type="button" data-act="all">Select all</button>
            </div>
            <div class="upg-valuebox" id="stake-box">Nothing selected</div>
          </div>

          <div class="upg-core">
            <div class="upg-dial oct" id="dial">
              <div class="oct-frame" aria-hidden="true"></div>
              <div class="oct-inner" aria-hidden="true"></div>
              <span class="oct-accent a1" aria-hidden="true"></span><span class="oct-accent a2" aria-hidden="true"></span>
              <span class="oct-accent a3" aria-hidden="true"></span><span class="oct-accent a4" aria-hidden="true"></span>
              <span class="oct-dots top" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
              <span class="oct-dots bottom" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
              <svg viewBox="0 0 260 260" aria-hidden="true">
                <defs>
                  <linearGradient id="needle-grad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3b5c" stop-opacity="0"/><stop offset="1" stop-color="#ff3b5c"/></linearGradient>
                </defs>
                <g class="dial-ticks">${ticks}</g>
                <circle cx="130" cy="130" r="${R}" class="dial-track"/>
                <circle cx="130" cy="130" r="${R}" class="dial-arc" id="arc" transform="rotate(-90 130 130)" stroke-dasharray="0 ${CIRC}"/>
                <circle cx="130" cy="130" r="${R}" class="dial-tail" id="tail" transform="rotate(-90 130 130)" stroke-dasharray="0 ${CIRC}"/>
                <g id="needle" class="dial-needle"><path d="M127 130 L130 26 L133 130 Z" fill="url(#needle-grad)"/><circle cx="130" cy="30" r="4"/></g>
              </svg>
              <div class="dial-center">
                <b id="chance">0.000 %</b>
                <span id="chance-label" class="chance-label">Pick both sides</span>
                <small id="mult"></small>
                <small id="roll-out"></small>
              </div>
              <div class="sparks" id="sparks" aria-hidden="true"></div>
            </div>
            <div class="upg-side" role="group" aria-label="Win zone">
              <button type="button" data-side="under" aria-pressed="${upg.side === 'under'}" class="${upg.side === 'under' ? 'on' : ''}">Roll under</button>
              <button type="button" data-side="over" aria-pressed="${upg.side === 'over'}" class="${upg.side === 'over' ? 'on' : ''}">Roll over</button>
            </div>
            <div class="upg-bar" aria-hidden="true"><i id="chance-bar"></i></div>
          </div>

          <div class="upg-panel">
            <div class="upg-slot" id="slot-out"></div>
            <button class="skew-btn skew-go" type="button" id="upg-go" disabled>Upgrade</button>
            <div class="upg-mults" role="group" aria-label="Pick a target by multiplier">
              ${[1.05, 1.5, 2, 5, 10, 20].map(m => `<button type="button" class="skew-chip" data-mult="${m}">${m}x</button>`).join('')}
            </div>
          </div>
          <div class="upg-wing upg-wing-r" aria-hidden="true"></div>
        </div>
        <div class="upg-subrow">
          <label class="switch"><input type="checkbox" id="upg-fast" ${SR.store.state.fast ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span>Fast</label>
          <div class="upg-history" id="upg-history" aria-label="Your recent upgrades"></div>
        </div>
        <div class="pickers">
          <div class="picker">
            <div class="picker-head"><h2>Your skins</h2><span class="muted" id="stake-hint"></span></div>
            <div class="item-grid item-grid-sm" id="pick-in"></div>
          </div>
          <div class="picker">
            <div class="picker-head"><h2>Targets</h2>
              <span class="picker-tools">
                <select class="input input-sm select" id="twear" aria-label="Wear">${['all', 'FN', 'MW', 'FT', 'WW', 'BS'].map(w => `<option value="${w}" ${upg.wear === w ? 'selected' : ''}>${w === 'all' ? 'Any wear' : SR.WEAR_NAMES[w]}</option>`).join('')}</select>
                <input class="input input-sm" type="search" id="tq" placeholder="Search" aria-label="Search targets" value="${esc(upg.q)}">
              </span>
            </div>
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
      const chanceOf = () => { const t = upg.target && SR.item(upg.target); return SR.upgradeChance(stakeValue(), t && t.price); };
      const inZone = (frac, ch) => SR.upgradeWins(frac, ch, upg.side);
      const ghost = text => `${SR.pic(SR.item(GHOST), 'ghost', false)}<p class="slot-empty">${text}</p>`;

      // Green zone: [0, chance) for roll under, [1 − chance, 1) for roll over — clockwise from the top.
      const drawZone = ch => {
        $('#arc', root).setAttribute('stroke-dasharray', `${ch * CIRC} ${CIRC}`);
        $('#arc', root).setAttribute('stroke-dashoffset', upg.side === 'over' ? String(-(1 - ch) * CIRC) : '0');
        $$('.tk', root).forEach(el => el.classList.toggle('in', ch > 0 && inZone((+el.dataset.tk + 0.5) / TICKS, ch)));
        const bar = $('#chance-bar', root);
        bar.style.width = `${(ch * 100).toFixed(2)}%`;
        bar.style.marginLeft = upg.side === 'over' ? `${((1 - ch) * 100).toFixed(2)}%` : '0';
      };

      const drawHistory = () => {
        $('#upg-history', root).innerHTML = upg.history.length
          ? upg.history.map(h => `<span class="uh ${h.won ? 'won' : 'lost'}" title="${h.won ? 'Won' : 'Lost'} ${esc(h.name)} at ${(h.chance * 100).toFixed(1)}%">${h.won ? '✓' : '✕'} x${h.mult.toFixed(2)}</span>`).join('')
          : '<span class="muted">Your upgrades from this visit appear here.</span>';
      };

      const draw = () => {
        const v = stakeValue();
        if (upg.target && SR.item(upg.target).price <= v) upg.target = null;
        const ch = chanceOf();
        const t = upg.target && SR.item(upg.target);

        $('#slot-in', root).innerHTML = upg.stake.length
          ? `<div class="slot-stack">${upg.stake.map(uid => { const it = SR.item(st.inv.find(x => x.uid === uid).id); return `<span class="slot-stack-item" style="--tc:${SR.tier(it).color}">${SR.pic(it)}</span>`; }).join('')}</div>`
          : ghost('Select a skin you want to upgrade');
        $('#stake-box', root).innerHTML = upg.stake.length
          ? `${money(v)}<small>${upg.stake.length} ${upg.stake.length === 1 ? 'skin' : 'skins'}</small>`
          : 'Nothing selected';
        $('#stake-box', root).classList.toggle('has', upg.stake.length > 0);
        $('#slot-out', root).innerHTML = t
          ? `<span class="slot-img" style="--tc:${SR.tier(t).color}">${SR.pic(t)}</span>
             <div class="slot-label"><span>${esc(t.weapon)} · ${esc(t.finish)}${t.wear ? ` · ${t.wear}` : ''}</span><b>${money(t.price)}</b></div>`
          : ghost('Select a skin you want to get');

        drawZone(ch);
        const [label, cls] = chanceLabel(ch);
        $('#chance', root).textContent = (ch * 100).toFixed(3) + ' %';
        const lab = $('#chance-label', root);
        lab.textContent = label; lab.className = 'chance-label ' + cls;
        $('#mult', root).textContent = t && v ? `x${(t.price / v).toFixed(2)} · roll ${upg.side}` : '';
        $('#roll-out', root).textContent = '';
        const go = $('#upg-go', root);
        go.disabled = spinning || !ch;
        go.textContent = ch ? `Upgrade · x${(t.price / v).toFixed(2)}` : 'Upgrade';
        $$('[data-mult]', root).forEach(b => b.classList.toggle('on', !!(t && v) && Math.abs(t.price / v - +b.dataset.mult) / +b.dataset.mult < 0.08));
        $('#stake-hint', root).textContent = `${upg.stake.length}/${MAX_STAKE} selected`;

        $('#pick-in', root).innerHTML = st.inv.length ? st.inv.map(e => {
          const it = SR.item(e.id), on = upg.stake.includes(e.uid);
          return SR.itemCard(it, { cls: `pickable ${on ? 'on' : ''}`, attrs: `role="button" tabindex="0" aria-pressed="${on}" data-stake="${e.uid}"`, foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : `<div class="empty-inline">No skins yet. <a href="#/">Open a case</a> or <a href="#/market">buy one</a> first.</div>`;

        const targets = SR.ITEM_LIST.filter(it => it.price > v && matchQ(it, upg.q) && (upg.wear === 'all' || it.wear === upg.wear)).sort((a, b) => a.price - b.price).slice(0, 80);
        $('#pick-out', root).innerHTML = targets.length ? targets.map(it => {
          const on = upg.target === it.id;
          const c = SR.upgradeChance(v, it.price);
          return SR.itemCard(it, { cls: `pickable ${on ? 'on' : ''}`, attrs: `role="button" tabindex="0" aria-pressed="${on}" data-target="${it.id}"`,
            top: v ? `<span>${(c * 100).toFixed(1)}%</span>` : '', foot: `<span class="price">${money(it.price)}</span>` });
        }).join('') : `<div class="empty-inline">No skins above your stake match. Try another wear or a shorter search.</div>`;
        drawHistory();
      };
      draw();
      SR.onPage('state', () => alive && !spinning && draw());

      // Nearest catalog item to a wanted price (respecting the wear filter).
      const nearestTarget = goal => {
        const v = stakeValue();
        return SR.ITEM_LIST.filter(it => it.price > v && (upg.wear === 'all' || it.wear === upg.wear))
          .sort((a, b) => Math.abs(a.price - goal) - Math.abs(b.price - goal))[0];
      };
      const howItWorks = () => SR.modal(`
        <h2 class="modal-title">How upgrades work</h2>
        <p class="modal-sub">Stake up to ${MAX_STAKE} of your skins and pick a pricier skin to go for. Your chance is <b>stake ÷ target × 0.95</b>, up to 80%. The green part of the dial is your chance. The needle spins and stops on a provably fair roll: if it stops in the green, the target is yours. If not, your stake is gone.</p>
        <p class="modal-sub"><b>Roll under</b> puts the green zone at the start of the dial and <b>Roll over</b> at the end. The odds are the same; pick whichever feels luckier. The multiplier buttons pick a target that many times your stake.</p>
        <div class="win-actions"><button class="btn btn-ghost" type="button" data-close>Got it</button></div>`, { label: 'How upgrades work' });

      root.addEventListener('click', e => {
        if (e.target.closest('[data-act="how"]')) { howItWorks(); return; }
        if (spinning) return;
        const act = e.target.closest('[data-act]');
        if (act && (act.dataset.act === 'random' || act.dataset.act === 'all')) {
          if (!st.inv.length) { SR.toast('You have no skins yet. Open a case or buy one first.'); return; }
          if (act.dataset.act === 'random') upg.stake = [st.inv[Math.floor(Math.random() * st.inv.length)].uid];
          else upg.stake = [...st.inv].sort((a, b) => SR.item(b.id).price - SR.item(a.id).price).slice(0, MAX_STAKE).map(x => x.uid);
          SR.audio.click(); draw(); return;
        }
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
        const side = e.target.closest('[data-side]');
        if (side) {
          upg.side = side.dataset.side;
          $$('[data-side]', root).forEach(b => { b.classList.toggle('on', b === side); b.setAttribute('aria-pressed', b === side); });
          SR.audio.click(); draw(); return;
        }
        const m = e.target.closest('[data-mult]');
        if (m) {
          const v = stakeValue();
          if (!v) { SR.toast('Pick skins to stake first'); return; }
          const best = nearestTarget(v * +m.dataset.mult);
          if (best) { upg.target = best.id; SR.audio.click(); draw(); }
        }
      });
      $('#tq', root).addEventListener('input', e => { upg.q = e.target.value; draw(); });
      $('#twear', root).addEventListener('change', e => { upg.wear = e.target.value; draw(); });
      $('#upg-fast', root).addEventListener('change', e => { st.fast = e.target.checked; SR.store.save(); });
      $('#upg-go', root).addEventListener('click', go);

      function sparks(color) {
        const box = $('#sparks', root);
        box.innerHTML = [...Array(26).keys()].map(i => {
          const a = (i / 26) * 2 * Math.PI + Math.random() * 0.3, d = 110 + Math.random() * 90;
          return `<i style="--x:${(Math.cos(a) * d).toFixed(0)}px;--y:${(Math.sin(a) * d).toFixed(0)}px;--c:${i % 3 ? color : 'var(--ember-2)'};animation-delay:${(Math.random() * 120).toFixed(0)}ms"></i>`;
        }).join('');
        setTimeout(() => { box.innerHTML = ''; }, 1400);
      }

      async function go() {
        const ch = chanceOf();
        if (!ch || spinning) return;
        spinning = true;
        const dial = $('#dial', root), stage = $('.upg-stage', root);
        dial.classList.remove('win', 'lose', 'in-zone', 'out-zone');
        stage.classList.remove('won', 'lost');
        $('#upg-go', root).disabled = true;
        $('#upg-go', root).textContent = 'Rolling…';
        const target = upg.target, stake = [...upg.stake], v = stakeValue(), side = upg.side;
        // The outcome is settled before the needle moves, so a reload mid-spin can't dodge it.
        let roll, won;
        try { ({ roll, won } = await SR.game.upgrade(stake, target, side)); }
        catch (e) {
          spinning = false;
          SR.toast(SR.errorText(e), 'bad');
          upg.stake = []; draw();
          return;
        }

        // Needle lands exactly on the roll (fraction of a full turn, clockwise from the top).
        const fast = st.fast || SR.reducedMotion();
        const from = needleDeg % 360;
        // ~1.3× the travel and time of the original spin (whole turns, so the needle still lands on the roll).
        const to = 360 * (fast ? 4 : 8) + roll.value * 360;
        const dur = SR.reducedMotion() ? 600 : fast ? 2340 : 7300;
        const ease = t => 1 - Math.pow(1 - t, 5);
        const needle = $('#needle', root), tail = $('#tail', root);
        let lastTick = 0, lastSeg = -1, lastZone = null;
        SR.audio.spinUp();
        await new Promise(res => {
          const t0 = performance.now();
          let prev = from;
          const f = now => {
            const p = Math.min(1, (now - t0) / dur);
            const d = from + (to - from) * ease(p);
            needle.setAttribute('transform', `rotate(${d} 130 130)`);
            // comet tail: the arc swept in the last frames
            const swept = Math.min(120, Math.max(4, (d - prev) * 6));
            tail.setAttribute('stroke-dasharray', `${(swept / 360) * CIRC} ${CIRC}`);
            tail.setAttribute('stroke-dashoffset', String(-(((d - swept) % 360) / 360) * CIRC));
            prev = d;
            const seg = Math.floor(d / 20);
            if (seg !== lastSeg && now - lastTick > 34) { SR.audio.tick(); lastTick = now; lastSeg = seg; }
            // last lap: the dial glows green while the needle is inside the win zone, red outside
            if (p > 0.55) {
              const z = inZone((((d % 360) + 360) % 360) / 360, ch);
              if (z !== lastZone) { dial.classList.toggle('in-zone', z); dial.classList.toggle('out-zone', !z); lastZone = z; }
            }
            if (p < 1) requestAnimationFrame(f); else res();
          };
          requestAnimationFrame(f);
        });
        needleDeg = to;
        tail.setAttribute('stroke-dasharray', `0 ${CIRC}`);
        dial.classList.remove('in-zone', 'out-zone');

        const it = SR.item(target);
        dial.classList.add(won ? 'win' : 'lose');
        stage.classList.add(won ? 'won' : 'lost');
        $('#chance', root).textContent = won ? 'Won' : 'Lost';
        const lab = $('#chance-label', root);
        lab.textContent = won ? 'Upgraded' : 'Stake lost'; lab.className = 'chance-label ' + (won ? 'safe' : 'risky');
        $('#mult', root).innerHTML = won ? `+${SR.money(it.price - v)}` : `−${SR.money(v)}`;
        $('#roll-out', root).textContent = `Roll ${roll.value.toFixed(4)} · ${side === 'over' ? `needed ≥ ${(1 - ch).toFixed(4)}` : `needed < ${ch.toFixed(4)}`}`;
        upg.history.unshift({ won, chance: ch, mult: it.price / v, name: SR.fullName(it) });
        upg.history = upg.history.slice(0, 14);
        drawHistory();
        if (won) {
          sparks(SR.tier(it).color);
          SR.audio.win(Math.max(5, SR.tier(it).rank));
          SR.toast(`Upgraded to ${esc(SR.fullName(it))}${it.wear ? ` (${it.wear})` : ''}`, 'good');
          SR.drops.push(target, null, true);
        } else {
          SR.audio.lose();
          SR.toast('Upgrade lost. Your stake is gone.', 'bad');
        }
        await wait(fast ? 1100 : 2000);
        spinning = false;
        upg.stake = []; upg.target = null;
        dial.classList.remove('win', 'lose');
        stage.classList.remove('won', 'lost');
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
  const con = { picked: [], mode: 'medium' };
  const RACK_GHOSTS = ['ak-47-redline', 'awp-asiimov', 'm4a1-s-cyrex', 'desert-eagle-printstream', 'usp-s-kill-confirmed',
    'm4a4-desolate-space', 'p90-asiimov', 'glock-18-water-elemental', 'ssg-08-dragonfire', 'mp7-bloodsport'];
  const TAB_GUNS = { easy: 'glock-18-water-elemental', medium: 'ak-47-redline', hard: 'awp-asiimov' };

  pages.contracts = {
    title: 'Contracts',
    render() {
      const R = SR.RULES;
      return `
      <section class="wrap section con2" id="con2" style="--mc:${SR.CONTRACT_MODES[con.mode].color}">
        <div class="page-head"><h1>Contracts</h1><p>Put ${R.CONTRACT_MIN} to ${R.CONTRACT_MAX} skins into a contract and get one skin back. Pick how risky: every difficulty returns 0.9× the total on average, but harder ones reach higher and land low more often.</p></div>
        <div class="con-tabs" role="tablist" aria-label="Difficulty">
          ${Object.entries(SR.CONTRACT_MODES).map(([k, m], i) => {
            const gun = SR.item(TAB_GUNS[k]);
            return `<button type="button" role="tab" class="con-tab ${con.mode === k ? 'on' : ''}" data-cmode="${k}" aria-selected="${con.mode === k}" style="--tc:${m.color}">
              <span class="con-chev" aria-hidden="true">${'<i></i>'.repeat(i + 1)}</span>
              <span class="con-tab-label">${m.label}</span>
              <span class="con-badge">x${m.hi}</span>
              ${gun ? SR.pic(gun, 'con-tab-gun', false) : ''}
            </button>`;
          }).join('')}
        </div>
        <div class="con-rack" id="con-rack"></div>
        <div class="con-panel">
          <div class="con-panel-top">
            <span class="con-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h12l-3-3 1.4-1.4L20 8l-5.6 5.4L13 12l3-3H4zm16 10H8l3 3-1.4 1.4L4 16l5.6-5.4L11 12l-3 3h12z" fill="currentColor"/></svg></span>
            <p id="con-info"></p>
            <button class="skew-btn con-go" type="button" data-act="sign" disabled>Create contract</button>
          </div>
          <div class="con-progress"><i id="con-bar"></i></div>
          <div class="con-scale" aria-hidden="true">${[...Array(R.CONTRACT_MAX + 1).keys()].map(n => `<span class="${n === R.CONTRACT_MIN ? 'min' : ''}">${n === R.CONTRACT_MIN ? `${n} min` : n}</span>`).join('')}</div>
        </div>
        <div class="stage contract-stage" id="con-stage" hidden></div>
        <div class="con-inv" id="con-inv-wrap"></div>
      </section>`;
    },
    mount(root) {
      const R = SR.RULES;
      const st = SR.store.state;
      let alive = true, busy = false;
      const totalOf = () => con.picked.reduce((s, uid) => { const e = st.inv.find(x => x.uid === uid); return s + (e ? SR.item(e.id).price : 0); }, 0);
      const ghosts = RACK_GHOSTS.map(id => SR.item(id)).filter(Boolean);

      const draw = () => {
        con.picked = con.picked.filter(uid => st.inv.some(e => e.uid === uid));
        const n = con.picked.length, total = totalOf(), m = SR.CONTRACT_MODES[con.mode];
        $('#con2', root).style.setProperty('--mc', m.color);

        // the rack: 10 slots, skins hang vertically; empty slots show a faint weapon
        $('#con-rack', root).innerHTML = `<span class="con-rack-word" aria-hidden="true">Contract</span>` + [...Array(R.CONTRACT_MAX).keys()].map(i => {
          const uid = con.picked[i], e = uid && st.inv.find(x => x.uid === uid);
          if (e) {
            const it = SR.item(e.id);
            return `<button type="button" class="con-slot filled" data-unpick="${uid}" style="--tc:${SR.tier(it).color}" title="Remove ${esc(SR.fullName(it))}">${SR.pic(it, 'con-gun')}<span class="con-slot-price">${money(it.price)}</span></button>`;
          }
          const g = ghosts[i % ghosts.length];
          return `<span class="con-slot ${i < R.CONTRACT_MIN ? 'need' : ''}" aria-hidden="true">${g ? SR.pic(g, 'con-gun ghost', false) : ''}</span>`;
        }).join('') + '<span class="con-shelf" aria-hidden="true"></span>';

        $('#con-info', root).innerHTML = n
          ? `${n} ${n === 1 ? 'skin' : 'skins'} worth ${money(total)}. You get one skin worth <b>${money(total * m.lo)}</b> to <b>${money(total * m.hi)}</b> (${m.lo}×–${m.hi}×).`
          : `Add at least <b>${R.CONTRACT_MIN} skins</b> (up to ${R.CONTRACT_MAX}) to get a chance at a rarer one. ${m.label}: the result is worth <b>${m.lo}×</b> to <b>${m.hi}×</b> what you put in.`;
        const go = $('[data-act="sign"]', root);
        go.disabled = busy || n < R.CONTRACT_MIN;
        go.textContent = busy ? 'Signing…' : n < R.CONTRACT_MIN ? `Add ${R.CONTRACT_MIN - n} more` : 'Create contract';
        $('#con-bar', root).style.width = `${(n / R.CONTRACT_MAX) * 100}%`;

        const free = st.inv.filter(e => !con.picked.includes(e.uid));
        $('#con-inv-wrap', root).innerHTML = st.inv.length
          ? `<div class="picker">
              <div class="picker-head"><h2>Your skins</h2>
                <span class="picker-tools">
                  <button class="btn btn-ghost btn-sm" type="button" data-act="fill">Fill with cheapest</button>
                  <button class="btn btn-ghost btn-sm" type="button" data-act="clear">Clear</button>
                </span>
              </div>
              <div class="item-grid item-grid-sm">${free.map(e => SR.itemCard(SR.item(e.id), { cls: 'pickable', attrs: `role="button" tabindex="0" data-pick-con="${e.uid}"`, foot: `<span class="price">${money(SR.item(e.id).price)}</span>` })).join('')
                || '<div class="empty-inline">Every skin you own is in the contract.</div>'}</div>
            </div>`
          : `<div class="con-none">
              <span class="con-none-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7zm9 2.2L5 6.3v9.4l7 3.1 7-3.1V6.3l-7 2.9z" fill="currentColor"/></svg></span>
              <div><b>No skins yet</b><span>Open cases and win skins to use in a contract.</span></div>
              <a class="btn btn-ghost btn-sm" href="#/">Go to cases</a>
            </div>`;
      };
      draw();
      SR.onPage('state', () => alive && !busy && draw());

      root.addEventListener('click', e => {
        if (busy) return;
        const mt = e.target.closest('[data-cmode]');
        if (mt) {
          con.mode = mt.dataset.cmode;
          $$('[data-cmode]', root).forEach(b => { b.classList.toggle('on', b === mt); b.setAttribute('aria-selected', b === mt); });
          SR.audio.click(); draw(); return;
        }
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
        const uids = [...con.picked], total = totalOf(), mode = con.mode, m = SR.CONTRACT_MODES[mode];
        draw();
        let res;
        try { res = await SR.game.contract(uids, mode); }
        catch (e) { busy = false; draw(); SR.toast(SR.errorText(e), 'bad'); return; }
        con.picked = [];

        // Reel through skins in this difficulty's range; it lands on the result.
        const lo = total * m.lo, hi = total * m.hi;
        let pool = SR.ITEM_LIST.filter(it => it.main && it.price >= lo && it.price <= hi);
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
        <label>Luck level at that open<select class="input select" id="v-luck">${[0, 1, 2, 3, 4, 5].map(l => `<option value="${l}">${l}</option>`).join('')}</select></label>
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
      const luck = +$('#v-luck', m.el).value;
      const it = SR.item(SR.pickWeighted(SR.caseTable(c, luck), value));
      out.innerHTML = `Roll ${value.toFixed(8)} → <b style="color:${SR.tier(it).color}">${esc(SR.fullName(it))}</b> in the ${esc(c.name)} case at luck ${luck}.<br>
        <span class="muted">For an upgrade, you win when the roll is below your chance. For a contract, the result is worth ${SR.contractMultiplier(value, 'easy').toFixed(3)}× (easy), ${SR.contractMultiplier(value, 'medium').toFixed(3)}× (medium) or ${SR.contractMultiplier(value, 'hard').toFixed(3)}× (hard) the contract total.</span>`;
    });
  };
})();
