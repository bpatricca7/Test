// Tiny synchronous event bus.
//
// Standard events (payload in braces) — see ARCHITECTURE.md for the full list:
//   'action'      {name, ...args}   discrete player command from input/UI (e.g. {name:'ROD_DOWN'})
//   'message'     {text, level: 'info'|'good'|'warn'|'alarm', duration?}   show a message to the player
//   'callout'     {text, voice?: boolean}   crew/mission-control voice callout (UI shows, audio speaks)
//   'scenario'    {id}              a scenario was (re)loaded — modules reset transient state
//   'vessel'      {id}              the active vessel changed
//   'camera'      {mode}            the camera mode changed
//   'contact'     {vessel:'LM'}     LUNAR CONTACT light (probe touched)
//   'touchdown'   {vessel, vSpeed, hSpeed, tiltDeg, rating: 'perfect'|'good'|'hard', distanceToTarget}
//   'crash'       {vessel, reason}
//   'engine'      {vessel, engine, on: boolean}
//   'stage'       {vessel:'LM'}     ascent stage separated
//   'dock' / 'undock' {a:'CSM', b:'LM'}
//   'alarm'       {code, text}      program alarm / caution&warning (master alarm)
//   'program'     {vessel, program} guidance program changed (e.g. 'P64')

export class EventBus {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.map.get(type)?.delete(fn);
  }
  emit(type, payload = {}) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`event handler for '${type}' failed`, e);
      }
    }
  }
}
