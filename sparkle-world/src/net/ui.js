// Playing with friends: every screen a child sees (docs/MULTIPLAYER.md §11, §12).
//
//   panel 'mp-start'    Title -> Play with Friends: two big picture cards, "Make a Code"
//                       (friends come to your world) and "Join a Code" (visit a friend), plus
//                       the resume chips "Keep playing" (host) / "Join Lily" (guest).
//   panel 'mp-join'     the 12-picture keypad (4 slots, Back, Clear, Go) and, after Go, the
//                       joining cards: looking for your friend, knock knock, flying there.
//   panel 'mp-players'  who's here (colors, crown for the host), the code as 4 big pictures,
//                       and for the host: Undo building / Send home per player, "Players can
//                       build", "Careful players", Stop playing. Guests: Go home.
//   panel 'mp-say'      16 quick phrases with little icons (never typed text).
//   knock card          (host, non-modal, over everything) portrait, "Mia wants to play!",
//                       the account name in small print on claude.ai, Let in / Not now.
//   message cards       friendly texts for every session message (never error codes).
//   summary             host: "Playing together is over! Everything is saved." + Before friends.
//   status              "Lily is taking a little break…", "Lily paused building" and
//                       "Reconnecting…" pills.
//   name step           the first time she plays together while her name is still the game's
//                       starting one: "What's your name?" (so a friend's knock card never
//                       says "Lily" for everyone).
//
// The words "Friends" and "My Friends" belong to the NPC friends (pals team); real players
// are "Players" in the game and "Play with Friends" on the title, so a child never mixes
// them up. Everything here reads game.net (src/net/facade.js) and its 'net:*' events.

import { CODE_WORDS, messageText, isCode } from './protocol.js';
import { CODE_PICTURES, pictureSvg, pictureName, codeWords, PHRASES, phraseIcon } from './pictures.js';
import { sanitizeName } from './names.js';
import { unpackLook } from './codec.js';
import { seatColor } from './remote-players.js';
import { icon2, button2 } from '../ui/menus/icons2.js';
import { getStage } from '../ui/dressup/stage.js';

const HOST_RESUME_MS = 30 * 60 * 1000; // "Keep playing" for 30 min (§6)
const GUEST_RESUME_MS = 2 * 60 * 60 * 1000; // "Join Lily" for 2 h
const BACKUP_DAYS = 7;
const KNOCK_MISSED_MS = 60000; // a knock card up this long and gone: "she knocked while you were busy"
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'today', 'yesterday' or the day's name (backups are at most 7 days old). */
function dayWord(at) {
  const d = new Date(at), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'on ' + DAY_NAMES[d.getDay()];
}

const CSS = /* css */ `
.sw-net-layer { position: absolute; inset: 0; pointer-events: none; z-index: 30; }
.sw-net-layer > * { pointer-events: auto; }

/* ---------- picture tiles (keypad keys, code tiles, slots) ---------- */
.sw-pic { display: block; width: 100%; height: 100%; }
.sw-net-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: 22px; background: var(--t, #fff); border: 4px solid #fff; box-shadow: 0 5px 0 rgba(58,31,77,.12), 0 8px 16px var(--sw-shadow); color: var(--sw-ink); font-family: var(--sw-font); font-weight: 700; }
.sw-net-tile .sw-pic { width: 62%; height: auto; aspect-ratio: 1; filter: drop-shadow(0 3px 0 rgba(58,31,77,.12)); }
.sw-net-tile .sw-net-word { font-size: 16px; line-height: 1; }

/* ---------- start ---------- */
.sw-net-start { display: flex; flex-direction: column; gap: 14px; }
.sw-net-chips { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.sw-net-chips:empty { display: none; }
.sw-net-chip.sw-btn { flex-direction: row; gap: 10px; padding: 6px 20px 6px 8px; min-height: 64px; border-radius: 26px; text-align: left; }
.sw-net-chip .sw-net-chip-pics { display: flex; gap: 2px; background: rgba(255,255,255,.85); border-radius: 16px; padding: 4px; }
.sw-net-chip .sw-net-chip-pics .sw-pic { width: 26px; height: 26px; }
.sw-net-chip-words { display: flex; flex-direction: column; line-height: 1.05; }
.sw-net-chip-sub { font-size: 14px; font-weight: 600; opacity: .9; }
.sw-net-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sw-net-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 12px 16px; border-radius: 28px; border: 5px solid #fff; background: linear-gradient(170deg, var(--a), var(--b)); color: var(--sw-ink); cursor: pointer; font-family: var(--sw-font); box-shadow: 0 6px 0 rgba(58,31,77,.12), 0 12px 26px var(--sw-shadow); transition: transform .18s var(--sw-bounce); min-height: 88px; }
.sw-net-card:hover { transform: translateY(-3px); }
.sw-net-card:active { transform: scale(.96); }
.sw-net-card-art { display: flex; gap: 6px; justify-content: center; padding: 10px 12px; border-radius: 22px; background: rgba(255,255,255,.72); }
.sw-net-card-art .sw-net-mini { width: 56px; height: 56px; border-radius: 16px; background: #fff; display: grid; place-items: center; box-shadow: 0 3px 8px rgba(58,31,77,.15); }
.sw-net-card-art .sw-net-mini .sw-pic { width: 44px; height: 44px; }
.sw-net-card-art .sw-net-mini.sw-empty { background: rgba(255,255,255,.55); border: 3px dashed rgba(58,31,77,.25); box-shadow: none; }
.sw-net-card-art .sw-net-mini.sw-empty svg { width: 28px; height: 28px; color: rgba(58,31,77,.35); }
.sw-net-card-title { font-size: 30px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.sw-net-card-title svg { width: 34px; height: 34px; color: var(--c); }
.sw-net-card-sub { font-size: 17px; font-weight: 600; opacity: .8; text-align: center; }
.sw-net-card-world { font-size: 14px; font-weight: 700; color: var(--sw-lav); background: rgba(255,255,255,.85); border-radius: 999px; padding: 2px 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-net-card-world:empty { display: none; }
.sw-net-note { font-size: 13px; font-weight: 600; color: rgba(58,31,77,.6); text-align: center; line-height: 1.25; }

/* ---------- keypad ---------- */
.sw-net-keypad { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.sw-net-ask { font-size: 20px; font-weight: 700; color: var(--sw-lav); text-align: center; }
.sw-net-slotrow { display: flex; gap: 10px; align-items: center; justify-content: center; }
.sw-net-slot { width: 88px; height: 88px; border-radius: 24px; border: 4px dashed rgba(156,123,255,.55); background: rgba(255,255,255,.6); display: grid; place-items: center; transition: transform .2s var(--sw-bounce); }
.sw-net-slot.sw-filled { border: 4px solid #fff; background: var(--t, #fff); box-shadow: 0 5px 12px var(--sw-shadow); animation: sw-pop .3s var(--sw-bounce); }
.sw-net-slot.sw-next { border-color: var(--sw-pink); background: #fff; animation: sw-net-blink 1.2s ease-in-out infinite; }
.sw-net-slot .sw-pic { width: 70px; height: 70px; }
.sw-net-slot-num { font-size: 26px; font-weight: 700; color: rgba(156,123,255,.55); }
@keyframes sw-net-blink { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,95,162,.0); } 50% { box-shadow: 0 0 0 6px rgba(255,95,162,.35); } }
.sw-net-back.sw-btn { width: 88px; height: 88px; min-height: 88px; padding: 0; border-radius: 24px; flex-direction: column; gap: 0; font-size: 15px; }
.sw-net-back.sw-btn svg { width: 36px; height: 36px; }
.sw-net-keys { display: grid; grid-template-columns: repeat(6, 88px); gap: 10px; justify-content: center; }
.sw-net-key { width: 88px; height: 88px; padding: 0; cursor: pointer; transition: transform .16s var(--sw-bounce); touch-action: manipulation; }
.sw-net-key:active, .sw-net-key.sw-pressed { transform: scale(.88); }
.sw-net-key[disabled] { opacity: .45; cursor: default; }
.sw-net-keyrow { display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap; }
.sw-net-go.sw-btn { min-width: 220px; }
.sw-net-oops { display: flex; align-items: center; gap: 10px; max-width: 560px; padding: 10px 16px; border-radius: 20px; background: #FFF1D6; border: 3px solid #FFC94D; color: var(--sw-ink); font-size: 17px; font-weight: 600; animation: sw-pop .3s var(--sw-bounce); }
.sw-net-oops svg { width: 30px; height: 30px; color: #F5A300; flex: none; }
.sw-net-oops[hidden] { display: none; }

/* joining cards (inside the keypad panel) */
.sw-net-joining { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 6px 4px 8px; text-align: center; }
.sw-net-joining[hidden], .sw-net-keypad[hidden] { display: none; }
.sw-net-joining-pics { display: flex; gap: 8px; }
.sw-net-joining-pics .sw-net-mini { width: 64px; height: 64px; border-radius: 18px; background: var(--t, #fff); border: 4px solid #fff; display: grid; place-items: center; box-shadow: 0 4px 10px var(--sw-shadow); animation: sw-net-hop 1.1s ease-in-out infinite; }
.sw-net-joining-pics .sw-net-mini:nth-child(2) { animation-delay: .15s; }
.sw-net-joining-pics .sw-net-mini:nth-child(3) { animation-delay: .3s; }
.sw-net-joining-pics .sw-net-mini:nth-child(4) { animation-delay: .45s; }
.sw-net-joining-pics .sw-pic { width: 50px; height: 50px; }
@keyframes sw-net-hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-12px); } }
.sw-net-door { width: 110px; height: 110px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 5px solid var(--sw-pink-soft); color: var(--sw-pink); box-shadow: 0 6px 18px var(--sw-shadow); }
.sw-net-door svg { width: 64px; height: 64px; animation: sw-net-knock 1.4s ease-in-out infinite; transform-origin: 40% 90%; }
@keyframes sw-net-knock { 0%, 55%, 100% { transform: rotate(0); } 62% { transform: rotate(-7deg); } 70% { transform: rotate(4deg); } 78% { transform: rotate(-7deg); } 86% { transform: rotate(3deg); } }
.sw-net-joining-text { font-size: 26px; font-weight: 700; color: var(--sw-ink); max-width: 560px; }
.sw-net-joining-sub { font-size: 17px; font-weight: 600; color: var(--sw-lav); }
.sw-net-bar { width: min(360px, 80%); height: 18px; border-radius: 999px; background: #fff; border: 3px solid var(--sw-pink-soft); overflow: hidden; }
.sw-net-bar > div { height: 100%; width: 0; background: linear-gradient(90deg, var(--sw-pink), var(--sw-lav)); border-radius: 999px; transition: width .3s; }
.sw-net-bar[hidden] { display: none; }

/* ---------- players ---------- */
.sw-net-players { display: flex; flex-direction: column; gap: 12px; }
.sw-net-code { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 10px 10px; border-radius: 26px; background: linear-gradient(170deg, #FFF3FA, #F1ECFF); border: 4px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); }
.sw-net-code-title { font-size: 20px; font-weight: 700; color: var(--sw-pink); display: flex; align-items: center; gap: 8px; }
.sw-net-code-title svg { width: 24px; height: 24px; }
.sw-net-code-tiles { display: flex; gap: 10px; justify-content: center; }
.sw-net-code-tiles .sw-net-tile { width: 96px; height: 106px; padding-top: 4px; }
.sw-net-code-tiles .sw-net-tile .sw-pic { width: 70px; }
.sw-net-code-tiles.sw-wait .sw-net-tile { opacity: .35; }
.sw-net-code-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
.sw-net-rows { display: flex; flex-direction: column; gap: 8px; }
.sw-net-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 22px; background: #fff; border: 4px solid var(--c, var(--sw-pink-soft)); box-shadow: 0 3px 8px rgba(58,31,77,.12); min-height: 72px; }
.sw-net-face { position: relative; width: 58px; height: 58px; flex: none; border-radius: 50%; background: var(--c); border: 3px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); overflow: hidden; display: grid; place-items: center; color: #fff; }
.sw-net-face img { width: 100%; height: 100%; object-fit: cover; }
.sw-net-face svg { width: 30px; height: 30px; }
.sw-net-crown { position: absolute; left: 36px; top: -4px; width: 28px; height: 28px; color: #FFB300; filter: drop-shadow(0 2px 0 #fff) drop-shadow(0 -1px 0 #fff); }
.sw-net-row-face { position: relative; }
.sw-net-who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.1; }
.sw-net-who-name { font-size: 21px; font-weight: 700; color: var(--sw-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.sw-net-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(58,31,77,.15); flex: none; }
.sw-net-who-sub { font-size: 14px; font-weight: 600; color: var(--sw-lav); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-net-who-acct { font-size: 12px; font-weight: 600; color: rgba(58,31,77,.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-net-badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 0 7px; border-radius: 999px; background: #FFE9A8; color: #7A5B00; vertical-align: middle; margin-left: 4px; }
.sw-net-row-btns { display: flex; gap: 6px; flex: none; }
.sw-net-row-btns .sw-btn { min-height: 56px; padding: 4px 10px; flex-direction: column; gap: 0; font-size: 13px; border-radius: 18px; border-width: 3px; min-width: 84px; }
.sw-net-row-btns .sw-btn svg { width: 24px; height: 24px; }
.sw-net-waiting { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 22px; border: 4px dashed rgba(156,123,255,.4); color: var(--sw-lav); font-size: 18px; font-weight: 600; }
.sw-net-waiting svg { width: 34px; height: 34px; flex: none; animation: sw-net-hop 1.6s ease-in-out infinite; }
.sw-net-rules { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sw-net-rule { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 20px; background: #fff; border: 4px solid var(--sw-lav-soft); cursor: pointer; font-family: var(--sw-font); color: var(--sw-ink); text-align: left; min-height: 72px; }
.sw-net-rule-text { flex: 1; min-width: 0; line-height: 1.1; }
.sw-net-rule-name { font-size: 18px; font-weight: 700; }
.sw-net-rule-sub { font-size: 13px; font-weight: 600; color: var(--sw-lav); }
.sw-net-switch { position: relative; width: 62px; height: 36px; border-radius: 999px; background: #D9D2E9; flex: none; transition: background .2s; box-shadow: inset 0 2px 4px rgba(58,31,77,.15); }
.sw-net-switch::after { content: ''; position: absolute; left: 4px; top: 4px; width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(58,31,77,.3); transition: transform .22s var(--sw-bounce); }
.sw-net-rule.sw-on .sw-net-switch { background: var(--sw-mint); }
.sw-net-rule.sw-on .sw-net-switch::after { transform: translateX(26px); }
.sw-net-bottom { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }

/* ---------- say ---------- */
.sw-net-phrases { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.sw-net-phrase.sw-btn { --c: #fff; --fg: var(--sw-ink); flex-direction: column; gap: 4px; min-height: 92px; padding: 8px 6px; border-radius: 22px; border-color: var(--pc); font-size: 17px; text-shadow: none; white-space: normal; line-height: 1.05; }
.sw-net-phrase.sw-btn svg { width: 36px; height: 36px; color: var(--pc); }

/* ---------- speech bubbles over heads ---------- */
.sw-net-say { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 6px; padding: 7px 14px 7px 8px; border-radius: 22px; background: #fff; border: 4px solid var(--c, var(--sw-pink)); box-shadow: 0 5px 14px var(--sw-shadow); font-size: 19px; font-weight: 700; color: var(--sw-ink); white-space: nowrap; pointer-events: none !important; opacity: 0; transition: opacity .2s; will-change: transform; }
.sw-net-say.sw-on { opacity: 1; }
.sw-net-say::after { content: ''; position: absolute; left: 50%; bottom: -14px; margin-left: -10px; border: 10px solid transparent; border-top: 12px solid var(--c, var(--sw-pink)); border-bottom: 0; }
.sw-net-say-ic svg { width: 28px; height: 28px; display: block; }
.sw-net-say-who { font-size: 14px; color: var(--c); margin-right: 2px; }

/* ---------- knock card ---------- */
.sw-net-knock { position: absolute; left: 50%; top: calc(86px + var(--sw-safe-t)); transform: translateX(-50%); width: min(520px, calc(100% - 24px)); display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 30px; background: var(--sw-cream); border: 5px solid #fff; box-shadow: 0 0 0 4px var(--sw-pink), 0 18px 44px rgba(58,31,77,.4); animation: sw-net-in .45s var(--sw-bounce); }
@keyframes sw-net-in { from { transform: translate(-50%, -30px) scale(.8); opacity: 0; } to { transform: translate(-50%, 0) scale(1); opacity: 1; } }
.sw-net-knock .sw-net-face { width: 92px; height: 92px; }
.sw-net-knock-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.sw-net-knock-text { font-size: 24px; font-weight: 700; color: var(--sw-ink); line-height: 1.1; }
.sw-net-knock-text b { color: var(--sw-pink); }
.sw-net-knock-acct { font-size: 13px; font-weight: 600; color: rgba(58,31,77,.6); margin-top: -4px; }
.sw-net-knock-acct:empty { display: none; }
.sw-net-knock-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.sw-net-knock-btns .sw-btn { min-height: 60px; font-size: 21px; }
.sw-net-knock-more { position: absolute; right: 12px; top: -14px; background: var(--sw-sun); color: var(--sw-ink); font-size: 14px; font-weight: 700; border-radius: 999px; padding: 2px 10px; border: 3px solid #fff; }

/* ---------- message cards ---------- */
.sw-net-msg-wrap { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(58,31,77,.25); animation: sw-fade .2s ease-out; }
.sw-net-msg { position: relative; width: min(500px, 100%); display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 22px 22px 20px; border-radius: 32px; background: var(--sw-cream); border: 5px solid #fff; box-shadow: 0 8px 0 rgba(58,31,77,.12), 0 22px 60px rgba(58,31,77,.35); text-align: center; animation: sw-pop .35s var(--sw-bounce); }
.sw-net-msg-icon { width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; background: var(--c, var(--sw-pink)); color: #fff; border: 5px solid #fff; box-shadow: 0 5px 14px var(--sw-shadow); margin-top: -64px; }
.sw-net-msg-icon svg { width: 54px; height: 54px; }
.sw-net-msg-text { font-size: 25px; font-weight: 700; color: var(--sw-ink); line-height: 1.2; }
.sw-net-msg-small { font-size: 15px; font-weight: 600; color: var(--sw-lav); line-height: 1.25; }
.sw-net-msg-small:empty { display: none; }
.sw-net-msg-btns { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.sw-net-msg-btns .sw-btn { min-width: 150px; }
.sw-net-msg .sw-net-small.sw-btn { min-width: 0; }

/* ---------- status pills ---------- */
.sw-net-away { position: absolute; left: 50%; top: calc(74px + var(--sw-safe-t)); transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 18px 8px 10px; border-radius: 999px; background: rgba(255,255,255,.95); border: 4px solid var(--sw-lav-soft); box-shadow: 0 6px 16px var(--sw-shadow); font-size: 18px; font-weight: 700; color: var(--sw-ink); pointer-events: none !important; white-space: nowrap; max-width: calc(100% - 24px); }
.sw-net-away svg { width: 28px; height: 28px; color: var(--sw-lav); flex: none; animation: sw-net-hop 2s ease-in-out infinite; }
.sw-net-away span { overflow: hidden; text-overflow: ellipsis; }
.sw-net-away[hidden] { display: none; }
.sw-net-away.sw-net-paused svg { color: var(--sw-sun); animation: none; }

/* ---------- "Before friends" confirm: the picture of the copy ---------- */
.sw-net-before-pic { display: block; width: min(240px, 100%); aspect-ratio: 8 / 5; object-fit: cover; margin: 0 auto 6px; border-radius: 16px; border: 4px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); }

@media (max-width: 760px) {
  .sw-net-keys { grid-template-columns: repeat(4, 80px); gap: 8px; }
  .sw-net-key { width: 80px; height: 80px; }
  .sw-net-slot, .sw-net-back.sw-btn { width: 64px; height: 64px; min-height: 64px; border-radius: 18px; }
  .sw-net-slot .sw-pic { width: 50px; height: 50px; }
  .sw-net-back.sw-btn svg { width: 28px; height: 28px; }
  .sw-net-back.sw-btn .sw-btn-label { display: none; }
  .sw-net-slotrow { gap: 8px; }
  .sw-net-cards { grid-template-columns: 1fr; gap: 12px; }
  .sw-net-card { flex-direction: row; text-align: left; padding: 10px; gap: 10px; }
  .sw-net-card-art { flex-direction: column; padding: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .sw-net-card-art .sw-net-mini { width: 40px; height: 40px; border-radius: 12px; }
  .sw-net-card-art .sw-net-mini .sw-pic { width: 32px; height: 32px; }
  .sw-net-card-words { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
  .sw-net-card-title { font-size: 25px; }
  .sw-net-card-sub { text-align: left; font-size: 15px; }
  .sw-net-code-tiles { gap: 6px; }
  .sw-net-code-tiles .sw-net-tile { width: 76px; height: 88px; border-radius: 18px; }
  .sw-net-code-tiles .sw-net-tile .sw-pic { width: 56px; }
  .sw-net-rules { grid-template-columns: 1fr; }
  .sw-net-phrases { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .sw-net-phrase.sw-btn { flex-direction: row; min-height: 80px; justify-content: flex-start; gap: 8px; padding: 6px 10px; }
  .sw-net-row { flex-wrap: wrap; }
  .sw-net-row-btns { width: 100%; }
  .sw-net-row-btns .sw-btn { flex: 1; min-height: 50px; flex-direction: row; gap: 6px; }
  .sw-net-knock { flex-direction: column; text-align: center; top: calc(64px + var(--sw-safe-t)); }
  .sw-net-knock .sw-net-face { width: 80px; height: 80px; }
  .sw-net-knock-btns { justify-content: center; }
  .sw-net-joining-text { font-size: 22px; }
  .sw-net-msg-text { font-size: 22px; }
  .sw-net-away { font-size: 16px; top: calc(118px + var(--sw-safe-t)); }
}
@media (min-width: 761px) { .sw-net-card-words { display: contents; } }
@media (max-height: 560px) and (min-width: 761px) {
  .sw-net-keys { grid-template-columns: repeat(6, 76px); gap: 8px; }
  .sw-net-key { width: 76px; height: 76px; }
  .sw-net-slot, .sw-net-back.sw-btn { width: 72px; height: 72px; min-height: 72px; }
  .sw-net-slot .sw-pic { width: 56px; height: 56px; }
}
`;

/** A picture tile (keypad key, code tile, chosen slot). */
function tile(ui, word, { tag = 'div', cls = '', label = true } = {}) {
  const pic = CODE_PICTURES.find((p) => p.word === word) || CODE_PICTURES[0];
  const e = ui.el(tag, 'sw-net-tile ' + cls);
  if (tag === 'button') e.type = 'button';
  e.style.setProperty('--t', pic.tint);
  e.innerHTML = pictureSvg(pic.word);
  if (label) e.appendChild(ui.el('span', 'sw-net-word', pic.name));
  e.dataset.pic = pic.word;
  e.setAttribute('aria-label', pic.name);
  return e;
}

function mini(ui, word) {
  const e = ui.el('span', 'sw-net-mini');
  if (word) {
    const pic = CODE_PICTURES.find((p) => p.word === word);
    e.style.setProperty('--t', pic ? pic.tint : '#fff');
    e.innerHTML = pictureSvg(word);
  } else {
    e.classList.add('sw-empty');
    e.innerHTML = icon2('help');
  }
  return e;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function installNetUI(game, net, remote) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const layer = ui.el('div', 'sw-net-layer');
  ui.root.appendChild(layer);
  const S = net.session;

  // ---------- small helpers ----------

  const hostName = () => sanitizeName(S.guestCore ? S.guestCore.hostName : '', '') || 'your friend';
  const text = (code, vars = {}) => {
    const v = { ...vars };
    if (v.host !== undefined) v.host = sanitizeName(String(v.host || ''), '') || 'your friend';
    if (v.name !== undefined) v.name = sanitizeName(String(v.name || ''), 'Friend');
    return cap(messageText(code, v));
  };
  const playerName = () => sanitizeName(game.profile.playerName || (game.profile.look && game.profile.look.name) || '', 'Friend');
  const say = (t) => { if (typeof game.speak === 'function') game.speak(t); };
  const netProfile = () => {
    const p = game.profile;
    if (!p.net || typeof p.net !== 'object') p.net = {};
    return p.net;
  };

  const portraits = new Map(); // look string -> Promise<dataURL|null>
  function portrait(lk, name) {
    const key = lk || '-';
    let pr = portraits.get(key);
    if (!pr) {
      let look;
      try {
        look = lk ? unpackLook(lk, name) : game.defaultLook;
      } catch {
        look = game.defaultLook;
      }
      pr = getStage().snapshot('net-head:' + key, look, { frame: 'head', size: 160 })
        .then((c) => {
          if (!c) return null;
          try {
            return c.toDataURL('image/png');
          } catch {
            return null;
          }
        })
        .catch(() => null);
      portraits.set(key, pr);
    }
    return pr;
  }

  function faceEl(color, lk, name, crown = false) {
    const wrap = ui.el('span', 'sw-net-row-face');
    const f = ui.el('span', 'sw-net-face');
    f.style.setProperty('--c', color);
    f.innerHTML = icon2('person');
    portrait(lk, name).then((url) => {
      if (!url) return;
      const img = ui.el('img');
      img.alt = '';
      img.src = url;
      f.innerHTML = '';
      f.appendChild(img);
    });
    wrap.appendChild(f);
    if (crown) {
      const c = ui.el('span', 'sw-net-crown');
      c.innerHTML = icon2('crown');
      wrap.appendChild(c);
    }
    return wrap;
  }

  /** The platform account name of a peer (claude.ai only; grown-ups' small print). */
  async function accountName(uid) {
    const t = S.transport;
    if (!uid || !t || typeof t.accountName !== 'function') return '';
    try {
      return (await t.accountName(uid)) || '';
    } catch {
      return '';
    }
  }

  // ======================================================================================
  // message cards (§12): friendly words, never codes
  // ======================================================================================

  const MSG_LOOK = {
    cannot_host: { icon: 'players', c: 'var(--sw-sky)' },
    no_rooms: { icon: 'players', c: 'var(--sw-lav)' },
    busy: { icon: 'clock', c: 'var(--sw-sun)' },
    transient: { icon: 'cloud', c: 'var(--sw-sky)' },
    no_host: { icon: 'help', c: 'var(--sw-sun)' },
    version: { icon: 'again', c: 'var(--sw-mint)' },
    denied: { icon: 'knock', c: 'var(--sw-lav)' },
    no_answer: { icon: 'knock', c: 'var(--sw-sky)' },
    full: { icon: 'players', c: 'var(--sw-lav)' },
    snapshot_failed: { icon: 'world', c: 'var(--sw-sky)' },
    host_gone: { icon: 'home', c: 'var(--sw-pink)' },
    ended: { icon: 'home', c: 'var(--sw-pink)' },
    kicked: { icon: 'home', c: 'var(--sw-lav)' },
    backup_failed: { icon: 'world', c: 'var(--sw-sun)' },
    fatal: { icon: 'players', c: 'var(--sw-lav)' },
    summary: { icon: 'heart', c: 'var(--sw-pink)' },
    need_world: { icon: 'world', c: 'var(--sw-mint)' },
  };

  let msgWrap = null;
  let lastAction = null; // { kind: 'host'|'join', code } for "Try again"

  function closeMessage() {
    if (msgWrap) {
      msgWrap.remove();
      msgWrap = null;
    }
  }

  /**
   * Show a message card. opts: { text, small, icon, color, buttons: [{ label, icon, variant,
   * run, cls }] } or a session message code (+ vars).
   */
  function showCard({ text: t, small = '', icon = 'heart', color = 'var(--sw-pink)', buttons = [], code = '' }) {
    closeMessage();
    const wrap = ui.el('div', 'sw-net-msg-wrap');
    const card = ui.el('div', 'sw-net-msg');
    card.dataset.code = code;
    card.setAttribute('role', 'dialog');
    const ic = ui.el('div', 'sw-net-msg-icon');
    ic.style.setProperty('--c', color);
    ic.innerHTML = icon2(icon);
    const btns = ui.el('div', 'sw-net-msg-btns');
    for (const b of buttons.length ? buttons : [{ label: 'OK', icon: 'check', variant: 'pink' }]) {
      btns.appendChild(button2(ui, {
        icon: b.icon, label: b.label, variant: b.variant || 'pink', size: b.size || null,
        className: 'sw-net-msg-btn ' + (b.cls || ''),
        onClick: () => {
          closeMessage();
          if (b.run) b.run();
        },
      }));
    }
    card.append(ic, ui.el('div', 'sw-net-msg-text', t), ui.el('div', 'sw-net-msg-small', small), btns);
    wrap.appendChild(card);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeMessage(); });
    layer.appendChild(wrap);
    msgWrap = wrap;
    game.audio.play('chime');
    say(t);
    return card;
  }

  function showMessage(code, vars = {}) {
    const look = MSG_LOOK[code] || { icon: 'heart', c: 'var(--sw-pink)' };
    const t = text(code, vars);
    if (!t) return null;
    const buttons = [];
    let small = '';
    if (code === 'cannot_host') {
      small = text('cannot_host_small');
      buttons.push({ label: 'Join a Code', icon: 'players', variant: 'sky', run: () => openJoin() }, { label: 'OK', icon: 'check', variant: 'white' });
    } else if (code === 'version') {
      small = 'Everyone playing together needs the newest Sparkle World.';
      buttons.push({ label: 'Refresh', icon: 'again', variant: 'mint', run: () => location.reload() });
    } else if ((code === 'transient' || code === 'snapshot_failed') && lastAction) {
      const again = lastAction;
      buttons.push({ label: 'Try again', icon: 'again', variant: 'mint', run: () => (again.kind === 'join' ? startJoin(again.code) : startHost(again)) }, { label: 'Not now', icon: 'close', variant: 'white' });
    } else if (code === 'fatal') {
      small = game.mode === 'play' && game.world && !game._isShared?.() ? 'Your world is here and everything is saved.' : 'Your own worlds are right here.';
    } else if (code === 'no_host' && lastAction && lastAction.kind === 'join') {
      const again = lastAction;
      buttons.push({ label: 'Check the pictures', icon: 'grid', variant: 'sky', run: () => openJoin(again.code) }, { label: 'OK', icon: 'check', variant: 'white' });
    } else if (code === 'no_answer' && lastAction && lastAction.kind === 'join') {
      const again = lastAction;
      buttons.push({ label: 'Knock again', icon: 'knock', variant: 'mint', run: () => startJoin(again.code, { chip: again.chip }) }, { label: 'Not now', icon: 'close', variant: 'white' });
    }
    return showCard({ text: t, small, icon: look.icon, color: look.c, buttons, code });
  }

  // ======================================================================================
  // hosting
  // ======================================================================================

  let hosting = false;
  let pendingHost = null; // { at } set when "Make a Code" needs a new world first

  /** profile.net.lastHost when it is fresh and for this world (her friends may be waiting). */
  function freshLastHost(worldId) {
    const h = game.profile && game.profile.net && game.profile.net.lastHost;
    if (!h || !isCode(h.code) || !worldId || h.worldId !== worldId) return null;
    return Date.now() - (h.at || 0) < HOST_RESUME_MS ? h : null;
  }

  async function startHost({ code = null, resume = false, uids = [] } = {}) {
    if (hosting || net.active) return false;
    if (game.mode !== 'play' || !game.world || game._isShared?.()) return false;
    // her friends from a moment ago (her page reloaded) still have these pictures: the same
    // code again, and they come straight back in
    if (!code && !resume) {
      const h = freshLastHost(game.world.meta && game.world.meta.id);
      if (h) {
        code = h.code.slice();
        resume = true;
        uids = h.uids || [];
      }
    }
    hosting = true;
    lastAction = { kind: 'host', code, resume, uids };
    closeMessage();
    game.toast(resume ? 'Opening your door again…' : 'Making your code…', { icon: 'players', key: 'net-host' });
    try {
      const ok = await net.host({ code, resume, uids });
      if (ok) {
        game.audio.play('magic');
        game.celebrate([game.player.position.x, game.player.position.y + 1.2, game.player.position.z], 'sparkle');
        // a new code: show it big; the same code again (Keep playing): her friends know it
        if (resume) game.toast('Your door is open again! Your friends can come back.', { icon: 'players', color: 'mint', key: 'net-host' });
        else ui.open('mp-players', { fresh: true });
      }
      return ok;
    } finally {
      hosting = false;
    }
  }

  /** Title: "Make a Code" opens the last world, then hosts; with no world, make one first. */
  async function hostFromTitle() {
    if (game.mode === 'play' && game.world) {
      ui.close();
      return startHost();
    }
    const worlds = await game.store.listWorlds();
    if (!worlds.length) {
      pendingHost = { at: performance.now() };
      showCard({
        text: 'Make a world first!', small: 'Then your friends can come and play in it.', icon: 'world', color: 'var(--sw-mint)', code: 'need_world',
        buttons: [{ label: 'New World', icon: 'plus', variant: 'mint', run: () => ui.open('newworld') }],
      });
      return false;
    }
    const last = worlds.find((w) => w.id === game.profile.lastWorldId) || worlds[0];
    pendingHost = { at: performance.now(), id: last.id };
    ui.close();
    const ok = await game.loadWorld(last.id);
    if (!ok) pendingHost = null;
    return ok;
  }

  /** Host: Save & Exit ends playing together kindly (friends go home, summary, title). */
  async function hostSaveAndExit() {
    clearLastHost();
    await net.leave();
    await game.exitToTitle();
  }

  // (the title redraws its resume chips on 'profile:changed')
  function clearLastHost() {
    const n = netProfile();
    if (n.lastHost) {
      n.lastHost = null;
      game.saveProfile();
      game.events.emit('profile:changed', { profile: game.profile });
    }
  }

  function clearLastJoin() {
    const n = netProfile();
    if (n.lastJoin) {
      n.lastJoin = null;
      game.saveProfile();
      game.events.emit('profile:changed', { profile: game.profile });
    }
  }

  // ======================================================================================
  // joining
  // ======================================================================================

  let joinView = null; // keypad panel parts
  const chosen = [];

  async function startJoin(code, { chip = null } = {}) {
    if (!isCode(code)) return false;
    if (net.active) return false;
    lastAction = { kind: 'join', code: code.slice(), chip };
    closeMessage();
    if (!ui.isOpen('mp-join')) ui.open('mp-join', { code, go: false });
    showJoining('finding');
    game.audio.play('magic');
    const ok = await net.join(code.slice());
    if (!ok && ui.isOpen('mp-join') && !net.active) showKeypad();
    return ok;
  }

  // ======================================================================================
  // resume chips (title and Play with Friends)
  // ======================================================================================

  /** [{ kind, label, sub, code, run }] for the chips shown now. */
  function resumeChips() {
    const out = [];
    if (!net.available || net.active) return out;
    const n = game.profile && game.profile.net;
    if (!n) return out;
    const now = Date.now();
    const h = n.lastHost;
    if (h && isCode(h.code) && h.worldId && now - (h.at || 0) < HOST_RESUME_MS) {
      out.push({
        kind: 'host', label: 'Keep playing', sub: 'with your friends', code: h.code,
        run: () => resumeHost(h),
      });
    }
    const j = n.lastJoin;
    if (j && isCode(j.code) && now - (j.at || 0) < GUEST_RESUME_MS) {
      const who = sanitizeName(j.hostName || '', '') || 'your friend';
      out.push({ kind: 'guest', label: `Join ${who}`, sub: 'again', code: j.code, run: () => { ui.open('mp-join', { code: j.code }); startJoin(j.code, { chip: who }); } });
    }
    return out;
  }

  async function resumeHost(h) {
    pendingHost = { at: performance.now(), id: h.worldId, code: h.code, resume: true, uids: h.uids || [] };
    ui.close();
    const ok = game.world && game.world.meta && game.world.meta.id === h.worldId && game.mode === 'play' ? true : await game.loadWorld(h.worldId);
    if (!ok) {
      pendingHost = null;
      clearLastHost();
    }
  }

  function chipButton(c) {
    const b = button2(ui, { variant: c.kind === 'host' ? 'pink' : 'sky', className: 'sw-net-chip sw-net-chip--' + c.kind, onClick: () => c.run() });
    const pics = ui.el('span', 'sw-net-chip-pics');
    for (const w of c.code) pics.insertAdjacentHTML('beforeend', pictureSvg(w));
    const words = ui.el('span', 'sw-net-chip-words');
    words.append(ui.el('span', '', c.label), ui.el('span', 'sw-net-chip-sub', c.sub));
    b.querySelector('.sw-btn-label')?.remove();
    b.append(pics, words);
    b.setAttribute('aria-label', `${c.label} ${c.sub}`);
    b.dataset.kind = c.kind;
    return b;
  }

  // ======================================================================================
  // panel: Play with Friends (mp-start)
  // ======================================================================================

  let startChips, startWorld;
  // ======================================================================================
  // the name step: others read her name on their knock card and over her head
  // ======================================================================================

  /** Is her name still the game's own starting name (never chosen by her)? */
  function nameUnset() {
    const p = game.profile || {};
    if (p.nameSet) return false;
    const cur = p.playerName || (p.look && p.look.name) || '';
    return !cur || cur === ((game.defaultLook && game.defaultLook.name) || 'Lily');
  }

  /** Ask once: "What's your name?" Resolves false when she closes it. */
  async function ensureName() {
    if (!nameUnset()) return true;
    const v = await ui.textInput({
      title: "What's your name?", placeholder: 'Your name', ok: 'That\'s me!', maxLength: 16,
      suggestions: [],
    });
    if (!v) return false;
    const p = game.profile;
    p.playerName = v;
    p.nameSet = true;
    if (p.look) p.look.name = v;
    game.saveProfile();
    game.events.emit('avatar:changed', { look: p.look });
    game.events.emit('profile:changed', { profile: p });
    game.toast(`Hi, ${sanitizeName(v, 'friend')}!`, { icon: 'heart' });
    return true;
  }

  ui.registerPanel('mp-start', {
    title: 'Play with Friends',
    icon: 'players',
    width: 760,
    back: (g) => (g.mode === 'title' ? 'title' : null),
    build(container) {
      const col = ui.el('div', 'sw-net-start');
      startChips = ui.el('div', 'sw-net-chips');
      const cards = ui.el('div', 'sw-net-cards');
      const card = (cls, a, b, c, iconName, title, sub, art, onClick) => {
        const e = ui.el('button', 'sw-net-card ' + cls);
        e.type = 'button';
        e.style.setProperty('--a', a);
        e.style.setProperty('--b', b);
        e.style.setProperty('--c', c);
        e.setAttribute('aria-label', title);
        const artEl = ui.el('span', 'sw-net-card-art');
        for (const w of art) artEl.appendChild(mini(ui, w));
        const words = ui.el('span', 'sw-net-card-words');
        const t = ui.el('span', 'sw-net-card-title');
        t.innerHTML = icon2(iconName);
        t.appendChild(ui.el('span', '', title));
        words.append(t, ui.el('span', 'sw-net-card-sub', sub));
        e.append(artEl, words);
        e.addEventListener('click', () => {
          game.audio.play('pop');
          onClick();
        });
        return { e, words };
      };
      const make = card('sw-net-invite', '#FFE3EF', '#FFC6E0', 'var(--sw-pink)', 'sparkle', 'Make a Code', 'Friends come to your world', ['heart', 'star', 'moon', 'cat'], () => hostFromTitle());
      startWorld = ui.el('span', 'sw-net-card-world');
      make.words.appendChild(startWorld);
      const join = card('sw-net-join', '#E3F4FF', '#C9E8FF', '#3AAEF0', 'knock', 'Join a Code', "Visit a friend's world", [null, null, null, null], () => openJoin());
      cards.append(make.e, join.e);
      const note = ui.el('div', 'sw-net-note', 'Only friends you say yes to can come in. No typing, no chatting: just waves, dances and happy words.');
      col.append(startChips, cards, note);
      container.appendChild(col);
    },
    async onOpen() {
      startChips.innerHTML = '';
      for (const c of resumeChips()) startChips.appendChild(chipButton(c));
      startWorld.textContent = '';
      if (game.mode === 'play' && game.world) startWorld.textContent = game.world.meta.name;
      else {
        const worlds = await game.store.listWorlds();
        const last = worlds.find((w) => w.id === game.profile.lastWorldId) || worlds[0];
        if (last) startWorld.textContent = last.name;
      }
    },
  });
  game.registerAction('mp-start', (g) => {
    ensureName().then((ok) => { if (ok) g.ui.open('mp-start'); });
    return true;
  });

  // ======================================================================================
  // panel: the keypad (mp-join)
  // ======================================================================================

  function openJoin(code = null) {
    ui.open('mp-join', { code });
  }

  function renderSlots() {
    const v = joinView;
    if (!v) return;
    v.slots.forEach((s, k) => {
      s.innerHTML = '';
      s.className = 'sw-net-slot';
      const w = chosen[k];
      if (w) {
        const pic = CODE_PICTURES.find((p) => p.word === w);
        s.classList.add('sw-filled');
        s.style.setProperty('--t', pic.tint);
        s.innerHTML = pictureSvg(w);
        s.dataset.pic = w;
        s.setAttribute('aria-label', pic.name);
      } else {
        delete s.dataset.pic;
        s.style.removeProperty('--t');
        if (k === chosen.length) s.classList.add('sw-next');
        s.appendChild(ui.el('span', 'sw-net-slot-num', String(k + 1)));
        s.setAttribute('aria-label', `Picture ${k + 1}`);
      }
    });
    v.go.disabled = chosen.length !== 4;
    v.back.disabled = chosen.length === 0;
    v.clear.disabled = chosen.length === 0;
    for (const k of v.keys) k.disabled = chosen.length >= 4;
  }

  function showKeypad(oops = null) {
    const v = joinView;
    if (!v) return;
    v.keypad.hidden = false;
    v.joining.hidden = true;
    v.oops.hidden = !oops;
    if (oops) {
      v.oopsText.textContent = oops;
      say(oops);
    }
    ui.setTitle('mp-join', 'Join a Code');
    renderSlots();
  }

  function showJoining(phase, progress = null) {
    const v = joinView;
    if (!v) return;
    v.keypad.hidden = true;
    v.joining.hidden = false;
    v.joining.dataset.phase = phase;
    const who = hostName();
    v.jPics.innerHTML = '';
    v.jDoor.hidden = phase !== 'knocking';
    v.jPics.hidden = phase === 'knocking';
    for (const w of lastAction && lastAction.code ? lastAction.code : chosen) v.jPics.appendChild(mini(ui, w));
    v.bar.hidden = phase !== 'loading';
    v.cancel.hidden = phase === 'loading';
    let t = '', sub = '';
    if (phase === 'finding') {
      t = 'Looking for your friend…';
      sub = 'Hold on tight!';
    } else if (phase === 'knocking') {
      t = `Knock knock! Waiting for ${who} to say yes…`;
      sub = `${cap(who)} will tap "Let in!"`;
    } else {
      t = `Flying to ${who}'s world…`;
      sub = 'Almost there!';
      if (progress) v.barFill.style.width = `${Math.round(Math.max(0.04, Math.min(1, progress.have / Math.max(1, progress.of))) * 100)}%`;
    }
    if (v.jText.textContent !== t) {
      v.jText.textContent = t;
      say(t);
    }
    v.jSub.textContent = sub;
    ui.setTitle('mp-join', phase === 'loading' ? 'Here we go!' : 'Visiting a friend');
  }

  ui.registerPanel('mp-join', {
    title: 'Join a Code',
    icon: 'knock',
    width: 740,
    back: (g) => (g.mode === 'title' ? 'mp-start' : null),
    build(container) {
      const keypad = ui.el('div', 'sw-net-keypad');
      const ask = ui.el('div', 'sw-net-ask', 'Tap the 4 pictures your friend tells you');
      const slotRow = ui.el('div', 'sw-net-slotrow');
      const slots = [];
      for (let k = 0; k < 4; k++) {
        const s = ui.el('div', 'sw-net-slot');
        slots.push(s);
        slotRow.appendChild(s);
      }
      const back = button2(ui, {
        icon: 'back', label: 'Back', variant: 'white', className: 'sw-net-back',
        onClick: () => {
          chosen.pop();
          joinView.oops.hidden = true;
          renderSlots();
        },
      });
      slotRow.appendChild(back);
      const keys = ui.el('div', 'sw-net-keys');
      const keyEls = [];
      for (const w of CODE_WORDS) {
        const k = tile(ui, w, { tag: 'button', cls: 'sw-net-key' });
        k.addEventListener('click', () => {
          if (chosen.length >= 4) return;
          chosen.push(w);
          joinView.oops.hidden = true;
          game.audio.play('pop', { pitch: 0.9 + chosen.length * 0.12 });
          say(pictureName(w));
          k.classList.add('sw-pressed');
          setTimeout(() => k.classList.remove('sw-pressed'), 140);
          renderSlots();
          if (chosen.length === 4) {
            game.audio.play('sparkle');
            joinView.go.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
          }
        });
        keyEls.push(k);
        keys.appendChild(k);
      }
      const oops = ui.el('div', 'sw-net-oops');
      oops.innerHTML = icon2('help');
      const oopsText = ui.el('span', '');
      oops.appendChild(oopsText);
      oops.hidden = true;
      const row = ui.el('div', 'sw-net-keyrow');
      const clear = button2(ui, { icon: 'trash', label: 'Clear', variant: 'white', className: 'sw-net-clear', onClick: () => { chosen.length = 0; oops.hidden = true; renderSlots(); } });
      const go = button2(ui, {
        icon: 'play', label: 'Go!', variant: 'pink', size: 'big', className: 'sw-net-go',
        onClick: () => { if (chosen.length === 4) startJoin(chosen.slice()); },
      });
      row.append(clear, go);
      keypad.append(ask, slotRow, oops, keys, row);

      const joining = ui.el('div', 'sw-net-joining');
      joining.hidden = true;
      const jPics = ui.el('div', 'sw-net-joining-pics');
      const jDoor = ui.el('div', 'sw-net-door');
      jDoor.innerHTML = icon2('knock');
      const jText = ui.el('div', 'sw-net-joining-text', '');
      const jSub = ui.el('div', 'sw-net-joining-sub', '');
      const bar = ui.el('div', 'sw-net-bar');
      const barFill = ui.el('div');
      bar.appendChild(barFill);
      const cancel = button2(ui, {
        icon: 'close', label: 'Cancel', variant: 'white', className: 'sw-net-cancel',
        onClick: () => cancelJoin(),
      });
      joining.append(jPics, jDoor, jText, jSub, bar, cancel);
      container.append(keypad, joining);
      joinView = { keypad, joining, slots, back, keys: keyEls, go, clear, oops, oopsText, jPics, jDoor, jText, jSub, bar, barFill, cancel };
    },
    onOpen(args = {}) {
      if (args && isCode(args.code)) {
        chosen.length = 0;
        chosen.push(...args.code);
      } else if (!net.active) {
        chosen.length = 0;
      }
      const st = S.state;
      if (st === 'g.finding' || st === 'g.joining') showJoining('finding');
      else if (st === 'g.knocking') showJoining('knocking');
      else if (st === 'g.loading') showJoining('loading');
      else showKeypad();
    },
    onClose() {
      // closing while knocking means "never mind"
      const st = S.state;
      if (st === 'g.finding' || st === 'g.knocking' || st === 'g.joining') cancelJoin(false);
    },
  });

  function cancelJoin(reopen = true) {
    clearLastJoin();
    if (net.active && net.isGuest) net.leave({ quiet: true });
    if (reopen && ui.isOpen('mp-join')) showKeypad();
  }

  // ======================================================================================
  // panel: Players (mp-players)
  // ======================================================================================

  let playersBody = null;
  let playersTimer = 0;
  let playersKey = '';

  function codeBox(code, waiting) {
    const box = ui.el('div', 'sw-net-code');
    const title = ui.el('div', 'sw-net-code-title');
    title.innerHTML = icon2('sparkle');
    title.appendChild(ui.el('span', '', waiting ? 'Making your code…' : 'Your code'));
    const tiles = ui.el('div', 'sw-net-code-tiles' + (waiting ? ' sw-wait' : ''));
    for (const w of code || ['heart', 'star', 'moon', 'cat']) {
      const t = tile(ui, w, { tag: 'button', cls: 'sw-net-codetile' });
      t.addEventListener('click', () => {
        game.audio.play('pop');
        if (typeof game.speak === 'function') game.speak(pictureName(w), true);
      });
      tiles.appendChild(t);
    }
    box.append(title, tiles);
    if (!waiting) {
      const row = ui.el('div', 'sw-net-code-row');
      row.appendChild(ui.el('div', 'sw-net-ask', 'Say these pictures to play together!'));
      row.appendChild(button2(ui, {
        icon: 'speak', label: 'Say it', variant: 'white', size: 'small', className: 'sw-net-sayit',
        onClick: () => { if (typeof game.speak === 'function') game.speak(`Your code is ${codeWords(code)}`, true); },
      }));
      box.appendChild(row);
      const where = net.kind === 'ws' && typeof location !== 'undefined' ? `open ${location.host} ` : 'open Sparkle World ';
      box.appendChild(ui.el('div', 'sw-net-note', `Grown-ups: friends ${where}and tap Play with Friends, then Join a Code. Code: ${code.join('-')}`));
    }
    return box;
  }

  function ruleToggle(cls, name, sub, on, onChange) {
    const b = ui.el('button', 'sw-net-rule ' + cls + (on ? ' sw-on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!on));
    const t = ui.el('span', 'sw-net-rule-text');
    t.append(ui.el('div', 'sw-net-rule-name', name), ui.el('div', 'sw-net-rule-sub', sub));
    b.append(t, ui.el('span', 'sw-net-switch'));
    b.addEventListener('click', () => {
      const v = !b.classList.contains('sw-on');
      b.classList.toggle('sw-on', v);
      b.setAttribute('aria-checked', String(v));
      game.audio.play('pop', { pitch: v ? 1.2 : 0.85 });
      onChange(v);
    });
    return b;
  }

  function playerRow(pl, isHostView, name) {
    const st = pl.state || {};
    const color = seatColor(pl.seat);
    const row = ui.el('div', 'sw-net-row');
    row.dataset.seat = String(pl.seat);
    row.dataset.peer = pl.peer || '';
    row.style.setProperty('--c', color);
    const lk = pl.you ? null : typeof st.lk === 'string' ? st.lk : null;
    row.appendChild(faceEl(color, pl.you ? myLook() : lk, name, !!pl.host));
    const who = ui.el('div', 'sw-net-who');
    const nameLine = ui.el('div', 'sw-net-who-name');
    const dot = ui.el('span', 'sw-net-dot');
    nameLine.append(dot, ui.el('span', 'sw-net-who-text', name + (pl.you ? ' (you)' : '')));
    if (pl.guest) nameLine.appendChild(ui.el('span', 'sw-net-badge', 'visitor'));
    let sub = pl.host ? "It's her world" : 'Visiting';
    if (pl.host && pl.you) sub = "It's your world";
    if (!pl.you && pl.away) sub = pl.host ? 'Taking a little break' : 'Coming back…';
    else if (!pl.you && !pl.host && (!Array.isArray(st.p) || (st.rx && typeof st.rx === 'object'))) sub = 'Flying here…';
    who.append(nameLine, ui.el('div', 'sw-net-who-sub', sub));
    const acct = ui.el('div', 'sw-net-who-acct', '');
    who.appendChild(acct);
    if (!pl.you && pl.uid) accountName(pl.uid).then((a) => { if (a) acct.textContent = `Account: ${a}`; });
    row.appendChild(who);
    if (isHostView && !pl.you && !pl.host) {
      const btns = ui.el('div', 'sw-net-row-btns');
      btns.append(
        button2(ui, {
          icon: 'undo', label: 'Undo building', variant: 'white', className: 'sw-net-undo',
          onClick: async () => {
            // after her page came back (a reload), the list only knows what came after
            const since = S.hostCore && S.hostCore.resumed ? ' since you came back' : '';
            const ok = await ui.confirm({ title: `Undo ${name}'s building?`, text: `Everything ${name} built or changed${since} goes back. You can press Undo to bring it back.`, yes: 'Yes, undo', no: 'No', icon: 'undo' });
            if (!ok) return;
            const n = S.undoSeat(pl.seat);
            game.toast(n > 0 ? `${name}'s building went back.` : `${name} hasn't built anything yet.`, { icon: 'undo' });
          },
        }),
        button2(ui, {
          icon: 'home', label: 'Send home', variant: 'white', className: 'sw-net-kick',
          onClick: async () => {
            const ok = await ui.confirm({ title: `Send ${name} home?`, text: `${name} goes back to her own world and can't come back in this game.`, yes: 'Yes, send home', no: 'No', icon: 'home' });
            if (!ok) return;
            remote.hush(pl.peer); // one goodbye (this one), not a second when her avatar leaves
            S.kick(pl.peer);
            game.toast(`${name} went home.`, { icon: 'home' });
            renderPlayers(true);
          },
        }),
      );
      row.appendChild(btns);
    }
    return row;
  }

  /** The name each player shows as (a second "Lily" becomes "Lily 2", in seat order). */
  function shownNames(players) {
    const count = new Map();
    return players.map((pl) => {
      const st = pl.state || {};
      const base = pl.you ? playerName() : sanitizeName(typeof st.nm === 'string' ? st.nm : pl.name || '', 'Friend');
      const key = base.toLowerCase();
      const n = (count.get(key) || 0) + 1;
      count.set(key, n);
      return n > 1 ? `${base} ${n}` : base;
    });
  }

  function myLook() {
    try {
      return net.adapter && typeof net.adapter.local === 'function' ? net.adapter.local().lk : null;
    } catch {
      return null;
    }
  }

  function renderPlayers(force = false) {
    if (!playersBody) return;
    const st = S.state;
    const players = net.active ? S.players() : [];
    const key = JSON.stringify([st, net.code, S.rules, players.map((p) => [p.peer, p.seat, p.away, p.state && p.state.nm, p.state && p.state.lk, p.state && Array.isArray(p.state.p)])]);
    if (!force && key === playersKey) return;
    playersKey = key;
    playersBody.innerHTML = '';
    const col = ui.el('div', 'sw-net-players');
    if (!net.active) {
      col.appendChild(ui.el('div', 'sw-net-waiting', 'Nobody is playing together right now.'));
      playersBody.appendChild(col);
      return;
    }
    const isHost = net.isHost;
    if (isHost) col.appendChild(codeBox(net.code, st === 'h.opening'));
    const rows = ui.el('div', 'sw-net-rows');
    const names = shownNames(players);
    players.forEach((pl, k) => rows.appendChild(playerRow(pl, isHost, names[k])));
    if (isHost && players.length < 2) {
      const w = ui.el('div', 'sw-net-waiting');
      w.innerHTML = icon2('knock');
      w.appendChild(ui.el('span', '', 'Waiting for players to knock…'));
      rows.appendChild(w);
    }
    col.appendChild(rows);
    if (isHost) {
      const rules = S.rules;
      const box = ui.el('div', 'sw-net-rules');
      box.append(
        ruleToggle('sw-net-rule-build', 'Players can build', 'Blocks, furniture and gardens', rules.build === 1, (v) => S.setRules({ build: v ? 1 : 0 })),
        ruleToggle('sw-net-rule-careful', 'Careful players', "They can't change your things", rules.mine !== 1, (v) => S.setRules({ mine: v ? 0 : 1 })),
      );
      col.appendChild(box);
    }
    const bottom = ui.el('div', 'sw-net-bottom');
    if (isHost) {
      bottom.appendChild(button2(ui, {
        icon: 'close', label: 'Stop playing', variant: 'lav', className: 'sw-net-stop',
        onClick: async () => {
          const ok = await ui.confirm({ title: 'Stop playing together?', text: 'The other players go home and your world is saved.', yes: 'Yes, stop', no: 'Keep playing', icon: 'home' });
          if (!ok) return;
          clearLastHost();
          ui.close();
          await net.leave();
        },
      }));
    } else {
      bottom.appendChild(button2(ui, {
        icon: 'home', label: 'Go home', variant: 'lav', className: 'sw-net-gohome',
        onClick: async () => {
          const ok = await ui.confirm({ title: 'Go home?', text: `You leave ${hostName()}'s world and go back to yours.`, yes: 'Yes, go home', no: 'Stay', icon: 'home' });
          if (!ok) return;
          ui.close();
          await game.exitToTitle();
        },
      }));
    }
    col.appendChild(bottom);
    playersBody.appendChild(col);
  }

  ui.registerPanel('mp-players', {
    title: 'Players',
    icon: 'players',
    width: 620,
    build(container) {
      playersBody = container;
      playersBody.classList.add('sw-net-players-body');
    },
    onOpen() {
      // the same word as the HUD button that opens it (NPC friends own "Friends")
      ui.setTitle('mp-players', 'Players');
      renderPlayers(true);
    },
  });
  game.registerAction('mp-players', (g) => {
    if (!net.active) return false;
    g.ui.toggle('mp-players');
    return true;
  });

  // ======================================================================================
  // panel: Say (mp-say)
  // ======================================================================================

  ui.registerPanel('mp-say', {
    title: 'Say something!',
    icon: 'talk',
    width: 720,
    build(container) {
      const grid = ui.el('div', 'sw-net-phrases');
      for (const p of PHRASES) {
        const b = ui.el('button', 'sw-btn sw-net-phrase');
        b.type = 'button';
        b.dataset.id = String(p.id);
        b.style.setProperty('--pc', p.color);
        b.innerHTML = phraseIcon(p.id);
        b.appendChild(ui.el('span', 'sw-btn-label', p.text));
        b.setAttribute('aria-label', p.text);
        b.addEventListener('click', () => {
          if (!net.active) return;
          if (net.say(p.id)) {
            remote.sayMine(p.id);
            ui.close();
          } else {
            b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
          }
        });
        grid.appendChild(b);
      }
      container.appendChild(grid);
    },
  });
  game.registerAction('mp-say', (g) => {
    if (!net.active || g.mode !== 'play') return false;
    g.ui.toggle('mp-say');
    return true;
  });
  game.input.on('key', (e) => {
    if (!e.down || e.repeat || e.code !== 'KeyT' || ui.dialogOpen) return;
    if (game.mode !== 'play' || !net.active) return;
    const open = ui.current;
    if (!open || open === 'mp-say') game.runAction('mp-say');
  });

  // ======================================================================================
  // knock cards (host)
  // ======================================================================================

  const knocks = []; // info queue
  let knockEl = null;
  let knockPeer = null;

  function knockSound() {
    game.audio.play('click', { pitch: 0.55 });
    setTimeout(() => game.audio.play('click', { pitch: 0.5 }), 170);
    setTimeout(() => game.audio.play('chime'), 520);
  }

  function showNextKnock() {
    if (knockEl) {
      knockEl.remove();
      knockEl = null;
      knockPeer = null;
    }
    const info = knocks[0];
    if (!info || !net.isHost) return;
    // a name someone playing already has gets a number, so she can tell them apart
    const base = sanitizeName(info.name || '', 'Friend');
    const taken = shownNames(S.players()).map((n) => n.toLowerCase());
    let name = base;
    for (let n = 2; taken.includes(name.toLowerCase()); n++) name = `${base} ${n}`;
    const card = ui.el('div', 'sw-net-knock');
    card.dataset.peer = info.peer;
    card.setAttribute('role', 'alertdialog');
    card.appendChild(faceEl('var(--sw-pink)', info.look || null, name, false));
    const main = ui.el('div', 'sw-net-knock-main');
    const t = ui.el('div', 'sw-net-knock-text');
    const b = ui.el('b', '', name);
    t.append(b, document.createTextNode(' wants to play!'));
    const acct = ui.el('div', 'sw-net-knock-acct', '');
    if (info.guest) acct.textContent = 'visitor';
    accountName(info.uid).then((a) => {
      if (a) acct.textContent = `Account: ${a}` + (info.guest ? ' (visitor)' : '');
    });
    const btns = ui.el('div', 'sw-net-knock-btns');
    btns.append(
      button2(ui, {
        icon: 'check', label: 'Let in!', variant: 'mint', className: 'sw-net-yes',
        onClick: () => {
          knocks.shift();
          if (S.admit(info.peer)) {
            game.audio.play('success');
            game.toast(`${name} is coming in!`, { icon: 'players', color: 'mint' });
          }
          showNextKnock();
          if (ui.isOpen('mp-players')) renderPlayers(true);
        },
      }),
      button2(ui, {
        icon: 'close', label: 'Not now', variant: 'white', className: 'sw-net-no',
        onClick: () => {
          knocks.shift();
          S.deny(info.peer);
          showNextKnock();
        },
      }),
    );
    main.append(t, acct, btns);
    card.appendChild(main);
    if (knocks.length > 1) card.appendChild(ui.el('span', 'sw-net-knock-more', `+${knocks.length - 1} more`));
    layer.appendChild(card);
    knockEl = card;
    knockPeer = info.peer;
    knockSound();
    say(`${name} wants to play!`);
  }

  game.events.on('net:knock', (info) => {
    if (!info || knocks.some((k) => k.peer === info.peer)) return;
    knocks.push(info);
    if (!knockEl) {
      showNextKnock();
      return;
    }
    knockEl.querySelector('.sw-net-knock-more')?.remove();
    knockEl.appendChild(ui.el('span', 'sw-net-knock-more', `+${knocks.length - 1} more`));
  });
  game.events.on('net:knock-gone', ({ peer, name, waited } = {}) => {
    const k = knocks.findIndex((x) => x.peer === peer);
    if (k < 0) return;
    knocks.splice(k, 1);
    if (knockPeer === peer) showNextKnock();
    // her card was up a long time and nobody answered: tell the host kindly
    if (net.isHost && waited >= KNOCK_MISSED_MS) {
      const who = sanitizeName(name || '', 'A friend');
      game.toast(`${who} knocked while you were busy. She can knock again!`, { icon: 'knock', duration: 6000 });
    }
  });

  // ======================================================================================
  // status: host away, reconnecting, sending
  // ======================================================================================

  const away = ui.el('div', 'sw-net-away');
  away.hidden = true;
  away.innerHTML = icon2('moon');
  const awayText = ui.el('span', '');
  away.appendChild(awayText);
  layer.appendChild(away);

  // ======================================================================================
  // session events
  // ======================================================================================

  let unloading = false;
  if (typeof window !== 'undefined') {
    // capture: runs before the facade's own pagehide listener drops the session
    window.addEventListener('pagehide', () => { unloading = true; }, true);
    window.addEventListener('pageshow', () => { unloading = false; });
  }

  let prevRole = null;
  game.events.on('net:state', (s = {}) => {
    const st = s.state;
    if (st === 'g.knocking' && ui.isOpen('mp-join')) showJoining('knocking');
    if (st === 'g.finding' && ui.isOpen('mp-join')) showJoining('finding');
    if (st === 'g.loading' && ui.isOpen('mp-join')) showJoining('loading', { have: 0, of: 1 });
    if (st === 'g.live' && ui.isOpen('mp-join')) ui.close();
    refreshPill();
    if (st === 'idle') {
      knocks.length = 0;
      showNextKnock();
      if (prevRole === 'host' && !unloading) setTimeout(() => clearLastHost(), 0);
      if (ui.isOpen('mp-players') || ui.isOpen('mp-say')) ui.close();
      if (ui.isOpen('mp-join') && !msgWrap) showKeypad();
    }
    if (st === 'h.live' && pendingHost) pendingHost = null;
    prevRole = s.role || (st === 'idle' ? null : prevRole);
    if (ui.isOpen('mp-players')) renderPlayers();
  });

  /**
   * The pill under the top bar: "Lily is taking a little break…" while she is away; for a
   * visiting friend "Lily paused building" while building is switched off (else nothing).
   */
  function refreshPill() {
    const st = S.state;
    let t = '';
    let paused = false;
    if (st === 'g.waiting') t = text('host_away', { host: hostName() });
    else if (st === 'g.live' && S.guestCore && S.guestCore.rules.build === 0) {
      t = text('building_paused', { host: hostName() });
      paused = true;
    }
    if (t && awayText.textContent !== t) awayText.textContent = t;
    away.classList.toggle('sw-net-paused', paused);
    away.innerHTML = '';
    away.insertAdjacentHTML('afterbegin', icon2(paused ? 'build' : 'moon'));
    away.appendChild(awayText);
    away.hidden = !t;
  }
  game.events.on('net:rules', refreshPill);

  game.events.on('net:progress', (p) => {
    if (ui.isOpen('mp-join') && S.state === 'g.loading') showJoining('loading', p);
  });

  game.events.on('net:message', (m = {}) => {
    const code = m.code;
    if (!code || code === 'unavailable') return;
    // (host_gone and fatal keep her "Join Lily" chip: her friend may be back with the same
    // pictures in a moment; if she is not, the chip says so and goes, see below)
    if (['kicked', 'denied', 'ended', 'version', 'full'].includes(code)) clearLastJoin();
    // a "Join Lily again" chip whose friend is not playing any more: say so, and the chip goes
    if (code === 'no_host' && lastAction && lastAction.kind === 'join' && lastAction.chip) {
      clearLastJoin();
      const who = sanitizeName(lastAction.chip, '') || 'Your friend';
      if (ui.isOpen('mp-join')) showKeypad();
      showCard({ text: `${cap(who)} isn't playing right now. Ask her for a new code!`, icon: 'home', color: 'var(--sw-sun)', code: 'no_host_chip' });
      return;
    }
    // wrong pictures: the "oops" right on the keypad, her pictures still there to fix
    if (code === 'no_host' && ui.isOpen('mp-join')) {
      showKeypad(text('no_host'));
      return;
    }
    if (ui.isOpen('mp-join')) showKeypad();
    showMessage(code, m.vars || {});
  });

  game.events.on('net:summary', () => {
    showCard({
      text: text('summary'), icon: 'heart', color: 'var(--sw-pink)', code: 'summary',
      buttons: [
        { label: 'Great!', icon: 'check', variant: 'pink' },
        { label: 'Before friends', icon: 'undo', variant: 'white', size: 'small', cls: 'sw-net-small sw-net-before', run: () => restoreBefore() },
      ],
    });
  });

  game.events.on('net:resync', () => {
    game.toast(text('resync'), { icon: 'sparkle', key: 'net-resync' });
  });

  game.events.on('net:players', () => {
    if (ui.isOpen('mp-players')) renderPlayers();
  });

  // pending "Make a Code" / "Keep playing": host as soon as the world is ready; back on the
  // title without a world means "never mind"
  game.events.on('world:load', ({ world } = {}) => {
    if (pendingHost && performance.now() - pendingHost.at > 10 * 60 * 1000) pendingHost = null;
    // she opened the world her friends are waiting in (Play instead of "Keep playing"): ask
    if (!pendingHost && world && world.meta && !world.meta.shared && !net.active) {
      const h = freshLastHost(world.meta.id);
      if (h) {
        Promise.resolve(net.detect ? net.detect() : net.available)
          .then((ok) => { if (ok) setTimeout(() => askToReopen(h, world), 400); })
          .catch(() => {});
      }
    }
  });

  /** "Your friends are waiting! Open your door again?" (the same code; they come straight in). */
  function askToReopen(h, world) {
    if (net.active || game.world !== world || game.mode !== 'play') return;
    showCard({
      text: 'Your friends are waiting!', small: 'Open your door again? They still have your pictures.', icon: 'players', color: 'var(--sw-mint)', code: 'friends_waiting',
      buttons: [
        { label: 'Yes, open my door', icon: 'check', variant: 'mint', cls: 'sw-net-reopen', run: () => startHost({ code: h.code, resume: true, uids: h.uids || [] }) },
        { label: 'Not now', icon: 'close', variant: 'white', run: () => clearLastHost() },
      ],
    });
  }
  game.events.on('ui:open', ({ panel } = {}) => {
    if (panel === 'title' && pendingHost && game.mode === 'title' && !game._busy) pendingHost = null;
  });

  // ======================================================================================
  // "Before friends" (the backup made when hosting started, §11.7, §13)
  // ======================================================================================

  /** world id -> its backup meta, for backups younger than 7 days. */
  async function backups() {
    const out = new Map();
    const store = game.store;
    if (typeof store.listBackups !== 'function') return out;
    try {
      for (const b of await store.listBackups()) {
        const id = b.backupOf || (typeof b.id === 'string' ? b.id.replace(/\.before$/, '') : null);
        const at = b.backupAt || b.updatedAt || 0;
        if (id && Date.now() - at < BACKUP_DAYS * 86400000) out.set(id, b);
      }
    } catch {
      // no list: no button
    }
    return out;
  }

  /** The world's backup meta when one younger than 7 days exists. */
  async function backupFor(worldId) {
    if (!worldId) return null;
    return (await backups()).get(worldId) || null;
  }

  /**
   * Two questions (with the copy's picture and day, and the honest words: everything since
   * then goes, hers too), then the world goes back to how it was before friends came. The
   * world as it was is kept, so an "Undo" on the card after brings it back.
   */
  async function restoreBefore(worldId = null) {
    const id = worldId || (game.world && game.world.meta ? game.world.meta.id : null) || game.profile.lastWorldId;
    if (!id || typeof game.store.restoreBackup !== 'function') return false;
    const b = await backupFor(id);
    if (!b) {
      game.toast('There is no copy from before friends came.', { icon: 'world' });
      return false;
    }
    const when = dayWord(b.backupAt || b.updatedAt || Date.now());
    const first = await ui.confirm({
      title: 'Go back to how it was before friends came?',
      text: `Your world goes back to this copy from ${when}. Everything built since then goes away, also what you built.`,
      image: b.thumbnail || null, imageClass: 'sw-net-before-pic', yes: 'Yes, go back', no: 'No, keep it', icon: 'undo',
    });
    if (!first) return false;
    const second = await ui.confirm({ title: 'Are you really sure?', text: `Everything built since ${when} goes away.`, yes: 'Yes, go back', no: 'No, keep it', icon: 'undo' });
    if (!second) return false;
    net._restoring = true; // (the save on the way out must not count as building alone)
    let res;
    try {
      if (net.active) await net.leave({ quiet: true });
      const inIt0 = game.mode === 'play' && game.world && game.world.meta.id === id;
      // leave (the world as it is now is saved: it becomes the undo copy), then restore
      if (inIt0) await game.exitToTitle();
      res = await game.store.restoreBackup(id);
      res.inIt = inIt0;
    } finally {
      net._restoring = false;
    }
    const inIt = res.inIt;
    if (!res || !res.ok) {
      game.toast("Oops! That didn't work.", { icon: 'world' });
      return false;
    }
    game.audio.play('magic');
    if (inIt) await game.loadWorld(id);
    game.events.emit('net:restored', { id });
    showCard({
      text: 'Your world is back to how it was!', small: res.undo ? 'Changed your mind? Undo brings back what was there.' : '',
      icon: 'world', color: 'var(--sw-mint)', code: 'restored',
      buttons: [
        { label: 'Great!', icon: 'check', variant: 'mint' },
        ...(res.undo ? [{ label: 'Undo', icon: 'undo', variant: 'white', cls: 'sw-net-restore-undo', run: () => undoRestore(id) }] : []),
      ],
    });
    return true;
  }

  /** Take a "Before friends" back: the world as it was just before comes back. */
  async function undoRestore(id) {
    if (typeof game.store.restoreUndo !== 'function') return false;
    const inIt = game.mode === 'play' && game.world && game.world.meta.id === id;
    if (inIt) {
      // no save over the undo copy's world: the world now is the restored copy, nothing new
      await game.exitToTitle();
    }
    const res = await game.store.restoreUndo(id);
    if (!res || !res.ok) {
      game.toast("Oops! That didn't work.", { icon: 'world' });
      return false;
    }
    game.audio.play('magic');
    game.toast('Everything is back!', { icon: 'world', color: 'mint' });
    if (inIt) await game.loadWorld(id);
    game.events.emit('net:restored', { id, undo: true });
    return true;
  }

  // ======================================================================================
  // per frame
  // ======================================================================================

  function update(dt) {
    if (pendingHost && !net.active && !hosting && game.mode === 'play' && game.world && !game.loading && !game._busy) {
      const p = pendingHost;
      if (!p.id || (game.world.meta && game.world.meta.id === p.id) || !p.resume) {
        pendingHost = null;
        startHost({ code: p.code || null, resume: !!p.resume, uids: p.uids || [] });
      }
    }
    if (ui.isOpen('mp-players')) {
      playersTimer -= dt;
      if (playersTimer <= 0) {
        playersTimer = 0.5;
        renderPlayers();
      }
    }
  }

  const api = {
    update,
    resumeChips,
    chipButton,
    openStart: () => game.runAction('mp-start'),
    dayWord: (at) => dayWord(at).replace(/^on /, ''),
    ensureName,
    nameUnset,
    openJoin,
    startHost,
    startJoin,
    hostFromTitle,
    hostSaveAndExit,
    backups,
    backupFor,
    restoreBefore,
    undoRestore,
    showMessage,
    closeMessage,
    clearLastHost,
    clearLastJoin,
    get knocks() { return knocks.slice(); },
  };
  return api;
}
