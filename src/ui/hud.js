// DOM HUD + screen helpers.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      coins: $('hud-coins'),
      mult: $('hud-mult'),
      score: $('hud-score'),
      dist: $('hud-dist'),
      toast: $('toast'),
      flash: $('stumble-flash'),
    };
    this.toastTimer = 0;
    this.last = {};
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  set(score, coins, dist, mult) {
    // Only touch the DOM when a value actually changes.
    const s = Math.floor(score).toLocaleString();
    if (s !== this.last.s) this.el.score.textContent = this.last.s = s;
    if (coins !== this.last.c) this.el.coins.textContent = this.last.c = coins;
    const d = `${Math.floor(dist)} m`;
    if (d !== this.last.d) this.el.dist.textContent = this.last.d = d;
    const m = `x${mult}`;
    if (m !== this.last.m) this.el.mult.textContent = this.last.m = m;
  }

  toast(text, ms = 700) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  flash() {
    const f = this.el.flash;
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 120);
  }
}

export function showScreen(name) {
  for (const s of ['menu', 'calibrate', 'countdown', 'pause', 'over']) {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}
