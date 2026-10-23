// Hotkey dispatcher (UI spec §11). One window keydown listener; components register combos and get an
// unregister function back. THREE binds no keys.
//
//   const off = registerHotkey('j', () => next(), { label: 'Next needs-review row', group: 'Review' });
//   useHotkey('shift+m', () => setFactorsOpen(true));
//   const pop = pushEscape(() => { close(); return true; }, 'dialog');   // Esc stack for layers
//
// Rules:
// - Hotkeys are ignored while focus is in an input, select, textarea or contenteditable (except Esc, and
//   combos registered with { allowInInput: true }, e.g. mod+enter).
// - While a modal layer is open (a Dialog pushes one), only combos registered with { inModal: true } fire.
// - Esc walks the escape stack: highest layer first (menu → dialog → drawer → edit → search → base), most
//   recent first within a layer. A handler returns false to pass Esc to the next one.
// - Combo grammar: modifiers joined with "+": mod (Ctrl or ⌘), ctrl, meta, alt, shift; then a key:
//   a letter/digit, a symbol ("/", "[", "]", "\\", "?", "-", "="), or a named key (enter, escape, space,
//   arrowup, arrowdown, arrowleft, arrowright, home, end, pageup, pagedown, delete, backspace, tab, f2).
//   Shift is significant for letters, digits and named keys and ignored for symbols ("?" is shift+/ already).

import { useEffect, useRef } from 'react';

export type EscLayer = 'menu' | 'dialog' | 'drawer' | 'edit' | 'search' | 'selection' | 'base';
const LAYER_RANK: Record<EscLayer, number> = { menu: 60, dialog: 50, drawer: 40, edit: 30, search: 20, selection: 10, base: 0 };

export interface HotkeyOptions {
  /** fire even while focus is in a text field */
  allowInInput?: boolean;
  /** fire while a modal dialog is open */
  inModal?: boolean;
  /** extra guard evaluated at key time */
  when?: () => boolean;
  /** call preventDefault (default true) */
  preventDefault?: boolean;
  /** fire on auto-repeat (default true) */
  repeat?: boolean;
  /** for the shortcuts sheet */
  label?: string;
  group?: string;
}

interface Combo { key: string; mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; symbol: boolean }
interface Entry { id: number; combo: Combo; text: string; handler: (e: KeyboardEvent) => void | boolean; opts: HotkeyOptions }
interface EscEntry { id: number; rank: number; handler: () => boolean | void }

const NAMED: Record<string, string> = { esc: 'escape', return: 'enter', space: ' ', spacebar: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', del: 'delete', pgup: 'pageup', pgdn: 'pagedown', plus: '+', slash: '/', backslash: '\\' };

function parseCombo(text: string): Combo {
  const parts = text.toLowerCase().split('+');
  // "mod++" / "shift+=" style: a trailing empty part means the key itself is "+"
  let key = parts.pop() ?? '';
  if (key === '' && parts.length && parts[parts.length - 1] === '') { parts.pop(); key = '+'; }
  key = NAMED[key] ?? key;
  const c: Combo = { key, mod: false, ctrl: false, meta: false, alt: false, shift: false, symbol: key.length === 1 && !/[a-z0-9 ]/.test(key) };
  for (const p of parts) {
    if (p === 'mod' || p === 'cmd' || p === 'cmdorctrl') c.mod = true;
    else if (p === 'ctrl' || p === 'control') c.ctrl = true;
    else if (p === 'meta') c.meta = true;
    else if (p === 'alt' || p === 'option') c.alt = true;
    else if (p === 'shift') c.shift = true;
  }
  return c;
}

function eventKey(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // Shift+digit on US layouts gives a symbol in e.key; use e.code so "shift+1" can still be bound.
  if (/^Digit\d$/.test(e.code) && e.shiftKey && !/\d/.test(k)) return e.code.slice(5);
  return k;
}

function matches(c: Combo, e: KeyboardEvent): boolean {
  if (eventKey(e) !== c.key && !(c.symbol && e.key === c.key)) return false;
  const modDown = e.ctrlKey || e.metaKey;
  if (c.mod) { if (!modDown) return false; }
  else {
    if (c.ctrl !== e.ctrlKey) return false;
    if (c.meta !== e.metaKey) return false;
  }
  if (c.alt !== e.altKey) return false;
  if (!c.symbol && c.shift !== e.shiftKey) return false;
  return true;
}

let nextId = 1;
const entries: Entry[] = [];
const escStack: EscEntry[] = [];
let modalDepth = 0;
let installed = false;
const listeners = new Set<() => void>();

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.key === 'Escape') {
    if (runEscape()) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  const typing = isTypingTarget(e.target) || isTypingTarget(document.activeElement);
  // newest registration wins, so a focused feature can shadow a global binding
  for (let i = entries.length - 1; i >= 0; i--) {
    const h = entries[i];
    if (!matches(h.combo, e)) continue;
    if (typing && !h.opts.allowInInput) continue;
    if (modalDepth > 0 && !h.opts.inModal) continue;
    if (e.repeat && h.opts.repeat === false) continue;
    if (h.opts.when && !h.opts.when()) continue;
    const r = h.handler(e);
    if (r === false) continue; // handler declined: let an older binding try
    if (h.opts.preventDefault !== false) e.preventDefault();
    return;
  }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', onKeyDown);
}

function emit() { for (const l of listeners) l(); }

/** Register a hotkey. Returns the unregister function. */
export function registerHotkey(combo: string | string[], handler: (e: KeyboardEvent) => void | boolean, opts: HotkeyOptions = {}): () => void {
  install();
  const list = Array.isArray(combo) ? combo : [combo];
  const ids = list.map((text) => { const id = nextId++; entries.push({ id, combo: parseCombo(text), text, handler, opts }); return id; });
  emit();
  return () => {
    for (const id of ids) { const i = entries.findIndex((x) => x.id === id); if (i >= 0) entries.splice(i, 1); }
    emit();
  };
}

/** React binding; the latest handler is always called (no stale closures), registration follows `combo` and `enabled`. */
export function useHotkey(combo: string | string[], handler: (e: KeyboardEvent) => void | boolean, opts: HotkeyOptions & { enabled?: boolean } = {}) {
  const ref = useRef(handler); ref.current = handler;
  const optsRef = useRef(opts); optsRef.current = opts;
  const key = Array.isArray(combo) ? combo.join('|') : combo;
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const o = optsRef.current;
    return registerHotkey(key.split('|'), (e) => ref.current(e), { ...o, when: o.when ? () => optsRef.current.when?.() ?? true : undefined });
  }, [key, enabled]);
}

/** Push an Esc handler on the layer stack. Returns the pop function. Return false from the handler to pass Esc down. */
export function pushEscape(handler: () => boolean | void, layer: EscLayer = 'base'): () => void {
  install();
  const id = nextId++;
  escStack.push({ id, rank: LAYER_RANK[layer], handler });
  if (layer === 'dialog') modalDepth++;
  return () => {
    const i = escStack.findIndex((x) => x.id === id);
    if (i >= 0) { escStack.splice(i, 1); if (layer === 'dialog') modalDepth = Math.max(0, modalDepth - 1); }
  };
}

/** React binding for pushEscape while `active`. */
export function useEscape(handler: () => boolean | void, layer: EscLayer = 'base', active = true) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => (active ? pushEscape(() => ref.current(), layer) : undefined), [active, layer]);
}

/** Run the Esc stack once (also used by tests and by close buttons that want "Esc" semantics). */
export function runEscape(): boolean {
  const order = [...escStack].sort((a, b) => b.rank - a.rank || b.id - a.id);
  for (const h of order) { if (h.handler() !== false) return true; }
  return false;
}

/** True while a modal dialog is open. */
export function modalOpen(): boolean { return modalDepth > 0; }

/** Registered hotkeys with labels, for the shortcuts sheet. */
export function listHotkeys(): { combo: string; label: string; group: string }[] {
  const seen = new Set<string>();
  const out: { combo: string; label: string; group: string }[] = [];
  for (const e of entries) {
    if (!e.opts.label) continue;
    const k = `${e.text}|${e.opts.label}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ combo: e.text, label: e.opts.label, group: e.opts.group ?? 'General' });
  }
  return out;
}

/** Subscribe to registry changes (the shortcuts sheet re-reads listHotkeys()). */
export function onHotkeysChanged(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Human label for a combo: "mod+o" → "Ctrl+O" (or "⌘O" on Mac). */
export function formatCombo(text: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const c = parseCombo(text);
  const k = c.key === ' ' ? 'Space' : c.key === 'escape' ? 'Esc' : c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^arrow/, '').replace(/^\w/, (m) => m.toUpperCase());
  const mods = [c.mod ? (mac ? '⌘' : 'Ctrl') : '', c.ctrl ? 'Ctrl' : '', c.meta ? '⌘' : '', c.alt ? (mac ? '⌥' : 'Alt') : '', c.shift ? (mac ? '⇧' : 'Shift') : ''].filter(Boolean);
  return mac ? `${mods.join('')}${k}` : [...mods, k].join('+');
}
