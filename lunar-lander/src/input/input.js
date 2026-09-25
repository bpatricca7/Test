// STUB — owned by the IO agent. Contract: createInput(game, domElement) -> { update(realDt) }
// Writes game.active.ctrl each frame and emits 'action' events for discrete commands.
export function createInput(game, el) {
  const keys = new Set();
  const ACTIONS = { KeyV: 'SWITCH_VESSEL', KeyC: 'CYCLE_CAMERA', KeyG: 'KILL_ROT', KeyT: 'RCS_MODE_CYCLE', KeyP: 'PAUSE', KeyU: 'UNDOCK', Space: 'PRO' };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (ACTIONS[e.code]) game.events.emit('action', { name: ACTIONS[e.code] });
    if (e.code === 'KeyZ') game.active.ctrl.throttle = 1;
    if (e.code === 'KeyX') game.active.ctrl.throttle = 0;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  game.events.on('action', (a) => {
    if (a.name === 'SWITCH_VESSEL') { game.activeId = a.to || (game.activeId === 'LM' ? 'CSM' : 'LM'); game.events.emit('vessel', { id: game.activeId }); }
    if (a.name === 'PAUSE') game.time.paused = !game.time.paused;
  });
  const ax = (p, n) => (keys.has(p) ? 1 : 0) - (keys.has(n) ? 1 : 0);
  return {
    update(dt) {
      for (const v of Object.values(game.vessels)) if (v !== game.active) Object.assign(v.ctrl, { pitch: 0, yaw: 0, roll: 0, transFwd: 0, transRight: 0, transUp: 0 });
      const c = game.active.ctrl;
      c.pitch = ax('KeyS', 'KeyW'); c.yaw = ax('KeyD', 'KeyA'); c.roll = ax('KeyE', 'KeyQ');
      c.transFwd = ax('KeyH', 'KeyN'); c.transRight = ax('KeyL', 'KeyJ'); c.transUp = ax('KeyI', 'KeyK');
      c.throttle = Math.max(0, Math.min(1, c.throttle + ax('KeyR', 'KeyF') * dt * 0.5));
    },
  };
}
