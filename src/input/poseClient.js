// WebSocket client for the Python tracker (tracker/server.py).
// The tracker does all the computer vision (OpenCV capture + MediaPipe armature + calibration);
// this mirrors its state for the game and re-emits its actions on the shared input bus.

const URL = 'ws://localhost:8765';

export class PoseClient {
  constructor(bus) {
    this.bus = bus;
    this.ws = null;
    this.connected = false;
    this.lm = null; // 33 × [x, y, visibility], mirrored, normalised
    this.zones = null;
    this.state = {
      calibrating: false,
      calibrated: false,
      step: 'stand',
      stepIndex: 0,
      steps: [],
      progress: 0,
      hint: '',
      issue: '',
      vzone: 'center',
      hzone: 'center',
      lane: 0,
      visible: false,
      lostMs: Infinity,
    };
    this.fps = 0;
    this.ms = 0;
    this.lastMsg = 0;
    this.flash = { zone: null, t: 0 };
    this.image = new Image();
    this._pendingCalibrate = false;
    this._connect();
  }

  _connect() {
    let ws;
    try {
      ws = new WebSocket(URL);
    } catch {
      setTimeout(() => this._connect(), 1500);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.bus.emit('tracker', { connected: true });
      if (this._pendingCalibrate) this.startCalibration();
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.lm = null;
      if (was) this.bus.emit('tracker', { connected: false });
      setTimeout(() => this._connect(), 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
  }

  _onMessage(msg) {
    if (msg.type !== 'pose') return;
    const now = performance.now();
    this.lastMsg = now;
    this.lm = msg.lm;
    this.zones = msg.zones;
    this.fps = msg.fps;
    this.ms = msg.ms;
    if (msg.jpg) this.image.src = `data:image/jpeg;base64,${msg.jpg}`;
    const wasCalibrated = this.state.calibrated;
    this.state = msg.state;
    if (wasCalibrated && !this.state.calibrated && !this.state.calibrating) this._pendingCalibrate = false;

    for (const ev of msg.events) {
      if (ev.type === 'calibstep') this.bus.emit('calibstep', ev.step);
      else if (ev.type === 'calibrated') this.bus.emit('calibrated', {});
      else if (ev.type === 'action') {
        const zone = ev.action === 'jump' ? 'up' : ev.action === 'duck' ? 'down' : this.state.hzone;
        this.flash = { zone, t: now };
        this.bus.emit('action', { action: ev.action, lane: ev.lane, source: 'camera' });
      }
    }
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  /** Ask the tracker to (re)run calibration; queued until the tracker is connected. */
  startCalibration() {
    this._pendingCalibrate = true;
    if (this.connected) {
      this.send({ cmd: 'calibrate' });
      this._pendingCalibrate = false;
    }
  }

  skipStep() {
    this.send({ cmd: 'skip' });
  }

  // ---- getters used by the game loop
  get calibrating() {
    return this.state.calibrating || this._pendingCalibrate;
  }
  get calibrated() {
    return this.state.calibrated;
  }
  get step() {
    return this.state.step;
  }
  get stepIndex() {
    return this.state.stepIndex;
  }
  get steps() {
    return this.state.steps;
  }
  get calibProgress() {
    return this.state.progress;
  }
  get calibHint() {
    return this.state.hint;
  }
  get calibIssue() {
    return this.state.issue;
  }
  get vzone() {
    return this.state.vzone;
  }
  get hzone() {
    return this.state.hzone;
  }
  get ducking() {
    return this.state.vzone === 'down';
  }
  get currentLane() {
    return this.state.lane;
  }
  get visible() {
    return this.connected && this.state.visible && performance.now() - this.lastMsg < 500;
  }
  lostFor() {
    if (!this.connected || performance.now() - this.lastMsg > 500) return Infinity;
    return this.state.lostMs;
  }
}
