# Temple Run IRL

An endless temple runner in Three.js that you control with your **whole body**.

A **Python tracker** (`tracker/`) does the computer vision:

1. OpenCV captures the webcam.
2. MediaPipe Pose builds a 33-joint **positional armature**.
3. The tracker calibrates to your body and turns your pose into game actions.

It streams the skeleton, actions and a preview frame to the browser game over a local WebSocket (`ws://localhost:8765`). The game draws your armature over the camera view, and the explorer's arms, torso and head **copy your pose** while running.

| Your body | Action |
| --- | --- |
| Step **left / right** (hips move into the side box) | run in that lane (lanes are absolute) |
| **Jump** (ankles and hips rise) or raise **both hands above your head** | jump over logs and low walls |
| **Crouch** (hips drop while the feet stay planted) | slide under arches and branches (hold it to keep sliding) |

## Setup

```bash
npm install
python -m pip install -r tracker/requirements.txt
```

The pose model (about 9 MB) downloads automatically the first time the tracker runs.

## Run

```bash
npm start            # tracker + game together
```

Or run them in two terminals with `npm run tracker` and `npm run dev`. Then open http://localhost:5173.

Tracker options (pass them after `--`, e.g. `npm start -- --window`):

| Option | Meaning |
| --- | --- |
| `--camera 1` | use another webcam |
| `--window` | show an OpenCV debug window with the armature and zones |
| `--model lite` | faster, less accurate model (`lite` / `full` / `heavy`) |
| `--video clip.mp4 --loop` | use a recording instead of the webcam |

## Calibration (runs automatically at start)
1. **Stand in position**: centre, facing the camera, head to feet visible. This records your neutral armature.
2. **Crouch**: this measures how far your hips drop and sets the duck threshold.
3. **Jump**: this measures how far your ankles rise and sets the jump threshold.

All thresholds are in multiples of your torso length, so they fit your size and distance from the camera. Put the camera about 2.5–3 m away at waist height. **Recalibrate** is on the game-over screen and the menu.

Keyboard fallback: `←/→` lane, `↑`/`Space` jump, `↓` slide, `P` pause, `M` mute, `C` enlarge the camera view.

## Tests

```bash
python tracker/test_armature.py   # calibration + action classification on a synthetic skeleton
```
