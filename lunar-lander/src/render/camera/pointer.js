// Mouse / touch input for the cameras: drag to look or orbit, wheel (or pinch) to zoom,
// double-click to reset, middle-click toggles pointer-lock mouse look. Accumulates deltas that
// cameras.js consumes once per frame (take()). Ignores input while the title menu or a UI overlay
// has the focus (game.started false / game.uiCapture true).

export function createPointer(game, el) {
  const acc = { dx: 0, dy: 0, wheel: 0, reset: false, dragging: false };
  const pointers = new Map(); // pointerId -> {x, y}
  let pinchDist = 0;
  let locked = false;

  const enabled = () => !!game.started && game.uiCapture !== true;

  function onDown(e) {
    if (!enabled()) return;
    if (e.pointerType === 'mouse' && e.button === 1) {
      // middle button: toggle pointer-lock mouse look
      e.preventDefault();
      toggleLock();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    acc.dragging = true;
    if (pointers.size === 2) pinchDist = spread();
  }

  function spread() {
    const p = [...pointers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  function onMove(e) {
    if (locked) {
      if (enabled()) {
        acc.dx += e.movementX || 0;
        acc.dy += e.movementY || 0;
      }
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!enabled()) return;
    if (pointers.size >= 2) {
      // pinch zoom (spread apart = zoom in)
      const d = spread();
      if (pinchDist > 0 && d > 0) acc.wheel += (pinchDist - d) * 4;
      pinchDist = d;
      return;
    }
    acc.dx += dx;
    acc.dy += dy;
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size < 2) pinchDist = 0;
    if (!pointers.size) acc.dragging = false;
  }

  function onWheel(e) {
    if (!enabled()) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    acc.wheel += Math.max(-600, Math.min(600, e.deltaY * k));
  }

  function toggleLock() {
    try {
      if (document.pointerLockElement === el) document.exitPointerLock();
      else {
        const r = el.requestPointerLock?.();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch {
      /* pointer lock unavailable */
    }
  }

  if (el && typeof el.addEventListener === 'function') {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', (e) => {
      if (!enabled()) return;
      e.preventDefault();
      acc.reset = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // no browser middle-click autoscroll
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === el;
    });
    // locked mouse moves are reported on the document too when the canvas is covered by the UI
    document.addEventListener('mousemove', (e) => {
      if (locked && e.target !== el && enabled()) {
        acc.dx += e.movementX || 0;
        acc.dy += e.movementY || 0;
      }
    });
  }

  return {
    get locked() {
      return locked;
    },
    get dragging() {
      return acc.dragging;
    },
    /** Consume accumulated input since the last call. */
    take(out = {}) {
      out.dx = acc.dx;
      out.dy = acc.dy;
      out.wheel = acc.wheel;
      out.reset = acc.reset;
      acc.dx = acc.dy = acc.wheel = 0;
      acc.reset = false;
      return out;
    },
  };
}
