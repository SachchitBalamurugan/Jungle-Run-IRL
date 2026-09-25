"""Jungle Run IRL body tracker.

OpenCV captures the webcam, MediaPipe Pose builds a 33-joint armature, and armature.py calibrates
to the player and turns their pose into actions. Everything is streamed to the browser game over a
WebSocket (ws://localhost:8765): the skeleton, calibration state, actions and a small JPEG preview.

    python tracker/server.py                 # webcam 0
    python tracker/server.py --camera 1      # another webcam
    python tracker/server.py --video clip.mp4 --loop   # test with a recording
    python tracker/server.py --window        # also show an OpenCV debug window
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
import threading
import time
from pathlib import Path

import cv2
import mediapipe as mp
import websockets
from mediapipe.tasks.python import BaseOptions, vision

from armature import BONES, STEPS, Armature

HERE = Path(__file__).resolve().parent
MODELS = {
    "full": HERE / "models" / "pose_landmarker_full.task",
    "lite": HERE / "models" / "pose_landmarker_lite.task",
    "heavy": HERE / "models" / "pose_landmarker_heavy.task",
}
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{0}/float16/latest/pose_landmarker_{0}.task"


def ensure_model(kind: str) -> Path:
    path = MODELS[kind]
    if not path.exists():
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"[tracker] downloading {kind} pose model…", flush=True)
        urllib.request.urlretrieve(MODEL_URL.format(kind), path)
    return path


class Tracker:
    """Capture + inference loop running on its own thread."""

    def __init__(self, args):
        self.args = args
        self.arm = Armature()
        self.lock = threading.Lock()
        self.commands: list[dict] = []
        self.on_message = None  # set by the server: called with each outgoing dict
        self.running = True
        self.fps = 0.0
        self.ms = 0.0

    def command(self, cmd: dict):
        with self.lock:
            self.commands.append(cmd)

    def _open_source(self):
        if self.args.video:
            cap = cv2.VideoCapture(self.args.video)
        else:
            backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
            cap = cv2.VideoCapture(self.args.camera, backend)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, 30)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open {'video ' + self.args.video if self.args.video else 'camera ' + str(self.args.camera)}")
        return cap

    def run(self):
        opts = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model(self.args.model))),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        landmarker = vision.PoseLandmarker.create_from_options(opts)
        cap = self._open_source()
        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
        t_start = time.monotonic()
        last_ts = -1
        frames, fps_t = 0, time.monotonic()
        print("[tracker] running. Open the game at http://localhost:5173", flush=True)

        while self.running:
            loop_t = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                if self.args.video and self.args.loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                if self.args.video:
                    break
                time.sleep(0.05)
                continue

            # Mirror so the player's left is the screen's left, then normalise to 4:3.
            frame = cv2.flip(frame, 1)
            frame = crop_43(frame)
            h, w = frame.shape[:2]
            self.arm.aspect = w / h

            with self.lock:
                cmds, self.commands = self.commands, []
            for c in cmds:
                if c.get("cmd") == "calibrate":
                    self.arm.start_calibration()
                elif c.get("cmd") == "skip":
                    self.arm.skip_step()

            t0 = time.monotonic()
            ts = int((time.monotonic() - t_start) * 1000)
            ts = max(ts, last_ts + 1)
            last_ts = ts
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
            self.ms = (time.monotonic() - t0) * 1000

            lm = None
            if result.pose_landmarks:
                lm = [(p.x, p.y, p.visibility if p.visibility is not None else 1.0) for p in result.pose_landmarks[0]]
            now = time.monotonic()
            self.arm.update(lm, now)

            frames += 1
            if now - fps_t >= 1:
                self.fps = frames / (now - fps_t)
                frames, fps_t = 0, now

            preview = cv2.resize(frame, (320, 240), interpolation=cv2.INTER_AREA)
            ok_jpg, jpg = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 60])
            msg = self._message(lm, base64.b64encode(jpg).decode("ascii") if ok_jpg else None, now)
            if self.on_message:
                self.on_message(msg)

            if self.args.window:
                draw_debug(frame, lm, self.arm)
                cv2.imshow("Jungle Run IRL - tracker", frame)
                if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                    self.running = False

            if self.args.video:  # play recordings in real time
                time.sleep(max(0.0, 1 / video_fps - (time.monotonic() - loop_t)))

        cap.release()
        landmarker.close()
        if self.args.window:
            cv2.destroyAllWindows()

    def _message(self, lm, jpg, now):
        a = self.arm
        step_ids = [s for s, _ in STEPS]
        return {
            "type": "pose",
            "fps": round(self.fps, 1),
            "ms": round(self.ms, 1),
            "lm": [[round(x, 4), round(y, 4), round(v, 2)] for x, y, v in lm] if lm else None,
            "jpg": jpg,
            "state": {
                "calibrating": a.calibrating,
                "calibrated": a.calibrated,
                "step": a.step,
                "stepIndex": step_ids.index(a.step) if a.step in step_ids else len(step_ids),
                "steps": [label for _, label in STEPS],
                "progress": round(a.progress, 3),
                "hint": a.hint,
                "issue": a.issue,
                "vzone": a.vzone,
                "hzone": a.hzone,
                "lane": a.lane,
                "visible": a.body is not None,
                "lostMs": round(min(a.lost_for(now), 1e6) * 1000),
            },
            "zones": a.zones(),
            "events": a.drain_events(),
        }


def crop_43(frame):
    h, w = frame.shape[:2]
    target = 4 / 3
    if w / h > target:
        nw = int(h * target)
        x = (w - nw) // 2
        return frame[:, x : x + nw]
    nh = int(w / target)
    y = (h - nh) // 2
    return frame[y : y + nh]


def draw_debug(frame, lm, arm: Armature):
    """OpenCV debug view: zones + armature."""
    h, w = frame.shape[:2]
    z = arm.zones()
    if z:
        for x in (z["left"], z["right"]):
            cv2.line(frame, (int(x * w), 0), (int(x * w), h), (255, 200, 80), 2)
        cv2.line(frame, (0, int(z["duckY"] * h)), (w, int(z["duckY"] * h)), (60, 160, 255), 2)
        cv2.line(frame, (0, int(z["feetY"] * h)), (w, int(z["feetY"] * h)), (140, 255, 110), 2)
    if lm:
        pts = [(int(x * w), int(y * h)) for x, y, _ in lm]
        for a, b in BONES:
            if lm[a][2] > 0.5 and lm[b][2] > 0.5:
                cv2.line(frame, pts[a], pts[b], (81, 196, 245), 3, cv2.LINE_AA)
        for i, (x, y, v) in enumerate(lm):
            if v > 0.5 and i not in range(17, 23) and i not in range(29, 33):
                cv2.circle(frame, pts[i], 5, (255, 255, 255), -1, cv2.LINE_AA)
    label = f"{arm.step} | v={arm.vzone} h={arm.hzone}"
    cv2.putText(frame, label, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    if arm.issue:
        cv2.putText(frame, arm.issue, (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (80, 180, 255), 2, cv2.LINE_AA)


async def serve(args):
    tracker = Tracker(args)
    clients: set = set()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=4)

    def push(msg):
        def put():
            if queue.full():  # drop the oldest preview but keep its events
                old = queue.get_nowait()
                msg["events"] = old["events"] + msg["events"]
            queue.put_nowait(msg)

        loop.call_soon_threadsafe(put)

    tracker.on_message = push

    async def handler(ws):
        clients.add(ws)
        print(f"[tracker] game connected ({len(clients)})", flush=True)
        try:
            async for raw in ws:
                try:
                    tracker.command(json.loads(raw))
                except json.JSONDecodeError:
                    pass
        finally:
            clients.discard(ws)
            print(f"[tracker] game disconnected ({len(clients)})", flush=True)

    async def broadcast():
        while True:
            msg = await queue.get()
            if not clients:
                continue
            data = json.dumps(msg, separators=(",", ":"))
            await asyncio.gather(*(c.send(data) for c in list(clients)), return_exceptions=True)

    def safe_run():
        try:
            tracker.run()
        except Exception as exc:  # surface camera / model errors instead of dying silently
            print(f"[tracker] error: {exc}", file=sys.stderr, flush=True)

    thread = threading.Thread(target=safe_run, daemon=True)
    async with websockets.serve(handler, args.host, args.port, max_size=2**20):
        print(f"[tracker] WebSocket on ws://{args.host}:{args.port}", flush=True)
        thread.start()
        bt = asyncio.create_task(broadcast())
        while thread.is_alive():
            await asyncio.sleep(0.2)
        bt.cancel()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--camera", type=int, default=0)
    p.add_argument("--video", help="use a video file instead of the webcam")
    p.add_argument("--loop", action="store_true", help="loop the video file")
    p.add_argument("--model", choices=list(MODELS), default="full")
    p.add_argument("--window", action="store_true", help="show an OpenCV debug window")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
