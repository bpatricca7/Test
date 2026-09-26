// In-flight heads-up display (exterior views) and the compact strip used in the cockpit (IVA),
// where the real instruments carry the information.
//
// Layout (exterior):
//   top-left      vessel, guidance program, guidance AUTO/MANUAL, DAP mode, autopilot, radar
//   top-centre    mission clock (Apollo GET), time warp / pause / CPU-limited warp, camera
//   below it      ignition countdown and the DSKY "flashing verb/noun" PRO prompt
//   top-right     MASTER ALARM, LUNAR CONTACT and other caution lights
//   bottom-left   altitude (radar when locked), altitude rate, horizontal velocity (fwd / lateral),
//                 attitude (pitch / roll / heading)
//   bottom-right  main engine throttle (with command and hover marks), propellant & bingo, RCS
//   right-middle  orbit (apolune / perilune / period / speed), range & bearing to the landing
//                 site, range & closing rate to the other spacecraft
//   bottom-centre P66 rate-of-descent command, P64 LPD angle & time, time to go
// Numbers refresh at ~15 Hz (readable, cheap); everything writes the DOM only on change.

import { h, slot, setClass } from './dom.js';
import { DOCK } from '../sim/docking.js';
import { fmtMET, fmtClock, fmtAlt, fmtSpeed, fmtDist, fmtOrbitAlt, fmtBearing, fmtAngle, fmtPct, fmtWarp, fmtDuration, num, PROGRAM_NAMES, AUTOPILOT_NAMES, dskyPrompt, FT } from './format.js';

const NUM_INTERVAL = 1 / 15; // s between numeric refreshes

const VESSEL_TITLE = { LM: 'Lunar Module', CSM: 'Command / Service Module' };

/** Programs in which "time to bingo" (hover propellant above the 20-s reserve) is meaningful. */
const DESCENT_PROGRAMS = new Set(['P63', 'P64', 'P65', 'P66', 'P67']);

/** Plain-language meaning of the caution & warning lights (shown next to the lamp name). */
export const CAUTION_TEXT = {
  ALT: 'Radar altitude not valid',
  VEL: 'Radar velocity not valid',
  'DES QTY': 'Descent propellant low',
  'ASC QTY': 'Ascent propellant low',
  RCS: 'RCS propellant low',
  'RCS TCA': 'RCS thruster failure',
  'ENG FIRE': 'Engine fire signal',
  PGNS: 'Guidance computer caution',
};

/** Bingo applies while the LM's descent stage is flying a descent program below 16 km. */
export function bingoApplies(v) {
  return v.type === 'LM' && !v.staged && !v.landed && DESCENT_PROGRAMS.has(v.gnc?.program) && Number.isFinite(v.tel?.bingoSeconds) && v.tel.altitude < 16000;
}

/** Label + value + unit cell. */
function cell(label, cls = '') {
  const v = h('span.hv');
  const u = h('span.hu');
  const el = h(`div${cls}`, null, h('div.hl', null, label), h('div.val', null, v, u));
  return { el, v: slot(v), u: slot(u), vEl: v };
}

function bar(extra = '') {
  const fill = h(`i${extra}`);
  const el = h('div.bar', null, fill);
  return { el, fill };
}

export function createHUD(game) {
  // ---------------------------------------------------------------- build
  // top-left: identity
  const vName = slot(h('span'));
  const vType = slot(h('i'));
  const pNum = slot(h('span.pn'));
  const pName = slot(h('span.pt'));
  const chips = h('div.chips');
  const idPanel = h('div.hp.h-id', null,
    h('div.vname', null, vName.el, vType.el),
    h('div.prog', null, pNum.el, pName.el),
    chips,
  );

  // top-centre: clock
  const met = slot(h('span.met.num'));
  const warpEl = h('span.warp');
  const warp = slot(warpEl);
  const cam = slot(h('span'));
  const clock = h('div.hp.h-clock', null, h('div.row', null, h('span.hl', null, 'GET'), met.el, warpEl), h('div.cam', null, cam.el, h('kbd', { title: 'C: next camera' }, 'C')));

  // ignition / PRO prompt
  const prT = slot(h('div.pt'));
  const prTig = slot(h('div.tig.num'));
  const prH = slot(h('div.ph'));
  const prompt = h('div.hp.h-prompt.hidden', null, prT.el, prTig.el, prH.el);

  // top-right: caution & warning
  const lampMA = h('div.lamp.ma.blink.hidden', null, 'Master alarm');
  const lampContact = h('div.lamp.contact.hidden', null, 'Lunar contact');
  const cautions = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4em' } });
  const cw = h('div.hp.h-cw', null, lampMA, lampContact, cautions);

  // bottom-left: flight data
  const altLabel = slot(h('div.hl'));
  const altV = slot(h('span.hv'));
  const altU = slot(h('span.hu'));
  const vs = cell('Alt rate');
  const vsArrow = slot(h('span.vsarrow'));
  vs.el.lastChild.prepend(vsArrow.el);
  const hs = cell('H vel');
  const fwd = cell('Fwd');
  const lat = cell('Lat');
  const pitch = cell('Pitch');
  const roll = cell('Roll');
  const hdg = cell('Hdg');
  const flight = h('div.hp.h-flight', null,
    h('div.h-alt', null, altLabel.el, h('div', null, altV.el, altU.el)),
    h('div.h-sep'),
    h('div.h-grid', null, vs.el, hs.el, fwd.el, lat.el),
    h('div.h-sep'),
    h('div.h-att', null, pitch.el, roll.el, hdg.el),
  );

  // bottom-right: propulsion
  const engLabel = slot(h('div.hl'));
  const engState = slot(h('span.chip'));
  const thrV = slot(h('span.hv'));
  const thrBar = bar('.amber-f');
  const thrCmd = h('div.cmd');
  const thrHover = h('div.tick');
  thrBar.el.append(thrCmd, thrHover);
  const propLabel = slot(h('span.hl'));
  const propV = slot(h('span.hv'));
  const propBar = bar();
  const bingoL = slot(h('span.hl'));
  const bingoV = slot(h('span.hv'));
  const rcsV = slot(h('span.hv'));
  const rcsBar = bar();
  const prop = h('div.hp.h-prop', null,
    h('div.h-eng', null, h('div', null, engLabel.el, h('div', { style: { marginTop: '0.35em' } }, thrV.el, h('span.hu', null, '%'))), engState.el),
    thrBar.el,
    h('div.h-row', null, propLabel.el, propV.el),
    propBar.el,
    h('div.h-row', null, bingoL.el, bingoV.el),
    h('div.h-row', null, h('span.hl', null, 'RCS'), rcsV.el),
    rcsBar.el,
  );

  // right-middle: navigation
  const orbitBlk = h('div.blk');
  const orb = {
    ap: kv(orbitBlk, 'Apolune'),
    pe: kv(orbitBlk, 'Perilune'),
    per: kv(orbitBlk, 'Period'),
    spd: kv(orbitBlk, 'Speed'),
  };
  orbitBlk.prepend(h('h4', null, 'Orbit'));
  const siteBlk = h('div.blk');
  const siteTitle = slot(h('h4'));
  siteBlk.append(siteTitle.el);
  const site = { rng: kv(siteBlk, 'Range'), brg: kv(siteBlk, 'Bearing') };
  const tgtBlk = h('div.blk');
  const tgtTitle = slot(h('h4'));
  tgtBlk.append(tgtTitle.el);
  const tgt = { rng: kv(tgtBlk, 'Range'), rate: kv(tgtBlk, 'Closing') };
  const nav = h('div.hp.h-nav', null, orbitBlk, siteBlk, tgtBlk);

  // bottom-centre: landing guidance
  const gRod = cell('ROD cmd', '.gk');
  const gLpd = cell('LPD', '.gk');
  const gLpdT = cell('LPD time', '.gk');
  const gTgo = cell('Time to go', '.gk');
  const guide = h('div.hp.h-guide.hidden', null, gRod.el, gLpd.el, gLpdT.el, gTgo.el);

  // cockpit strip
  const sId = slot(h('span.sid'));
  const sMet = slot(h('span.hv'));
  const sWarp = slot(h('span.hv'));
  const sAlt = slot(h('span.hv'));
  const sVs = slot(h('span.hv'));
  const sHs = slot(h('span.hv'));
  const sProp = slot(h('span.hv'));
  const sAltL = slot(h('span.hl'));
  const sPropL = slot(h('span.hl'));
  // phase row: the numbers that matter right now (TIG / TGO, P64 LPD, P66 ROD, rendezvous & docking)
  const phName = slot(h('span.pname'));
  const ph = {};
  const phItem = (key, label) => {
    const lab = slot(h('span.hl', null, label));
    const v = slot(h('span.hv'));
    const el = h('span.pi.hidden', null, lab.el, v.el);
    ph[key] = { el, v, lab };
    return el;
  };
  const phase = h('div.sphase.hidden', null,
    phName.el,
    phItem('tig', 'TIG'),
    phItem('tgo', 'TGO'),
    phItem('lpd', 'LPD'),
    phItem('rod', 'ROD cmd'),
    phItem('rng', 'Range'),
    phItem('rate', 'Closing'),
    phItem('lat', 'Lateral'),
    phItem('mis', 'Misalign'),
  );
  const strip = h('div.hp.h-strip.hidden', null,
    h('div.srow', null,
      sId.el, h('i.sep'),
      h('span', null, h('span.hl', null, 'GET'), sMet.el, ' ', sWarp.el), h('i.sep'),
      h('span', null, sAltL.el, sAlt.el), h('span', null, h('span.hl', null, 'Alt rate'), sVs.el), h('span', null, h('span.hl', null, 'H vel'), sHs.el), h('i.sep'),
      h('span', null, sPropL.el, sProp.el),
    ),
    phase,
  );

  // cockpit: the strip and, right under it, the PRO prompt (whatever height the strip wraps to)
  const ivaTop = h('div.h-ivatop.hidden', null, strip);
  const el = h('div.hud', null, idPanel, clock, prompt, cw, flight, prop, nav, guide, ivaTop);
  const exterior = [idPanel, clock, cw, flight, prop, nav];

  function kv(parent, label) {
    const v = slot(h('span.hv'));
    const row = h('div.h-kv', null, h('span.hl', null, label), v.el);
    parent.appendChild(row);
    return { row, v, el: v.el };
  }

  // ---------------------------------------------------------------- helpers
  let lastChips = '';
  function setChips(list) {
    const key = list.map((c) => c.join(':')).join('|');
    if (key === lastChips) return;
    lastChips = key;
    chips.replaceChildren(...list.map(([text, cls]) => h(`span.chip${cls ? '.' + cls : ''}`, null, text)));
  }

  let lastCautions = '';
  function setCautions(list) {
    const key = list.join('|');
    if (key === lastCautions) return;
    lastCautions = key;
    cautions.replaceChildren(...list.map((t) => h('div.lamp.caution', { title: CAUTION_TEXT[t] || t }, t, CAUTION_TEXT[t] ? h('small', null, CAUTION_TEXT[t]) : null)));
  }

  /** "42 s" under a minute, "18:40" above. */
  const secs = (x) => (x < 60 ? `${Math.floor(x)} s` : fmtDuration(x));
  const pct = (f) => `${Math.max(0, Math.min(100, f * 100)).toFixed(2)}%`;
  const setW = (fill, f) => {
    const w = pct(f);
    if (fill.style.width !== w) fill.style.width = w;
  };
  const setL = (node, f) => {
    const w = pct(f);
    if (node.style.left !== w) node.style.left = w;
  };

  /** Altitude shown to the pilot: radar when locked, else footpad height (LM) / CG height. */
  function pilotAltitude(v) {
    const t = v.tel;
    if (v.type === 'LM' && Number.isFinite(t.radarAltitude) && v.gnc.radarLock !== false && t.altitude < 15000) return { m: t.radarAltitude, radar: true };
    const m = v.type === 'LM' && Number.isFinite(t.gearAltitude) ? t.gearAltitude : t.altitude;
    return { m, radar: false };
  }

  /** Horizontal velocity split along the vessel's heading: forward and lateral (+ = right). */
  function fwdLat(t) {
    const hd = ((t.attitude?.heading || 0) * Math.PI) / 180;
    const e = t.velENU?.x || 0;
    const n = t.velENU?.y || 0;
    return { fwd: e * Math.sin(hd) + n * Math.cos(hd), lat: e * Math.cos(hd) - n * Math.sin(hd) };
  }

  /** Show / hide one phase-row item and set its value (and warn / alarm tint). */
  function phSet(key, on, value, level) {
    const it = ph[key];
    setClass(it.el, 'hidden', !on);
    if (!on) return;
    it.v.set(value);
    setClass(it.v.el, 'warn', level === 'warn');
    setClass(it.v.el, 'alarm', level === 'alarm');
  }

  /**
   * Cockpit phase row: the few numbers the current phase is flown on, which the strip's first row
   * does not carry — P63 TIG countdown / time to go, P64 LPD angle & time left, P66 commanded
   * rate of descent, and within 1 km of the other spacecraft its range and closing rate (plus the
   * probe-to-drogue lateral offset and misalignment on the final docking approach).
   */
  function updatePhase(v, units, tm) {
    const g = v.gnc;
    const t = v.tel;
    const p = g.program || 'P00';
    const lm = v.type === 'LM' && !v.landed && !v.crashed;
    const tig = Number.isFinite(g.tig) ? g.tig - tm.met : NaN;
    const tigOn = tig > 0 && tig < 3600;
    const tgoOn = !tigOn && lm && (p === 'P63' || p === 'P64') && Number.isFinite(g.tgo) && g.tgo > 0;
    const lpdOn = lm && p === 'P64' && Number.isFinite(g.lpdAngle);
    const rodOn = lm && p === 'P66' && g.throttleMode === 'AUTO' && Number.isFinite(g.rodCmd);
    phSet('tig', tigOn, `\u2212${fmtClock(tig)}`, tig < 10 ? 'warn' : null);
    phSet('tgo', tgoOn, tgoOn ? fmtDuration(g.tgo) : '');
    if (lpdOn) {
      const left = Number.isFinite(g.lpdTimeLeft) ? Math.max(0, Math.round(g.lpdTimeLeft)) : null;
      phSet('lpd', true, `${num(g.lpdAngle, 0)}°${left != null ? ` · ${left} s` : ''}`, left != null && left < 10 ? 'warn' : null);
    } else phSet('lpd', false);
    if (rodOn) {
      const r = fmtSpeed(g.rodCmd, units, { plus: true });
      phSet('rod', true, `${units === 'metric' ? r.v : num(g.rodCmd / FT, 0, { plus: true })} ${r.u}`, g.rodCmd < -5 * FT && pilotAltitude(v).m < 30 ? 'warn' : null);
    } else phSet('rod', false);

    // the other spacecraft within 1 km (not docked)
    const other = game.inactive;
    const rt = t.relTarget;
    const near = !!rt && !v.docked && !!other && !other.crashed && Number.isFinite(rt.range) && rt.range < 1000;
    const dk = near ? rt.dock : null;
    // final docking approach: probe-to-drogue geometry is valid and the tip is within ~60 m
    const docking = !!dk && Number.isFinite(dk.lateral) && Number.isFinite(dk.misalignDeg) && dk.range < 60;
    if (near) {
      ph.rng.lab.set(other.name);
      const r = fmtDist(docking ? dk.range : rt.range, units);
      phSet('rng', true, `${r.v} ${r.u}`);
      const closing = docking && Number.isFinite(dk.closing) ? dk.closing : -(rt.rangeRate || 0);
      const c = fmtSpeed(closing, units, { plus: true });
      const hot = docking && dk.range < 15 && closing > DOCK.CAPTURE_CLOSING;
      phSet('rate', true, `${c.v} ${c.u}`, hot ? (closing > DOCK.CAPTURE_CLOSING * 1.8 ? 'alarm' : 'warn') : null);
    } else {
      phSet('rng', false);
      phSet('rate', false);
    }
    if (docking) {
      const l = fmtDist(dk.lateral, units);
      const lv = units === 'metric' ? num(dk.lateral, 2) : num(dk.lateral / FT, 1);
      phSet('lat', true, `${lv} ${l.u}`, dk.range < 5 && dk.lateral > DOCK.CAPTURE_LATERAL ? 'warn' : null);
      phSet('mis', true, `${num(dk.misalignDeg, 1)}°`, dk.misalignDeg > DOCK.CAPTURE_MISALIGN_DEG ? 'warn' : null);
    } else {
      phSet('lat', false);
      phSet('mis', false);
    }

    const any = tigOn || tgoOn || lpdOn || rodOn || near;
    setClass(phase, 'hidden', !any);
    if (any) phName.set(docking ? 'Docking' : near && !lpdOn && !rodOn && !tgoOn ? 'Rendezvous' : tigOn && !tgoOn ? 'Ignition' : PROGRAM_NAMES[p] || p);
  }

  let numT = 0;
  let mode = null;
  let lastMet = NaN;
  // a new mission or vessel (and a jump in mission time, e.g. debug.advance / ?t=) refreshes the
  // numbers on the next frame instead of up to 1/15 s later
  const refresh = () => {
    numT = 0;
  };
  game.events.on('scenario', refresh);
  game.events.on('vessel', refresh);
  game.events.on('program', refresh);

  // ---------------------------------------------------------------- update
  /**
   * @param {object} frame
   * @param {boolean} visible
   * @param {{liftoffHint?: boolean}} [opt] liftoffHint: landed in P68 — prompt PRO for the P12 ascent
   */
  function update(frame, visible, opt = {}) {
    setClass(el, 'off', !visible);
    if (!visible) return;
    const v = game.active;
    if (!v) return;
    const iva = game.view.mode === 'iva';
    if (mode !== iva) {
      mode = iva;
      for (const p of exterior) setClass(p, 'hidden', iva);
      setClass(strip, 'hidden', !iva);
      setClass(ivaTop, 'hidden', !iva);
      if (iva) ivaTop.appendChild(prompt);
      else el.insertBefore(prompt, cw);
      numT = 0;
    }
    const units = game.settings.units;
    const t = v.tel;
    const g = v.gnc;
    const tm = game.time;

    // ---- prompt (every frame: it flashes)
    const pr = dskyPrompt(v.agc);
    const tig = Number.isFinite(g.tig) ? g.tig - tm.met : NaN;
    const showTig = tig > 0 && tig < 900;
    const lift = !pr && !showTig && !!opt.liftoffHint;
    // cockpit: a bare countdown lives in the strip's phase row; the box is for PRO prompts
    const tigBox = showTig && (!iva || !!pr);
    setClass(prompt, 'hidden', !pr && !tigBox && !lift);
    setClass(prompt, 'iva', iva);
    setClass(prompt, 'calm', lift);
    if (pr || showTig || lift) {
      prT.set(pr ? pr.title : lift ? 'On the surface · P68' : 'Ignition');
      // (cockpit: the countdown is in the strip's phase row just above)
      prTig.set(showTig ? `TIG \u2212${fmtClock(tig)}` : '');
      setClass(prTig.el, 'hidden', !showTig || iva);
      prH.set(pr ? `${pr.hint}${iva ? ' · O: glance at the DSKY' : ''}` : lift ? 'Space (PRO): load P12 — lift off and return to Columbia' : v.type === 'LM' ? 'Guidance will ask for PRO (Space) at 5 s' : '');
      setClass(prH.el, 'hidden', !prH.el.textContent);
      setClass(prompt, 'flash', !!pr);
      setClass(prompt, 'alarmp', pr?.level === 'alarm');
    }

    // ---- master alarm & contact light (every frame)
    setClass(lampMA, 'hidden', !v.cw?.masterAlarm);
    const contact = v.type === 'LM' && !!(v.cw?.lights?.['LUNAR CONTACT'] || v.gear?.probeContact) && !v.staged;
    setClass(lampContact, 'hidden', !contact);

    numT -= frame?.dt ?? 0.016;
    // mission time moved by more than this frame's simulation step (debug.advance, ?t=): refresh now
    if (Number.isFinite(lastMet) && Math.abs(tm.met - lastMet - (frame?.simDt || 0)) > 0.5) numT = 0;
    lastMet = tm.met;
    if (numT > 0) return;
    numT = NUM_INTERVAL;

    const alt = pilotAltitude(v);
    const low = alt.m < 150 && !v.landed;

    if (iva) {
      setClass(guide, 'hidden', true); // the cockpit's own displays carry LPD / ROD / TGO
      // ---- compact cockpit strip
      sId.set(`${v.name.toUpperCase()} · ${g.program || 'P00'}`);
      sMet.set(fmtMET(tm.met));
      sWarp.set(tm.paused ? 'PAUSED' : tm.warpActual > 1 ? fmtWarp(tm) : '');
      const a = fmtAlt(alt.m, units);
      sAltL.set(alt.radar ? 'Radar alt' : 'Alt');
      sAlt.set(`${a.v} ${a.u}`);
      const vsx = fmtSpeed(t.vSpeed, units, { plus: true });
      sVs.set(`${vsx.v} ${vsx.u}`);
      const hsx = fmtSpeed(t.hSpeed, units);
      sHs.set(`${hsx.v} ${hsx.u}`);
      const bingo = bingoApplies(v);
      sPropL.set('Prop');
      sProp.set(`${fmtPct(t.fuelFraction)}${bingo && t.fuelFraction < 0.25 ? ` · BINGO ${t.bingoSeconds > 0 ? secs(t.bingoSeconds) : 'NOW'}` : ''}`);
      setClass(sProp.el, 'warn', t.fuelFraction < 0.1);
      setClass(sVs.el, 'alarm', low && t.vSpeed < -3);
      updatePhase(v, units, tm);
      return;
    }

    // ---- identity
    vName.set(v.name.toUpperCase());
    vType.set(v.docked ? 'Docked' : v.type === 'LM' && v.staged ? 'Ascent stage' : VESSEL_TITLE[v.type] || '');
    const p = g.program || 'P00';
    pNum.set(p);
    pName.set(PROGRAM_NAMES[p] || '');
    const list = [];
    if (v.crashed) list.push(['Crashed', 'w']);
    else if (v.landed) list.push(['Landed', 'g']);
    list.push([g.throttleMode === 'AUTO' ? 'Guid auto' : 'Guid man', g.throttleMode === 'AUTO' ? 'a' : '']);
    list.push([g.rcsMode || 'RATE', '']);
    if (g.rcsMode === 'RATE') list.push(['Att hold', g.attHold ? '' : 'dim']);
    if (v.ctrl?.fine) list.push(['Fine', 'w']);
    if (g.autopilot && g.autopilot !== 'OFF') list.push([`AP ${AUTOPILOT_NAMES[g.autopilot] || g.autopilot}`, 'a']);
    if (v.type === 'LM' && !v.landed && t.altitude < 16000 && !v.staged) list.push([g.radarLock ? 'Radar' : 'No radar', g.radarLock ? 'g' : 'dim']);
    setChips(list);

    // ---- clock
    met.set(fmtMET(tm.met));
    warp.set(fmtWarp(tm));
    setClass(warpEl, 'fast', !tm.paused && tm.warpActual > 1);
    setClass(warpEl, 'paused', !!tm.paused);
    cam.set(game.view.label || game.view.mode || '');

    // ---- cautions (lit lights other than the two lamps above)
    const lit = [];
    for (const [name, on] of Object.entries(v.cw?.lights || {})) if (on && name !== 'MASTER ALARM' && name !== 'LUNAR CONTACT') lit.push(name);
    setCautions(lit.slice(0, 5));

    // ---- flight data
    altLabel.set(alt.radar ? 'Radar altitude' : v.type === 'LM' && alt.m < 20000 ? 'Altitude (gear)' : 'Altitude');
    const a = fmtAlt(alt.m, units);
    altV.set(a.v);
    altU.set(a.u);
    const vsx = fmtSpeed(t.vSpeed, units, { plus: true });
    vs.v.set(vsx.v);
    vs.u.set(vsx.u);
    vsArrow.set(t.vSpeed > 0.05 ? '\u25B2' : t.vSpeed < -0.05 ? '\u25BC' : '\u00b7');
    setClass(vs.vEl, 'alarm', low && t.vSpeed < -3);
    setClass(vs.vEl, 'warn', low && t.vSpeed < -1.5 && t.vSpeed >= -3);
    const hsx = fmtSpeed(t.hSpeed, units);
    hs.v.set(hsx.v);
    hs.u.set(hsx.u);
    setClass(hs.vEl, 'warn', alt.m < 30 && t.hSpeed > 1.2 && !v.landed);
    const fl = fwdLat(t);
    const fx = fmtSpeed(fl.fwd, units, { plus: true });
    const lx = fmtSpeed(fl.lat, units, { plus: true });
    fwd.v.set(fx.v);
    fwd.u.set(fx.u);
    lat.v.set(lx.v);
    lat.u.set(lx.u);
    const att = t.attitude || {};
    pitch.v.set(fmtAngle(att.pitch));
    roll.v.set(fmtAngle(att.roll));
    hdg.v.set(fmtBearing(att.heading));

    // ---- propulsion
    const e = v.mainEngine || {};
    engLabel.set(`${e.name || 'Engine'} thrust`);
    const firing = e.firing && e.throttle > 0;
    const stateText = v.crashed ? 'Off' : firing ? g.throttleState || 'Firing' : e.armed === false ? 'Safe' : 'Armed';
    engState.set(stateText);
    setClass(engState.el, 'a', firing);
    thrV.set(num((e.throttle || 0) * 100, 0));
    setW(thrBar.fill, e.throttle || 0);
    setL(thrCmd, e.throttleCmd || 0);
    const hover = v.type === 'LM' && Number.isFinite(t.hoverThrottle) && t.hoverThrottle < 1 && !v.landed;
    setClass(thrHover, 'hidden', !hover);
    if (hover) setL(thrHover, t.hoverThrottle);

    const staged = v.type === 'LM' && v.staged;
    propLabel.set(v.type === 'LM' ? (staged ? 'Ascent prop' : 'Descent prop') : 'SPS prop');
    propV.set(fmtPct(t.fuelFraction, { fine: true }));
    setW(propBar.fill, t.fuelFraction);
    setClass(propV.el, 'warn', t.fuelFraction < 0.1 && t.fuelFraction >= 0.03);
    setClass(propV.el, 'alarm', t.fuelFraction < 0.03);
    if (bingoApplies(v)) {
      bingoL.set('To bingo');
      bingoV.set(t.bingoSeconds > 0 ? secs(t.bingoSeconds) : 'BINGO');
      setClass(bingoV.el, 'alarm', t.bingoSeconds <= 0);
      setClass(bingoV.el, 'warn', t.bingoSeconds > 0 && t.bingoSeconds < 60);
    } else {
      bingoL.set('Burn time');
      bingoV.set(Number.isFinite(t.burnTimeLeft) ? secs(t.burnTimeLeft) : '—');
      setClass(bingoV.el, 'alarm', false);
      setClass(bingoV.el, 'warn', false);
    }
    rcsV.set(fmtPct(t.rcsFraction));
    setW(rcsBar.fill, t.rcsFraction);
    setClass(rcsV.el, 'warn', t.rcsFraction < 0.15);

    // ---- navigation
    const inOrbit = t.altitude > 12000 && !v.landed;
    setClass(orbitBlk, 'hidden', !inOrbit);
    if (inOrbit) {
      const ap = fmtOrbitAlt(t.apoapsisAlt, units);
      const pe = fmtOrbitAlt(t.periapsisAlt, units);
      orb.ap.v.set(Number.isFinite(t.apoapsisAlt) ? `${ap.v} ${ap.u}` : 'ESCAPE');
      orb.pe.v.set(`${pe.v} ${pe.u}`);
      setClass(orb.pe.el, 'alarm', t.periapsisAlt < 0);
      setClass(orb.pe.el, 'warn', t.periapsisAlt >= 0 && t.periapsisAlt < 10000);
      orb.per.v.set(Number.isFinite(t.period) ? fmtDuration(t.period) : '—');
      const sp = fmtSpeed(t.orbitalSpeed, units);
      orb.spd.v.set(`${sp.v} ${sp.u}`);
    }
    const siteOn = Number.isFinite(t.rangeToSite) && (t.rangeToSite > 15 || !v.landed) && t.rangeToSite < 2.5e6;
    setClass(siteBlk, 'hidden', !siteOn);
    if (siteOn) {
      siteTitle.set(v.type === 'LM' && !v.staged ? 'Landing site' : 'Tranquility Base');
      const r = fmtDist(t.rangeToSite, units);
      site.rng.v.set(`${r.v} ${r.u}`);
      site.brg.v.set(fmtBearing(t.bearingToSite));
    }
    const other = game.inactive;
    const rt = t.relTarget;
    const tgtOn = !!rt && !v.docked && other && !other.crashed && Number.isFinite(rt.range);
    setClass(tgtBlk, 'hidden', !tgtOn);
    if (tgtOn) {
      tgtTitle.set(other.name);
      const r = fmtDist(rt.range, units);
      tgt.rng.v.set(`${r.v} ${r.u}`);
      const c = fmtSpeed(-(rt.rangeRate || 0), units, { plus: true });
      tgt.rate.v.set(`${c.v} ${c.u}`);
      setClass(tgt.rate.row, 'hidden', rt.range > 50000); // closing rate matters for rendezvous
    }
    setClass(nav, 'hidden', !inOrbit && !siteOn && !tgtOn);

    // ---- landing guidance
    const isLM = v.type === 'LM' && !v.landed;
    const rodOn = isLM && p === 'P66' && g.throttleMode === 'AUTO';
    const lpdOn = isLM && p === 'P64' && Number.isFinite(g.lpdAngle);
    const tgoOn = isLM && (p === 'P63' || p === 'P64') && Number.isFinite(g.tgo) && g.tgo > 0;
    setClass(gRod.el, 'hidden', !rodOn);
    setClass(gLpd.el, 'hidden', !lpdOn);
    setClass(gLpdT.el, 'hidden', !lpdOn);
    setClass(gTgo.el, 'hidden', !tgoOn);
    setClass(guide, 'hidden', !rodOn && !lpdOn && !tgoOn);
    if (rodOn) {
      const r = fmtSpeed(g.rodCmd || 0, units, { plus: true });
      gRod.v.set(units === 'metric' ? r.v : num((g.rodCmd || 0) / FT, 0, { plus: true }));
      gRod.u.set(r.u);
    }
    if (lpdOn) {
      gLpd.v.set(`${num(g.lpdAngle, 0)}°`);
      gLpdT.v.set(Number.isFinite(g.lpdTimeLeft) ? `${Math.max(0, Math.round(g.lpdTimeLeft))} s` : '—');
    }
    if (tgoOn) gTgo.v.set(fmtDuration(g.tgo));
  }

  return {
    el,
    update,
    /** True while the ignition / PRO prompt under the clock is shown (the ticker moves below it). */
    get promptShown() {
      return !el.classList.contains('off') && !prompt.classList.contains('hidden');
    },
  };
}
