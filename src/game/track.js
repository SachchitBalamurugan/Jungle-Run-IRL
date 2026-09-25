// Endless stone causeway through the jungle. Segments recycle from behind the player to the front;
// scenery that repeats a lot (trees, bushes, rubble, vines) is drawn with InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makePathTextures, makeWallTextures, makeBarkTexture } from './textures.js';

export const SEG_LEN = 24;
export const SEG_COUNT = 11;
export const LANE_W = 2.2;
export const PATH_HALF = 3.0; // inner edge of the curbs
const DECK_HALF = 4.8; // full causeway half-width (curbs + ledges)
const FOUNDATION_H = 16;

const TREES_PER_SEG = 9;
const BUSHES_PER_SEG = 8;
const RUBBLE_PER_SEG = 6;
const VINES_PER_SEG = 10;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function colorize(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Strip to position/normal/uv (+color) so geometries can be merged. */
function clean(geo, keepColor = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name) && !(keepColor && name === 'color')) g.deleteAttribute(name);
  }
  return g;
}

function jitter(geo, amount, seed = 1) {
  const p = geo.attributes.position;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  // Jitter shared vertices consistently by keying on rounded position.
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, [rnd() * amount, rnd() * amount, rnd() * amount]);
    const d = cache.get(key);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

class Scatter {
  constructor(scene, geo, mat, perSeg, { shadow = false, receive = false } = {}) {
    this.perSeg = perSeg;
    this.mesh = new THREE.InstancedMesh(geo, mat, perSeg * SEG_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = receive;
    for (let i = 0; i < perSeg * SEG_COUNT; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    scene.add(this.mesh);
  }

  set(seg, k, pos, rot, scale, color) {
    const i = seg * this.perSeg + k;
    _q.setFromEuler(_e.set(rot.x, rot.y, rot.z));
    _m.compose(pos, _q, scale);
    this.mesh.setMatrixAt(i, _m);
    if (color) this.mesh.setColorAt(i, color);
  }

  hide(seg, k) {
    _m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(seg * this.perSeg + k, _m);
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this.torches = []; // { pos: Vector3, flame: Mesh, seg }

    const path = makePathTextures();
    const wall = makeWallTextures();
    const bark = makeBarkTexture();

    path.map.repeat.set((DECK_HALF * 2) / 4, SEG_LEN / 4);
    path.bump.repeat.copy(path.map.repeat);
    this.pathMat = new THREE.MeshStandardMaterial({
      map: path.map,
      bumpMap: path.bump,
      bumpScale: 2.2,
      roughness: 0.92,
      color: 0xf2e6d0,
    });

    const wallMap = wall.map;
    wallMap.repeat.set(SEG_LEN / 6, FOUNDATION_H / 6);
    const wallBump = wall.bump;
    wallBump.repeat.copy(wallMap.repeat);
    this.wallMat = new THREE.MeshStandardMaterial({
      map: wallMap,
      bumpMap: wallBump,
      bumpScale: 3,
      roughness: 0.95,
      color: 0xd8ccb4,
    });

    const curbMap = wall.map.clone();
    curbMap.repeat.set(SEG_LEN / 3, 0.25);
    curbMap.needsUpdate = true;
    const curbBump = wall.bump.clone();
    curbBump.repeat.copy(curbMap.repeat);
    curbBump.needsUpdate = true;
    this.curbMat = new THREE.MeshStandardMaterial({ map: curbMap, bumpMap: curbBump, bumpScale: 2, roughness: 0.9, color: 0xe0d2b8 });

    const pillarMap = wall.map.clone();
    pillarMap.repeat.set(0.5, 1.4);
    pillarMap.needsUpdate = true;
    const pillarBump = wall.bump.clone();
    pillarBump.repeat.copy(pillarMap.repeat);
    pillarBump.needsUpdate = true;
    this.pillarMat = new THREE.MeshStandardMaterial({ map: pillarMap, bumpMap: pillarBump, bumpScale: 3, roughness: 0.9, color: 0xe6dac2 });

    this.bronzeMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, metalness: 0.85, roughness: 0.38 });
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.4, 0.6), transparent: true, opacity: 0.95 });
    this.flameCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 7, 3.5) });
    this.idolEyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.2) });

    this._buildShared();

    bark.repeat.set(2, 5);
    this.trunks = new Scatter(
      scene,
      this.trunkGeo,
      new THREE.MeshStandardMaterial({ map: bark, roughness: 1, color: 0xcfbfa8 }),
      TREES_PER_SEG,
      { shadow: true }
    );
    this.canopies = new Scatter(
      scene,
      this.canopyGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
      TREES_PER_SEG,
      { shadow: true }
    );
    this.bushes = new Scatter(
      scene,
      this.bushGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }),
      BUSHES_PER_SEG,
      { shadow: true, receive: true }
    );
    this.rubble = new Scatter(scene, this.rubbleGeo, this.curbMat, RUBBLE_PER_SEG, { shadow: true, receive: true });
    this.vines = new Scatter(
      scene,
      this.vineGeo,
      new THREE.MeshStandardMaterial({ color: 0x3f5a1c, roughness: 0.9, flatShading: true }),
      VINES_PER_SEG,
      { shadow: true }
    );

    for (let i = 0; i < SEG_COUNT; i++) this.segments.push(this._makeSegment(i));
    this.reset(0);
  }

  _buildShared() {
    // Deck: top plane + tall foundation beneath + curbs
    this.deckGeo = new THREE.PlaneGeometry(DECK_HALF * 2, SEG_LEN).rotateX(-Math.PI / 2);
    this.foundationGeo = new THREE.BoxGeometry(DECK_HALF * 2, FOUNDATION_H, SEG_LEN);
    this.curbGeo = new THREE.BoxGeometry(0.6, 0.45, SEG_LEN);

    // Pillar = plinth + shaft + capital, merged.
    const plinth = new THREE.BoxGeometry(1.25, 0.45, 1.25).translate(0, 0.225, 0);
    const shaft = new THREE.BoxGeometry(0.85, 4.4, 0.85).translate(0, 0.45 + 2.2, 0);
    const ring = new THREE.BoxGeometry(1.0, 0.2, 1.0).translate(0, 2.4, 0);
    const cap = new THREE.BoxGeometry(1.3, 0.4, 1.3).translate(0, 4.85 + 0.2, 0);
    this.pillarGeo = mergeGeometries([plinth, shaft, ring, cap].map((g) => clean(g)));
    const bshaft = new THREE.BoxGeometry(0.85, 2.1, 0.85).translate(0, 0.45 + 1.05, 0);
    const chunk = new THREE.BoxGeometry(0.7, 0.5, 0.6).rotateZ(0.5).translate(0.15, 2.65, 0.05);
    this.brokenPillarGeo = mergeGeometries([plinth.clone(), bshaft, chunk].map((g) => clean(g)));

    this.bowlGeo = new THREE.CylinderGeometry(0.42, 0.22, 0.32, 10).translate(0, 5.41, 0);
    this.flameGeo = new THREE.ConeGeometry(0.26, 0.8, 8).translate(0, 0.4, 0);
    this.flameCoreGeo = new THREE.SphereGeometry(0.16, 8, 6);

    // Tree: tall trunk rising from the jungle floor; canopy of flat-shaded blobs.
    this.trunkGeo = new THREE.CylinderGeometry(0.45, 0.95, 27, 8, 4).translate(0, 13.5, 0);
    jitter(this.trunkGeo, 0.18, 3);
    const blobs = [];
    const leafCols = [0x3f6a22, 0x4d7d2a, 0x355c1f, 0x5a8a30];
    const blobDefs = [
      [0, 27.5, 0, 4.2],
      [2.6, 26.4, 0.8, 3.1],
      [-2.4, 26.6, -0.6, 3.3],
      [0.6, 29.4, -1.2, 2.8],
      [-0.8, 26.2, 2.4, 2.9],
    ];
    blobDefs.forEach(([x, y, z, r], i) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      jitter(g, r * 0.25, 10 + i);
      g.scale(1, 0.62, 1).translate(x, y, z);
      blobs.push(colorize(clean(g), _c.set(leafCols[i % leafCols.length])));
    });
    this.canopyGeo = mergeGeometries(blobs);

    const bushParts = [];
    [
      [0, 0.35, 0, 0.75],
      [0.55, 0.28, 0.25, 0.55],
      [-0.5, 0.3, -0.2, 0.6],
    ].forEach(([x, y, z, r], i) => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      jitter(g, r * 0.3, 40 + i);
      g.scale(1, 0.8, 1).translate(x, y, z);
      bushParts.push(colorize(clean(g), _c.set(i === 1 ? 0x5c8a2c : 0x44722a)));
    });
    // Fern fronds: flattened cones fanning out
    for (let i = 0; i < 5; i++) {
      const g = new THREE.ConeGeometry(0.12, 1.3, 4).rotateZ(Math.PI / 2 - 0.5).translate(0.55, 0.4, 0);
      g.rotateY((i / 5) * Math.PI * 2);
      bushParts.push(colorize(clean(g), _c.set(0x6a9a34)));
    }
    this.bushGeo = mergeGeometries(bushParts);

    this.rubbleGeo = jitter(new THREE.BoxGeometry(0.7, 0.45, 0.6, 2, 1, 2), 0.1, 77);
    this.vineGeo = new THREE.CylinderGeometry(0.05, 0.035, 1, 4, 6).translate(0, -0.5, 0);
    jitter(this.vineGeo, 0.06, 88);

    // Giant stone idol head for distant landmarks
    const head = new THREE.BoxGeometry(5, 6.5, 4.4, 2, 3, 2);
    jitter(head, 0.25, 99);
    const brow = new THREE.BoxGeometry(5.2, 0.7, 1).translate(0, 1.5, 2.3);
    const nose = new THREE.BoxGeometry(1, 2, 1.1).translate(0, 0.1, 2.5);
    const lips = new THREE.BoxGeometry(2.6, 0.55, 0.9).translate(0, -1.6, 2.35);
    const earL = new THREE.BoxGeometry(0.7, 2.6, 1.2).translate(-2.8, 0.3, 0.4);
    const earR = earL.clone().translate(5.6, 0, 0);
    const crown = new THREE.BoxGeometry(5.6, 1.1, 4.8).translate(0, 3.7, 0);
    this.idolGeo = mergeGeometries([head, brow, nose, lips, earL, earR, crown].map((g) => clean(g)));
    this.idolEyeGeo = mergeGeometries([
      clean(new THREE.BoxGeometry(0.9, 0.45, 0.2).translate(-1.2, 0.85, 2.25)),
      clean(new THREE.BoxGeometry(0.9, 0.45, 0.2).translate(1.2, 0.85, 2.25)),
    ]);
  }

  _makeSegment(index) {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(this.deckGeo, this.pathMat);
    deck.receiveShadow = true;
    g.add(deck);
    const found = new THREE.Mesh(this.foundationGeo, this.wallMat);
    found.position.y = -FOUNDATION_H / 2 - 0.01;
    found.receiveShadow = true;
    g.add(found);
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(this.curbGeo, this.curbMat);
      curb.position.set(side * (PATH_HALF + 0.3), 0.225, 0);
      curb.castShadow = true;
      curb.receiveShadow = true;
      g.add(curb);
    }

    // Two pillar slots per segment, each may be full (with torch) or broken.
    const pillars = [];
    for (let k = 0; k < 2; k++) {
      const full = new THREE.Mesh(this.pillarGeo, this.pillarMat);
      const broken = new THREE.Mesh(this.brokenPillarGeo, this.pillarMat);
      const bowl = new THREE.Mesh(this.bowlGeo, this.bronzeMat);
      const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
      const core = new THREE.Mesh(this.flameCoreGeo, this.flameCoreMat);
      core.position.y = 0.18;
      flame.add(core);
      for (const m of [full, broken, bowl]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      g.add(full, broken, bowl, flame);
      const torch = { pos: new THREE.Vector3(), flame, active: false, phase: Math.random() * 10 };
      this.torches.push(torch);
      pillars.push({ full, broken, bowl, flame, torch });
    }

    const idol = new THREE.Mesh(this.idolGeo, this.wallMat);
    idol.castShadow = true;
    const eyes = new THREE.Mesh(this.idolEyeGeo, this.idolEyeMat);
    idol.add(eyes);
    g.add(idol);

    this.scene.add(g);
    return { index, group: g, pillars, idol, zStart: 0 };
  }

  /** Place segment so it spans [zStart - SEG_LEN, zStart] and re-roll its scenery. */
  _place(seg, zStart, calm = false) {
    seg.zStart = zStart;
    const zc = zStart - SEG_LEN / 2;
    seg.group.position.set(0, 0, zc);

    seg.pillars.forEach((p, k) => {
      const side = (seg.index + k) % 2 === 0 ? -1 : 1;
      const lz = -SEG_LEN / 2 + 6 + k * 12;
      const x = side * 4.2;
      const broken = !calm && Math.random() < 0.3;
      p.full.visible = !broken;
      p.broken.visible = broken;
      p.bowl.visible = !broken;
      p.flame.visible = !broken;
      for (const m of [p.full, p.broken, p.bowl]) m.position.set(x, 0, lz);
      p.full.rotation.y = p.broken.rotation.y = (Math.random() - 0.5) * 0.1;
      p.flame.position.set(x, 5.55, lz);
      p.torch.active = !broken;
      p.torch.pos.set(x, 6.0, zc + lz);
    });

    const idolOn = Math.random() < 0.28;
    seg.idol.visible = idolOn;
    if (idolOn) {
      const side = Math.random() < 0.5 ? -1 : 1;
      seg.idol.position.set(side * (15 + Math.random() * 8), -3 + Math.random() * 3, (Math.random() - 0.5) * 10);
      seg.idol.rotation.set(0, -side * (0.6 + Math.random() * 0.4), (Math.random() - 0.5) * 0.15);
      seg.idol.scale.setScalar(1 + Math.random() * 0.6);
    }

    const i = seg.index;
    // Trees: most in the abyss either side, a few leaning in close to shade the path.
    for (let k = 0; k < TREES_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const close = k < 3;
      const x = side * (close ? 7 + Math.random() * 3 : 11 + Math.random() * 30);
      const z = zStart - Math.random() * SEG_LEN;
      const s = close ? 0.7 + Math.random() * 0.25 : 0.8 + Math.random() * 0.6;
      _p.set(x, -16 - Math.random() * 2, z);
      _e.set((Math.random() - 0.5) * 0.12, Math.random() * Math.PI * 2, close ? side * 0.12 : (Math.random() - 0.5) * 0.1);
      _s.set(s, s * (0.9 + Math.random() * 0.25), s);
      const tint = _c.setHSL(0.24 + Math.random() * 0.06, 0.45 + Math.random() * 0.2, 0.45 + Math.random() * 0.25);
      this.trunks.set(i, k, _p, _e, _s, null);
      this.canopies.set(i, k, _p, _e, _s, tint);
    }

    for (let k = 0; k < BUSHES_PER_SEG; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const x = side * (3.9 + Math.random() * 1.1);
      const z = zStart - Math.random() * SEG_LEN;
      const s = 0.6 + Math.random() * 0.7;
      _p.set(x, 0, z);
      _e.set(0, Math.random() * Math.PI * 2, side * 0.2);
      _s.setScalar(s);
      this.bushes.set(i, k, _p, _e, _s, _c.setHSL(0.22 + Math.random() * 0.08, 0.5, 0.5 + Math.random() * 0.2));
    }

    for (let k = 0; k < RUBBLE_PER_SEG; k++) {
      if (calm || Math.random() < 0.3) {
        this.rubble.hide(i, k);
        continue;
      }
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * (3.8 + Math.random() * 0.8);
      _p.set(x, 0.18, zStart - Math.random() * SEG_LEN);
      _e.set(Math.random() * 0.3, Math.random() * 3, Math.random() * 0.3);
      _s.setScalar(0.6 + Math.random() * 0.8);
      this.rubble.set(i, k, _p, _e, _s, null);
    }

    for (let k = 0; k < VINES_PER_SEG; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      _p.set(side * (4.6 + Math.random() * 3.5), 9 + Math.random() * 4, zStart - Math.random() * SEG_LEN);
      _e.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
      _s.set(1, 4 + Math.random() * 7, 1);
      this.vines.set(i, k, _p, _e, _s, null);
    }
  }

  reset(z0) {
    this.frontZ = z0 + SEG_LEN * 1.5;
    this.segments.sort((a, b) => a.index - b.index);
    for (const seg of this.segments) {
      this._place(seg, this.frontZ);
      this.frontZ -= SEG_LEN;
    }
    this._commit();
  }

  _commit() {
    for (const s of [this.trunks, this.canopies, this.bushes, this.rubble, this.vines]) s.commit();
  }

  update(pz, time) {
    // Recycle segments that are fully behind the camera.
    let moved = false;
    for (const seg of this.segments) {
      if (seg.zStart - SEG_LEN > pz + 14) {
        this._place(seg, this.frontZ);
        this.frontZ -= SEG_LEN;
        moved = true;
      }
    }
    if (moved) this._commit();

    // Flicker flames
    for (const t of this.torches) {
      if (!t.active) continue;
      const f = 0.85 + Math.sin(time * 13 + t.phase) * 0.08 + Math.sin(time * 23.7 + t.phase * 2) * 0.07;
      t.flame.scale.set(1 + (1 - f) * 0.6, f * 1.1, 1 + (1 - f) * 0.6);
      t.flame.rotation.y = time * 2 + t.phase;
    }
  }

  /** Nearest active torches ahead of the player (for the pooled point lights). */
  nearestTorches(pz, n) {
    return this.torches
      .filter((t) => t.active && t.pos.z < pz + 6 && t.pos.z > pz - 60)
      .sort((a, b) => b.pos.z - a.pos.z)
      .slice(0, n);
  }
}
