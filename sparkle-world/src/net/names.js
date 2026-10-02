// Names other players see (docs/MULTIPLAYER.md §11.8). Nothing a child typed is shown on
// another player's screen unless it passed sanitizeName(): the name tag above her avatar,
// the knock card, the Players list, the host's world name ("<name>'s World") and the names
// of the host's pets.
//
//   1. NFKC (fancy look-alike letters become plain ones);
//   2. keep Unicode letters (and their accents), spaces, '-' and '\'' only: no digits, no
//      emoji, no symbols, no invisible characters. Letters that draw nothing (the Hangul
//      fillers) go too, and a letter keeps at most 2 accents (no towers of marks);
//   3. collapse spaces and cut to 12 characters;
//   4. empty, or a word on the blocklist below -> the fallback ("Friend"). The blocklist is
//      checked on a copy where Cyrillic and Greek look-alike letters read as Latin ones
//      ("fuсk" with a Cyrillic "с" is caught; "Настя" itself is still a fine name).
//
// The blocklist is short on purpose and was written for a family game: grown-ups can review
// it here. It is compared in lower case with spaces, '-' and '\'' removed, both against the
// whole name and against each word; the STRONG words are also caught inside longer names.

const MAX = 12;

/** Words that make a whole name (or one of its words) fall back to "Friend". */
const BLOCK = new Set([
  // rude or unkind words
  'stupid', 'idiot', 'dumb', 'dummy', 'ugly', 'loser', 'fatso', 'hate', 'hater', 'kill', 'killer', 'die',
  'dead', 'murder', 'moron', 'jerk', 'fart', 'poop', 'pee', 'butt', 'butthead', 'weirdo', 'freak', 'nerd',
  'retard', 'retarded', 'crap', 'damn', 'hell', 'suck', 'sucks', 'shutup', 'knife', 'blood',
  // pretending to be the game or someone in charge of it
  'admin', 'administrator', 'moderator', 'mod', 'owner', 'police', 'host', 'sparkleworld', 'glimmerworld', 'claude',
  'anthropic', 'railway', 'system',
  // body words
  'boob', 'boobs', 'penis', 'vagina', 'nipple', 'nude', 'naked', 'sexy', 'sex',
  // swear words (and common spellings)
  'ass', 'arse', 'bastard', 'bitch', 'bitches', 'bollocks', 'cock', 'cunt', 'dick', 'dildo', 'fag',
  'faggot', 'fuck', 'fucker', 'fucking', 'fuk', 'fuq', 'motherfucker', 'nigga', 'nigger', 'piss',
  'prick', 'pussy', 'shit', 'shitty', 'slut', 'twat', 'wank', 'wanker', 'whore', 'porn', 'rape',
]);

/** Also caught inside a longer name ("Lilyfuck" -> "Friend"); never part of a normal name. */
const STRONG = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'porn', 'wank', 'dildo', 'penis', 'vagina', 'rape', 'retard'];

/** Cyrillic and Greek letters that look like Latin ones (lower case), for the blocklist. */
const LOOKALIKE = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
  'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'ɡ': 'g', 'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p',
  'τ': 't', 'υ': 'u', 'χ': 'x', 'ү': 'y', 'һ': 'h', 'ӏ': 'l',
};
const LOOKALIKE_RE = new RegExp('[' + Object.keys(LOOKALIKE).join('') + ']', 'g');

/** Lower case, look-alikes read as Latin, accents dropped, no spaces, '-' or '\''. */
const squash = (s) => s.toLowerCase().replace(LOOKALIKE_RE, (c) => LOOKALIKE[c])
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[\s'\-]/g, '');

/** Is this (already cleaned) name unkind or pretending to be someone else? */
export function isBlocked(name) {
  if (!name) return true;
  const whole = squash(name);
  if (!whole) return true;
  if (BLOCK.has(whole)) return true;
  for (const w of name.split(/[\s\-]+/)) {
    const t = squash(w);
    if (t && BLOCK.has(t)) return true;
  }
  for (const s of STRONG) if (whole.includes(s)) return true;
  return false;
}

/**
 * The name to show other players. `fallback` is used when nothing kind is left (default
 * "Friend"; pets fall back to their species name).
 */
export function sanitizeName(s, fallback = 'Friend') {
  let t = typeof s === 'string' ? s : '';
  try {
    t = t.normalize('NFKC');
  } catch {
    // very old browsers: keep the text as it is (step 2 still removes everything unusual)
  }
  t = t.replace(/[^\p{L}\p{M} '\-]/gu, '');
  // letters that draw nothing (a name tag must never look empty)
  t = t.replace(/[\u115f\u1160\u3164\uffa0]/g, '');
  // at most 2 accents on a letter, and none without a letter under them
  t = t.replace(/^\p{M}+/u, '').replace(/(\P{M})(\p{M}{2})\p{M}+/gu, '$1$2').replace(/ \p{M}+/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // at most one dash / apostrophe in a row, and none at the ends
  t = t.replace(/(['\-]){2,}/g, '$1').replace(/^['\-\s]+|['\-\s]+$/g, '');
  if (!t || isBlocked(t)) return fallback;
  if (t.length > MAX) t = Array.from(t).slice(0, MAX).join('').trim();
  t = t.replace(/['\-\s]+$/g, '');
  if (!t || isBlocked(t)) return fallback;
  return t;
}
