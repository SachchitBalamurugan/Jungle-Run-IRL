// Keyboard fallback: relative lane moves, jump, slide, and a few utility keys.
const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'duck', KeyS: 'duck',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  KeyC: 'camview',
};

export function bindKeyboard(bus) {
  window.addEventListener('keydown', (e) => {
    const action = MAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    bus.emit('action', { action, source: 'keyboard' });
  });
}
