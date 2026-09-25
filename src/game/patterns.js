// Pattern spawner: lays out fair, readable obstacle + coin sequences ahead of the player.
import { LANE_W } from './track.js';
import { pick } from './util.js';

const LANES = [-1, 0, 1];

export class Spawner {
  constructor(obstacles, coins) {
    this.obstacles = obstacles;
    this.coins = coins;
    this.reset(0);
  }

  reset(pz, { leniency = 1 } = {}) {
    this.nextZ = pz - 45; // first obstacle a comfortable distance away
    this.leniency = leniency;
    this.count = 0;
    this.lastKind = '';
  }

  /** difficulty in [0,1] grows with distance */
  update(pz, speed, difficulty) {
    while (this.nextZ > pz - 140) {
      const len = this._pattern(this.nextZ, speed, difficulty);
      const gap = Math.max(20, speed * 1.45) * this.leniency * (1.15 - difficulty * 0.25);
      this.nextZ -= len + gap;
      this.count++;
    }
  }

  _pattern(z, speed, d) {
    const O = this.obstacles;
    const C = this.coins;
    const inner = Math.max(13, speed * 0.95) * this.leniency; // spacing inside combos
    const choices = ['jump', 'duck', 'block1', 'block2', 'coins'];
    if (d > 0.2) choices.push('block2', 'jumpBlock');
    if (d > 0.35) choices.push('zigzag', 'duckBlock');
    if (d > 0.55) choices.push('triple');
    let kind = pick(Math.random, choices);
    if (this.count < 3) kind = ['jump', 'block1', 'duck'][this.count]; // gentle tutorial opener
    if (kind === this.lastKind && kind !== 'block2') kind = pick(Math.random, ['jump', 'duck', 'block1']);
    this.lastKind = kind;

    const lane = pick(Math.random, LANES);
    switch (kind) {
      case 'jump': {
        O.spawn(Math.random() < 0.55 ? 'log' : 'lowwall', z);
        C.arc(lane * LANE_W, z);
        return 4;
      }
      case 'duck': {
        O.spawn(Math.random() < 0.55 ? 'arch' : 'branch', z);
        C.line(lane * LANE_W, z + 5, 5, 2.2, 0.45);
        return 4;
      }
      case 'block1': {
        O.spawn(Math.random() < 0.7 ? 'block' : 'idol', z, lane);
        const free = pick(Math.random, LANES.filter((l) => l !== lane));
        C.line(free * LANE_W, z + 8, 6);
        return 4;
      }
      case 'block2': {
        const free = lane;
        for (const l of LANES) if (l !== free) O.spawn(Math.random() < 0.75 ? 'block' : 'idol', z, l);
        C.line(free * LANE_W, z + 10, 7);
        return 4;
      }
      case 'jumpBlock': {
        const free = lane;
        for (const l of LANES) if (l !== free) O.spawn('block', z, l);
        C.line(free * LANE_W, z + 6, 4);
        O.spawn('log', z - inner);
        C.arc(free * LANE_W, z - inner);
        return inner + 4;
      }
      case 'duckBlock': {
        O.spawn('arch', z);
        C.line(lane * LANE_W, z + 4, 4, 2.2, 0.45);
        const blocked = pick(Math.random, LANES);
        O.spawn('block', z - inner, blocked);
        const free = LANES.filter((l) => l !== blocked);
        C.line(pick(Math.random, free) * LANE_W, z - inner + 6, 4);
        return inner + 4;
      }
      case 'zigzag': {
        const a = lane;
        const b = pick(Math.random, LANES.filter((l) => l !== a));
        O.spawn('block', z, a);
        O.spawn('block', z - inner, b);
        const free1 = LANES.find((l) => l !== a && l !== b);
        C.line(free1 * LANE_W, z + 6, 3 + Math.floor(inner / 2.2));
        return inner + 4;
      }
      case 'triple': {
        O.spawn('log', z);
        O.spawn('branch', z - inner);
        O.spawn('lowwall', z - inner * 2);
        C.arc(lane * LANE_W, z);
        C.arc(lane * LANE_W, z - inner * 2);
        return inner * 2 + 4;
      }
      case 'coins':
      default: {
        // Breather: a snaking coin trail
        let l = lane;
        for (let i = 0; i < 3; i++) {
          C.line(l * LANE_W, z - i * 11, 5);
          l = pick(Math.random, LANES.filter((x) => Math.abs(x - l) === 1));
        }
        return 30;
      }
    }
  }
}
