// Stripe's request encoding: application/x-www-form-urlencoded with brackets for nesting, the
// way the official SDK writes it (`line_items[0][price]=price_1`, `expand[0]=subscription`,
// `metadata[family_id]=…`). Values stay strings; the fake coerces the ones it reads.

/** 'a[b][0][c]' → ['a', 'b', '0', 'c']; 'expand[]' → ['expand', '']. */
export function keyPath(key) {
  const out = [];
  const m = /^([^[\]]+)/.exec(key);
  if (!m) return null;
  out.push(m[1]);
  let rest = key.slice(m[1].length);
  while (rest.length) {
    const b = /^\[([^[\]]*)\]/.exec(rest);
    if (!b) return null;
    out.push(b[1]);
    rest = rest.slice(b[0].length);
  }
  return out;
}

function decode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Parse a form body or query string into nested objects and arrays. */
export function parseForm(text) {
  const root = {};
  if (!text) return root;
  for (const pair of String(text).split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = decode(i < 0 ? pair : pair.slice(0, i));
    const v = i < 0 ? '' : decode(pair.slice(i + 1));
    const path = keyPath(k);
    if (!path) continue;
    let node = root;
    for (let j = 0; j < path.length; j++) {
      const seg = path[j];
      const last = j === path.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(path[j + 1]);
      if (Array.isArray(node)) {
        const idx = seg === '' ? node.length : Number(seg);
        if (last) node[idx] = v;
        else {
          if (node[idx] === undefined || typeof node[idx] !== 'object') node[idx] = nextIsIndex ? [] : {};
          node = node[idx];
        }
      } else {
        if (last) node[seg] = v;
        else {
          if (node[seg] === undefined || typeof node[seg] !== 'object') node[seg] = nextIsIndex ? [] : {};
          node = node[seg];
        }
      }
    }
  }
  return compact(root);
}

// arrays written with gaps (only [3]) become dense, like Stripe reads them
function compact(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(compact);
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = compact(v[k]);
  }
  return v;
}

/** The way the SDK encodes (for tests of this module and for the control helpers). */
export function encodeForm(data) {
  const pairs = [];
  const enc = (key, value) => {
    if (value === undefined) return;
    if (value === null || typeof value !== 'object') {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value === null ? '' : String(value))}`);
      return;
    }
    if (Array.isArray(value)) value.forEach((x, i) => enc(`${key}[${i}]`, x));
    else for (const k of Object.keys(value)) enc(`${key}[${k}]`, value[k]);
  };
  for (const k of Object.keys(data || {})) enc(k, data[k]);
  return pairs.join('&');
}

export const asBool = (v) => v === true || v === 'true';
export const asInt = (v) => (v === undefined || v === null || v === '' ? null : /^-?\d+$/.test(String(v)) ? Number(v) : NaN);
