// The Sparkle World Family page (/account) and the sign-in link page (/account/verify):
// docs/ACCOUNTS.md §9. Vanilla JavaScript, no libraries, only this site's own /api (fetch,
// JSON, X-SW: 1; never a form post). Every value from the API is put on the page as text
// (textContent), never as HTML. Stripe's pages are opened with location.assign(url).
//
// One page, many states; render() shows the first that applies (§9.2):
//   1 sign in (401)  ·  2 the notice (consent none)  ·  3 the plan (not entitled, no players)
//   4 back from Stripe (?checkout=cs_…)  ·  5 add the first player  ·  6 the dashboard
//   7 the email check (a small dialog before sensitive actions: check_required)
// plus: a kid device opened this page (403), the family was deleted (410), can't reach us.
//
// Copy rules (§9.3): plain words; the price and the renewal terms next to every button that
// starts a plan; cancelling is as easy as starting (the Portal); no box is ever pre-ticked;
// errors say what to do next. The kids' names are used instead of pronouns.

import { sanitizeName, isBlocked } from '/names.js';

const doc = document;
doc.documentElement.classList.remove('no-js');
doc.documentElement.classList.add('js');

const DAY = 24 * 3600 * 1000;
const MAX_PLAYERS = 6;
// players.color 0..7 (the picker in the game uses the same order)
const PLAYER_COLORS = ['#FF5FA2', '#3AAEF0', '#22BF95', '#9C7BFF', '#FF8C42', '#E0A800', '#E76BD8', '#14A3B8'];
const GATE_NOTE = 'Voices go live only to friends in this game, are never recorded, and stop when the button is let go.';
const NEXT_RE = /^\/(account|play)(\?[A-Za-z0-9=&%_-]{0,200})?$/;

// ------------------------------------------------------------------------------ the header

const top = doc.querySelector('.top');
if (top) {
  const onScroll = () => top.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ------------------------------------------------------------------------------ DOM helpers

/** h('p', { class, on: { click }, ...attributes }, ...children): text children are text nodes. */
function h(tag, props, ...kids) {
  const el = doc.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : doc.createTextNode(String(k)));
  }
}

const main = doc.getElementById('acct');
const sub = doc.getElementById('acct-sub');
let timers = [];

function clearTimers() {
  for (const t of timers) clearInterval(t);
  timers = [];
}

/** Show a state: its nodes in the page's column (wide for the dashboard). */
function mount(nodes, { wide = false, mid = false, subtitle = null } = {}) {
  clearTimers();
  if (subtitle && sub) sub.textContent = subtitle;
  const wrap = h('div', { class: 'acct-wrap' + (wide ? '' : mid ? ' acct-mid' : ' acct-narrow') }, nodes);
  main.replaceChildren(wrap);
  const first = wrap.querySelector('h2');
  if (first) {
    first.setAttribute('tabindex', '-1');
    if (mounted) first.focus({ preventScroll: true });
  }
  if (mounted) window.scrollTo(0, 0);
  mounted = true;
  return wrap;
}
let mounted = false;

const card = (...kids) => h('section', { class: 'acct-card' }, kids);
const row = (...kids) => h('div', { class: 'acct-row' }, kids);
const errBox = () => h('p', { class: 'acct-error', role: 'alert' });
const loadingRow = (text = 'One moment…') => h('div', { class: 'acct-loading' }, h('span', { class: 'acct-spin', 'aria-hidden': 'true' }), text);
const btn = (label, cls, onClick, attrs = {}) => h('button', { type: 'button', class: 'btn ' + cls, on: { click: onClick }, ...attrs }, label);
const linkBtn = (label, onClick, cls = '') => h('button', { type: 'button', class: 'acct-link ' + cls, on: { click: onClick } }, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function busy(b, on) {
  if (!b) return;
  b.disabled = !!on;
  b.setAttribute('aria-busy', on ? 'true' : 'false');
}

let toastTimer = 0;
function toast(text) {
  const t = doc.getElementById('acct-toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

// ------------------------------------------------------------------------------ the API

class ApiError extends Error {
  constructor(status, code, data = null) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** One call to this site's /api: JSON in and out; throws ApiError (status 0: no network). */
async function api(method, path, body, { raw = false } = {}) {
  const opts = { method, credentials: 'same-origin', cache: 'no-store', headers: { 'X-SW': '1', Accept: 'application/json' } };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.ok && raw) return res;
  let data = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || (res.status >= 500 ? 'unavailable' : 'bad_request'), data);
  return data;
}

/** What went wrong, in plain words, with what to do next (never an error code). */
function say(e) {
  const code = e && e.code;
  if (!e || e.status === 0) return "Couldn't reach Sparkle World. Check the internet connection, then try again.";
  if (code === 'rate') return 'That was a lot of tries in a short time. Wait a few minutes, then try again.';
  if (code === 'stripe_unavailable') return "Couldn't reach the payment page. Try again in a minute.";
  if (code === 'not_entitled') return 'That needs the Family Plan.';
  if (code === 'needs_verified') return 'That turns on after your first payment.';
  if (code === 'nickname_taken') return 'You already have a player with that nickname. Try another one.';
  if (code === 'nickname_blocked') return "Please pick a different nickname: other players couldn't see that one.";
  if (code === 'limit') return 'That is the most there can be for now.';
  if (code === 'us_only') return 'For now the Family Plan is only for families in the United States.';
  if (code === 'already_subscribed') return 'Your family already has a Family Plan.';
  if (code === 'bad_email') return 'Please check the email address.';
  if (code === 'expired') return 'That has expired. Please start again.';
  if (code === 'signed_out') return 'You were signed out. Please sign in again.';
  if (code === 'check_required') return 'That needs a quick email check first.';
  if (e.status >= 500) return 'Something went wrong on our side. Please try again in a minute.';
  return "That didn't work. Please try again.";
}

// ------------------------------------------------------------------------------ formatting

function ms(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** "Nov 5" (this year) or "Nov 5, 2027". */
function date(v) {
  const t = ms(v);
  if (t === null) return '…';
  const d = new Date(t);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** b•••@gmail.com */
function mask(email) {
  const m = /^(.)[^@]*(@.*)$/.exec(String(email || ''));
  return m ? m[1] + '•••' + m[2] : 'your email';
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const today = () => new Date().toISOString().slice(0, 10);

/** "$5.99" from "$5.99 a month, plus sales tax where it applies". */
function amountOf(priceText) {
  const m = /\$\s?\d+(\.\d\d)?/.exec(priceText || '');
  return m ? m[0].replace(/\s/g, '') : '$5.99';
}

function standalone() {
  return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// ------------------------------------------------------------------------------ the state

const S = {
  fam: null,
  devices: null,
  audit: null,
  email: '',
  params: new URLSearchParams(location.search),
  skipPlan: false,
  elevatedUntil: null, // the email check is good until (ms)
};
const nextParam = S.params.get('next');
S.next = nextParam && NEXT_RE.test(nextParam) ? nextParam : null;

function cleanUrl() {
  const keep = S.next ? '?next=' + encodeURIComponent(S.next) : '';
  history.replaceState(null, '', '/account' + keep);
  S.params = new URLSearchParams(keep);
}

async function load() {
  S.fam = await api('GET', '/api/family');
  S.elevatedUntil = ms(S.fam.elevatedUntil);
  return S.fam;
}

/**
 * Who is here (GET /api/me answers everyone, so a signed-out visit makes no failed request),
 * then the family (grown-ups only) and the right state.
 */
async function boot() {
  let me = null;
  try {
    me = await api('GET', '/api/me');
  } catch (e) {
    if (e.code === 'family_gone') return familyGone();
    if (e.status === 401) return signIn({ note: 'You were signed out. Please sign in again.' });
    return trouble(e, boot);
  }
  if (!me || !me.signedIn) return signIn();
  if (me.kind !== 'parent') return kidDeviceHere();
  try {
    await load();
  } catch (e) {
    if (e.status === 401) return signIn();
    if (e.status === 403) return kidDeviceHere();
    if (e.code === 'family_gone') return familyGone();
    return trouble(e, boot);
  }
  render();
}

async function refresh() {
  try {
    await load();
  } catch (e) {
    if (e.status === 401) return signIn({ note: 'You were signed out. Please sign in again.' });
    if (e.code === 'family_gone') return familyGone();
    return trouble(e, boot);
  }
  render();
}

function render() {
  const f = S.fam;
  const checkout = S.params.get('checkout');
  if (!f.consent || f.consent.level === 'none') return noticeView();
  if (checkout && /^cs_[A-Za-z0-9_]+$/.test(checkout)) return backFromStripe(checkout);
  if (S.params.get('portal')) return backFromPortal();
  if (!f.plan.entitled && f.players.length === 0 && !S.skipPlan) return planView({ cancelled: checkout === 'cancel' });
  if (checkout) cleanUrl();
  if (f.players.length === 0 && (f.plan.entitled || f.config.friendsMode === 'free-join')) return addFirstView();
  return dashboard();
}

function trouble(e, retry) {
  mount(card(
    h('h2', null, "We couldn't open the Family page"),
    h('p', { class: 'acct-lead' }, say(e)),
    row(btn('Try again', 'btn-play', () => {
      mount(loadingRow());
      retry();
    }), h('a', { class: 'btn btn-soft', href: '/play' }, 'Play now')),
  ));
}

// ------------------------------------------------------------------------------ 1. sign in

function signIn({ note = null } = {}) {
  const err = errBox();
  const input = h('input', { class: 'acct-input', type: 'email', id: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', placeholder: 'you@example.com', value: S.email, required: true });
  const send = h('button', { type: 'submit', class: 'btn btn-play' }, 'Send me a code');
  const form = h('form', { novalidate: true, on: { submit: async (ev) => {
    ev.preventDefault();
    const email = input.value.trim();
    err.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      err.textContent = 'Please check the email address. It looks like name@example.com.';
      input.focus();
      return;
    }
    busy(send, true);
    try {
      await api('POST', '/api/auth/start', { email, ...(S.next ? { next: S.next } : {}) });
      S.email = email;
      codeView();
    } catch (e) {
      err.textContent = say(e);
      busy(send, false);
    }
  } } },
  h('label', { class: 'acct-label', for: 'email' }, 'Your email'),
  input,
  err,
  row(send));
  mount(card(
    h('h2', null, 'Grown-ups: sign in or start the Family Plan'),
    note && h('p', { class: 'acct-note acct-note--sun' }, note),
    S.next && S.next.startsWith('/play') && h('p', { class: 'acct-note' }, "After you sign in, we'll take you back to the game."),
    h('p', { class: 'acct-lead' }, "Type your email and we'll send you a 6-digit code. Signing in and starting are the same: there are no passwords."),
    form,
    h('p', { class: 'acct-small' }, 'Kids never need an email. You set up the devices they play on.'),
  ), { subtitle: 'Sign in with your email. There are no passwords to remember.' });
  if (!('ontouchstart' in window)) input.focus({ preventScroll: true });
}

/** Six boxes over one input (so paste and the phone's one-time-code autofill both work). */
function codeBoxes(onDone) {
  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '6', name: 'code', id: 'code', 'aria-label': 'The 6-digit code from the email', enterkeyhint: 'go' });
  const boxes = Array.from({ length: 6 }, () => h('span', { class: 'box', 'aria-hidden': 'true' }));
  const el = h('div', { class: 'code-boxes' }, boxes, input);
  const paint = () => {
    const v = input.value;
    const on = doc.activeElement === input;
    boxes.forEach((b, i) => {
      b.textContent = v[i] || '';
      b.classList.toggle('is-full', i < v.length);
      b.classList.toggle('is-on', on && i === Math.min(v.length, 5));
    });
  };
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 6);
    if (d !== input.value) input.value = d;
    el.classList.remove('is-bad');
    paint();
    if (d.length === 6) onDone(d);
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && input.value.length === 6) onDone(input.value);
  });
  paint();
  return {
    el,
    input,
    get value() {
      return input.value;
    },
    bad() {
      el.classList.remove('is-bad');
      void el.offsetWidth;
      el.classList.add('is-bad');
      input.value = '';
      paint();
      input.focus();
    },
    focus() {
      input.focus({ preventScroll: true });
    },
  };
}

/** A "send again" link that waits 30 s. */
function resendLink(onResend) {
  const b = linkBtn('Send it again', async () => {
    busy(b, true);
    await onResend();
    wait();
  });
  let left = 0;
  const wait = () => {
    left = 30;
    b.disabled = true;
    b.textContent = `Send it again (in ${left} s)`;
    const t = setInterval(() => {
      left--;
      if (left > 0) b.textContent = `Send it again (in ${left} s)`;
      else {
        clearInterval(t);
        b.disabled = false;
        b.removeAttribute('aria-busy');
        b.textContent = 'Send it again';
      }
    }, 1000);
    timers.push(t);
  };
  b.wait = wait;
  return b;
}

function codeView() {
  const err = errBox();
  let sending = false;
  const go = h('button', { type: 'button', class: 'btn btn-play' }, 'Sign in');
  const submit = async (code) => {
    if (sending) return;
    if (!/^\d{6}$/.test(code)) {
      err.textContent = 'The code has 6 numbers.';
      boxes.focus();
      return;
    }
    sending = true;
    busy(go, true);
    err.textContent = '';
    try {
      const r = await api('POST', '/api/auth/verify', { code });
      const next = r && typeof r.next === 'string' && NEXT_RE.test(r.next) ? r.next : '/account';
      if (next.startsWith('/play')) {
        location.assign(next);
        return;
      }
      history.replaceState(null, '', next);
      S.params = new URLSearchParams(location.search);
      mount(loadingRow('Signing in…'));
      boot();
    } catch (e) {
      sending = false;
      busy(go, false);
      if (e.code === 'bad_code') {
        const left = e.data && Number.isFinite(e.data.triesLeft) ? e.data.triesLeft : null;
        err.textContent = "That code didn't match. Check the newest email from Sparkle World." + (left !== null ? ` (${plural(left, 'try', 'tries')} left)` : '');
        boxes.bad();
      } else if (e.code === 'expired') {
        err.textContent = 'That code has expired, or was used already. We can send you a new one.';
        boxes.bad();
      } else err.textContent = say(e);
    }
  };
  const boxes = codeBoxes(submit);
  go.addEventListener('click', () => submit(boxes.value));
  const again = resendLink(async () => {
    err.textContent = '';
    try {
      await api('POST', '/api/auth/start', { email: S.email, ...(S.next ? { next: S.next } : {}) });
      toast('We sent a new code.');
    } catch (e) {
      err.textContent = say(e);
    }
  });
  mount(card(
    h('h2', null, 'Check your email'),
    h('p', { class: 'acct-lead' }, 'We sent a 6-digit code to ', h('strong', null, mask(S.email)), '. Type it here. It works for 15 minutes.'),
    h('label', { class: 'acct-label', for: 'code' }, 'The code'),
    boxes.el,
    err,
    row(go),
    h('p', { class: 'acct-small' }, "You can also tap the link in the email. Didn't get it? Look in the spam folder, or send it again."),
    row(again, linkBtn('Use a different email', () => signIn())),
    h('p', { class: 'acct-small' }, 'Kids never need an email.'),
  ), { subtitle: 'Almost there: the code is in your email.' });
  again.wait();
  boxes.focus();
}

// ------------------------------------------------------------------------------ the sign-in link page

async function verifyPage() {
  const m = /[#&]t=([A-Za-z0-9_-]{16,256})/.exec(location.hash);
  const token = m ? m[1] : null;
  // the token leaves the address bar (and the history) at once
  history.replaceState(null, '', location.pathname);
  if (!token) {
    mount(card(
      h('h2', null, 'This sign-in link is not complete'),
      h('p', { class: 'acct-lead' }, 'Open the link from the email again, or type the 6-digit code from the email on the Family page.'),
      row(h('a', { class: 'btn btn-play', href: '/account' }, 'Go to the Family page')),
    ));
    return;
  }
  const err = errBox();
  const go = btn('Sign in', 'btn-play', async () => {
    busy(go, true);
    err.textContent = '';
    try {
      const r = await api('POST', '/api/auth/verify', { token });
      const next = r && typeof r.next === 'string' && NEXT_RE.test(r.next) ? r.next : '/account';
      location.replace(next);
    } catch (e) {
      busy(go, false);
      if (e.code === 'expired' || e.code === 'bad_code') {
        mount(card(
          h('h2', null, 'This link has run out'),
          h('p', { class: 'acct-lead' }, 'Sign-in links work once, for 15 minutes. Get a new code on the Family page: it takes a moment.'),
          row(h('a', { class: 'btn btn-play', href: '/account' }, 'Get a new code')),
        ));
      } else err.textContent = say(e);
    }
  });
  mount(card(
    h('h2', null, 'Sign in to Sparkle World?'),
    h('p', { class: 'acct-lead' }, 'Tap the button to finish signing in on this device.'),
    err,
    row(go, h('a', { class: 'btn btn-soft', href: '/' }, 'Not now')),
    h('p', { class: 'acct-small' }, "Didn't ask to sign in? Then you can close this page: nothing happens without the button."),
  ));
}

// ------------------------------------------------------------------------------ not for this page

function kidDeviceHere() {
  mount(card(
    h('h2', null, 'This device is set up for the kids'),
    h('p', { class: 'acct-lead' }, 'It is signed in for playing, not for the Family page. To manage the Family Plan, sign in on your own phone or computer.'),
    row(h('a', { class: 'btn btn-play', href: '/play' }, 'Play now'), linkBtn('Sign this device out', () => {
      const d = dialog([
        h('h2', null, 'Sign this device out?'),
        h('p', null, 'The kids will need a new code (or your sign-in) to play here with their worlds again.'),
        row(btn('Sign it out', 'btn-danger', async (ev) => {
          busy(ev.currentTarget, true);
          try {
            await api('POST', '/api/auth/logout', {});
          } catch {}
          d.close();
          signIn({ note: 'This device is signed out.' });
        }), linkBtn('Cancel', () => d.close())),
      ]);
    })),
  ), { subtitle: 'This device plays Sparkle World.' });
}

function familyGone(text = "Your family's account was deleted. Everything was removed from our server; backups roll off within 7 days.") {
  mount(card(
    h('h2', null, 'Your account is deleted'),
    h('p', { class: 'acct-lead' }, text),
    row(btn('Sign in or start again', 'btn-soft', () => signIn()), h('a', { class: 'btn btn-soft', href: '/' }, 'Home page')),
  ), { subtitle: 'Thank you for playing Sparkle World.' });
}

// ------------------------------------------------------------------------------ 2. the notice

async function noticeView() {
  mount(loadingRow());
  let n;
  try {
    n = await api('GET', '/api/notice');
  } catch (e) {
    return trouble(e, noticeView);
  }
  const err = errBox();
  const box = h('input', { type: 'checkbox', id: 'agree' });
  const go = h('button', { type: 'button', class: 'btn btn-play', disabled: true }, 'Agree and continue');
  box.addEventListener('change', () => {
    go.disabled = !box.checked;
  });
  go.addEventListener('click', async () => {
    if (!box.checked) return;
    busy(go, true);
    try {
      await api('POST', '/api/consent', { noticeVersion: n.version, agree: true });
      await refresh();
    } catch (e) {
      busy(go, false);
      err.textContent = say(e);
    }
  });
  const sections = Array.isArray(n.sections) ? n.sections : [];
  mount(card(
    h('h2', null, 'Before your children play: what Sparkle World keeps, and why.'),
    h('span', { class: 'notice-ver' }, `Notice version ${n.version}`),
    h('ul', { class: 'notice-list' }, sections.map((s) => h('li', null, s.title ? h('strong', null, s.title) : null, s.title ? ' ' : null, s.text || ''))),
    h('p', null, h('a', { href: '/privacy' }, 'Read the full Privacy Notice'), ' · ', h('a', { href: '/terms' }, 'Terms')),
    h('label', { class: 'acct-check', for: 'agree' }, box, h('span', null, n.checkbox || "I'm the parent or legal guardian of the children who will play, I'm 18 or older, and I agree.")),
    err,
    row(go),
    h('p', { class: 'acct-small' }, 'Playing with friends and the walkie-talkie stay off until you switch them on for each child.'),
  ), { subtitle: 'First, a short note about your children’s information.' });
}

// ------------------------------------------------------------------------------ 3. the plan

function planView({ cancelled = false } = {}) {
  const f = S.fam;
  const cfg = f.config || {};
  const priceText = cfg.priceText || '$5.99 a month, plus sales tax where it applies';
  const amount = amountOf(priceText);
  const pm = /^(\$\s?[\d.]+)\s*(.*)$/.exec(priceText);
  const trial = cfg.trialDays > 0 && f.plan.state === 'none';
  const week = cfg.trialDays === 7 ? 'free week' : `free ${plural(cfg.trialDays, 'day')}`;
  const err = errBox();
  const us = h('input', { type: 'checkbox', id: 'us' });
  const start = async (ev, withTrial) => {
    err.textContent = '';
    if (!us.checked) {
      err.textContent = 'Please tick the box if you live in the United States. For now the Family Plan is only for families in the US.';
      us.focus();
      return;
    }
    const b = ev.currentTarget;
    busy(b, true);
    try {
      const r = await api('POST', '/api/billing/checkout', { trial: withTrial, usResident: true });
      location.assign(r.url);
    } catch (e) {
      busy(b, false);
      if (e.code === 'already_subscribed') return refresh();
      if (e.code === 'consent_required') return refresh();
      err.textContent = say(e);
    }
  };
  const choices = trial
    ? h('div', { class: 'plan-choices plan-choices--two' },
      h('div', { class: 'plan-choice' },
        btn(`Start your ${week}`, 'btn-play', (ev) => start(ev, true)),
        h('p', null, `Free for ${plural(cfg.trialDays, 'day')}, then ${amount}/month. It renews every month until you cancel. Cancel any time here, with Manage subscription.`)),
      h('div', { class: 'plan-choice' },
        btn('Start today', 'btn-soft', (ev) => start(ev, false)),
        h('p', null, `${amount} today, then every month until you cancel. Pay now and playing with friends and the walkie-talkie can be turned on today. The first payment is how we confirm that a grown-up said yes.`)))
    : h('div', { class: 'plan-choices' },
      h('div', { class: 'plan-choice' },
        btn('Start the Family Plan', 'btn-play', (ev) => start(ev, false)),
        h('p', null, `${priceText}. The first payment is today, then it renews every month until you cancel. Cancel any time here, with Manage subscription. That first payment is also how we confirm that a grown-up said yes, so playing with friends and the walkie-talkie can be turned on right away.`)));
  mount(card(
    h('h2', null, 'Sparkle World Family Plan'),
    cancelled && h('p', { class: 'acct-note acct-note--sun' }, 'No payment was made. You can start whenever you like.'),
    f.plan.state === 'lapsed' && h('p', { class: 'acct-note' }, "Welcome back! Your family's plan has ended. Restart it and everything is there again."),
    h('div', { class: 'plan-card' },
      h('div', null,
        h('p', { class: 'price' }, h('b', null, pm ? pm[1] : amount), h('span', null, pm ? pm[2] : 'a month')),
        h('ul', { class: 'plan-list' },
          h('li', null, 'Up to 6 kids, each with her own player'),
          h('li', null, 'Their worlds saved on every device, and kept safe if a browser clears them'),
          h('li', null, 'Playing with friends whose families have the plan too'),
          h('li', null, 'The walkie-talkie, only if you turn it on'),
          h('li', null, 'Nothing to buy inside the game, ever'))),
      h('div', null,
        h('label', { class: 'acct-check', for: 'us' }, us, h('span', null, 'I live in the United States')),
        h('div', { style: 'height:14px' }),
        choices,
        err)),
    h('p', { class: 'acct-small' }, "Payment happens on Stripe's secure page. We never see your card number. Receipts come from Stripe by email."),
    standalone() && h('p', { class: 'acct-note' }, h('strong', null, 'Tip: '), `you opened this from the Home Screen. Paying works best in Safari: open ${location.host}/account there.`),
    cfg.friendsMode === 'free-join' && f.players.length === 0 && row(linkBtn('Not now', () => {
      S.skipPlan = true;
      render();
    })),
    row(linkBtn('Sign out', signOut)),
  ), { mid: true, subtitle: 'One plan for the whole family. Nothing to buy inside the game, ever.' });
}

// ------------------------------------------------------------------------------ 4. back from Stripe

async function backFromStripe(sessionId) {
  mount(card(h('h2', null, 'Setting up your Family Plan…'), loadingRow('Checking with Stripe…')), { subtitle: 'Just a moment.' });
  let plan = null;
  let lastErr = null;
  for (let k = 0; k < 5; k++) {
    try {
      plan = (await api('POST', '/api/billing/sync', { sessionId })).plan;
      lastErr = null;
      if (plan && plan.entitled) break;
    } catch (e) {
      lastErr = e;
      if (e.status === 401) return signIn({ note: 'Please sign in again to finish setting up.' });
    }
    await sleep(1500);
  }
  cleanUrl();
  try {
    await load();
  } catch {}
  if (plan && plan.entitled) return allSet(plan);
  mount(card(
    h('h2', null, "We're still waiting to hear from Stripe"),
    h('p', { class: 'acct-lead' }, lastErr ? say(lastErr) : "Stripe's page said you're done, but the payment hasn't reached us yet. It usually takes a few seconds."),
    row(btn('Check again', 'btn-play', () => backFromStripe(sessionId)), linkBtn('Go to the Family page', () => render())),
  ));
}

async function backFromPortal() {
  mount(loadingRow('Checking your plan…'));
  try {
    await api('POST', '/api/billing/sync', {});
  } catch {}
  cleanUrl();
  await refresh();
}

function allSet(plan) {
  const f = S.fam;
  const amount = amountOf(f.config && f.config.priceText);
  const colors = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF8C42'];
  const bits = Array.from({ length: 36 }, (_, i) => h('i', { style: `--c:${colors[i % colors.length]};--x:${(i * 37) % 100}%;--d:${(i % 9) * 0.07}s;--dx:${((i * 53) % 120) - 60}px;--r:${(i * 97) % 540}deg` }));
  const players = f && f.players && f.players.length;
  mount(h('section', { class: 'acct-card all-set' },
    h('div', { class: 'confetti', 'aria-hidden': 'true' }, bits),
    h('h2', null, "You're all set!"),
    h('p', { class: 'acct-lead' }, plan.state === 'trialing'
      ? `Your free trial has started. The first ${amount} payment is on ${date(plan.trialEnd)}, unless you cancel before then.`
      : 'Thank you! The Family Plan is on. You can turn on playing with friends and the walkie-talkie for each child.'),
    row(players ? btn('Go to your Family page', 'btn-play', () => render()) : btn('Add your first player', 'btn-play', () => addFirstView())),
  ), { subtitle: 'Welcome to the Family Plan!' });
}

// ------------------------------------------------------------------------------ 5. players

function bubble(p, big = false) {
  const color = PLAYER_COLORS[(p && Number.isInteger(p.color) ? p.color : 0) % PLAYER_COLORS.length];
  const b = h('span', { class: 'bubble' + (big ? ' bubble--big' : ''), style: `--c:${color}`, 'aria-hidden': 'true' });
  if (p && typeof p.portrait === 'string' && p.portrait.startsWith('/api/')) {
    const img = h('img', { src: p.portrait, alt: '', width: big ? 88 : 64, height: big ? 88 : 64 });
    img.addEventListener('error', () => img.replaceWith(doc.createTextNode(initial(p.nickname))));
    b.append(img);
  } else b.textContent = initial(p && p.nickname);
  return b;
}

function initial(name) {
  const c = String(name || '?').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/** The nickname form (add a player, or rename one). */
function playerForm({ player = null, first = false, onDone, onCancel = null }) {
  const err = errBox();
  const input = h('input', { class: 'acct-input', id: 'nick', name: 'nickname', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', maxlength: '24', placeholder: 'Star Bunny', value: player ? player.nickname : '' });
  let color = player && Number.isInteger(player.color) ? player.color : (S.fam ? S.fam.players.length : 0) % PLAYER_COLORS.length;
  const shown = h('strong', null, '');
  const note = h('p', { class: 'acct-hint' });
  const prev = h('div', { class: 'preview' });
  const paint = () => {
    const raw = input.value;
    const clean = isBlocked(raw) ? '' : sanitizeName(raw, '');
    shown.textContent = clean || '…';
    note.textContent = raw.trim() && !clean ? 'Please pick a different nickname: other players could not see that one.' : clean && clean !== raw.trim() ? 'Only letters and spaces, up to 12, so this is how it will look.' : '';
    prev.replaceChildren(bubble({ nickname: clean || raw, color }), h('p', null, 'Other players will see: ', shown));
  };
  input.addEventListener('input', paint);
  const swatches = h('fieldset', { class: 'swatches' }, h('legend', null, 'A color'), PLAYER_COLORS.map((c, i) => {
    const r = h('input', { type: 'radio', name: 'color', value: String(i), checked: i === color, 'aria-label': `Color ${i + 1}` });
    r.addEventListener('change', () => {
      color = i;
      paint();
    });
    return h('label', { class: 'swatch' }, r, h('span', { style: `--c:${c}` }));
  }));
  const save = h('button', { type: 'submit', class: 'btn btn-play' }, player ? 'Save' : 'Add');
  const form = h('form', { novalidate: true, on: { submit: async (ev) => {
    ev.preventDefault();
    const raw = input.value.trim();
    const clean = isBlocked(raw) ? '' : sanitizeName(raw, '');
    err.textContent = '';
    if (!raw) {
      err.textContent = 'Please type a nickname.';
      input.focus();
      return;
    }
    if (!clean) {
      err.textContent = 'Please pick a different nickname: other players could not see that one.';
      input.focus();
      return;
    }
    busy(save, true);
    try {
      const body = { nickname: clean, color };
      const p = player ? await api('PATCH', `/api/players/${encodeURIComponent(player.id)}`, body) : await api('POST', '/api/players', body);
      onDone(p);
    } catch (e) {
      busy(save, false);
      if (e.code === 'limit') err.textContent = `A family can have up to ${MAX_PLAYERS} players.`;
      else if (e.code === 'not_entitled') err.textContent = 'Adding players needs the Family Plan.';
      else if (e.code === 'consent_required') return refresh();
      else err.textContent = say(e);
    }
  } } },
  h('label', { class: 'acct-label', for: 'nick' }, 'Nickname'),
  input,
  h('p', { class: 'acct-hint' }, 'A nickname, not her real name. Letters only, up to 12.'),
  note,
  swatches,
  prev,
  err,
  row(save, onCancel && linkBtn('Cancel', onCancel)));
  paint();
  if (first) setTimeout(() => input.focus({ preventScroll: true }), 50);
  return form;
}

function addFirstView() {
  mount(card(
    h('h2', null, 'Add your first player'),
    h('p', { class: 'acct-lead' }, `Each child gets her own player, with her own worlds and stickers. You can add up to ${MAX_PLAYERS}.`),
    playerForm({ first: true, onDone: async (p) => {
      toast(`${p.nickname} is ready to play!`);
      await refresh();
    } }),
  ), { subtitle: 'Nearly done: who plays?' });
}

// ------------------------------------------------------------------------------ 6. the dashboard

function dashboard() {
  const f = S.fam;
  const wrap = mount([
    h('div', { class: 'dash' },
      h('div', { class: 'dash-head' },
        h('h2', null, 'Your family'),
        h('p', null, 'Signed in as ', f.email)),
      S.next && S.next.startsWith('/play') && h('p', { class: 'acct-note' }, 'Ready to play? ', h('a', { href: S.next }, 'Back to the game')),
      ribbon(f),
      playersSection(f),
      h('div', { class: 'dash-cols' }, devicesSection(f), privacySection(f)),
      h('div', { class: 'dash-foot' },
        h('a', { class: 'btn btn-play', href: '/play' }, 'Play now'),
        h('div', { class: 'acct-row' }, btn('Sign out', 'btn-soft btn-small', signOut), linkBtn('Sign out everywhere', signOutEverywhere)))),
  ], { wide: true, subtitle: "Everything about your family's Sparkle World, in one place." });
  loadDevices();
  loadHistory();
  return wrap;
}

function ribbon(f) {
  const p = f.plan;
  const cfg = f.config || {};
  const month = `${amountOf(cfg.priceText)}/month`;
  let text;
  let cls = '';
  const acts = [];
  const portal = (label) => btn(label, 'btn-soft btn-small', openPortal);
  switch (p.state) {
    case 'trialing': {
      const days = Math.max(0, Math.round(((ms(p.trialEnd) ?? Date.now()) - Date.now()) / DAY));
      const word = cfg.trialDays === 7 ? 'Free week' : 'Free trial';
      text = `${word}: ${days === 0 ? 'ends today' : plural(days, 'day') + ' left'}, then ${month}.`;
      cls = 'ribbon--trial';
      acts.push(portal('Manage subscription'), btn('Start now', 'btn-play btn-small', startNow));
      break;
    }
    case 'active':
      text = `Family Plan: renews ${date(p.periodEnd)}.`;
      acts.push(portal('Manage subscription'));
      break;
    case 'past_due':
      text = `Payment didn't go through. Playing continues until ${date(p.graceUntil ?? p.until)}.`;
      cls = 'ribbon--warn';
      acts.push(portal('Update card'));
      break;
    case 'canceling':
      text = `Family Plan: ends ${date(p.periodEnd ?? p.until)}. Nothing more will be charged.`;
      cls = 'ribbon--end';
      acts.push(portal('Resume'));
      break;
    case 'lapsed':
      text = ms(f.purgeAfter) ? `Resting: the kids' worlds are kept until ${date(f.purgeAfter)}.` : "Resting: the kids' worlds are kept for a while after a plan ends.";
      cls = 'ribbon--rest';
      acts.push(btn('Restart the plan', 'btn-play btn-small', () => planView()), btn('Download worlds', 'btn-soft btn-small', downloadEverything));
      break;
    case 'comp':
      text = `Free pass until ${date(p.until)}.`;
      cls = 'ribbon--comp';
      break;
    default:
      text = 'No Family Plan yet.';
      cls = 'ribbon--rest';
      acts.push(btn('Start the Family Plan', 'btn-play btn-small', () => planView()));
  }
  return h('div', { class: 'ribbon ' + cls, id: 'plan', role: 'status' }, h('span', { class: 'pip', 'aria-hidden': 'true' }), h('p', null, text), acts.length ? h('div', { class: 'ribbon-acts' }, acts) : null);
}

async function openPortal(ev) {
  const b = ev && ev.currentTarget;
  busy(b, true);
  try {
    const r = await withCheck(() => api('POST', '/api/billing/portal', {}));
    if (r && r.url) {
      location.assign(r.url);
      return;
    }
  } catch (e) {
    toast(say(e));
  }
  busy(b, false);
}

function startNow() {
  const f = S.fam;
  const amount = amountOf(f.config && f.config.priceText);
  const err = errBox();
  const d = dialog([
    h('h2', null, 'Start paying now?'),
    h('p', null, `Your free trial ends today and the first ${amount} payment is made now. It then renews every month until you cancel.`),
    h('p', null, 'The first payment is how we confirm that a grown-up said yes, so you can turn on playing with friends and the walkie-talkie right after.'),
    err,
    row(btn('Start now', 'btn-play', async (ev) => {
      const b = ev.currentTarget;
      busy(b, true);
      try {
        const r = await withCheck(() => api('POST', '/api/billing/start-now', {}));
        if (r) {
          d.close();
          toast('Done! Playing with friends can be turned on now.');
          await refresh();
          return;
        }
      } catch (e) {
        err.textContent = say(e);
      }
      busy(b, false);
    }), linkBtn('Not now', () => d.close())),
  ]);
}

function playersSection(f) {
  const n = f.players.length;
  const canAdd = n < MAX_PLAYERS && (f.plan.entitled || f.config.friendsMode === 'free-join');
  return card(
    h('div', { class: 'sec-head' }, h('h2', null, 'Players', h('span', { class: 'count' }, `${n} of ${MAX_PLAYERS}`))),
    n === 0 && h('p', null, 'No players yet.'),
    h('div', { class: 'players' },
      f.players.map((p) => playerCard(p, f)),
      canAdd && h('button', { type: 'button', class: 'player-add', on: { click: addPlayerDialog } }, '+ Add player')),
  );
}

function addPlayerDialog() {
  const d = dialog([
    h('h2', null, 'Add a player'),
    playerForm({ first: true, onCancel: () => d.close(), onDone: async (p) => {
      d.close();
      toast(`${p.nickname} is ready to play!`);
      await refresh();
    } }),
  ]);
}

function playerCard(p, f) {
  const plan = f.plan;
  const nick = p.nickname;
  const bits = [`Added ${date(p.createdAt)}`];
  if (Number.isFinite(p.worlds)) bits.push(plural(p.worlds, 'world'));
  if (p.lastPlayed) bits.push(`played ${date(p.lastPlayed)}`);
  const trialing = plan.state === 'trialing';
  const lockedWhy = () => {
    if (!plan.entitled && f.config.friendsMode !== 'free-join') return ['Needs the Family Plan.'];
    if (!plan.friendsConsentOk) {
      if (plan.state === 'comp') return [`Turns on once we have your signed consent form. Write to ${f.config.operatorEmail || 'us'}.`];
      return ['Turns on after your first payment. ', trialing && linkBtn('Start now', startNow)];
    }
    return null;
  };
  const friendsWhy = lockedWhy();
  let walkieWhy = null;
  if (friendsWhy) walkieWhy = lockedWhy(); // its own nodes (a node lives in one place only)
  else if (!plan.walkieConsentOk) walkieWhy = ['Turns on after your first payment. ', trialing && linkBtn('Start now', startNow)];
  else if (!p.friends) walkieWhy = ['Turn on Play with friends first.'];
  const el = h('article', { class: 'player', 'data-player': p.id },
    h('div', { class: 'player-top' },
      bubble(p),
      h('div', { class: 'who' }, h('h3', null, nick), h('p', null, bits.join(' · '))),
      linkBtn('Rename', () => renameDialog(p))),
    toggle({
      label: 'Play with friends', on: !!p.friends, locked: friendsWhy && !p.friends ? friendsWhy : null,
      text: `Other players in a game ${nick} joins or hosts see ${nick}'s nickname, avatar and world. Only friends the host lets in, whose families have Sparkle World too. No typing, only 16 friendly phrases.`,
      change: (on) => setSwitch(p, { friends: on }),
    }),
    toggle({
      label: 'Walkie-talkie', on: !!p.walkie, locked: walkieWhy && !p.walkie ? walkieWhy : null,
      text: GATE_NOTE,
      change: (on) => setSwitch(p, { walkie: on }),
    }),
    h('div', { class: 'player-acts' },
      linkBtn(`See ${nick}'s data`, () => summaryDialog(p)),
      linkBtn(`Download ${nick}'s worlds`, () => downloadPlayer(p)),
      linkBtn(`Delete ${nick}`, () => deletePlayerDialog(p), 'acct-link--danger')));
  return el;
}

function toggle({ label, on, text, locked, change }) {
  const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: !!locked }, h('span', { class: 'switch-label' }, label));
  sw.addEventListener('click', async () => {
    const want = sw.getAttribute('aria-checked') !== 'true';
    sw.classList.add('is-busy');
    sw.disabled = true;
    const ok = await change(want);
    sw.classList.remove('is-busy');
    sw.disabled = false;
    if (ok) sw.setAttribute('aria-checked', want ? 'true' : 'false');
  });
  return h('div', { class: 'toggle' },
    h('div', { class: 'toggle-row' }, h('b', null, label), sw),
    h('p', null, text),
    locked && h('p', { class: 'why' }, locked));
}

async function setSwitch(p, body) {
  const on = Object.values(body)[0];
  try {
    // turning something ON needs the email check; turning it off never does
    const patch = () => api('PATCH', `/api/players/${encodeURIComponent(p.id)}`, body);
    const r = on ? await withCheck(patch) : await patch();
    if (!r) return false;
    const which = 'friends' in body ? 'Play with friends' : 'The walkie-talkie';
    toast(`${which} is ${on ? 'on' : 'off'} for ${p.nickname}.`);
    await refresh();
    return true;
  } catch (e) {
    if (e.code === 'player_gone') {
      await refresh();
      return false;
    }
    toast(say(e));
    return false;
  }
}

function renameDialog(p) {
  const d = dialog([
    h('h2', null, `Change ${p.nickname}'s nickname or color`),
    playerForm({ player: p, first: true, onCancel: () => d.close(), onDone: async (np) => {
      d.close();
      toast(`Saved: ${np.nickname}.`);
      await refresh();
    } }),
  ]);
}

async function summaryDialog(p) {
  const body = h('div', null, loadingRow());
  const d = dialog([h('h2', null, `${p.nickname}'s data`), body], { wide: true });
  let s;
  try {
    s = await api('GET', `/api/players/${encodeURIComponent(p.id)}/summary`);
  } catch (e) {
    body.replaceChildren(h('p', { class: 'acct-error' }, say(e)));
    return;
  }
  const prof = s.profile || {};
  const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : Number.isFinite(v) ? v : 0);
  const worlds = Array.isArray(s.worlds) ? s.worlds : [];
  const stats = prof.stats && typeof prof.stats === 'object' ? Object.entries(prof.stats).filter(([, v]) => Number.isFinite(v)) : [];
  const nice = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const kb = (n) => (Number.isFinite(n) ? (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');
  body.replaceChildren(
    h('p', null, `This is everything Sparkle World keeps for ${s.nickname || p.nickname}: the nickname, the avatar and its picture, game progress, and worlds.`),
    h('div', { class: 'facts-grid' },
      h('div', null, h('b', null, String(worlds.length)), h('span', null, 'worlds')),
      h('div', null, h('b', null, String(count(prof.stickers))), h('span', null, 'stickers')),
      h('div', null, h('b', null, String(Number.isFinite(prof.coins) ? prof.coins : 0)), h('span', null, 'Sparkle Coins')),
      h('div', null, h('b', null, date(s.createdAt)), h('span', null, 'added'))),
    h('p', null, `Play with friends: ${s.friends ? 'on' : 'off'}. Walkie-talkie: ${s.walkie ? 'on' : 'off'}.`),
    stats.length > 0 && h('h3', null, 'Progress'),
    stats.length > 0 && h('ul', { class: 'acct-list' }, stats.slice(0, 16).map(([k, v]) => h('li', null, `${nice(k)}: ${v}`))),
    h('h3', null, 'Worlds'),
    worlds.length === 0 ? h('p', null, 'No worlds saved on our server yet.') : h('ul', { class: 'worlds-list' }, worlds.map((w) => {
      const thumb = h('span', { class: 'thumb' });
      if (typeof w.thumb === 'string' && w.thumb.startsWith('/api/')) thumb.append(h('img', { src: w.thumb, alt: '', loading: 'lazy', width: 76, height: 56 }));
      else thumb.textContent = initial(w.name);
      const info = [w.biome && nice(String(w.biome)), w.sizeName, w.updatedAt && `saved ${date(w.updatedAt)}`, kb(w.size)].filter(Boolean).join(' · ');
      return h('li', null, thumb, h('div', null, h('b', null, w.name || 'A world'), h('span', null, info)));
    })),
    row(btn(`Download ${p.nickname}'s worlds`, 'btn-soft', () => downloadPlayer(p)), linkBtn('Close', () => d.close())),
  );
}

function deletePlayerDialog(p) {
  const err = errBox();
  const input = h('input', { class: 'acct-input', id: 'confirm-nick', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const go = h('button', { type: 'button', class: 'btn btn-danger-strong', disabled: true }, `Delete ${p.nickname}`);
  input.addEventListener('input', () => {
    go.disabled = input.value.trim().toLowerCase() !== p.nickname.toLowerCase();
  });
  go.addEventListener('click', async () => {
    busy(go, true);
    err.textContent = '';
    try {
      const r = await withCheck(() => api('DELETE', `/api/players/${encodeURIComponent(p.id)}`, { confirm: input.value.trim() }));
      if (r) {
        d.close();
        toast(`${p.nickname} was deleted.`);
        await refresh();
        return;
      }
    } catch (e) {
      if (e.code === 'player_gone') {
        d.close();
        return refresh();
      }
      err.textContent = say(e);
    }
    busy(go, false);
  });
  const d = dialog([
    h('h2', null, `Delete ${p.nickname}?`),
    h('p', null, `This deletes ${p.nickname}'s worlds, stickers and progress from our server now. Devices remove their copies the next time they open the game. This can't be undone.`),
    h('p', null, 'Want a copy first? ', linkBtn(`Download ${p.nickname}'s worlds`, () => downloadPlayer(p))),
    h('label', { class: 'acct-label', for: 'confirm-nick' }, `Type ${p.nickname} to confirm`),
    input,
    err,
    row(go, linkBtn('Cancel', () => d.close())),
  ]);
}

// ---- downloads

function saveFile(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name.replace(/[\\/:*?"<>|]+/g, ' ') });
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * A player's worlds as one file the game opens (My Worlds → Open a file): the game's own
 * backup format (src/core/storage.js BACKUP_FORMAT), made from the player export.
 */
function toGameFile(exp) {
  const KEYS = ['look', 'outfits', 'playerName', 'nameSet', 'stickers', 'stickersSeen', 'stats', 'coins', 'basket', 'tutorialDone'];
  const worlds = (Array.isArray(exp.worlds) ? exp.worlds : [])
    .map((w) => (w && w.format === 'sparkle-world' ? w.save : w))
    .filter((s) => s && typeof s === 'object' && typeof s.blocks === 'string' && !/\.(before|undo)$/.test(String(s.id || '')));
  const profile = {};
  if (exp.profile && typeof exp.profile === 'object') for (const k of KEYS) if (exp.profile[k] !== undefined) profile[k] = exp.profile[k];
  return {
    format: 'sparkle-world-backup',
    v: 1,
    about: 'Sparkle World: a copy of every world, the look, outfits and stickers. To bring it back: My Worlds, then Open a file.',
    savedAt: new Date().toISOString(),
    profile,
    worlds,
  };
}

async function downloadPlayer(p) {
  try {
    const res = await withCheck(() => api('GET', `/api/players/${encodeURIComponent(p.id)}/export`, null, { raw: true }));
    if (!res) return;
    const exp = await res.json();
    saveFile(JSON.stringify(toGameFile(exp)), `${p.nickname} worlds ${today()}.json`);
    toast(`Saved. Open it in the game with My Worlds → Open a file.`);
  } catch (e) {
    toast(say(e));
  }
}

async function downloadEverything() {
  try {
    const res = await withCheck(() => api('GET', '/api/family/export', null, { raw: true }));
    if (!res) return;
    const text = await res.text();
    const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    saveFile(text, m ? m[1] : `sparkle-world-family-${today()}.json`);
    toast('Your family’s data is saved.');
  } catch (e) {
    toast(say(e));
  }
}

// ---- devices

const ICON_KID = 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5H7Zm5 14.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z';
const ICON_GROWN = 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4V5Zm2 0v8h12V5H6ZM2 17h20v1.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5V17Z';

function devicesSection() {
  const list = h('ul', { class: 'devices', id: 'devices' }, h('li', null, loadingRow('Loading devices…')));
  return card(
    h('h2', null, 'Devices'),
    h('p', { class: 'acct-small' }, "Where your family is signed in. Kid devices can play; only a grown-up's sign-in opens this page."),
    list,
    h('p', { class: 'acct-note', id: 'devices-next', hidden: true }, h('strong', null, 'Next: '), 'set up the device the kids play on.'),
    h('div', { class: 'acct-stack' },
      btn("Set up a kid's device", 'btn-play', pairDialog),
      btn('Kids play on this device', 'btn-soft', thisDeviceDialog)),
  );
}

async function loadDevices() {
  const list = doc.getElementById('devices');
  if (!list) return;
  try {
    S.devices = await api('GET', '/api/devices');
  } catch (e) {
    list.replaceChildren(h('li', { class: 'acct-error' }, say(e)));
    return;
  }
  const players = S.fam.players;
  list.replaceChildren(...S.devices.map((d) => deviceRow(d, players)));
  const next = doc.getElementById('devices-next');
  if (next) next.hidden = !(players.length > 0 && !S.devices.some((d) => d.kind === 'device'));
}

function deviceRow(d, players) {
  const kid = d.kind === 'device';
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', kid ? ICON_KID : ICON_GROWN);
  svg.append(path);
  const acts = h('div', { class: 'device-acts' });
  if (kid) {
    const sel = h('select', { 'aria-label': `Who plays on ${d.label || 'this device'}` },
      h('option', { value: '' }, 'Anyone in the family'),
      players.map((p) => h('option', { value: p.id }, `Only ${p.nickname}`)));
    sel.value = d.lockPlayer || '';
    sel.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/devices/${encodeURIComponent(d.id)}`, { lockPlayer: sel.value || null });
        toast('Saved.');
      } catch (e) {
        toast(say(e));
        sel.value = d.lockPlayer || '';
      }
    });
    acts.append(sel);
  }
  acts.append(linkBtn('Rename', () => renameDeviceDialog(d)));
  if (!d.current) acts.append(linkBtn('Sign out', () => signOutDevice(d), 'acct-link--danger'));
  return h('li', { class: 'device' },
    h('div', { class: 'device-top' }, svg,
      h('div', { class: 'who' },
        h('b', null, d.label || (kid ? 'A kid device' : 'A grown-up browser'), d.current ? h('span', { class: 'tag-here' }, 'this one') : null),
        h('span', null, `${kid ? 'Kid device' : 'Grown-up'} · last used ${date(d.lastSeen)}`))),
    acts);
}

function renameDeviceDialog(d) {
  const err = errBox();
  const input = h('input', { class: 'acct-input', id: 'dev-label', maxlength: '40', value: d.label || '', autocomplete: 'off' });
  const save = btn('Save', 'btn-play', async () => {
    busy(save, true);
    try {
      await api('PATCH', `/api/devices/${encodeURIComponent(d.id)}`, { label: input.value.trim().slice(0, 40) });
      dlg.close();
      toast('Saved.');
      loadDevices();
    } catch (e) {
      err.textContent = say(e);
      busy(save, false);
    }
  });
  const dlg = dialog([h('h2', null, 'Name this device'), h('label', { class: 'acct-label', for: 'dev-label' }, 'Name'), input, h('p', { class: 'acct-hint' }, "For example: Lily's iPad."), err, row(save, linkBtn('Cancel', () => dlg.close()))]);
}

function signOutDevice(d) {
  const err = errBox();
  const dlg = dialog([
    h('h2', null, `Sign out ${d.label || 'this device'}?`),
    h('p', null, d.kind === 'device' ? 'The kids will need a new code to play there with their worlds again. A game in progress there stops at once.' : 'That browser will need to sign in again.'),
    err,
    row(btn('Sign it out', 'btn-danger', async (ev) => {
      busy(ev.currentTarget, true);
      try {
        await api('DELETE', `/api/devices/${encodeURIComponent(d.id)}`, {});
        dlg.close();
        toast('Signed out.');
        loadDevices();
      } catch (e) {
        err.textContent = say(e);
        busy(ev.currentTarget, false);
      }
    }), linkBtn('Cancel', () => dlg.close())),
  ]);
}

function whoPlaysSelect(id) {
  return h('select', { class: 'acct-select', id },
    h('option', { value: '' }, 'Anyone in the family'),
    S.fam.players.map((p) => h('option', { value: p.id }, `Only ${p.nickname}`)));
}

function pairDialog() {
  const err = errBox();
  const who = whoPlaysSelect('pair-who');
  const label = h('input', { class: 'acct-input', id: 'pair-label', maxlength: '40', placeholder: "Lily's iPad", autocomplete: 'off' });
  const body = h('div');
  const make = btn('Make a code', 'btn-play', async () => {
    busy(make, true);
    err.textContent = '';
    try {
      const r = await withCheck(() => api('POST', '/api/devices/pair-code', { ...(label.value.trim() ? { label: label.value.trim().slice(0, 40) } : {}), ...(who.value ? { lockPlayer: who.value } : {}) }));
      if (r) return showCode(r);
    } catch (e) {
      err.textContent = e.code === 'limit' || e.code === 'rate' ? 'There are 3 codes waiting already. Use one, or wait 10 minutes for them to run out.' : say(e);
    }
    busy(make, false);
  });
  const showCode = (r) => {
    const kid = S.fam.players.find((p) => p.id === who.value);
    const left = h('p', { class: 'acct-small', role: 'timer' });
    const tick = () => {
      const s = Math.max(0, Math.round((ms(r.expiresAt) - Date.now()) / 1000));
      left.textContent = s > 0 ? `Works for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} more, one time.` : 'This code has run out. Make a new one.';
      if (s <= 0) clearInterval(t);
    };
    const t = setInterval(tick, 1000);
    timers.push(t);
    tick();
    body.replaceChildren(
      h('p', { class: 'pair-code', 'aria-label': `The code: ${String(r.code).split('').join(' ')}` }, r.code),
      left,
      h('ol', { class: 'pair-steps' },
        h('li', null, kid ? `On ${kid.nickname}'s device, open ` : 'On the kid\'s device, open ', h('b', null, `${location.host}/play`), '.'),
        h('li', null, 'Tap ', h('b', null, 'Grown-ups'), ', then ', h('b', null, 'I have a code'), '.'),
        h('li', null, 'Type this code. The dash is optional, and small letters are fine.')),
      row(btn('Done', 'btn-play', () => dlg.close())),
    );
  };
  body.append(
    h('p', null, "You'll get a code to type on her iPad, phone or computer. It works once, for 10 minutes."),
    h('label', { class: 'acct-label', for: 'pair-who' }, 'Who plays on it?'),
    who,
    h('label', { class: 'acct-label', for: 'pair-label', style: 'margin-top:14px' }, 'A name for it (you can skip this)'),
    label,
    err,
    row(make, linkBtn('Cancel', () => dlg.close())),
  );
  const dlg = dialog([h('h2', null, "Set up a kid's device"), body], { onClose: loadDevices });
}

function thisDeviceDialog() {
  const err = errBox();
  const who = whoPlaysSelect('this-who');
  const dlg = dialog([
    h('h2', null, 'Kids play on this device?'),
    h('p', null, "This device becomes a kid device: the kids can play here right away, and the Family page signs out on it. You can sign in again any time with your email."),
    h('label', { class: 'acct-label', for: 'this-who' }, 'Who plays on it?'),
    who,
    err,
    row(btn('Make this a kid device', 'btn-play', async (ev) => {
      busy(ev.currentTarget, true);
      try {
        await api('POST', '/api/devices/this', { ...(who.value ? { lockPlayer: who.value } : {}) });
        dlg.close();
        mount(card(
          h('h2', null, 'This device is ready for the kids!'),
          h('p', { class: 'acct-lead' }, 'They can open the game and start playing. To open the Family page here again, sign in with your email.'),
          row(h('a', { class: 'btn btn-play', href: '/play' }, 'Play now'), linkBtn('Sign in as a grown-up', () => signIn())),
        ), { subtitle: 'This device plays Sparkle World.' });
      } catch (e) {
        err.textContent = say(e);
        busy(ev.currentTarget, false);
      }
    }), linkBtn('Cancel', () => dlg.close())),
  ]);
}

// ---- privacy and data

function privacySection(f) {
  return card(
    h('h2', null, 'Privacy and data'),
    h('p', { class: 'acct-small' }, 'Everything we keep about your family, to take with you or to delete.'),
    h('div', { class: 'acct-stack' }, btn('Download everything', 'btn-soft', downloadEverything)),
    h('h3', { style: 'margin-top:18px' }, 'Consent history'),
    h('ul', { class: 'history', id: 'history' }, h('li', null, 'Loading…')),
    h('div', { class: 'links-row' }, h('a', { href: '/privacy' }, 'Privacy Notice'), h('a', { href: '/terms' }, 'Terms'), h('a', { href: '/parents' }, 'Safety, in plain words')),
    f.config && f.config.operatorEmail && h('p', { class: 'acct-small' }, 'Questions or requests? Write to ', h('a', { href: 'mailto:' + f.config.operatorEmail }, f.config.operatorEmail), '.'),
    h('div', { class: 'danger-zone' }, btn('Delete our account', 'btn-danger', deleteFamilyDialog)),
  );
}

function historyLine(a, names) {
  const who = a.player && names.get(a.player) ? names.get(a.player) : null;
  const d = a.detail || {};
  switch (a.action) {
    case 'consent.email_plus': return `You agreed to the notice${d.v ? ` (version ${d.v})` : ''}.`;
    case 'consent.confirm_sent': return 'We emailed you a confirmation of your consent.';
    case 'consent.verified': return d.method === 'card' || !d.method ? 'Your first payment confirmed that a grown-up said yes.' : 'We recorded your signed consent.';
    case 'player.create': return who ? `You added ${who}.` : 'You added a player.';
    case 'player.delete': return 'You deleted a player.';
    case 'friends.on': return `Play with friends on${who ? ` for ${who}` : ''}.`;
    case 'friends.off': return `Play with friends off${who ? ` for ${who}` : ''}.`;
    case 'walkie.on': return `Walkie-talkie on${who ? ` for ${who}` : ''}.`;
    case 'walkie.off': return `Walkie-talkie off${who ? ` for ${who}` : ''}.`;
    case 'device.paired': return 'A kid device was set up.';
    case 'device.removed': return 'A device was signed out.';
    case 'export.player': return who ? `You downloaded ${who}'s worlds.` : "You downloaded a player's worlds.";
    case 'export.family': return 'You downloaded everything.';
    case 'plan.lapsed': return 'The Family Plan ended.';
    case 'plan.resumed': return 'The Family Plan started again.';
    case 'retention.purge': return 'Players were deleted after the plan ended.';
    case 'comp.set': return 'A free pass was set.';
    case 'email.changed': return 'Your sign-in email was changed.';
    default: return null;
  }
}

async function loadHistory() {
  const list = doc.getElementById('history');
  if (!list) return;
  try {
    S.audit = await api('GET', '/api/family/audit');
  } catch {
    list.replaceChildren(h('li', null, "Couldn't load it right now."));
    return;
  }
  const names = new Map(S.fam.players.map((p) => [p.id, p.nickname]));
  const rows = (Array.isArray(S.audit) ? S.audit : []).slice().sort((a, b) => ms(b.at) - ms(a.at)).map((a) => [a, historyLine(a, names)]).filter(([, t]) => t);
  list.replaceChildren(...(rows.length ? rows.slice(0, 50).map(([a, t]) => h('li', null, h('time', { datetime: new Date(ms(a.at)).toISOString() }, date(a.at)), h('span', null, t))) : [h('li', null, 'Nothing yet.')]));
}

function deleteFamilyDialog() {
  const err = errBox();
  const input = h('input', { class: 'acct-input', id: 'confirm-delete', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const go = h('button', { type: 'button', class: 'btn btn-danger-strong', disabled: true }, 'Delete our account');
  input.addEventListener('input', () => {
    go.disabled = input.value.trim() !== 'DELETE';
  });
  go.addEventListener('click', async () => {
    busy(go, true);
    err.textContent = '';
    try {
      const r = await withCheck(() => api('POST', '/api/family/delete', { confirm: 'DELETE' }), { within5: true });
      if (r) {
        dlg.close();
        familyGone("Your family's account is deleted. The Family Plan is cancelled, and the kids' worlds and everything else are gone from our server. Backups roll off within 7 days.");
        return;
      }
    } catch (e) {
      err.textContent = say(e);
    }
    busy(go, false);
  });
  const dlg = dialog([
    h('h2', null, 'Delete our account?'),
    h('p', null, 'This is for good. Here is what happens:'),
    h('ul', { class: 'acct-list' },
      h('li', null, 'The Family Plan is cancelled now, with no further charges.'),
      h('li', null, "The kids' players, worlds and everything else are deleted from our server now."),
      h('li', null, 'Our backups roll off within 7 days.'),
      h('li', null, 'Stripe keeps the payment records the law requires.'),
      h('li', null, "Your family's devices are signed out, and remove their copies the next time they open the game.")),
    h('p', null, 'Want a copy first? ', linkBtn('Download everything', downloadEverything)),
    h('label', { class: 'acct-label', for: 'confirm-delete' }, 'Type DELETE to confirm'),
    input,
    err,
    row(go, linkBtn('Cancel', () => dlg.close())),
  ]);
}

// ---- signing out

async function signOut() {
  try {
    await api('POST', '/api/auth/logout', {});
  } catch {}
  S.fam = null;
  signIn({ note: 'You signed out. See you soon!' });
}

function signOutEverywhere() {
  const err = errBox();
  const dlg = dialog([
    h('h2', null, 'Sign out everywhere?'),
    h('p', null, "Every device of your family is signed out, the kids' devices too. They will need a new code (or your sign-in) to play with their worlds again."),
    err,
    row(btn('Sign out everywhere', 'btn-danger', async (ev) => {
      busy(ev.currentTarget, true);
      try {
        const r = await withCheck(() => api('POST', '/api/auth/logout-all', {}));
        if (r) {
          dlg.close();
          S.fam = null;
          signIn({ note: 'Every device is signed out.' });
          return;
        }
      } catch (e) {
        err.textContent = say(e);
      }
      busy(ev.currentTarget, false);
    }), linkBtn('Cancel', () => dlg.close())),
  ]);
}

// ------------------------------------------------------------------------------ dialogs and the email check

function dialog(kids, { wide = false, onClose = null } = {}) {
  const d = h('dialog', { class: 'acct-dialog' + (wide ? ' acct-dialog--wide' : ''), 'aria-modal': 'true' });
  const x = h('button', { type: 'button', class: 'x', 'aria-label': 'Close' }, '×');
  x.addEventListener('click', () => d.close());
  d.append(x);
  add(d, kids);
  doc.body.append(d);
  d.addEventListener('close', () => {
    d.remove();
    if (onClose) onClose();
  });
  // a click on the dimmed backdrop closes it too
  d.addEventListener('click', (ev) => {
    if (ev.target === d) {
      const r = d.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) d.close();
    }
  });
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
  const h2 = d.querySelector('h2');
  if (h2) {
    h2.setAttribute('tabindex', '-1');
    h2.focus({ preventScroll: true });
  }
  return d;
}

/**
 * Run fn; when the server answers check_required, ask for the email check (a code sent to
 * the grown-up's email) and run it again. Resolves fn's answer, or null when she cancelled.
 */
async function withCheck(fn, { within5 = false } = {}) {
  // the check lasts 15 minutes; deleting the account wants one from the last 5 (§4.4). Ask
  // first when it has run out, so the server is not asked in vain
  const need = Date.now() + (within5 ? 10 * 60 * 1000 : 5000);
  if (!(S.elevatedUntil > need)) {
    if (!(await emailCheck({ within5 }))) return null;
  }
  try {
    return await fn();
  } catch (e) {
    if (e.code !== 'check_required') throw e;
  }
  if (!(await emailCheck({ within5 }))) return null;
  return fn();
}

function emailCheck({ within5 = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const err = errBox();
    const go = h('button', { type: 'button', class: 'btn btn-play' }, 'Continue');
    const submit = async (code) => {
      if (!/^\d{6}$/.test(code)) {
        err.textContent = 'The code has 6 numbers.';
        boxes.focus();
        return;
      }
      busy(go, true);
      err.textContent = '';
      try {
        const r = await api('POST', '/api/auth/verify', { code });
        S.elevatedUntil = r && ms(r.elevatedUntil) ? ms(r.elevatedUntil) : Date.now() + 15 * 60 * 1000;
        done = true;
        dlg.close();
        resolve(true);
      } catch (e) {
        busy(go, false);
        if (e.code === 'bad_code') {
          const left = e.data && Number.isFinite(e.data.triesLeft) ? e.data.triesLeft : null;
          err.textContent = "That code didn't match." + (left !== null ? ` (${plural(left, 'try', 'tries')} left)` : '');
          boxes.bad();
        } else if (e.code === 'expired') {
          err.textContent = 'That code has expired. Send a new one.';
          boxes.bad();
        } else err.textContent = say(e);
      }
    };
    const boxes = codeBoxes(submit);
    go.addEventListener('click', () => submit(boxes.value));
    const send = async () => {
      try {
        await api('POST', '/api/auth/check', {});
        return true;
      } catch (e) {
        err.textContent = e.code === 'rate' ? 'We sent a few codes already. Wait a few minutes, then try again.' : say(e);
        return false;
      }
    };
    const again = resendLink(async () => {
      err.textContent = '';
      if (await send()) toast('We sent a new code.');
    });
    const dlg = dialog([
      h('h2', null, 'Quick check: is it you?'),
      h('p', null, 'We emailed a code to ', h('strong', null, mask(S.fam && S.fam.email)), '. Type it here to continue.'),
      boxes.el,
      err,
      row(go, again, linkBtn('Cancel', () => dlg.close())),
      h('p', { class: 'acct-small' }, within5 ? 'Deleting the account needs a code from the last 5 minutes.' : 'Important changes need a fresh code, so nobody else using this device can make them.'),
    ], { onClose: () => {
      if (!done) resolve(false);
    } });
    again.wait();
    send().then(() => boxes.focus());
  });
}

// ------------------------------------------------------------------------------ start

if (doc.body.dataset.page === 'verify') verifyPage();
else boot();
