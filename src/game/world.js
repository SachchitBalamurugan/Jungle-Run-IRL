// Renderer, scene, lighting, sky, atmosphere and post-processing.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeMistTexture, makeShaftTexture, makeSoftSprite, makeGroundTexture } from './textures.js';

export const SUN_DIR = new THREE.Vector3(0.55, 0.42, -0.72).normalize();
const FOG_COLOR = new THREE.Color(0x9a8a62);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uDanger: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uDanger;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Warm split-tone grade: lift shadows toward teal-green, push highlights toward gold.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.86, 1.0, 0.94), smoothstep(0.35, 0.0, l) * 0.5);
      col = mix(col, col * vec3(1.08, 1.0, 0.86), smoothstep(0.3, 1.2, l) * 0.6);
      // Gentle saturation boost
      col = mix(vec3(l), col, 1.12);
      // Vignette (+ red danger pulse when the demons are close)
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d) * uVignette);
      col *= mix(0.55, 1.0, v);
      col = mix(col, col * vec3(1.4, 0.35, 0.25), (1.0 - v) * uDanger);
      // Film grain
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

export class World {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = FOG_COLOR.clone();
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0135);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.set(0, 3.4, 7);
    this.baseFov = 62;

    this._buildSky();
    this._buildLights();
    this._buildEnvironment();
    this._buildAtmosphere();
    this._buildComposer();

    this.time = 0;
    window.addEventListener('resize', () => this.resize());
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d6f8f) },
        uHorizon: { value: FOG_COLOR.clone() },
        uBottom: { value: new THREE.Color(0x2b3320) },
        uSunDir: { value: SUN_DIR.clone() },
        uSunColor: { value: new THREE.Color(0xffd08a) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, smoothstep(0.02, 0.55, h));
          col = mix(col, uBottom, smoothstep(0.0, -0.3, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 600.0) * 6.0 + pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    // Image-based lighting from the sky so metals (coins) and stone get soft, coloured reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(geo, mat));
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffe2b0, 0x2c3a1a, 0.9);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffcf8f, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -16;
    s.right = 16;
    s.top = 22;
    s.bottom = -22;
    s.near = 1;
    s.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  _buildEnvironment() {
    // Far jungle floor way below the causeway, plus a drifting mist layer between.
    const groundTex = makeGroundTexture();
    groundTex.repeat.set(30, 30);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: 0x9aa878 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -16;
    this.ground.receiveShadow = false;
    this.scene.add(this.ground);

    const mistTex = makeMistTexture();
    mistTex.repeat.set(6, 6);
    this.mistLayers = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        new THREE.MeshBasicMaterial({
          map: mistTex.clone(),
          color: 0xe9dcc0,
          transparent: true,
          opacity: 0.55 - i * 0.15,
          depthWrite: false,
          fog: true,
        })
      );
      m.material.map.repeat.set(5 + i * 2, 5 + i * 2);
      m.rotation.x = -Math.PI / 2;
      m.position.y = -4.5 - i * 3.5;
      this.mistLayers.push(m);
      this.scene.add(m);
    }
  }

  _buildAtmosphere() {
    // God-ray light shafts: big additive quads that recycle around the player.
    const shaftTex = makeShaftTexture();
    const shaftMat = new THREE.MeshBasicMaterial({
      map: shaftTex,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.shafts = [];
    for (let i = 0; i < 9; i++) {
      const w = 3 + Math.random() * 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 34), shaftMat);
      m.userData.z = -i * 13 - Math.random() * 6;
      m.userData.x = (Math.random() - 0.5) * 30;
      m.rotation.set(0, Math.random() * Math.PI, -0.45 + (Math.random() - 0.5) * 0.2);
      this.shafts.push(m);
      this.scene.add(m);
    }

    // Floating dust motes around the camera.
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 10 - 1;
      pos[i * 3 + 2] = -Math.random() * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustBase = pos.slice();
    this.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.09,
        map: makeSoftSprite(),
        color: 0xffe6b0,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  _buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.82);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /** Keep sky, sun, shadows and atmosphere centred on the player. */
  follow(px, pz, dt) {
    this.time += dt;
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(px + SUN_DIR.x * 60, SUN_DIR.y * 60, pz + SUN_DIR.z * 60 - 8);
    this.sun.target.position.set(px, 0, pz - 8);
    this.ground.position.x = px;
    this.ground.position.z = pz;
    this.ground.material.map.offset.set(px / 20, -pz / 20);

    for (let i = 0; i < this.mistLayers.length; i++) {
      const m = this.mistLayers[i];
      m.position.x = px;
      m.position.z = pz;
      m.material.map.offset.set(px / 400 + this.time * 0.004 * (i + 1), -pz / 400 * (1 + i * 0.15));
    }

    for (const s of this.shafts) {
      if (s.userData.z > pz + 12) {
        s.userData.z -= 117;
        s.userData.x = (Math.random() - 0.5) * 30;
      }
      s.position.set(s.userData.x, 8, s.userData.z);
    }

    const p = this.dust.geometry.attributes.position;
    const b = this.dustBase;
    for (let i = 0; i < p.count; i++) {
      let z = b[i * 3 + 2] + this.time * 0.3;
      // wrap into a 60-unit window ahead of the camera
      const rel = ((z - pz + 50) % 60 + 60) % 60 - 55;
      p.array[i * 3] = b[i * 3] + Math.sin(this.time * 0.4 + i) * 0.4 + px;
      p.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(this.time * 0.3 + i * 1.7) * 0.3;
      p.array[i * 3 + 2] = pz + rel;
    }
    p.needsUpdate = true;
    this.grade.uniforms.uTime.value = this.time % 100;
  }

  render() {
    this.composer.render();
  }
}
