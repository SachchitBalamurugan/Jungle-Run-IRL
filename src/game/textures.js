// Procedural canvas textures: mossy temple bricks, carved walls, jungle floor, mist, sprites.
// Everything is generated at load time, so the game has no image assets to download.
import * as THREE from 'three';
import { fbm, mulberry32, clamp } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Builds a tileable masonry texture (colour + height) from a row/brick layout.
 * opts: rows, minW, maxW, mortar, palette, moss, seed, drips
 */
function masonry(size, opts) {
  const rand = mulberry32(opts.seed);
  const rows = opts.rows;
  const rowH = size / rows;
  // Layout: for each row, list of brick boundaries that wrap exactly at `size`.
  const layout = [];
  for (let r = 0; r < rows; r++) {
    const edges = [];
    let x = rand() * opts.maxW;
    const start = x;
    edges.push(x);
    while (x < start + size - opts.minW) {
      const w = opts.minW + rand() * (opts.maxW - opts.minW);
      if (x + w > start + size - opts.minW * 0.7) break;
      x += w;
      edges.push(x);
    }
    edges.push(start + size);
    const tones = edges.map(() => rand());
    layout.push({ edges, tones, start });
  }

  const color = canvas(size, size);
  const height = canvas(size, size);
  const cctx = color.getContext('2d');
  const hctx = height.getContext('2d');
  const cimg = cctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const [base0, base1] = opts.palette;
  const mossCol = opts.mossColor || [74, 98, 38];
  const mortarCol = opts.mortarColor || [48, 42, 34];

  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rowH);
    const row = layout[r];
    const y0 = r * rowH;
    const dy = Math.min(y - y0, y0 + rowH - y);
    for (let x = 0; x < size; x++) {
      // position relative to row start, wrapped
      let xx = x;
      if (xx < row.start) xx += size;
      let bi = 0;
      while (bi < row.edges.length - 1 && xx >= row.edges[bi + 1]) bi++;
      const dx = Math.min(xx - row.edges[bi], row.edges[bi + 1] - xx);
      const edge = Math.min(dx, dy);
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, 8, 4, opts.seed);
      const nFine = fbm(u, v, 32, 2, opts.seed + 5);
      const tone = row.tones[bi];

      let cr, cg, cb, h;
      if (edge < opts.mortar) {
        const k = 0.8 + n * 0.4;
        cr = mortarCol[0] * k;
        cg = mortarCol[1] * k;
        cb = mortarCol[2] * k;
        h = 0.05 + n * 0.1;
      } else {
        const bevel = smooth(opts.mortar, opts.mortar + opts.bevel, edge);
        const shade = (0.72 + 0.28 * bevel) * (0.82 + n * 0.3 + (nFine - 0.5) * 0.18);
        cr = (base0[0] + (base1[0] - base0[0]) * tone) * shade;
        cg = (base0[1] + (base1[1] - base0[1]) * tone) * shade;
        cb = (base0[2] + (base1[2] - base0[2]) * tone) * shade;
        h = 0.45 + 0.4 * bevel + (n - 0.5) * 0.25 + (nFine - 0.5) * 0.1;
      }

      // Moss grows in the cracks and in noisy patches (and drips down walls).
      let m = fbm(u, v * (opts.drips ? 3 : 1), 5, 4, opts.seed + 99);
      m += (1 - smooth(0, opts.mortar + 10, edge)) * 0.22;
      const mossAmt = smooth(opts.moss, opts.moss + 0.12, m);
      if (mossAmt > 0) {
        const mk = 0.7 + nFine * 0.6;
        cr += (mossCol[0] * mk - cr) * mossAmt;
        cg += (mossCol[1] * mk - cg) * mossAmt;
        cb += (mossCol[2] * mk - cb) * mossAmt;
        h += mossAmt * 0.08;
      }

      const i = (y * size + x) * 4;
      cimg.data[i] = clamp(cr, 0, 255);
      cimg.data[i + 1] = clamp(cg, 0, 255);
      cimg.data[i + 2] = clamp(cb, 0, 255);
      cimg.data[i + 3] = 255;
      const hv = clamp(h * 255, 0, 255);
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv;
      himg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  hctx.putImageData(himg, 0, 0);

  // Cracks
  const crackCount = opts.cracks ?? 10;
  for (let k = 0; k < crackCount; k++) {
    let x = rand() * size;
    let y = rand() * size;
    const segs = 4 + Math.floor(rand() * 6);
    let a = rand() * Math.PI * 2;
    for (const [ctx, col] of [
      [cctx, 'rgba(25,20,14,0.75)'],
      [hctx, 'rgba(0,0,0,0.9)'],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1 + rand() * 1.2;
    }
    const pts = [[x, y]];
    for (let s = 0; s < segs; s++) {
      a += (rand() - 0.5) * 1.2;
      const len = 6 + rand() * 16;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
    }
    for (const ctx of [cctx, hctx]) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }

  if (opts.carvings) carve(cctx, hctx, layout, rowH, size, rand, opts.carvings);

  return { color, height };
}

/** Engrave simple glyphs (spirals, eyes, step patterns) onto some wall blocks. */
function carve(cctx, hctx, layout, rowH, size, rand, chance) {
  layout.forEach((row, r) => {
    for (let b = 0; b < row.edges.length - 1; b++) {
      if (rand() > chance) continue;
      const x0 = (row.edges[b] % size) + 10;
      const w = row.edges[b + 1] - row.edges[b] - 20;
      const y0 = r * rowH + 10;
      const h = rowH - 20;
      if (w < 30 || x0 + w > size) continue;
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      const kind = Math.floor(rand() * 3);
      const draw = (ctx, stroke, off) => {
        ctx.save();
        ctx.translate(off, off);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (kind === 0) {
          // spiral
          const R = Math.min(w, h) * 0.4;
          for (let t = 0; t < Math.PI * 6; t += 0.2) {
            const rr = (R * t) / (Math.PI * 6);
            const px = cx + Math.cos(t) * rr;
            const py = cy + Math.sin(t) * rr;
            if (t === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        } else if (kind === 1) {
          // eye glyph
          ctx.ellipse(cx, cy, w * 0.38, h * 0.3, 0, 0, Math.PI * 2);
          ctx.moveTo(cx + h * 0.14, cy);
          ctx.arc(cx, cy, h * 0.14, 0, Math.PI * 2);
          ctx.rect(x0 + 4, y0 + 4, w - 8, h - 8);
        } else {
          // step fret
          const steps = 4;
          const sw = w / (steps * 2);
          ctx.moveTo(x0, y0 + h);
          for (let s = 0; s < steps; s++) {
            ctx.lineTo(x0 + sw * (2 * s), y0 + h - (h / steps) * s);
            ctx.lineTo(x0 + sw * (2 * s + 1), y0 + h - (h / steps) * s);
          }
          ctx.lineTo(x0 + w, y0);
          ctx.rect(x0 + w * 0.3, y0 + h * 0.3, w * 0.4, h * 0.4);
        }
        ctx.stroke();
        ctx.restore();
      };
      draw(cctx, 'rgba(20,14,8,0.65)', 0);
      draw(cctx, 'rgba(255,235,200,0.12)', 1.5);
      draw(hctx, 'rgba(0,0,0,0.85)', 0);
    }
  });
}

export function makePathTextures() {
  const { color, height } = masonry(512, {
    seed: 7,
    rows: 6,
    minW: 70,
    maxW: 150,
    mortar: 3,
    bevel: 10,
    moss: 0.6,
    palette: [
      [118, 104, 84],
      [166, 150, 120],
    ],
    cracks: 14,
  });
  return {
    map: toTexture(color),
    bump: toTexture(height, { srgb: false }),
  };
}

export function makeWallTextures() {
  const { color, height } = masonry(512, {
    seed: 21,
    rows: 4,
    minW: 120,
    maxW: 220,
    mortar: 4,
    bevel: 14,
    moss: 0.56,
    drips: true,
    palette: [
      [92, 82, 66],
      [138, 124, 100],
    ],
    mossColor: [62, 88, 34],
    cracks: 8,
    carvings: 0.35,
  });
  return {
    map: toTexture(color),
    bump: toTexture(height, { srgb: false }),
  };
}

export function makeBarkTexture() {
  const size = 128;
  const c = canvas(size, size * 2);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size * 2);
  for (let y = 0; y < size * 2; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / (size * 2);
      const n = fbm(u * 1, v * 0.25, 10, 4, 3);
      const streak = fbm(u, v * 0.1, 24, 2, 8);
      const k = 0.55 + n * 0.5 + (streak - 0.5) * 0.5;
      const i = (y * size + x) * 4;
      img.data[i] = 92 * k;
      img.data[i + 1] = 72 * k;
      img.data[i + 2] = 52 * k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

export function makeGroundTexture() {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 4, 5, 11);
      const n2 = fbm(x / size, y / size, 16, 3, 12);
      const i = (y * size + x) * 4;
      img.data[i] = 30 + n * 40 + n2 * 10;
      img.data[i + 1] = 44 + n * 50 + n2 * 14;
      img.data[i + 2] = 18 + n * 18;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

export function makeMistTexture() {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 3, 5, 31);
      const a = smooth(0.35, 0.8, n);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

export function makeSoftSprite() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false });
}

export function makeShaftTexture() {
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 64; x++) {
      const u = x / 63;
      const v = y / 255;
      const edge = Math.sin(u * Math.PI) ** 2;
      const fall = smooth(0, 0.25, v) * (1 - smooth(0.6, 1, v));
      const i = (y * 64 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 226;
      img.data[i + 2] = 170;
      img.data[i + 3] = edge * fall * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: false });
}
