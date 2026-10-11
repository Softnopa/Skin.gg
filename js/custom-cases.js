/* Hand-picked cases and the case groups shown on the home page.
   Loaded after js/data.js and before js/odds.js. Each skin is [weapon, finish] as shown on the site; its usual wear is used.
   Prices here are a starting point in USD: js/odds.js sets the final price so the case returns ~97% over many opens.
   After editing, run `npm run seed` and run supabase/seed.sql again so the server uses the same cases. */
(() => {
  const SR = window.SR;
  const all = Object.values(SR.ITEMS);
  const find = ([weapon, finish]) => all.find(i => i.main && i.weapon === weapon && (i.finish === finish || i.finish.startsWith(finish + ' (')));

  function addCase({ id, name, group, glow, price, skins, after }) {
    const items = skins.map(find).filter(Boolean);
    if (items.length !== skins.length) console.warn(`case ${id}: ${skins.length - items.length} skins not found`);
    const c = { id, name, group, glow, price, contents: items.map(it => ({ id: it.id, chance: 1 })) };
    const old = SR.CASES.findIndex(x => x.id === id);
    if (old >= 0) SR.CASES.splice(old, 1);
    const at = after ? SR.CASES.findIndex(x => x.id === after) : -1;
    if (at >= 0) SR.CASES.splice(at + 1, 0, c); else SR.CASES.push(c);
  }

  addCase({
    id: 'factory-new-premium', name: 'Factory New Premium', group: 'premium', glow: '#2fb4ff', price: 300, after: 'factory-new',
    skins: [
      ['★ Moto Gloves', 'Finish Line'], ['★ Specialist Gloves', 'Field Agent'], ['★ Paracord Knife', 'Slaughter'], ['★ Sport Gloves', 'Vice'],
      ['★ Bayonet', 'Marble Fade'], ['★ Stiletto Knife', 'Doppler'], ['★ Butterfly Knife', 'Autotronic'], ['★ Specialist Gloves', 'Crimson Kimono'],
      ["★ Sport Gloves", "Pandora's Box"], ['M4A1-S', 'Printstream'], ['AK-47', 'X-Ray'], ['AWP', 'Lightning Strike'], ['AWP', 'Fade'],
      ['P90', 'Emerald Dragon'], ['MP5-SD', 'Oxide Oasis'], ['UMP-45', 'Fade'], ['MAG-7', 'Cinquedea'], ['AK-47', 'Hydroponic'],
      ['M4A1-S', 'Hot Rod'], ['M4A1-S', 'Icarus Fell'], ['Desert Eagle', 'Blaze'], ['Glock-18', 'Fade'],
    ],
  });

  addCase({
    id: 'platinum-knife', name: 'Platinum Knife', group: 'knife', glow: '#c9b8ff', price: 300, after: 'knife-mix',
    skins: [
      ['★ Huntsman Knife', 'Freehand'], ['★ Huntsman Knife', 'Damascus Steel'], ['★ Falchion Knife', 'Lore'], ['★ Huntsman Knife', 'Crimson Web'],
      ['★ Survival Knife', 'Slaughter'], ['★ Bayonet', 'Ultraviolet'], ['★ Flip Knife', 'Autotronic'], ['★ Bowie Knife', 'Gamma Doppler'],
      ['★ Skeleton Knife', 'Vanilla'], ['★ Classic Knife', 'Fade'], ['★ Nomad Knife', 'Fade'], ['★ M9 Bayonet', 'Lore'], ['★ M9 Bayonet', 'Crimson Web'],
      ['★ Flip Knife', 'Gamma Doppler'], ['★ Karambit', 'Lore'], ['★ Karambit', 'Freehand'], ['★ M9 Bayonet', 'Marble Fade'], ['★ Talon Knife', 'Doppler'],
      ['★ Butterfly Knife', 'Tiger Tooth'], ['★ Butterfly Knife', 'Slaughter'], ['★ Butterfly Knife', 'Doppler'],
    ],
  });

  // Premium row on the home page (like GGDROP): Souvenir, then the wear cases from worst to best wear.
  const PREMIUM = ['souvenir', 'battle-scarred', 'well-worn', 'field-tested', 'minimal-wear', 'factory-new', 'factory-new-premium'];
  for (const c of SR.CASES) if (PREMIUM.includes(c.id)) c.group = 'premium';
  SR.CASE_ORDER = PREMIUM;
})();
