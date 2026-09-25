// STUB — owned by the UI agent. Contract: createUI(game, root, api) -> { update(frame) }
export function createUI(game, root, api) {
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:absolute;left:12px;top:8px;margin:0;font:12px/1.4 monospace;color:#e8e6e1;pointer-events:none;text-shadow:0 1px 2px #000';
  root.appendChild(hud);
  const menu = document.createElement('div');
  menu.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(0,0,0,.6)';
  for (const s of api.scenarios) {
    const b = document.createElement('button');
    b.textContent = `${s.title} — ${s.subtitle}`;
    b.style.cssText = 'font:14px sans-serif;padding:8px 16px;min-width:320px';
    b.onclick = () => api.startScenario(s.id);
    menu.appendChild(b);
  }
  root.appendChild(menu);
  return {
    update(frame) {
      menu.style.display = game.started ? 'none' : 'flex';
      const v = game.active, t = v.tel;
      hud.textContent = `${v.name}  ${game.view.mode.toUpperCase()}  MET ${game.time.met.toFixed(0)}s  x${game.time.warpActual}\n` +
        `ALT ${t.altitude.toFixed(1)} m  VS ${t.vSpeed.toFixed(1)} m/s  HS ${t.hSpeed.toFixed(1)} m/s\n` +
        `THR ${(v.mainEngine.throttle * 100).toFixed(0)}%  FUEL ${(t.fuelFraction * 100).toFixed(1)}%  PE ${(t.periapsisAlt / 1000).toFixed(1)} km  AP ${(t.apoapsisAlt / 1000).toFixed(1)} km`;
    },
  };
}
