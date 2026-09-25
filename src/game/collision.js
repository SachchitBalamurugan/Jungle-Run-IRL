// Player-vs-obstacle collision with a little forgiveness for camera-control latency.
const HALF_W = 0.36;
const HALF_D = 0.3;
const GRAZE = 0.2; // overlaps shallower than this on a jump/duck obstacle only trip the player

/**
 * @returns {null | {type:'crash'|'stumble'|'side', obstacle}}
 */
export function checkCollisions(player, obstacles) {
  const px0 = player.x - HALF_W;
  const px1 = player.x + HALF_W;
  const py0 = player.y;
  const py1 = player.y + player.height;
  const pz0 = player.z - HALF_D;
  const pz1 = player.z + HALF_D;

  for (const o of obstacles.active) {
    if (o.hit) continue;
    for (const b of o.boxes) {
      if (px1 <= b.x0 || px0 >= b.x1 || py1 <= b.y0 || py0 >= b.y1 || pz1 <= b.z0 || pz0 >= b.z1) continue;
      o.hit = true;
      if (o.need === 'jump' && b.y1 - py0 < GRAZE) return { type: 'stumble', obstacle: o };
      if (o.need === 'duck' && py1 - b.y0 < GRAZE) return { type: 'stumble', obstacle: o };
      if (o.need === 'dodge') {
        // Clipped the side of a block while changing lanes -> bounce back instead of dying.
        const xOverlap = Math.min(px1, b.x1) - Math.max(px0, b.x0);
        const lateral = Math.abs(player.x - player.targetX) > 0.15;
        if (lateral && xOverlap < 0.45) return { type: 'side', obstacle: o };
      }
      return { type: 'crash', obstacle: o };
    }
  }
  return null;
}
