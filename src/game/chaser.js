// Demon monkeys that close in behind the player after a stumble.
import * as THREE from 'three';
import { damp } from './util.js';

export const CHASE_WINDOW = 6; // seconds the demons stay close after a stumble

export class Chaser {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const fur = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1, flatShading: true });
    const face = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9, flatShading: true });
    const eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.2) });

    this.monkeys = [];
    const offsets = [
      [0, 0],
      [-1.5, 1.4],
      [1.6, 1.9],
    ];
    for (const [ox, oz] of offsets) {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), fur);
      body.scale.set(0.9, 1.1, 1.2);
      body.position.y = 0.95;
      const head = new THREE.Group();
      head.position.set(0, 1.55, -0.35);
      const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), fur);
      const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), face);
      muzzle.position.set(0, -0.08, -0.25);
      muzzle.scale.set(1.2, 0.8, 0.8);
      head.add(skull, muzzle);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), eyes);
        e.position.set(s * 0.12, 0.06, -0.27);
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), fur);
        ear.position.set(s * 0.28, 0.22, 0);
        ear.rotation.z = -s * 0.6;
        head.add(e, ear);
      }
      const limbs = [];
      for (const [lx, ly, len] of [
        [-0.42, 1.3, 1.05],
        [0.42, 1.3, 1.05],
        [-0.25, 0.7, 0.72],
        [0.25, 0.7, 0.72],
      ]) {
        const pivot = new THREE.Group();
        pivot.position.set(lx, ly, 0);
        const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, len, 3, 6).translate(0, -len / 2, 0), fur);
        pivot.add(limb);
        m.add(pivot);
        limbs.push(pivot);
      }
      m.add(body, head);
      m.traverse((o) => o.isMesh && (o.castShadow = true));
      m.userData = { ox, oz, limbs, head, phase: Math.random() * 6 };
      this.group.add(m);
      this.monkeys.push(m);
    }
    this.dist = 14;
    this.group.visible = false;
  }

  reset() {
    this.dist = 14;
    this.group.visible = false;
  }

  /** closeness: 0 = far away, 1 = right behind, 2 = caught */
  update(dt, player, closeness, speed) {
    const target = closeness >= 2 ? 1.6 : closeness >= 1 ? 3.2 : 14;
    this.dist = damp(this.dist, target, closeness >= 2 ? 3 : 1.6, dt);
    this.group.visible = this.dist < 12;
    if (!this.group.visible) return;
    const rate = 4 + speed * 0.45;
    for (const m of this.monkeys) {
      const u = m.userData;
      u.phase += dt * rate;
      const s = Math.sin(u.phase);
      m.position.set(player.x * 0.8 + u.ox, Math.abs(Math.sin(u.phase)) * 0.25, player.z + this.dist + u.oz);
      m.rotation.x = -0.35 + s * 0.08;
      u.limbs[0].rotation.x = s * 1.1;
      u.limbs[1].rotation.x = -s * 1.1;
      u.limbs[2].rotation.x = -s * 0.9;
      u.limbs[3].rotation.x = s * 0.9;
      u.head.rotation.y = Math.sin(u.phase * 0.5) * 0.3;
    }
  }
}
