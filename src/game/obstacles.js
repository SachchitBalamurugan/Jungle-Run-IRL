// Obstacle kinds, their meshes, and collision boxes.
//   jump: log, lowwall       duck: arch, branch       dodge (lane): block, idol
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W, PATH_HALF } from './track.js';
import { makeBarkTexture, makeWallTextures } from './textures.js';

export const NEEDS = {
  log: 'jump',
  lowwall: 'jump',
  arch: 'duck',
  branch: 'duck',
  block: 'dodge',
  idol: 'dodge',
};

function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  return n;
}

function shadowAll(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

export class Obstacles {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.pool = {};

    const bark = makeBarkTexture();
    bark.repeat.set(1, 4);
    this.barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 1, color: 0xb8a282 });
    const endMat = new THREE.MeshStandardMaterial({ color: 0xa4814f, roughness: 0.9 });
    this.endMat = endMat;
    const wall = makeWallTextures();
    wall.map.repeat.set(0.5, 0.5);
    wall.bump.repeat.set(0.5, 0.5);
    this.stoneMat = new THREE.MeshStandardMaterial({ map: wall.map, bumpMap: wall.bump, bumpScale: 3, roughness: 0.92, color: 0xd9ccb2 });
    this.mossMat = new THREE.MeshStandardMaterial({ color: 0x4a6e26, roughness: 0.9, flatShading: true });
    this.leafMat = new THREE.MeshStandardMaterial({ color: 0x4f7d2a, roughness: 0.85, flatShading: true });
    this.vineMat = new THREE.MeshStandardMaterial({ color: 0x3c5a1a, roughness: 0.9 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.1, 0.2) });
  }

  // ------------------------------------------------------------------ builders
  _build(kind) {
    const g = new THREE.Group();
    const W = PATH_HALF * 2;
    if (kind === 'log') {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, W + 0.9, 14, 1).rotateZ(Math.PI / 2), [
        this.barkMat,
        this.endMat,
        this.endMat,
      ]);
      log.position.y = 0.42;
      g.add(log);
      for (let i = 0; i < 3; i++) {
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.8, 6), this.barkMat);
        stub.position.set(-2 + i * 2, 0.75, (i % 2 ? 1 : -1) * 0.2);
        stub.rotation.set((i % 2 ? 1 : -1) * 0.9, 0, 0.3);
        g.add(stub);
      }
      const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0).scale(1.6, 0.35, 0.9), this.mossMat);
      moss.position.set(0.8, 0.8, 0);
      g.add(moss);
      g.userData.boxes = [[-PATH_HALF, PATH_HALF, 0, 0.82, -0.44, 0.44]];
    } else if (kind === 'lowwall') {
      const parts = [];
      let x = -PATH_HALF - 0.2;
      while (x < PATH_HALF + 0.2) {
        const w = 0.8 + Math.random() * 0.6;
        const h = 0.55 + Math.random() * 0.2;
        const b = new THREE.BoxGeometry(w - 0.05, h, 0.7).translate(x + w / 2, h / 2, (Math.random() - 0.5) * 0.12);
        b.rotateY((Math.random() - 0.5) * 0.06);
        parts.push(clean(b));
        x += w;
      }
      g.add(new THREE.Mesh(mergeGeometries(parts), this.stoneMat));
      const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0).scale(2.2, 0.3, 0.8), this.mossMat);
      moss.position.set(-1, 0.72, 0);
      g.add(moss);
      g.userData.boxes = [[-PATH_HALF, PATH_HALF, 0, 0.76, -0.38, 0.38]];
    } else if (kind === 'arch') {
      for (const s of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.4, 0.9), this.stoneMat);
        col.position.set(s * (PATH_HALF + 0.55), 1.7, 0);
        g.add(col);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, 0.95, 1.0), this.stoneMat);
      beam.position.y = 1.3 + 0.475;
      g.add(beam);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 2.9, 0.35, 1.2), this.stoneMat);
      lintel.position.y = 2.42;
      g.add(lintel);
      // glowing carved eyes on the beam
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.05), this.eyeMat);
        eye.position.set(s * 0.6, 1.85, 0.51);
        g.add(eye);
      }
      for (let i = 0; i < 7; i++) {
        const len = 0.3 + Math.random() * 0.6;
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, len, 4).translate(0, -len / 2, 0), this.vineMat);
        v.position.set(-3 + Math.random() * 6, 1.32, 0.45 * (Math.random() < 0.5 ? -1 : 1));
        g.add(v);
      }
      g.userData.boxes = [[-PATH_HALF, PATH_HALF, 1.22, 3.2, -0.5, 0.5]];
    } else if (kind === 'branch') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, W + 3, 10).rotateZ(Math.PI / 2 - 0.06), this.barkMat);
      trunk.position.y = 1.72;
      g.add(trunk);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.9, 8), this.barkMat);
        post.position.set(s * (PATH_HALF + 0.6), 0.9, 0);
        post.rotation.z = s * 0.15;
        g.add(post);
      }
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.3, 0), this.leafMat);
        leaf.position.set(-3 + i * 1.2, 2.05 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4);
        leaf.scale.set(1.2, 0.6, 1);
        g.add(leaf);
      }
      for (let i = 0; i < 5; i++) {
        const len = 0.2 + Math.random() * 0.35;
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, len, 4).translate(0, -len / 2, 0), this.vineMat);
        v.position.set(-2.6 + Math.random() * 5.2, 1.45, (Math.random() - 0.5) * 0.3);
        g.add(v);
      }
      g.userData.boxes = [[-PATH_HALF, PATH_HALF, 1.3, 3.2, -0.4, 0.4]];
    } else if (kind === 'block') {
      const parts = [
        clean(new THREE.BoxGeometry(1.8, 1.6, 1.3).translate(0, 0.8, 0)),
        clean(new THREE.BoxGeometry(1.4, 0.9, 1.0).rotateY(0.25).translate(0.05, 2.05, 0.05)),
      ];
      g.add(new THREE.Mesh(mergeGeometries(parts), this.stoneMat));
      const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0).scale(1.2, 0.3, 1), this.mossMat);
      moss.position.set(0.1, 2.5, 0);
      g.add(moss);
      g.userData.boxes = [[-0.9, 0.9, 0, 2.5, -0.65, 0.65]];
    } else if (kind === 'idol') {
      // Toppled stone statue head with glowing eyes
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.5), this.stoneMat);
      head.position.y = 1.1;
      head.rotation.z = 0.12;
      g.add(head);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.3), this.stoneMat);
      brow.position.set(0, 1.55, 0.78);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.35), this.stoneMat);
      nose.position.set(0, 1.1, 0.85);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.2), this.stoneMat);
      mouth.position.set(0, 0.55, 0.78);
      head.add(brow, nose, mouth);
      brow.position.y -= 1.1;
      nose.position.y -= 1.1;
      mouth.position.y -= 1.1;
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), this.eyeMat);
        eye.position.set(s * 0.45, 0.25, 0.76);
        head.add(eye);
      }
      g.userData.boxes = [[-0.95, 0.95, 0, 2.3, -0.8, 0.8]];
    }
    shadowAll(g);
    g.userData.kind = kind;
    this.scene.add(g);
    return g;
  }

  _get(kind) {
    const list = (this.pool[kind] ||= []);
    const free = list.find((g) => !g.visible);
    if (free) return free;
    const g = this._build(kind);
    list.push(g);
    return g;
  }

  /** Spawn an obstacle. `lane` only matters for lane-blocking kinds. */
  spawn(kind, z, lane = 0) {
    const g = this._get(kind);
    g.visible = true;
    const x = NEEDS[kind] === 'dodge' ? lane * LANE_W : 0;
    g.position.set(x, 0, z);
    g.rotation.y = NEEDS[kind] === 'dodge' ? (Math.random() - 0.5) * 0.3 : 0;
    const o = {
      kind,
      need: NEEDS[kind],
      group: g,
      z,
      lane,
      hit: false,
      boxes: g.userData.boxes.map(([x0, x1, y0, y1, z0, z1]) => ({
        x0: x + x0,
        x1: x + x1,
        y0,
        y1,
        z0: z + z0,
        z1: z + z1,
      })),
    };
    this.active.push(o);
    return o;
  }

  /** Is `lane` blocked by a dodge obstacle overlapping [zMin, zMax]? */
  laneBlocked(lane, zMin, zMax) {
    return this.active.find(
      (o) => o.need === 'dodge' && o.lane === lane && o.boxes[0].z0 < zMax && o.boxes[0].z1 > zMin
    );
  }

  update(pz) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (o.z > pz + 12) {
        o.group.visible = false;
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    for (const o of this.active) o.group.visible = false;
    this.active.length = 0;
  }
}
