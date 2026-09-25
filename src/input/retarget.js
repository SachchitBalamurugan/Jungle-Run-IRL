// Retargets the tracker's positional armature (MediaPipe landmarks) onto the explorer's rig.
// Works in the mirrored image plane: the side that appears on the left of the screen drives the
// avatar's left side, which (seen from the chase camera behind it) is also on the left.

const VIS = 0.5;
const L = { sh: 11, el: 13, wr: 15, eye: 2, hip: 23 };
const R = { sh: 12, el: 14, wr: 16, eye: 5, hip: 24 };

/** Angle of a 2D image vector measured from "straight down", positive = outward for side s. */
function outward(v, s) {
  return Math.atan2(s * v.x, v.y);
}

/**
 * @param {number[][]} lm 33 × [x, y, visibility]
 * @param {number} aspect frame width / height
 * @returns {null | {arms: ({abduct:number, bend:number}|null)[], torsoRoll:number, headRoll:number}}
 */
export function poseToRig(lm, aspect = 4 / 3) {
  if (!lm) return null;
  const p = (i) => ({ x: lm[i][0] * aspect, y: lm[i][1] });
  const ok = (...ids) => ids.every((i) => lm[i][2] >= VIS);
  if (!ok(L.sh, R.sh)) return null;

  // Whichever labelled side is on the screen's left drives the avatar's left arm.
  const leftFirst = lm[L.sh][0] <= lm[R.sh][0];
  const sides = leftFirst ? [L, R] : [R, L];

  const arms = sides.map((S, i) => {
    const s = i === 0 ? -1 : 1;
    if (!ok(S.sh, S.el, S.wr)) return null;
    const sh = p(S.sh);
    const el = p(S.el);
    const wr = p(S.wr);
    const upper = { x: el.x - sh.x, y: el.y - sh.y };
    const fore = { x: wr.x - el.x, y: wr.y - el.y };
    const abduct = outward(upper, s);
    let bend = outward(fore, s) - abduct;
    bend = Math.atan2(Math.sin(bend), Math.cos(bend)); // wrap to [-π, π]
    return { abduct, bend };
  });

  const a = p(sides[0].sh);
  const b = p(sides[1].sh);
  const torsoRoll = Math.atan2(b.y - a.y, b.x - a.x);
  let headRoll = torsoRoll;
  if (ok(sides[0].eye, sides[1].eye)) {
    const e0 = p(sides[0].eye);
    const e1 = p(sides[1].eye);
    headRoll = Math.atan2(e1.y - e0.y, e1.x - e0.x);
  }
  return { arms, torsoRoll, headRoll };
}
