// CPU particle pool rendered as a single Points draw call with per-particle size/colour/alpha.
import * as THREE from 'three';
import { makeSoftSprite } from './textures.js';

const sprite = makeSoftSprite();

export class Particles {
  constructor(scene, max = 800, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: sprite },
        uScale: { value: window.innerHeight * 0.5 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    window.addEventListener('resize', () => (mat.uniforms.uScale.value = window.innerHeight * 0.5));
  }

  /**
   * @param {THREE.Vector3|{x,y,z}} p
   * @param {number} n
   * @param {object} o  color (THREE.Color), spread, speed, up, life, size, gravity, drag
   */
  emit(p, n, o = {}) {
    const color = o.color || new THREE.Color(1, 1, 1);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const sp = o.spread ?? 0.2;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * sp;
      const s = o.speed ?? 2;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s + (o.vx ?? 0);
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s * (o.upBias ?? 0.5) + (o.up ?? 0);
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s + (o.vz ?? 0);
      const l = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.baseSize[i] = (o.size ?? 0.3) * (0.6 + Math.random() * 0.8);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      const v = o.colorJitter ?? 0.1;
      const j = 1 - Math.random() * v;
      this.col[i * 3] = color.r * j;
      this.col[i * 3 + 1] = color.g * j;
      this.col[i * 3 + 2] = color.b * j;
      this.alpha[i] = o.alpha ?? 1;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t + (1 - t) * 0.6);
      this.alpha[i] = Math.min(1, t * 1.6);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.size.needsUpdate = true;
    a.alpha.needsUpdate = true;
    a.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
