// Stylised explorer built from primitives, with a procedural run / jump / slide / lean rig.
import * as THREE from 'three';
import { LANE_W } from './track.js';
import { damp, clamp } from './util.js';

const GRAVITY = 30;
const JUMP_V = 10.2; // peak ~1.73 m, airtime ~0.68 s
const SLIDE_TIME = 0.85;
export const STAND_H = 1.75;
export const SLIDE_H = 0.8;

function mat(color, rough = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
}

/** Capsule limb hanging down from its pivot (top at y=0). */
function limb(r, len, m) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, -len / 2, 0);
  return new THREE.Mesh(g, m);
}

export class Player {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    const M = {
      skin: mat(0xc98d5e, 0.65),
      shirt: mat(0xd9c28e, 0.85),
      vest: mat(0x6e5332, 0.75),
      pants: mat(0x5b4a33, 0.9),
      boots: mat(0x33200f, 0.6),
      hat: mat(0x9b7445, 0.8),
      band: mat(0x2a1a0c, 0.6),
      scarf: mat(0xa3302a, 0.7),
      pack: mat(0x56663a, 0.85),
      eye: mat(0x111111, 0.3),
      buckle: new THREE.MeshStandardMaterial({ color: 0xd4a84a, metalness: 1, roughness: 0.3 }),
    };

    // body = everything; pelvis is the hip joint the torso and legs hang from.
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.95;
    this.body.add(this.pelvis);

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.26), M.pants);
    this.pelvis.add(hips);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.28), M.band);
    belt.position.y = 0.1;
    this.pelvis.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), M.buckle);
    buckle.position.set(0, 0.1, -0.145);
    this.pelvis.add(buckle);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.08;
    this.pelvis.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 12), M.shirt);
    chest.scale.set(1.12, 1, 0.72);
    chest.position.y = 0.32;
    this.torso.add(chest);
    const vestL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.3), M.vest);
    vestL.position.set(-0.13, 0.3, 0);
    const vestR = vestL.clone();
    vestR.position.x = 0.13;
    this.torso.add(vestL, vestR);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.18), M.pack);
    pack.position.set(0, 0.32, 0.22);
    this.torso.add(pack);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10).rotateZ(Math.PI / 2), M.scarf);
    roll.position.set(0, 0.56, 0.24);
    this.torso.add(roll);

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.66;
    this.torso.add(this.neck);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.045, 6, 12).rotateX(Math.PI / 2), M.scarf);
    this.neck.add(scarf);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), M.skin);
    head.scale.set(0.92, 1.05, 0.95);
    head.position.y = 0.16;
    this.neck.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), M.eye);
      eye.position.set(s * 0.055, 0.19, -0.135);
      this.neck.add(eye);
    }
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.03, 20), M.hat);
    brim.position.y = 0.27;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.15, 16), M.hat);
    crown.position.y = 0.35;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.182, 0.182, 0.045, 16), M.band);
    band.position.y = 0.3;
    const hat = new THREE.Group();
    hat.add(brim, crown, band);
    hat.rotation.x = -0.12;
    this.neck.add(hat);

    // Arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.29, 0.52, 0);
      this.torso.add(shoulder);
      const upper = limb(0.065, 0.24, M.shirt);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      const fore = limb(0.055, 0.22, M.skin);
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.skin);
      hand.position.y = -0.3;
      elbow.add(hand);
      shoulder.rotation.z = s * 0.12;
      this.arms.push({ shoulder, elbow });
    }

    // Legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.11, -0.05, 0);
      this.pelvis.add(hip);
      const thigh = limb(0.085, 0.3, M.pants);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = limb(0.07, 0.3, M.pants);
      knee.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.26), M.boots);
      boot.position.set(0, -0.42, -0.05);
      knee.add(boot);
      this.legs.push({ hip, knee });
    }

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.reset();
  }

  reset() {
    this.lane = 0;
    this.prevLane = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.phase = 0;
    this.dead = false;
    this.deadT = 0;
    this.stumbleT = 0;
    this.pose = {
      pelvisY: 0.95,
      bodyPitch: 0,
      torsoPitch: -0.2,
      legs: [0, 0],
      knees: [0, 0],
      arms: [0, 0],
      elbows: [0.8, 0.8],
    };
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
  }

  get sliding() {
    return this.slideT > 0;
  }

  get height() {
    return this.sliding ? SLIDE_H : STAND_H;
  }

  get targetX() {
    return this.lane * LANE_W;
  }

  setLane(l) {
    l = clamp(l, -1, 1);
    if (l === this.lane) return false;
    this.prevLane = this.lane;
    this.lane = l;
    return true;
  }

  moveLane(d) {
    return this.setLane(this.lane + d);
  }

  /** Bounce back after clipping the side of something. */
  bounceBack() {
    this.lane = this.prevLane;
  }

  jump() {
    if (!this.grounded || this.dead) return false;
    this.vy = JUMP_V;
    this.grounded = false;
    this.slideT = 0;
    return true;
  }

  slide() {
    if (this.dead) return false;
    if (!this.grounded) this.vy = Math.min(this.vy, -16); // slam down
    const started = this.slideT <= 0;
    this.slideT = SLIDE_TIME;
    return started;
  }

  stumble() {
    this.stumbleT = 0.5;
  }

  /** Pose from the player's tracked armature (see input/retarget.js), or null to use pure animation. */
  setMirror(rig) {
    this.mirror = rig;
  }

  _applyMirror(dt) {
    const m = this.mirror;
    const w = (this.mirrorW = damp(this.mirrorW ?? 0, m ? 1 : 0, 6, dt));
    this.mz ||= { arms: [0, 0], elbows: [0, 0], torso: 0, head: 0 };
    const z = this.mz;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const a = m?.arms[i];
      // Upper arm swings out/up in the frontal plane; forearm bends relative to it.
      z.arms[i] = damp(z.arms[i], a ? clamp(a.abduct, -0.4, 3.1) : 0.12, 14, dt);
      z.elbows[i] = damp(z.elbows[i], a ? clamp(a.bend, -2.6, 2.6) : 0, 14, dt);
      const armW = a ? w : 0;
      const { shoulder, elbow } = this.arms[i];
      shoulder.rotation.z = s * (0.12 + (z.arms[i] - 0.12) * armW);
      // Mirrored arms live in the frontal plane, so fade out the running swing.
      shoulder.rotation.x *= 1 - armW * 0.85;
      elbow.rotation.z = s * z.elbows[i] * armW;
      elbow.rotation.x *= 1 - armW * 0.9;
    }
    z.torso = damp(z.torso, m ? clamp(-m.torsoRoll, -0.5, 0.5) : 0, 10, dt);
    z.head = damp(z.head, m ? clamp(-(m.headRoll - m.torsoRoll), -0.5, 0.5) : 0, 10, dt);
    this.torso.rotation.z = z.torso * w;
    this.neck.rotation.z = z.head * w;
  }

  die() {
    this.dead = true;
    this.deadT = 0;
  }

  /**
   * @returns {{landed:boolean, step:boolean}} events for audio / particles
   */
  update(dt, speed, duckHeld = false) {
    const ev = { landed: false, step: false };

    if (this.dead) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.45);
      this.body.rotation.x = damp(this.body.rotation.x, -1.45, 8, dt);
      this.pelvis.position.y = damp(this.pelvis.position.y, 0.35, 8, dt);
      this.y = Math.max(0, this.y - dt * 6);
      this.root.position.y = this.y;
      this.root.rotation.z = damp(this.root.rotation.z, 0, 8, dt);
      for (const a of this.arms) a.shoulder.rotation.x = damp(a.shoulder.rotation.x, 2.6 * t, 6, dt);
      return ev;
    }

    // Lateral
    const prevX = this.x;
    this.x = damp(this.x, this.targetX, 13, dt);
    const lateralV = (this.x - prevX) / Math.max(dt, 1e-4);

    // Vertical
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        ev.landed = true;
      }
    }

    // Slide timer (camera players can hold a crouch to keep sliding)
    if (this.slideT > 0) {
      this.slideT -= dt;
      if (duckHeld && this.slideT < 0.15) this.slideT = 0.15;
    }
    if (this.stumbleT > 0) this.stumbleT -= dt;

    // Run cycle
    const prevPhase = this.phase;
    this.phase += dt * (4 + speed * 0.42);
    if (
      speed >= 0.5 &&
      this.grounded &&
      !this.sliding &&
      Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)
    ) {
      ev.step = true;
    }

    // Target pose
    const P = {};
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    if (this.sliding) {
      P.pelvisY = 0.42;
      P.bodyPitch = 1.05;
      P.torsoPitch = -0.35;
      P.legs = [1.35, 1.1];
      P.knees = [-0.15, -0.5];
      P.arms = [2.3, 2.0];
      P.elbows = [0.4, 0.5];
    } else if (!this.grounded) {
      const up = clamp(this.vy / JUMP_V, -1, 1);
      P.pelvisY = 0.95;
      P.bodyPitch = 0;
      P.torsoPitch = -0.25 + up * 0.1;
      P.legs = [1.0, 0.25 - up * 0.2];
      P.knees = [-1.5, -0.7];
      P.arms = [-0.9 + up * 0.3, 2.4];
      P.elbows = [1.1, 0.5];
    } else if (speed < 0.5) {
      // Standing ready (countdown): gentle breathing.
      const b = Math.sin(this.phase * 0.35);
      P.pelvisY = 0.95 + b * 0.008;
      P.bodyPitch = 0;
      P.torsoPitch = -0.05 + b * 0.02;
      P.legs = [0.05, -0.05];
      P.knees = [-0.08, -0.08];
      P.arms = [0.1, 0.1];
      P.elbows = [0.35, 0.35];
    } else {
      const stumble = this.stumbleT > 0 ? Math.sin(this.stumbleT * 40) * 0.25 : 0;
      P.pelvisY = 0.93 + Math.abs(c) * 0.07;
      P.bodyPitch = 0;
      P.torsoPitch = -0.22 - Math.min(speed, 30) * 0.004 + stumble;
      P.legs = [s * 0.95, -s * 0.95];
      P.knees = [-0.25 - 1.2 * Math.max(0, c), -0.25 - 1.2 * Math.max(0, -c)];
      P.arms = [-s * 0.85, s * 0.85];
      P.elbows = [1.25 + s * 0.2, 1.25 - s * 0.2];
    }

    const k = this.sliding || !this.grounded ? 16 : 22;
    const p = this.pose;
    p.pelvisY = damp(p.pelvisY, P.pelvisY, k, dt);
    p.bodyPitch = damp(p.bodyPitch, P.bodyPitch, k, dt);
    p.torsoPitch = damp(p.torsoPitch, P.torsoPitch, k, dt);
    for (let i = 0; i < 2; i++) {
      p.legs[i] = damp(p.legs[i], P.legs[i], k, dt);
      p.knees[i] = damp(p.knees[i], P.knees[i], k, dt);
      p.arms[i] = damp(p.arms[i], P.arms[i], k, dt);
      p.elbows[i] = damp(p.elbows[i], P.elbows[i], k, dt);
    }

    this.pelvis.position.y = p.pelvisY;
    this.body.rotation.x = p.bodyPitch;
    this.torso.rotation.x = p.torsoPitch;
    for (let i = 0; i < 2; i++) {
      this.legs[i].hip.rotation.x = p.legs[i];
      this.legs[i].knee.rotation.x = p.knees[i];
      this.arms[i].shoulder.rotation.x = p.arms[i];
      this.arms[i].elbow.rotation.x = p.elbows[i];
    }
    this.neck.rotation.x = -p.torsoPitch * 0.6 - p.bodyPitch * 0.5;
    this._applyMirror(dt);

    // Lean into lane changes
    this.root.rotation.z = damp(this.root.rotation.z, clamp(-lateralV * 0.035, -0.4, 0.4), 10, dt);
    this.root.rotation.y = damp(this.root.rotation.y, clamp(-lateralV * 0.02, -0.3, 0.3), 10, dt);

    this.root.position.set(this.x, this.y, this.z);
    return ev;
  }
}
