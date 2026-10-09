// The shared name scanner (docs/teams/wave4-integration.md §6 step 0, C13): other companies' names
// never appear in the game, the site or the docs. The owner's rule is "never", so the lists are
// stored base64-encoded here and no test file spells them either: tests build their examples from
// the decoded lists (`brandWords()`, `characterWords()`).
//
// Three kinds of list:
//   - BRANDS: the owner's forbidden names. Scanned over everything in SCOPE (game source, site,
//     the built pages and docs/**).
//   - EXTRA[team]: a team's extra words (wave 4: squish, merfolk, ocean add theirs here, encoded,
//     one entry per line). Scanned over the game and site text only (EXTRA_SCOPE), never docs/**
//     (a team doc's own file name may use one of them).
//   - CHARACTERS: famous film, show and game character names (ocean.md §13.1 S9). Several are
//     ordinary words, so only the wave-4 string tables are checked against them
//     (`scanCharacters(text)`: `STRINGS`, `ITEMS` names, `SEA_TEXT`, `DOLPHIN_NAMES`, merfolk's
//     strings), never whole files.
//
// Every entry is a regex fragment (decoded), matched as a whole word, case-insensitive. Inlined
// `data:` URIs are stripped before a scan (random base64 can spell anything).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const BRANDS = [
  'bmVlWyAtXT9kb2g=',
  'c3F1aXNobWFsbG93cz8=',
  'ZGlzbmV5',
  'bHVjYQ==',
  'bWluZWNyYWZ0',
];

/** Each wave-4 team appends its own encoded words to its list (one entry per line). */
const EXTRA = {
  merfolk: [
    'UG9ydG9yb3Nzbw==',
    'TWFzc2ltbw==',
    'RXJjb2xl',
    'TWFjaGlhdmVsbGk=',
    'VmVzcGE=',
  ],
  squish: [
    'c3F1aXNoaWVz', // the toy-brand plural (squish team doc §8.1)
    'c3BhY2UgP2J1ZCg/OmR5fGRpZXN8cyk/', // the dropped "space" toy name (§8.1)
  ],
  ocean: [
  ],
};

const CHARACTERS = [
  'RmxpcHBlcg==',
  'TmVtbw==',
  'RG9yeQ==',
  'QXJpZWw=',
  'U2ViYXN0aWFu',
  'TW9hbmE=',
  'VXJzdWxh',
  'U2hhbXU=',
  'V2lsbHk=',
  'Q3J1c2g=',
  'U3F1aXJ0',
  'SGFuaw==',
  'RGVzdGlueQ==',
  'QmFpbGV5',
  'R2lsbA==',
  'RmxvdW5kZXI=',
  'TWFybGlu',
  'QWxiZXJ0bw==',
  'R2l1bGlh',
  'UG9ueW8=',
  'UGF0cmljaw==',
  'U3BvbmdlQm9i',
  'Q29jbw==',
  'U2hpbW1lcg==',
  'QnViYmxlcw==',
  'TWlzdHk=',
  'RGFzaA==',
  'WmlnZ3k=',
];

/** Where the brand list is checked (globs relative to the app folder). */
export const SCOPE = ['src/**', 'site/**', 'dist/*.html', 'dist/site/**', 'docs/**'];
/** Where the teams' extra words are checked: the game and site text, not docs/**. */
export const EXTRA_SCOPE = ['src/**', 'site/**', 'dist/*.html', 'dist/site/**'];
/** Text files only; images and fonts are skipped. */
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.md', '.txt', '.json', '.svg', '.xml', '.webmanifest']);

const decode = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const wordsOf = (list) => list.map(decode);
const toRegex = (frags) => (frags.length ? new RegExp(`\\b(?:${frags.join('|')})\\b`, 'gi') : null);

/** The decoded brand fragments (for tests that must build their examples without spelling them). */
export const brandWords = () => wordsOf(BRANDS);
/** The decoded extra fragments, all teams or one. */
export const extraWords = (team) => (team ? wordsOf(EXTRA[team] || []) : Object.values(EXTRA).flatMap(wordsOf));
/** The decoded character names. */
export const characterWords = () => wordsOf(CHARACTERS);

/** Inlined data: URIs (images, fonts) become a bare `data:` so they never match; newlines stay. */
export function stripDataUris(text) {
  return String(text).replace(/data:[\w.+-]+\/[\w.+-]+(?:;[\w.+=-]+)*,[A-Za-z0-9+/=%._~-]*/g, 'data:');
}

function matchAll(text, re) {
  if (!re) return [];
  const s = stripDataUris(text);
  const out = [];
  for (const m of s.matchAll(re)) {
    const before = s.slice(0, m.index);
    const line = before.split('\n').length;
    const col = m.index - before.lastIndexOf('\n');
    out.push({ word: m[0], index: m.index, line, col });
  }
  return out;
}

/**
 * Every forbidden name in `text`: the brand list, plus every team's extra words when
 * `extras` is true. Returns [{ word, index, line, col }] (empty when clean).
 */
export function scanText(text, { extras = false } = {}) {
  return matchAll(text, toRegex([...brandWords(), ...(extras ? extraWords() : [])]));
}

/** Every famous character name in `text` (for the wave-4 string tables only). */
export function scanCharacters(text) {
  return matchAll(text, toRegex(characterWords()));
}

function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return;
  const st = statSync(abs);
  if (!st.isDirectory()) { out.push(rel); return; }
  for (const name of readdirSync(abs).sort()) {
    if (name === 'node_modules' || name === '.git') continue;
    walk(rel ? path.posix.join(rel, name) : name, out);
  }
}

/** The text files (relative to the app folder) that the globs cover, sorted, no repeats. */
export function filesFor(globs) {
  const seen = new Set();
  for (const g of globs) {
    const base = g.split('/').filter((p, i, a) => !/[*?]/.test(a.slice(0, i + 1).join('/'))).join('/');
    const all = [];
    walk(base, all);
    const re = globRegex(g);
    for (const f of all) if (re.test(f) && TEXT_EXT.has(path.extname(f).toLowerCase())) seen.add(f);
  }
  return [...seen].sort();
}

/**
 * Scan the files the globs cover (default: SCOPE with the brand list). With `extras`, every
 * team's extra words are added (use EXTRA_SCOPE for that). Returns [{ file, line, word, text }].
 */
export function scanFiles(globs = SCOPE, { extras = false } = {}) {
  const out = [];
  for (const file of filesFor(globs)) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split('\n');
    for (const m of scanText(text, { extras })) out.push({ file, line: m.line, word: m.word, text: (lines[m.line - 1] || '').trim().slice(0, 140) });
  }
  return out;
}
