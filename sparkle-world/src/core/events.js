// Tiny event emitter shared by the game and its modules.

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  /** Subscribe; returns an unsubscribe function. */
  on(name, fn) {
    let list = this._handlers.get(name);
    if (!list) this._handlers.set(name, (list = []));
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(name, fn) {
    const list = this._handlers.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Call every handler; one failing handler must not stop the others. */
  emit(name, payload) {
    const list = this._handlers.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" failed`, err);
      }
    }
  }
}
