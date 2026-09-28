// The account cards (docs/ACCOUNTS.md §7.1, §7.5, §7.7): the grown-ups' card (behind the
// grown-up check), "I have a code", the blocking cards of `required` mode ("Ask a grown-up",
// "Sparkle World is resting", "Can't reach Sparkle World"), "Keep my old worlds safe" and the
// first sign-in's "worlds from before" question. Words for grown-ups; never a price, an email,
// an error code or a "buy" (§7.9).

import { choiceDialog, textInputDialog } from '../ui/dialogs.js';
import { saveAllWorlds } from '../ui/keepsafe.js';
import { findLegacy, legacyState, setLegacyState, removeLegacy, expireLegacy, playedSince } from './legacy.js';

const go = (url) => location.assign(url);
const OFF = "Can't reach Sparkle World. Try again in a minute.";

/** A card with buttons [value, label, variant?, icon?]; resolves the value (Esc: o.cancel). */
export function ask(game, title, choices, o = {}) {
  return choiceDialog(game.ui, {
    title, text: o.text || '', body: o.body || null, note: o.note || '', cancelValue: 'cancel' in o ? o.cancel : 'close',
    choices: choices.map(([value, label, variant = 'white', icon = null]) => ({ value, label, variant, icon })),
  });
}

/** "I have a code": pair this device with the code from the Family page (§4.5). */
export async function pairDevice(game, acct) {
  for (;;) {
    const code = await textInputDialog(game.ui, { title: 'Type the code from the Family page', placeholder: 'K7QM-2XFD', ok: 'Go', maxLength: 12 });
    if (!code) return;
    try {
      await acct.api.call('POST', '/api/auth/pair', { json: { code } });
      return location.reload();
    } catch (err) {
      const text = err.status === 429 ? 'Too many tries. Wait a few minutes.' : err.status ? "That code didn't work. Codes last 10 minutes: check the Family page." : OFF;
      if ((await ask(game, 'Hmm!', [['again', 'Try again', 'mint'], ['close', 'Not now']], { text })) !== 'again') return;
    }
  }
}

/** The grown-ups' card: what this device can do, by its kind of session (§7.7). */
export async function grownupCard(game, acct) {
  const me = acct.me || {};
  const parent = me.kind === 'parent';
  const c = me.signedIn
    ? [['family', 'Family page', 'mint'], parent && ['kid', 'Make this a kid device', 'sky'], acct.canSwitch && ['switch', 'Switch player', 'lav'],
      acct.hasLegacy && ['old', 'Remove old copies'], ['out', parent ? 'Sign out' : 'Sign this device out']]
    : [['signin', 'Sign in or start', 'mint'], ['code', 'I have a code', 'sky']];
  const v = await ask(game, 'For grown-ups', [...c.filter(Boolean), ['close', 'Close']], {
    text: !me.signedIn ? "Sign in, or type the code the Family page shows for a kid's device." : parent ? 'This device is signed in to your family.' : "This is one of your family's kid devices.",
  });
  if (v === 'signin') go('/account?next=/play');
  else if (v === 'family') go('/account');
  else if (v === 'code') await pairDevice(game, acct);
  else if (v === 'switch') await acct.switchPlayer();
  else if (v === 'old') {
    if ((await ask(game, 'Remove the old copies?', [['yes', 'Remove', 'pink'], ['close', 'Keep them']], { text: 'The worlds kept here from before accounts go. Worlds moved to a player stay safe.' })) !== 'yes') return;
    await removeLegacy();
    setLegacyState({ state: 'dismissed', at: Date.now(), removed: Date.now() });
    acct.hasLegacy = false;
  } else if (v === 'kid' || v === 'out') {
    try {
      await game.store.flush();
      await acct.api.call('POST', v === 'kid' ? '/api/devices/this' : '/api/auth/logout', { json: {} });
      location.reload();
    } catch {
      game.toast(OFF, { icon: 'cloud' });
    }
  }
}

/**
 * `required` mode without a sign-in, a good plan or a player: a card over the title that
 * stays (§7.1). why: 'signin' | 'resting' | 'noplayers'. soft (`optional`, no player yet): an
 * OK closes it and she plays on this device.
 */
export async function blockingCard(game, acct, why, soft = false) {
  const worlds = why === 'signin' ? await game.store.listWorlds() : [];
  for (;;) {
    const v = why === 'signin'
      ? await ask(game, 'Ask a grown-up to set up Sparkle World', [['grown', "I'm a grown-up", 'mint'], ['code', 'I have a code', 'sky'], ...(worlds.length ? [['old', 'Keep my old worlds safe']] : [])], { cancel: null })
      : await ask(game, why === 'resting' ? 'Sparkle World is resting. Ask a grown-up to wake it up!' : 'A grown-up can add you on the Family page', [['grownups', 'Grown-ups', 'mint'], ...(soft ? [['ok', 'OK']] : [])], { cancel: soft ? 'ok' : null });
    if (v === 'ok') return;
    if (v === 'old') {
      // "Keep my old worlds safe": the worlds from before, read only, and Save to a file
      const list = game.ui.el('div');
      for (const m of worlds.slice(0, 12)) list.appendChild(game.ui.el('p', '', m.name));
      if ((await ask(game, 'Your worlds on this device', [['save', 'Save to a file', 'mint', 'download'], ['close', 'Back']], { body: list })) === 'save') await saveAllWorlds(game);
    } else if (v && (await acct.gate())) {
      if (v === 'grown') go('/account?next=/play');
      else if (v === 'code') await pairDevice(game, acct);
      else await grownupCard(game, acct);
    }
  }
}

/** The first sign-in: whose are the worlds from before? (§7.5) */
export async function askLegacy(game, acct) {
  await expireLegacy();
  const legacy = await findLegacy();
  acct.hasLegacy = !!legacy;
  if (!legacy) return;
  // answered before ("imported" / "They're not ours"): asked again only for worlds played since
  const st = legacyState();
  if (st && !playedSince(legacy, st)) return legacy.store.close();
  const n = legacy.worlds.length;
  const ua = navigator.userAgent;
  const here = /iPad/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'This iPad' : /iPhone/.test(ua) ? 'This iPhone' : 'This device';
  const players = acct.me.players || [];
  const v = await ask(game, `${here} has ${n ? n + (n === 1 ? ' world' : ' worlds') : 'stickers and outfits'} from before. Whose are they?`,
    [...players.map((p) => [p.id, p.nickname, 'pink']), ['later', 'Not now'], ['no', "They're not ours"]],
    { cancel: 'later', note: 'Grown-ups: they are copied into her worlds and her cloud copy.' });
  const p = players.find((x) => x.id === v);
  if (v === 'no') setLegacyState({ state: 'dismissed', at: Date.now() });
  if (p && (await acct.importTo(p, legacy))) {
    setLegacyState({ state: 'imported', to: p.id, at: Date.now() });
    game.toast(p.id === acct.playerId ? 'Your worlds are here!' : `Moved to ${p.nickname}'s worlds!`, { icon: 'world', color: 'mint' });
  }
  legacy.store.close();
}
