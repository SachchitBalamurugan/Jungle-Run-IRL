// Gold coins: one InstancedMesh, spinning and bobbing, with a quick fly-up when collected.
import * as THREE from 'three';

const MAX = 320;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Coins {
  constructor(scene) {
    // Lathe profile gives a proper raised rim.
    const pts = [
      [0, 0.028],
      [0.2, 0.028],
      [0.225, 0.048],
      [0.29, 0.048],
      [0.31, 0],
      [0.29, -0.048],
      [0.225, -0.048],
      [0.2, -0.028],
      [0, -0.028],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffc23a,
      metalness: 1,
      roughness: 0.22,
      emissive: 0xa86400,
      emissiveIntensity: 0.55,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.items = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, z: 0, t: 0, got: -1 }));
    this.time = 0;
  }

  add(x, y, z) {
    const c = this.items.find((i) => !i.on);
    if (!c) return;
    c.on = true;
    c.x = x;
    c.y = y;
    c.z = z;
    c.t = Math.random() * 10;
    c.got = -1;
  }

  /** Line of coins in a lane from z0 going forward (negative z). */
  line(x, z0, count, spacing = 2.2, y = 0.75) {
    for (let i = 0; i < count; i++) this.add(x, y, z0 - i * spacing);
  }

  /** Arc of coins following a jump over something centred at zc. */
  arc(x, zc, count = 7, span = 9) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const y = 0.75 + Math.sin(t * Math.PI) * 1.6;
      this.add(x, y, zc + span / 2 - t * span);
    }
  }

  clear() {
    for (const c of this.items) c.on = false;
  }

  /**
   * Updates animation, collects coins that touch the player box.
   * @returns {THREE.Vector3[]} positions of coins collected this frame
   */
  update(dt, player, collect = true) {
    this.time += dt;
    const got = [];
    const px = player.x;
    const py = player.y;
    const ph = player.height;
    const pz = player.z;
    for (let i = 0; i < MAX; i++) {
      const c = this.items[i];
      if (!c.on) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      if (c.z > pz + 10) {
        c.on = false;
        continue;
      }
      let scale = 1;
      let y = c.y + Math.sin(this.time * 3 + c.t) * 0.08;
      let x = c.x;
      let z = c.z;
      if (c.got >= 0) {
        c.got += dt;
        const k = c.got / 0.28;
        if (k >= 1) {
          c.on = false;
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
          continue;
        }
        // fly toward the player's chest and shrink
        x = c.x + (px - c.x) * k;
        z = pz - 0.2;
        y = c.y + k * 1.4;
        scale = 1 - k * 0.8;
      } else if (
        collect &&
        Math.abs(c.x - px) < 0.85 &&
        Math.abs(c.z - pz) < 0.75 &&
        c.y > py - 0.3 &&
        c.y < py + ph + 0.35
      ) {
        c.got = 0;
        got.push(new THREE.Vector3(c.x, c.y, c.z));
      }
      _q.setFromEuler(_e.set(0, this.time * 3.2 + c.t, 0));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return got;
  }
}
