/* Case-opening reel: horizontal strip, centre indicator, cubic-bezier deceleration, tick on every card crossing. */
(() => {
  const SR = window.SR;

  /* CSS-style cubic-bezier(x1, y1, x2, y2) solved for y at a given x (time). */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1; t = x;
      while (hi - lo > 1e-7) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  SR.ease = bezier(0.1, 1, 0.1, 1);

  const LENGTH = 72;      // cards on the strip
  const WIN_INDEX = 62;   // where the winner sits

  /* Filler uses the case's own weights, so commons crowd the strip and top-tier items stay rare. */
  function buildStrip(c, winnerId) {
    const ids = [];
    for (let i = 0; i < LENGTH; i++) ids.push(SR.pickWeighted(c.contents, Math.random()));
    ids[WIN_INDEX] = winnerId;
    // Near miss: sometimes park a high-tier item right next to the winner.
    if (Math.random() < 0.4) {
      const rare = c.contents.map(x => SR.item(x.id)).sort((a, b) => b.price - a.price)[Math.floor(Math.random() * 3)];
      if (rare && rare.id !== winnerId) ids[WIN_INDEX + (Math.random() < 0.5 ? -1 : 1)] = rare.id;
    }
    return ids;
  }

  class Reel {
    constructor(host, c, winnerId, { compact = false } = {}) {
      this.c = c;
      this.winnerId = winnerId;
      this.ids = buildStrip(c, winnerId);
      this.el = document.createElement('div');
      this.el.className = 'reel' + (compact ? ' reel-compact' : '');
      this.el.innerHTML = `<div class="reel-track">${this.ids.map((id, i) => {
          const it = SR.item(id), t = SR.tier(it);
          return `<div class="rcard" style="--tc:${t.color}" data-i="${i}">
            ${SR.pic(it, 'rcard-img')}
            <div class="rcard-name"><span>${SR.esc(it.weapon)}</span><b>${SR.esc(it.finish)}</b></div>
          </div>`;
        }).join('')}</div>
        <div class="reel-marker" aria-hidden="true"><i></i></div>`;
      host.appendChild(this.el);
      this.track = this.el.firstElementChild;
    }

    geometry() {
      const cards = this.track.children;
      const cardW = cards[0].offsetWidth;
      const step = cards[1].offsetLeft - cards[0].offsetLeft;
      return { W: this.el.clientWidth, cardW, step };
    }

    /* Tween the strip from x0 to x1, ticking whenever a card edge crosses the marker. */
    tween(x0, x1, duration, ease, sound, W, step) {
      let lastIdx = Math.floor((x0 + W / 2) / step), lastTick = 0;
      return new Promise(resolve => {
        const t0 = performance.now();
        const frame = now => {
          const p = duration ? Math.min(1, (now - t0) / duration) : 1;
          const x = x0 + (x1 - x0) * ease(p);
          this.track.style.transform = `translate3d(${-x}px,0,0)`;
          const idx = Math.floor((x + W / 2) / step);
          if (idx !== lastIdx) {
            if (sound && now - lastTick > 26) { SR.audio.tick(); lastTick = now; }
            lastIdx = idx;
          }
          if (p < 1) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
    }

    /* Resolves when the strip has stopped and re-centred. `sound` lets only one of several parallel reels tick.
       1. Decelerate and stop at a random point inside the winning card (could be near either edge).
       2. Pause, then glide so the winner sits dead centre under the marker. */
    async spin(duration, { sound = true, settle = true } = {}) {
      const { W, cardW, step } = this.geometry();
      const slack = cardW / 2 - 8;
      const offset = (Math.random() * 2 - 1) * slack;
      const centre = WIN_INDEX * step + cardW / 2 - W / 2;
      const start = Math.random() * step * 0.5;
      this.el.classList.add('spinning');
      await this.tween(start, centre + offset, duration, SR.ease, sound, W, step);
      this.el.classList.remove('spinning');
      if (settle && !SR.reducedMotion()) {
        await new Promise(r => setTimeout(r, 380));
        if (sound) SR.audio.settle();
        const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        await this.tween(centre + offset, centre, 650, inOut, false, W, step);
      } else {
        this.track.style.transform = `translate3d(${-centre}px,0,0)`;
      }
      this.el.classList.add('done');
      this.track.children[WIN_INDEX].classList.add('is-win');
    }
  }

  SR.Reel = Reel;
})();
