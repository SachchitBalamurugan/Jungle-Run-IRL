// Jungle Run IRL: game bootstrap + state machine.
// (auto) calibrate -> countdown -> running <-> paused -> dying -> over  (menu reachable from game over)
import * as THREE from 'three';
import { World } from './game/world.js';
import { Track, LANE_W } from './game/track.js';
import { Player } from './game/player.js';
import { Obstacles } from './game/obstacles.js';
import { Coins } from './game/coins.js';
import { Spawner } from './game/patterns.js';
import { checkCollisions } from './game/collision.js';
import { Particles } from './game/particles.js';
import { Chaser, CHASE_WINDOW } from './game/chaser.js';
import { Audio } from './game/audio.js';
import { damp, clamp } from './game/util.js';
import { Hud, showScreen } from './ui/hud.js';
import { Bus } from './input/bus.js';
import { bindKeyboard } from './input/keyboard.js';
import { PoseClient } from './input/poseClient.js';
import { poseToRig } from './input/retarget.js';
import { drawOverlay } from './input/overlay.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ setup
const world = new World($('game'));
const { scene, camera } = world;
const track = new Track(scene);
const player = new Player(scene);
const obstacles = new Obstacles(scene);
const coins = new Coins(scene);
const spawner = new Spawner(obstacles, coins);
const sparks = new Particles(scene, 900, true);
const dust = new Particles(scene, 500, false);
const chaser = new Chaser(scene);
const audio = new Audio();
const hud = new Hud();
const bus = new Bus();
// Body tracking runs in Python (tracker/server.py): OpenCV capture + MediaPipe armature.
const tracker = new PoseClient(bus);
bindKeyboard(bus);

const torchLights = Array.from({ length: 4 }, () => {
  const l = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
  scene.add(l);
  return l;
});

const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const calibCanvas = $('calib-canvas');
const calibCtx = calibCanvas.getContext('2d');

const BASE_SPEED = { keyboard: 13, camera: 11 };
const MAX_SPEED = { keyboard: 30, camera: 23 };
const ACCEL = { keyboard: 0.11, camera: 0.07 };

const S = {
  state: 'menu',
  mode: 'keyboard',
  t: 0,
  speed: 0,
  speedMul: 1,
  dist: 0,
  score: 0,
  coins: 0,
  mult: 1,
  lastStumble: -99,
  dyingT: 0,
  shake: 0,
  countdown: 0,
  countdownStep: 0,
  pendingLane: null,
  lostT: 0,
  foundT: 0,
  restartHold: 0,
  deathCause: '',
  best: loadBest(),
  menuT: 0,
};

function loadBest() {
  try {
    return Number(localStorage.getItem('trirl-best')) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v) {
  try {
    localStorage.setItem('trirl-best', String(v));
  } catch {
    /* storage unavailable */
  }
}

function updateBestLine() {
  $('best-line').textContent = S.best ? `Best run: ${Math.floor(S.best).toLocaleString()}` : '';
}
updateBestLine();


// ------------------------------------------------------------------ flow
function resetRun() {
  player.reset();
  track.reset(0);
  obstacles.clear();
  coins.clear();
  sparks.clear();
  dust.clear();
  chaser.reset();
  spawner.reset(0, { leniency: S.mode === 'camera' ? 1.2 : 1 });
  Object.assign(S, {
    t: 0,
    speed: 0,
    speedMul: 1,
    dist: 0,
    score: 0,
    coins: 0,
    mult: 1,
    lastStumble: -99,
    dyingT: 0,
    shake: 0,
    pendingLane: null,
    restartHold: 0,
  });
  camera.position.set(0, 3.4, 7);
  lookAt.set(0, 1.3, -7);
}

function startCountdown(seconds = 3) {
  S.state = 'countdown';
  S.countdown = seconds;
  S.countdownStep = seconds + 1;
  showScreen('countdown');
  hud.show(true);
}

function beginRun() {
  resetRun();
  $('menu-note').textContent = '';
  $('cam-panel').classList.toggle('hidden', S.mode !== 'camera');
  startCountdown(3);
  audio.startMusic();
}

/** Camera play: runs the full-body calibration first unless we already have one. */
async function playWithCamera(recalibrate = false) {
  S.mode = 'camera';
  if (!recalibrate && tracker.connected && tracker.calibrated) {
    beginRun();
    return;
  }
  showScreen('calibrate');
  hud.show(false);
  $('cam-panel').classList.add('hidden');
  S.state = 'calibrate';
  $('calib-issue').textContent = '';
  tracker.startCalibration(); // queued until the Python tracker is connected
  renderSteps();
}

function playWithKeyboard() {
  audio.unlock();
  S.mode = 'keyboard';
  beginRun();
}

function renderSteps() {
  const labels = tracker.steps.length ? tracker.steps : ['Stand in position', 'Crouch', 'Jump'];
  const idx = tracker.calibrating ? tracker.stepIndex : -1;
  $('calib-steps').innerHTML = labels
    .map((label, i) => `<li data-n="${i + 1}" class="${i < idx ? 'done' : i === idx ? 'active' : ''}">${label}</li>`)
    .join('');
}
bus.on('calibstep', renderSteps);
bus.on('tracker', ({ connected }) => {
  renderSteps();
  if (!connected && S.state === 'running' && S.mode === 'camera') {
    pause('The Python tracker disconnected. Restart it with: npm run tracker', 'Tracker offline');
  }
});

bus.on('calibrated', () => {
  if (S.state === 'calibrate') {
    audio.go();
    hud.toast('CALIBRATED!', 900);
    beginRun();
  }
});

function gameOver() {
  S.state = 'over';
  S.restartHold = 0;
  const final = Math.floor(S.score);
  if (final > S.best) {
    S.best = final;
    saveBest(final);
  }
  $('over-score').textContent = final.toLocaleString();
  $('over-coins').textContent = S.coins;
  $('over-dist').textContent = `${Math.floor(S.dist)} m`;
  $('over-best').textContent = Math.floor(S.best).toLocaleString();
  document.querySelector('#screen-over .title-kicker').textContent = S.deathCause;
  $('restart-hint').innerHTML =
    S.mode === 'camera'
      ? 'Raise both arms above your head and hold to run again (or press <kbd>Space</kbd>)'
      : 'Press <kbd>Space</kbd> to run again';
  showScreen('over');
  hud.show(false);
  audio.stopMusic();
  updateBestLine();
}

function toMenu() {
  S.state = 'menu';
  resetRun();
  showScreen('menu');
  $('btn-recalibrate').classList.toggle('hidden', !tracker.calibrated);
  hud.show(false);
  $('cam-panel').classList.add('hidden');
  audio.stopMusic();
}

function pause(msg = 'Press P to resume.', title = 'Paused') {
  if (S.state !== 'running') return;
  S.state = 'paused';
  $('pause-title').textContent = title;
  $('pause-msg').textContent = msg;
  showScreen('pause');
}

function resume() {
  if (S.state !== 'paused') return;
  startCountdown(S.mode === 'camera' ? 2 : 1);
}

$('btn-camera').addEventListener('click', () => playWithCamera(false));
$('btn-recalibrate').addEventListener('click', () => playWithCamera(true));
$('btn-over-recal').addEventListener('click', () => playWithCamera(true));
$('btn-keys').addEventListener('click', playWithKeyboard);
$('btn-calib-skip').addEventListener('click', playWithKeyboard);
$('btn-calib-restart').addEventListener('click', () => tracker.startCalibration());
$('btn-calib-skip-step').addEventListener('click', () => tracker.skipStep());

// Browsers only allow audio after a user gesture; the camera flow may never click, so unlock on any.
function unlockAudio() {
  audio.unlock();
  if (['countdown', 'running', 'paused'].includes(S.state)) audio.startMusic();
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
$('btn-restart').addEventListener('click', () => {
  audio.unlock();
  beginRun();
});
$('btn-menu').addEventListener('click', toMenu);

// ------------------------------------------------------------------ input
function doJump() {
  if (player.jump()) audio.jump();
}
function doDuck() {
  if (player.slide()) audio.slide();
}

bus.on('action', ({ action, lane, source }) => {
  if (action === 'mute') {
    hud.toast(audio.toggleMute() ? 'MUTED' : 'SOUND ON', 600);
    return;
  }
  if (action === 'camview') {
    $('cam-panel').classList.toggle('big');
    return;
  }
  if (action === 'pause') {
    if (S.state === 'running') pause();
    else if (S.state === 'paused') resume();
    return;
  }
  if (S.state === 'over' && action === 'jump' && source === 'keyboard') {
    beginRun();
    return;
  }
  if (S.state === 'menu' && action === 'jump' && source === 'keyboard') {
    playWithKeyboard();
    return;
  }
  if (S.state !== 'running') return;

  const fromCam = source === 'camera';
  switch (action) {
    case 'left':
    case 'right':
      S.pendingLane = null;
      if (player.moveLane(action === 'left' ? -1 : 1)) audio.lane();
      break;
    case 'lane':
      S.pendingLane = lane; // applied in the loop once the lane is clear
      break;
    case 'jump':
      doJump();
      if (fromCam) hud.toast('JUMP!', 350);
      break;
    case 'duck':
      doDuck();
      if (fromCam) hud.toast('DUCK!', 350);
      break;
  }
});

// ------------------------------------------------------------------ game loop pieces
const _tmp = new THREE.Vector3();
const _look = new THREE.Vector3();
const lookAt = new THREE.Vector3(0, 1.3, -7);
const GOLD = new THREE.Color(4, 2.6, 0.7);
const EMBER = new THREE.Color(3.5, 1.1, 0.25);
const DIRT = new THREE.Color(0.55, 0.47, 0.36);
const RED = new THREE.Color(4, 0.4, 0.2);

function applyCameraLane() {
  if (S.mode !== 'camera' || S.pendingLane === null) return;
  const want = S.pendingLane;
  if (want === player.lane) return;
  // Don't steer the runner straight into the side of a block; wait until it is clear.
  if (obstacles.laneBlocked(want, player.z - 1.6, player.z + 1.6)) return;
  if (player.setLane(want)) {
    audio.lane();
    hud.toast(want < player.prevLane ? '◀' : '▶', 250);
  }
}

function stumble() {
  if (S.t - S.lastStumble < CHASE_WINDOW) {
    S.deathCause = 'The demon monkeys caught you';
    die();
    return;
  }
  S.lastStumble = S.t;
  S.speedMul = 0.72;
  S.shake = 0.35;
  player.stumble();
  audio.stumble();
  hud.flash();
  hud.toast('CAREFUL!', 600);
  dust.emit(_tmp.set(player.x, 0.3, player.z), 14, { color: DIRT, speed: 2.5, life: 0.8, size: 0.6, drag: 3 });
}

function die() {
  if (S.state !== 'running') return;
  S.state = 'dying';
  S.dyingT = 0;
  S.shake = 0.8;
  player.die();
  audio.crash();
  hud.flash();
  dust.emit(_tmp.set(player.x, 0.8, player.z - 0.4), 40, { color: DIRT, speed: 4, life: 1.2, size: 0.9, drag: 2.5 });
  sparks.emit(_tmp.set(player.x, 1, player.z - 0.4), 20, { color: RED, speed: 5, life: 0.5, size: 0.15, gravity: 6 });
}

function updateTorches(dt) {
  const near = track.nearestTorches(player.z, torchLights.length);
  torchLights.forEach((l, i) => {
    const t = near[i];
    if (!t) {
      l.intensity = 0;
      return;
    }
    l.position.copy(t.pos);
    l.intensity = 9 + Math.sin(world.time * 17 + i * 3) * 1.6 + Math.sin(world.time * 29 + i) * 1.2;
    if (Math.random() < dt * 7) {
      sparks.emit(t.pos, 1, { color: EMBER, speed: 0.6, up: 1.4, upBias: 0.2, spread: 0.3, life: 1.3, size: 0.09, gravity: -0.4, drag: 0.6 });
    }
  });
}

function updateCamera(dt, running) {
  const px = player.x;
  const pz = player.z;
  if (S.state === 'menu') {
    // Attract mode: slow orbit showing the explorer from the front-side.
    S.menuT += dt;
    const a = Math.sin(S.menuT * 0.25) * 0.9;
    camera.position.set(px + Math.sin(a) * 5.5, 2.2 + Math.sin(S.menuT * 0.3) * 0.3, pz - Math.cos(a) * 5.5);
    camera.lookAt(px, 1.25, pz);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  const dying = S.state === 'dying';
  const tx = px * 0.55;
  const ty = dying ? 5.2 : 3.3 + player.y * 0.35;
  const tz = pz + (dying ? 7.2 : 6.4);
  camera.position.x = damp(camera.position.x, tx, 7, dt);
  camera.position.y = damp(camera.position.y, ty, 6, dt);
  camera.position.z = running ? tz : damp(camera.position.z, tz, 4, dt);
  if (S.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * S.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * S.shake * 0.5;
    S.shake = Math.max(0, S.shake - dt * 1.4);
  }
  if (dying) _look.set(px, 0.6, pz - 1.5);
  else _look.set(px * 0.75, 1.3 + player.y * 0.4, pz - 7);
  lookAt.x = damp(lookAt.x, _look.x, 8, dt);
  lookAt.y = damp(lookAt.y, _look.y, 8, dt);
  lookAt.z = running ? _look.z : damp(lookAt.z, _look.z, 5, dt);
  camera.lookAt(lookAt);
  const fov = world.baseFov + clamp((S.speed - 12) * 0.45, 0, 9);
  camera.fov = damp(camera.fov, fov, 3, dt);
  camera.updateProjectionMatrix();
}

function updateRun(dt) {
  S.t += dt;
  const base = BASE_SPEED[S.mode];
  const target = Math.min(MAX_SPEED[S.mode], base + S.t * ACCEL[S.mode]);
  S.speedMul = damp(S.speedMul, 1, 0.8, dt);
  S.speed = target * S.speedMul;
  const difficulty = clamp(S.dist / 2200, 0, 1);
  audio.setIntensity((target - base) / (MAX_SPEED[S.mode] - base));

  player.z -= S.speed * dt;
  S.dist += S.speed * dt;
  applyCameraLane();

  const duckHeld = S.mode === 'camera' && tracker.ducking;
  const ev = player.update(dt, S.speed, duckHeld);
  if (ev.step) {
    audio.step();
    dust.emit(_tmp.set(player.x, 0.05, player.z + 0.2), 2, { color: DIRT, speed: 0.6, up: 0.4, life: 0.5, size: 0.35, drag: 3, alpha: 0.6 });
  }
  if (ev.landed) {
    audio.land();
    dust.emit(_tmp.set(player.x, 0.05, player.z), 12, { color: DIRT, speed: 2.2, up: 0.3, upBias: 0.1, life: 0.7, size: 0.55, drag: 3, alpha: 0.7 });
  }
  if (player.sliding && Math.random() < 0.6) {
    dust.emit(_tmp.set(player.x, 0.05, player.z + 0.3), 1, { color: DIRT, speed: 1.2, up: 0.5, life: 0.5, size: 0.5, drag: 2, alpha: 0.6 });
  }

  spawner.update(player.z, S.speed, difficulty);
  obstacles.update(player.z);

  const hit = checkCollisions(player, obstacles);
  if (hit) {
    if (hit.type === 'crash') {
      const names = { log: 'a fallen log', lowwall: 'a crumbling wall', arch: 'a stone arch', branch: 'a low branch', block: 'a stone block', idol: 'an ancient idol' };
      S.deathCause = `You ran into ${names[hit.obstacle.kind] || 'something'}`;
      die();
    } else if (hit.type === 'side') {
      player.bounceBack();
      stumble();
    } else {
      stumble();
    }
  }

  const got = coins.update(dt, player, S.state === 'running');
  for (const p of got) {
    S.coins++;
    S.score += 10 * S.mult;
    audio.coin();
    sparks.emit(p, 10, { color: GOLD, speed: 3, life: 0.45, size: 0.18, gravity: 3, drag: 2 });
  }

  S.mult = Math.min(5, 1 + Math.floor(S.dist / 400));
  S.score += S.speed * dt * 0.5 * S.mult;
  const closeness = S.t - S.lastStumble < CHASE_WINDOW ? 1 : 0;
  chaser.update(dt, player, closeness, S.speed);
  world.grade.uniforms.uDanger.value = damp(world.grade.uniforms.uDanger.value, closeness * 0.35, 4, dt);
  hud.set(S.score, S.coins, S.dist, S.mult);

  // Camera players stepping out of frame pause the game automatically.
  if (S.mode === 'camera' && S.state === 'running' && tracker.lostFor() > 1200) {
    pause('Step back into the camera frame. The run resumes automatically when you are visible.', 'Where did you go?');
  }
}

function updateDying(dt) {
  S.dyingT += dt;
  S.speed = damp(S.speed, 0, 5, dt);
  player.z -= S.speed * dt;
  player.update(dt, S.speed);
  coins.update(dt, player, false);
  chaser.update(dt, player, 2, 8);
  world.grade.uniforms.uDanger.value = damp(world.grade.uniforms.uDanger.value, 0.6, 3, dt);
  if (S.dyingT > 1.8) gameOver();
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let firstFrame = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Positional armature -> explorer rig (arms, torso and head follow the player).
  player.setMirror(S.mode === 'camera' || S.state === 'calibrate' ? poseToRig(tracker.lm) : null);

  switch (S.state) {
    case 'menu': {
      player.z -= 6.5 * dt;
      player.update(dt, 6.5);
      coins.update(dt, player, false);
      break;
    }
    case 'calibrate': {
      player.update(dt, 0);
      drawOverlay(calibCtx, tracker, { calibrating: tracker.calibrating });
      $('calib-progress').style.width = `${tracker.calibProgress * 100}%`;
      if (!tracker.connected) {
        $('calib-msg').innerHTML = 'Waiting for the Python body tracker. Start it in a terminal with <kbd>npm run tracker</kbd>';
        $('calib-issue').textContent = '';
      } else if (tracker.calibrating) {
        $('calib-msg').textContent = tracker.calibHint;
        $('calib-issue').textContent = tracker.calibIssue;
      }
      $('btn-calib-skip-step').classList.toggle('hidden', !['crouch', 'jump'].includes(tracker.step));
      $('sound-hint').classList.toggle('hidden', audio.ok);
      break;
    }
    case 'countdown': {
      player.update(dt, 0);
      coins.update(dt, player, false);
      S.countdown -= dt;
      const n = Math.ceil(S.countdown);
      if (n !== S.countdownStep) {
        S.countdownStep = n;
        $('countdown-num').textContent = n > 0 ? n : 'GO!';
        // restart the CSS pop animation
        const el = $('countdown-num');
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        if (n > 0) audio.tick();
        else audio.go();
      }
      if (S.countdown <= -0.4) {
        S.state = 'running';
        // Camera lanes are absolute: start in whichever box the player is standing in.
        if (S.mode === 'camera') S.pendingLane = tracker.currentLane;
        showScreen(null);
      }
      break;
    }
    case 'running':
      updateRun(dt);
      break;
    case 'paused': {
      if (S.mode === 'camera') {
        if (tracker.visible) S.foundT += dt;
        else S.foundT = 0;
        if (S.foundT > 0.6 && $('pause-title').textContent === 'Where did you go?') {
          S.foundT = 0;
          resume();
        }
      }
      break;
    }
    case 'dying':
      updateDying(dt);
      break;
    case 'over': {
      if (S.mode === 'camera') {
        S.restartHold = tracker.vzone === 'up' ? S.restartHold + dt : Math.max(0, S.restartHold - dt * 2);
        $('restart-progress').style.width = `${Math.min(1, S.restartHold / 0.8) * 100}%`;
        if (S.restartHold > 0.8) beginRun();
      }
      break;
    }
  }

  if (S.state !== 'paused') {
    track.update(player.z, world.time);
    updateTorches(dt);
    sparks.update(dt);
    dust.update(dt);
  }
  if (S.state !== 'running' && S.state !== 'dying') {
    world.grade.uniforms.uDanger.value = damp(world.grade.uniforms.uDanger.value, 0, 3, dt);
  }

  updateCamera(dt, S.state === 'running');
  world.follow(player.x, player.z, dt);

  if (S.mode === 'camera' && !$('cam-panel').classList.contains('hidden')) {
    drawOverlay(camCtx, tracker);
    const st = $('cam-status');
    if (!tracker.connected) st.textContent = 'Tracker offline';
    else if (!tracker.visible) st.textContent = 'No body detected';
    else st.textContent = `Python OpenCV + armature · ${tracker.fps.toFixed(0)} fps · ${tracker.ms.toFixed(0)} ms`;
  }

  world.render();

  if (firstFrame) {
    firstFrame = false;
    $('loading').classList.add('fade');
    setTimeout(() => $('loading').classList.add('hidden'), 700);
  }
}

// Expose a handle for debugging from the console.
window.__game = { S, player, world, obstacles, coins, tracker, bus, LANE_W };

requestAnimationFrame(frame);

// Calibration starts straight away: camera + OpenCV full-body setup is the first thing you see.
playWithCamera(true);
