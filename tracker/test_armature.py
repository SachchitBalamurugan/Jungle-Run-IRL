"""Camera-free test of calibration + action classification using a synthetic skeleton.

    python tracker/test_armature.py
"""
from armature import (Armature, L_ANK, L_EL, L_HIP, L_SH, L_WR, NOSE, R_ANK, R_EL, R_HIP, R_SH, R_WR)

FPS = 30


def skeleton(cx=0.5, crouch=0.0, lift=0.0, arms_up=False):
    """33 landmarks for a front-facing person; units are normalised image coords (4:3 frame)."""
    lm = [(cx, 0.5, 0.0)] * 33
    feet = 0.92 - lift
    hip = 0.62 - lift + crouch * 0.12
    sh = hip - 0.22
    nose = sh - 0.1

    def put(i, x, y):
        lm[i] = (x, y, 0.99)

    put(NOSE, cx, nose)
    put(L_SH, cx - 0.06, sh)
    put(R_SH, cx + 0.06, sh)
    put(L_HIP, cx - 0.04, hip)
    put(R_HIP, cx + 0.04, hip)
    put(L_ANK, cx - 0.05, feet)
    put(R_ANK, cx + 0.05, feet)
    wy = nose - 0.08 if arms_up else hip
    put(L_EL, cx - 0.08, (sh + wy) / 2)
    put(R_EL, cx + 0.08, (sh + wy) / 2)
    put(L_WR, cx - 0.08, wy)
    put(R_WR, cx + 0.08, wy)
    return lm


def run(arm, t, seconds, **pose):
    for _ in range(int(seconds * FPS)):
        t += 1 / FPS
        arm.update(skeleton(**pose), t)
    return t


def jump(arm, t):
    import math

    for k in range(int(0.5 * FPS)):
        t += 1 / FPS
        arm.update(skeleton(lift=math.sin(k / (0.5 * FPS) * math.pi) * 0.08), t)
    return t


def actions(arm):
    return [e.get("action") + (f":{e['lane']}" if "lane" in e else "") for e in arm.drain_events() if e["type"] == "action"]


def main():
    arm = Armature()
    arm.start_calibration()
    t = run(arm, 0, 2.0)  # stand still
    assert arm.step == "crouch", arm.step
    t = run(arm, t, 1.0, crouch=1.0)
    t = run(arm, t, 0.5)
    assert arm.step == "jump", arm.step
    t = jump(arm, t)
    t = run(arm, t, 0.3)
    assert arm.calibrated, "calibration did not finish"
    arm.drain_events()

    checks = [
        ("step right", dict(cx=0.62), ["lane:1"]),
        ("back to centre", dict(), ["lane:0"]),
        ("step left", dict(cx=0.38), ["lane:-1"]),
        ("back to centre", dict(), ["lane:0"]),
        ("crouch", dict(crouch=1.0), ["duck"]),
        ("stand", dict(), []),
        ("arms up", dict(arms_up=True), ["jump"]),
        ("arms down", dict(), []),
    ]
    for name, pose, want in checks:
        t = run(arm, t, 0.8, **pose)
        got = actions(arm)
        assert got == want, f"{name}: expected {want}, got {got}"
        print(f"ok  {name:15s} -> {got}")

    t = jump(arm, t)
    got = actions(arm)
    assert got == ["jump"], f"real jump: {got}"
    print(f"ok  {'real jump':15s} -> {got}")
    t = run(arm, t, 0.3, crouch=0.6)  # landing dip right after the jump
    got = actions(arm)
    assert got == [], f"landing dip should not duck: {got}"
    print(f"ok  {'landing dip':15s} -> {got}")
    print("all armature checks passed; thresholds:", arm.th)


if __name__ == "__main__":
    main()
