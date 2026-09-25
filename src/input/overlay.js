// Draws the Python tracker's (already mirrored) camera preview with the positional armature on
// top: skeleton bones + joints, the lane / jump / duck zones, and a stand-here guide while calibrating.

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [7, 2], [2, 0], [0, 5], [5, 8],
];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const VIS = 0.5;

const COLORS = {
  left: [80, 200, 255],
  right: [80, 200, 255],
  up: [110, 255, 140],
  down: [255, 160, 60],
  center: [245, 196, 81],
};
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

export function drawOverlay(ctx, pose, opts = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const now = performance.now();
  ctx.clearRect(0, 0, W, H);

  if (pose.connected && pose.image.complete && pose.image.naturalWidth) {
    ctx.drawImage(pose.image, 0, 0, W, H);
    ctx.fillStyle = 'rgba(10,6,2,0.28)';
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#0b0704';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f3e6c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(W / 30)}px Inter, sans-serif`;
    ctx.fillText('Waiting for the Python tracker…', W / 2, H / 2 - W / 40);
    ctx.font = `500 ${Math.round(W / 40)}px Inter, sans-serif`;
    ctx.fillText('python tracker/server.py', W / 2, H / 2 + W / 40);
    return;
  }

  const font = Math.max(10, Math.round(W / 26));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${font}px Inter, sans-serif`;

  const z = pose.zones;
  if (z && !opts.calibrating) {
    const flashK = (zone) => (pose.flash.zone === zone ? Math.max(0, 1 - (now - pose.flash.t) / 350) : 0);
    const col = (key, x0, y0, x1, y1, label) => {
      const on = key === pose.hzone || key === pose.vzone;
      const c = COLORS[key];
      ctx.fillStyle = rgba(c, on ? 0.28 + flashK(key) * 0.3 : 0.07);
      ctx.fillRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
      ctx.strokeStyle = rgba(c, on ? 1 : 0.55);
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.strokeRect(x0 * W + 1, y0 * H + 1, (x1 - x0) * W - 2, (y1 - y0) * H - 2);
      ctx.fillStyle = rgba(c, on ? 1 : 0.85);
      ctx.shadowColor = 'rgba(0,0,0,.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(label, ((x0 + x1) / 2) * W, ((y0 + y1) / 2) * H);
      ctx.shadowBlur = 0;
    };
    col('left', 0, 0, z.left, 1, 'LEFT');
    col('right', z.right, 0, 1, 1, 'RIGHT');
    col('up', z.left, 0, z.right, Math.max(0.04, z.headY - 0.08), 'JUMP');
    col('down', z.left, z.duckY, z.right, Math.min(z.floorY, z.duckY + 0.14), 'DUCK');
    // Feet line: ankles above it = jump
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = rgba(COLORS.up, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(z.left * W, z.feetY * H);
    ctx.lineTo(z.right * W, z.feetY * H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (opts.calibrating) {
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(COLORS.center, 0.85);
    ctx.strokeRect(W * 0.35, H * 0.03, W * 0.3, H * 0.94);
    ctx.setLineDash([]);
  }

  // Armature
  const lm = pose.lm;
  if (lm) {
    const pt = (i) => [lm[i][0] * W, lm[i][1] * H];
    ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if (lm[a][2] < VIS || lm[b][2] < VIS) continue;
      const [x0, y0] = pt(a);
      const [x1, y1] = pt(b);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(4, W / 90);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = '#f5c451';
      ctx.lineWidth = Math.max(2, W / 180);
      ctx.stroke();
    }
    for (const i of JOINTS) {
      if (lm[i][2] < VIS) continue;
      const [x, y] = pt(i);
      ctx.fillStyle = i === 0 ? '#ff7a2a' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, W / 150), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
