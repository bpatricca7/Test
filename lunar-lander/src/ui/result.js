// Landing result card: "The Eagle has landed" for a good landing, a hard-landing or crash card
// otherwise. Shows the touchdown sink rate and ground speed (against the LM's structural limits),
// tilt, propellant left, distance from the target, the rating and the 0-100 score.

import { h, s } from './dom.js';
import { fmtMET, fmtSpeed, fmtDist, num, RATING_LABEL, grade, FT } from './format.js';
import { MISSION } from '../core/constants.js';
import { createPatch } from './patch.js';

/**
 * @param {{onContinue():void, onRetry():void, onMissions():void}} cb
 */
export function createResultCard(cb) {
  const kicker = h('div.rkicker');
  const title = h('h1');
  const sub = h('div.rsub');
  const patch = createPatch({ size: 104, className: 'rpatch', text: 'TRANQUILITY BASE · APOLLO 11 ·' });
  const stats = h('div.rstats');
  const ringFg = s('circle', { cx: 56, cy: 56, r: 50, fill: 'none', stroke: '#ffb347', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '314.16', 'stroke-dashoffset': '314.16' });
  const ringSvg = s('svg', { width: 112, height: 112, viewBox: '0 0 112 112' },
    s('circle', { cx: 56, cy: 56, r: 50, fill: 'none', stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 3 }),
    ringFg,
  );
  const scoreV = h('b');
  const gradeV = h('span');
  const rating = h('div.rating');
  const reason = h('div.reason.hidden');
  const btnContinue = h('button.btn', { type: 'button', onclick: () => cb.onContinue() }, 'Continue exploring');
  const btnRetry = h('button.btn', { type: 'button', onclick: () => cb.onRetry() }, 'Retry');
  const btnMenu = h('button.btn', { type: 'button', onclick: () => cb.onMissions() }, 'Missions');
  const card = h('div.card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Landing result' },
    h('div.rhero', null, kicker, title, sub, patch),
    h('div.rbody', null,
      stats,
      h('div.rscore', null, h('div.ring', null, ringSvg, h('div.rv', null, scoreV, gradeV)), rating),
      reason,
    ),
    h('div.rfoot', null, btnMenu, btnRetry, btnContinue),
  );
  const el = h('div.modal.result.pe', null, h('div.veil'), card);

  function stat(k, value, unit, limit, state) {
    return h(`div.rstat${state ? '.' + state : ''}`, null,
      h('div.k', null, k),
      h('div.v', null, value, unit ? h('small', null, unit) : null),
      limit ? h('div.lim', null, limit) : null,
    );
  }

  /**
   * Fill the card from game.result.
   * @returns {HTMLElement} the button to focus
   */
  function fill(res, game) {
    const units = game.settings.units;
    const lm = res.vessel !== 'CSM';
    const name = lm ? 'Eagle' : 'Columbia';
    const good = res.outcome === 'landed';
    el.classList.toggle('bad', !good);
    const lim = MISSION.touchdown;

    if (good) {
      kicker.textContent = `Tranquility Base · GET ${fmtMET(res.met)}`;
      title.textContent = 'The Eagle has landed.';
      sub.textContent = res.rating === 'perfect' ? 'A perfect touchdown. Houston copies — you got a bunch of guys about to turn blue.' : 'Safe on the surface. Houston copies — we’re breathing again.';
    } else if (res.outcome === 'hard') {
      kicker.textContent = `Hard landing · GET ${fmtMET(res.met)}`;
      title.textContent = `${name} is down — hard.`;
      sub.textContent = 'The crew survived, but the structure took more than it was built for.';
    } else if (res.outcome === 'tipped') {
      kicker.textContent = `Loss of vehicle · GET ${fmtMET(res.met)}`;
      title.textContent = `${name} tipped over.`;
      sub.textContent = 'The Lunar Module came to rest on its side.';
    } else {
      kicker.textContent = `Loss of vehicle · GET ${fmtMET(res.met)}`;
      title.textContent = `${name} crashed.`;
      sub.textContent = lm ? 'Contact with the surface was far beyond the landing gear’s limits.' : 'Columbia struck the lunar surface.';
    }
    reason.classList.toggle('hidden', !res.reason);
    reason.textContent = res.reason ? `Cause: ${res.reason}` : '';

    const vs = fmtSpeed(res.vSpeed, units);
    const hs = fmtSpeed(res.hSpeed, units);
    const vsLim = units === 'metric' ? `${lim.maxVSpeed.toFixed(1)} m/s` : `${num(lim.maxVSpeed / FT, 0)} ft/s`;
    const hsLim = units === 'metric' ? `${lim.maxHSpeed.toFixed(1)} m/s` : `${num(lim.maxHSpeed / FT, 0)} ft/s`;
    const dist = fmtDist(res.distanceToTarget, units);
    const list = [
      stat('Sink rate', vs.v, vs.u, `limit ${vsLim}`, Number.isFinite(res.vSpeed) ? (res.vSpeed <= lim.maxVSpeed ? 'ok' : 'bad') : ''),
      stat('Ground speed', hs.v, hs.u, `limit ${hsLim}`, Number.isFinite(res.hSpeed) ? (res.hSpeed <= lim.maxHSpeed ? 'ok' : 'bad') : ''),
      stat('Tilt', Number.isFinite(res.tiltDeg) ? `${num(res.tiltDeg, 1)}°` : '—', '', Number.isFinite(res.maxTiltDeg) && res.maxTiltDeg > res.tiltDeg + 0.5 ? `max ${num(res.maxTiltDeg, 1)}° · limit ${lim.maxTiltDeg}°` : `limit ${lim.maxTiltDeg}°`, Number.isFinite(res.tiltDeg) ? (res.tiltDeg <= lim.maxTiltDeg ? 'ok' : 'bad') : ''),
      stat('Propellant left', Number.isFinite(res.fuelSeconds) ? num(res.fuelSeconds, 0) : '—', 'S', Number.isFinite(res.fuelKg) ? `${num(res.fuelKg, 0)} kg \u00b7 seconds at hover` : ''),
      stat('From target', dist.v, dist.u, 'LPD landing point'),
      stat('Mission time', fmtMET(res.met), '', 'GET'),
    ];
    stats.replaceChildren(...list);

    const score = Math.max(0, Math.min(100, Math.round(res.score || 0)));
    scoreV.textContent = String(score);
    gradeV.textContent = `Grade ${grade(score)}`;
    rating.textContent = RATING_LABEL[res.rating] && res.outcome !== 'crashed' && res.outcome !== 'tipped' ? RATING_LABEL[res.rating] : 'No landing';
    ringFg.setAttribute('stroke', good ? '#ffb347' : '#ff4d40');
    // animate the score ring on open
    ringFg.style.transition = 'none';
    ringFg.setAttribute('stroke-dashoffset', '314.16');
    requestAnimationFrame(() => {
      ringFg.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) 0.25s';
      ringFg.setAttribute('stroke-dashoffset', String(314.16 * (1 - score / 100)));
    });

    btnContinue.classList.toggle('primary', good);
    btnRetry.classList.toggle('primary', !good);
    btnContinue.textContent = good ? 'Continue exploring' : 'Look around';
    return good ? btnContinue : btnRetry;
  }

  return { el, fill };
}
