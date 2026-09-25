"""Positional armature: turns MediaPipe pose landmarks into body measurements,
runs the guided calibration, and classifies the pose into game actions.

All coordinates are in a mirrored frame (the image is flipped before inference, so moving to
your left moves you to the screen's left) and in "height units": y is 0..1 down the frame and x
is scaled by the frame aspect so distances are isotropic. Thresholds are expressed in multiples
of the player's torso length (shoulder-centre to hip-centre), so they scale with body size and
distance from the camera.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

# MediaPipe Pose landmark indices
NOSE = 0
L_EYE, R_EYE = 2, 5
L_EAR, R_EAR = 7, 8
L_SH, R_SH = 11, 12
L_EL, R_EL = 13, 14
L_WR, R_WR = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANK, R_ANK = 27, 28

BONES = [
    (L_SH, R_SH), (L_SH, L_EL), (L_EL, L_WR), (R_SH, R_EL), (R_EL, R_WR),
    (L_SH, L_HIP), (R_SH, R_HIP), (L_HIP, R_HIP),
    (L_HIP, L_KNEE), (L_KNEE, L_ANK), (R_HIP, R_KNEE), (R_KNEE, R_ANK),
    (L_EAR, L_EYE), (L_EYE, NOSE), (NOSE, R_EYE), (R_EYE, R_EAR),
]

STEPS = [
    ("stand", "Stand in position"),
    ("crouch", "Crouch"),
    ("jump", "Jump"),
]

VIS = 0.5  # landmark visibility needed to trust a joint
RELEASE = 0.55  # hysteresis: back inside RELEASE * threshold to leave a zone
LOST_S = 0.35
JUMP_BLOCKS_DUCK_S = 0.45  # the landing crouch right after a jump is not a duck (timed from landing)
DUCK_BLOCKS_JUMP_S = 0.25  # popping back up from a crouch is not a jump


@dataclass
class Body:
    """Measurements derived from one frame's armature."""
    hip_x: float
    hip_y: float
    sh_y: float
    nose_y: float
    ankle_y: float
    torso: float
    wrists_up: bool
    feet_visible: bool
    head_visible: bool


def _mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def measure(lm, aspect: float) -> Body | None:
    """lm: list of 33 (x, y, visibility) in normalised mirrored image coords."""
    if lm is None:
        return None
    pt = lambda i: (lm[i][0] * aspect, lm[i][1])  # noqa: E731
    vis = lambda *ids: all(lm[i][2] >= VIS for i in ids)  # noqa: E731
    if not vis(L_SH, R_SH, L_HIP, R_HIP):
        return None
    sh = _mid(pt(L_SH), pt(R_SH))
    hip = _mid(pt(L_HIP), pt(R_HIP))
    torso = math.dist(sh, hip)
    if torso < 0.04:
        return None
    feet_visible = vis(L_ANK, R_ANK) and max(lm[L_ANK][1], lm[R_ANK][1]) < 0.985
    ankle_y = (lm[L_ANK][1] + lm[R_ANK][1]) / 2
    nose_y = lm[NOSE][1]
    wrists_up = vis(L_WR, R_WR, NOSE) and lm[L_WR][1] < nose_y - 0.1 * torso and lm[R_WR][1] < nose_y - 0.1 * torso
    return Body(
        hip_x=hip[0], hip_y=hip[1], sh_y=sh[1], nose_y=nose_y, ankle_y=ankle_y, torso=torso,
        wrists_up=wrists_up, feet_visible=feet_visible, head_visible=lm[NOSE][2] >= VIS and nose_y > 0.02,
    )


@dataclass
class Thresholds:
    side: float
    duck: float
    feet: float


@dataclass
class Armature:
    """Calibration state machine + action classifier."""
    aspect: float = 4 / 3
    calibrating: bool = False
    step: str = "stand"
    progress: float = 0.0
    hint: str = ""
    issue: str = ""
    neutral: Body | None = None
    th: Thresholds | None = None
    body: Body | None = None
    last_seen: float = 0.0
    vzone: str = "center"
    hzone: str = "center"
    events: list = field(default_factory=list)
    _held: float = 0.0
    _phase: int = 0
    _peak: float = 0.0
    _samples: list = field(default_factory=list)
    _crouch_drop: float | None = None
    _jump_rise: float | None = None
    _last_jump: float = 0.0
    _last_duck_end: float = 0.0
    _last_t: float = 0.0

    # ------------------------------------------------------------------ public
    @property
    def calibrated(self) -> bool:
        return self.neutral is not None and self.th is not None

    @property
    def lane(self) -> int:
        return {"left": -1, "right": 1}.get(self.hzone, 0)

    def start_calibration(self):
        self.calibrating = True
        self.neutral = None
        self.th = None
        self.vzone = self.hzone = "center"
        self._enter("stand")

    def skip_step(self):
        if not self.calibrating or self.neutral is None:
            return
        if self.step == "crouch":
            self._crouch_drop = self.neutral.torso * 0.6
            self._enter("jump")
        elif self.step == "jump":
            self._jump_rise = self.neutral.torso * 0.35
            self._finish()

    def update(self, lm, now: float | None = None):
        now = time.monotonic() if now is None else now
        dt = min(0.2, now - self._last_t) if self._last_t else 0.0
        self._last_t = now
        b = measure(lm, self.aspect)
        if b is not None:
            if self.body is None or now - self.last_seen > LOST_S * 2:
                self.body = b
            else:  # light smoothing on the measurements we classify on
                k = 0.65
                for name in ("hip_x", "hip_y", "sh_y", "nose_y", "ankle_y", "torso"):
                    cur = getattr(self.body, name)
                    setattr(self.body, name, cur + (getattr(b, name) - cur) * k)
                self.body.wrists_up = b.wrists_up
                self.body.feet_visible = b.feet_visible
                self.body.head_visible = b.head_visible
            self.last_seen = now
        elif now - self.last_seen > LOST_S:
            self.body = None

        if self.calibrating:
            self._calibrate(dt, now)
        elif self.calibrated and self.body is not None:
            self._classify(now)

    def lost_for(self, now: float | None = None) -> float:
        now = time.monotonic() if now is None else now
        return now - self.last_seen if self.last_seen else float("inf")

    def zones(self):
        """Zone geometry in normalised (0..1) mirrored image coordinates, for drawing."""
        if not self.calibrated:
            return None
        n, t, a = self.neutral, self.th, self.aspect
        return {
            "left": (n.hip_x - t.side) / a,
            "right": (n.hip_x + t.side) / a,
            "neutralX": n.hip_x / a,
            "hipY": n.hip_y,
            "duckY": n.hip_y + t.duck,
            "feetY": n.ankle_y - t.feet,
            "floorY": n.ankle_y,
            "headY": n.nose_y,
        }

    # ------------------------------------------------------------------ calibration
    def _enter(self, step):
        self.step = step
        self.progress = 0.0
        self.issue = ""
        self._held = 0.0
        self._phase = 0
        self._peak = 0.0
        self._samples = []
        self.events.append({"type": "calibstep", "step": step})

    def _calibrate(self, dt, now):
        b = self.body
        if self.step == "stand":
            self.hint = "Stand in the middle, facing the camera, arms by your sides. Head to feet must be visible."
            issue = ""
            if b is None:
                issue = "Step into view of the camera…"
            elif not b.head_visible:
                issue = "Your head is cut off: step back or tilt the camera down"
            elif not b.feet_visible:
                issue = "I can't see your feet: step back or tilt the camera down"
            elif b.torso < 0.1:
                issue = "Come a little closer to the camera"
            elif b.hip_x / self.aspect < 0.35:
                issue = "Move a little to your right →"
            elif b.hip_x / self.aspect > 0.65:
                issue = "← Move a little to your left"
            last = self._samples[-1] if self._samples else None
            still = b is not None and (
                last is None
                or (abs(b.hip_x - last.hip_x) < b.torso * 0.06 and abs(b.hip_y - last.hip_y) < b.torso * 0.06)
            )
            if issue or not still:
                self._samples = []
                self._held = 0.0
                self.issue = issue or "Hold still…"
            else:
                self.issue = ""
                self._samples.append(Body(**vars(b)))
                self._held += dt
            self.progress = min(1.0, self._held / 1.5)
            if self._held >= 1.5:
                n = len(self._samples)
                avg = {k: sum(getattr(s, k) for s in self._samples) / n for k in ("hip_x", "hip_y", "sh_y", "nose_y", "ankle_y", "torso")}
                self.neutral = Body(**avg, wrists_up=False, feet_visible=True, head_visible=True)
                self._enter("crouch")

        elif self.step == "crouch":
            n = self.neutral
            if b is None:
                self.issue = "I lost you. Stay in view"
                return
            drop = b.hip_y - n.hip_y
            if self._phase == 0:
                self.hint = "Now crouch down low, as if ducking under a branch, and hold it."
                feet_ok = abs(b.ankle_y - n.ankle_y) < n.torso * 0.3
                self.issue = "" if feet_ok else "Keep your feet where they were"
                if drop > n.torso * 0.3 and feet_ok:
                    self._held += dt
                    self._peak = max(self._peak, drop)
                else:
                    self._held = max(0.0, self._held - dt)
                self.progress = min(1.0, self._held / 0.6)
                if self._held >= 0.6:
                    self._crouch_drop = self._peak
                    self._phase = 1
            else:
                self.hint = "Great! Now stand back up."
                self.issue = ""
                if drop < n.torso * 0.12:
                    self._enter("jump")

        elif self.step == "jump":
            n = self.neutral
            self.hint = "Now jump once, straight up!"
            if b is None:
                self.issue = "I lost you. Stay in view"
                return
            self.issue = ""
            rise = n.ankle_y - b.ankle_y
            if self._phase == 0 and rise > n.torso * 0.12 and (n.hip_y - b.hip_y) > n.torso * 0.06:
                self._phase = 1
            if self._phase == 1:
                self._peak = max(self._peak, rise)
                self.progress = 0.5
                if rise < n.torso * 0.05:
                    self._jump_rise = self._peak
                    self._finish()

    def _finish(self):
        n = self.neutral
        t = n.torso
        clamp = lambda v, lo, hi: max(lo, min(hi, v))  # noqa: E731
        self.th = Thresholds(
            side=t * 0.5,  # ~25 cm sideways step
            duck=clamp((self._crouch_drop or t * 0.6) * 0.5, t * 0.22, t * 0.6),
            feet=clamp((self._jump_rise or t * 0.35) * 0.4, t * 0.08, t * 0.25),
        )
        self.calibrating = False
        self.step = "done"
        self.progress = 1.0
        self.vzone = self.hzone = "center"
        self.events.append({"type": "calibrated"})

    # ------------------------------------------------------------------ classification
    def _classify(self, now):
        n, t, b = self.neutral, self.th, self.body
        dx = b.hip_x - n.hip_x
        feet_rise = n.ankle_y - b.ankle_y
        hip_rise = n.hip_y - b.hip_y
        hip_drop = -hip_rise
        head_drop = b.nose_y - n.nose_y

        # Jump: feet leave the floor with the hips, or both hands go up above the head.
        jumping = (feet_rise > t.feet and hip_rise > t.feet * 0.4) or b.wrists_up
        jump_released = feet_rise < t.feet * RELEASE and not b.wrists_up
        # Duck: hips (or head) drop while the feet stay planted; stepping back moves the feet too.
        planted = abs(feet_rise) < n.torso * 0.3
        ducking = planted and (hip_drop > t.duck or head_drop > t.duck * 1.4)
        duck_released = hip_drop < t.duck * RELEASE and head_drop < t.duck * 1.4 * RELEASE

        v = self.vzone
        if v == "center":
            if jumping and now - self._last_duck_end > DUCK_BLOCKS_JUMP_S:
                v = "up"
            elif ducking and now - self._last_jump > JUMP_BLOCKS_DUCK_S:
                v = "down"
        elif v == "up" and jump_released:
            v = "center"
        elif v == "down" and duck_released:
            v = "center"

        h = self.hzone
        if h == "center":
            if dx < -t.side:
                h = "left"
            elif dx > t.side:
                h = "right"
        elif h == "left" and dx > -t.side * RELEASE:
            h = "center"
        elif h == "right" and dx < t.side * RELEASE:
            h = "center"

        if v != self.vzone:
            if v == "up":
                self._last_jump = now
                self.events.append({"type": "action", "action": "jump"})
            elif v == "down":
                self.events.append({"type": "action", "action": "duck"})
            if self.vzone == "down":
                self._last_duck_end = now
            if self.vzone == "up":
                self._last_jump = now  # landed
            self.vzone = v
        if h != self.hzone:
            self.hzone = h
            self.events.append({"type": "action", "action": "lane", "lane": self.lane})

        # Forgive slow drift while standing still in the middle.
        if v == "center" and h == "center" and abs(feet_rise) < n.torso * 0.1:
            n.hip_x += dx * 0.003
            n.hip_y += (b.hip_y - n.hip_y) * 0.002
            n.ankle_y += (b.ankle_y - n.ankle_y) * 0.002
            n.nose_y += (b.nose_y - n.nose_y) * 0.002

    def drain_events(self):
        ev, self.events = self.events, []
        return ev
