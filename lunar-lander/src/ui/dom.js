// Tiny DOM helpers for the UI (no framework).
//
//   h('div.card.big', {onclick, style: {...}, dataset: {...}, 'aria-label': '...'}, child, 'text', [more])
//
// Class names follow the tag after dots; attributes starting with "on" become listeners; `style`
// may be an object; `dataset` is merged; everything else is set as an attribute (true -> "").
// Children may be nodes, strings, numbers, arrays (flattened), or null/false (skipped).

export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** SVG element helper (same conventions as h, but in the SVG namespace). */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/**
 * A text slot that only touches the DOM when its value changes (the HUD refreshes at frame rate;
 * unchanged writes would still cost style/layout work).
 */
export function slot(el) {
  let last;
  return {
    el,
    set(text) {
      if (text !== last) {
        last = text;
        el.textContent = text;
      }
    },
  };
}

/** Toggle a class only when it changes. */
export function setClass(el, name, on) {
  on = !!on;
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/** Set an inline style property only when it changes. */
export function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
