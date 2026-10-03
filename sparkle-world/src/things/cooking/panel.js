// The Cooking panel ('cooking', args { entity, station: 'stove'|'oven'|'fridge'|'counter' }):
//  1. Recipe book: big recipe cards (recipes for this station first; garden recipes show
//     what to grow when the basket is missing crops).
//  2. Tap the ingredients into the glass bowl in order (the bowl fills with colored layers).
//  3. Stir by drawing circles on the bowl (or tapping it).
//  4. Into the oven / pot / fridge / blender with a timer... ding!
//  5. The dish pops out (spinning 3D, confetti) into the basket; emits 'cook:done' { recipe }.

import { RECIPES, METHODS, gardenNeeds, ingredientColor, ingredientName, PANTRY } from './recipes.js';
import { FOOD, foodIcon, foodModel, foodName } from '../food-models.js';
import { basketCount, basketAdd, basketTake, lifeButton, lifeIcon } from '../pets/kit.js';
import { preview } from '../pets/preview.js';
import { sfx } from '../pets/sfx.js';
import { mixHex } from '../../core/util.js';

const CSS = /* css */ `
.lf-cook { position: relative; }
.lf-cook [hidden] { display: none !important; }
.lf-book-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.lf-station { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px 6px 10px; border-radius: 999px; background: var(--sw-sun); color: var(--sw-ink); font-size: 18px; font-weight: 700; border: 3px solid #fff; box-shadow: 0 3px 8px var(--sw-shadow); }
.lf-station svg { width: 26px; height: 26px; }
.lf-pantry { font-size: 16px; font-weight: 600; color: var(--sw-lav); }
.lf-recipes { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
.lf-recipe { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px 10px; border-radius: 22px; background: #fff; border: 4px solid var(--sw-pink-soft); cursor: pointer; font-family: var(--sw-font); color: var(--sw-ink); transition: transform .18s var(--sw-bounce), border-color .15s; box-shadow: 0 4px 10px rgba(58,31,77,.1); }
.lf-recipe:hover { transform: translateY(-3px) scale(1.03); border-color: var(--sw-pink); }
.lf-recipe:active { transform: scale(.95); }
.lf-recipe.lf-here { border-color: #FFD27A; background: linear-gradient(#FFFDF4, #fff); }
.lf-recipe-pic { width: 96px; height: 96px; border-radius: 50%; background: radial-gradient(circle at 50% 40%, #fff, #FFEAF4 65%, #F3ECFF); display: grid; place-items: center; }
.lf-recipe-pic img { width: 92px; height: 92px; pointer-events: none; }
.lf-recipe-name { font-size: 18px; font-weight: 700; text-align: center; line-height: 1.1; }
.lf-ings { display: flex; gap: 2px; justify-content: center; flex-wrap: wrap; min-height: 30px; }
.lf-ings img { width: 30px; height: 30px; pointer-events: none; }
.lf-method { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; color: #fff; background: var(--sw-lav); padding: 2px 10px 2px 6px; border-radius: 999px; }
.lf-method svg { width: 18px; height: 18px; }
.lf-recipe .lf-have { position: absolute; top: 6px; right: 8px; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 15px; background: var(--sw-mint); color: #fff; font-weight: 700; font-size: 15px; display: grid; place-items: center; border: 3px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); }
.lf-recipe.lf-locked .lf-recipe-pic, .lf-recipe.lf-locked .lf-recipe-name, .lf-recipe.lf-locked .lf-ings { opacity: .55; filter: saturate(.6); }
.lf-need { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; color: #fff; background: var(--sw-mint); padding: 2px 10px; border-radius: 999px; }
.lf-need img { width: 24px; height: 24px; }

.lf-steps { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 2px 0 12px; }
.lf-step { position: relative; width: 58px; height: 58px; border-radius: 50%; background: #fff; border: 4px solid var(--sw-lav-soft); display: grid; place-items: center; transition: transform .2s var(--sw-bounce); }
.lf-step img { width: 44px; height: 44px; }
.lf-step .lf-num { position: absolute; left: -6px; top: -6px; width: 24px; height: 24px; border-radius: 50%; background: var(--sw-lav); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; }
.lf-step.lf-next { border-color: var(--sw-pink); transform: scale(1.14); box-shadow: 0 0 0 4px #fff, 0 0 16px rgba(255,95,162,.6); }
.lf-step.lf-done { opacity: .5; }
.lf-step.lf-done::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; background: rgba(63,216,176,.25); }
.lf-step .lf-tick { position: absolute; right: -6px; bottom: -6px; width: 26px; height: 26px; border-radius: 50%; background: var(--sw-mint); color: #fff; display: none; place-items: center; border: 2px solid #fff; z-index: 1; }
.lf-step.lf-done .lf-tick { display: grid; }
.lf-step .lf-tick svg { width: 16px; height: 16px; }

.lf-stage2 { display: grid; grid-template-columns: minmax(250px, 330px) 1fr; gap: 16px; align-items: center; }
.lf-shelf { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px; border-radius: 24px; background: linear-gradient(#FFF1D6, #FFE2B8); border: 4px solid #fff; box-shadow: inset 0 -6px 0 rgba(160,110,60,.12), 0 4px 12px var(--sw-shadow); }
.lf-ing { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0; padding: 6px 2px 6px; min-height: 92px; border-radius: 18px; background: #fff; border: 3px solid #fff; box-shadow: 0 3px 0 rgba(58,31,77,.08), 0 4px 10px rgba(58,31,77,.12); cursor: pointer; font-family: var(--sw-font); transition: transform .15s var(--sw-bounce); touch-action: manipulation; }
.lf-ing img { width: 62px; height: 62px; pointer-events: none; }
.lf-ing span { font-size: 13px; font-weight: 700; color: var(--sw-ink); line-height: 1.05; text-align: center; }
.lf-ing:active { transform: scale(.9); }
.lf-ing.lf-glow { border-color: var(--sw-pink); animation: lf-pulse-glow .9s ease-in-out infinite; }
.lf-ing.lf-glow::after { content: ''; position: absolute; left: 50%; top: -16px; width: 0; height: 0; margin-left: -10px; border: 10px solid transparent; border-top: 14px solid var(--sw-pink); animation: lf-bob .8s ease-in-out infinite; pointer-events: none; }
@keyframes lf-pulse-glow { 0%, 100% { box-shadow: 0 0 0 3px #fff, 0 0 8px rgba(255,95,162,.45); } 50% { box-shadow: 0 0 0 3px #fff, 0 0 22px rgba(255,95,162,.95); } }
.lf-ing.lf-wiggle { animation: sw-wiggle .35s ease-in-out 2; }
.lf-ing.lf-used { opacity: .45; }
@keyframes lf-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

.lf-work { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px; min-height: 330px; padding: 8px; border-radius: 26px; background: radial-gradient(circle at 50% 30%, #FFFFFF, #FFF1F8 60%, #F1EAFF); border: 4px solid #fff; }
.lf-say { position: relative; max-width: 100%; padding: 8px 18px; border-radius: 20px; background: #fff; border: 3px solid var(--sw-mint); font-size: 21px; font-weight: 700; color: var(--sw-ink); text-align: center; box-shadow: 0 4px 10px var(--sw-shadow); animation: sw-pop .3s var(--sw-bounce); }
.lf-bowl { position: relative; width: 230px; height: 176px; margin-top: 6px; cursor: pointer; touch-action: none; }
.lf-bowl-glass { position: absolute; left: 0; right: 0; bottom: 0; height: 146px; border-radius: 16px 16px 118px 118px / 16px 16px 130px 130px; background: rgba(214,238,255,.55); border: 6px solid #fff; overflow: hidden; box-shadow: 0 10px 20px rgba(58,31,77,.18), inset 0 -8px 0 rgba(108,198,255,.15); }
.lf-layers { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column-reverse; }
.lf-layer { height: 0; transition: height .45s var(--sw-bounce); border-radius: 60% 60% 0 0 / 14px 14px 0 0; }
.lf-swirl { position: absolute; left: -20%; right: -20%; bottom: -60%; height: 180%; border-radius: 50%; opacity: 0; background: repeating-conic-gradient(from 0deg, var(--batter) 0 18deg, var(--batter2) 18deg 36deg); transition: opacity .2s; }
.lf-bowl-rim { position: absolute; left: -2px; right: -2px; top: 16px; height: 34px; border-radius: 50%; border: 6px solid #fff; background: rgba(255,255,255,.18); pointer-events: none; }
.lf-bowl-shine { position: absolute; left: 26px; top: 64px; width: 16px; height: 62px; border-radius: 10px; background: rgba(255,255,255,.75); transform: rotate(18deg); pointer-events: none; }
.lf-spoon { position: absolute; left: 50%; top: 40%; width: 20px; height: 130px; margin: -118px 0 0 -10px; transform-origin: 50% 100%; pointer-events: none; display: none; }
.lf-spoon::before { content: ''; position: absolute; left: 6px; top: 0; width: 8px; height: 100px; border-radius: 4px; background: #E0B07A; box-shadow: inset -2px 0 0 rgba(0,0,0,.08); }
.lf-spoon::after { content: ''; position: absolute; left: -2px; bottom: 0; width: 24px; height: 34px; border-radius: 50%; background: #E9C08E; }
.lf-bowl.lf-stirring .lf-spoon { display: block; }
.lf-bowl.lf-plop { animation: lf-plop .35s var(--sw-bounce); }
@keyframes lf-plop { 0% { transform: scale(1); } 40% { transform: scale(1.06, .94); } 100% { transform: scale(1); } }
.lf-fly { position: fixed; width: 64px; height: 64px; pointer-events: none; z-index: 80; }
.lf-hearts { display: flex; gap: 6px; }
.lf-hearts span { width: 30px; height: 30px; color: var(--sw-pink-soft); transition: color .2s, transform .2s var(--sw-bounce); }
.lf-hearts span.lf-on { color: var(--sw-pink); transform: scale(1.2); }
.lf-hearts svg { width: 100%; height: 100%; }
.lf-tip { font-size: 15px; font-weight: 600; color: var(--sw-lav); text-align: center; }
.lf-go-cook .sw-btn { animation: lf-pulse-btn 1s ease-in-out infinite; }
@keyframes lf-pulse-btn { 0%, 100% { box-shadow: 0 5px 0 rgba(58,31,77,.16), 0 0 0 0 rgba(255,95,162,.5); } 50% { box-shadow: 0 5px 0 rgba(58,31,77,.16), 0 0 0 12px rgba(255,95,162,0); } }

.lf-appwrap { position: relative; width: 220px; height: 210px; --batter: #FFD6A0; }
.lf-app { width: 100%; height: 100%; overflow: visible; }
.lf-timer { width: 220px; height: 22px; border-radius: 999px; background: #fff; border: 3px solid #fff; box-shadow: 0 3px 8px var(--sw-shadow); overflow: hidden; }
.lf-timer div { height: 100%; width: 0%; border-radius: 999px; background: repeating-linear-gradient(-45deg, var(--sw-sun) 0 12px, #FFD97A 12px 24px); }
.lf-oven-glow { opacity: .15; transition: opacity .6s; }
.lf-appwrap.lf-on .lf-oven-glow { animation: lf-glow 1.2s ease-in-out infinite; }
@keyframes lf-glow { 0%, 100% { opacity: .55; } 50% { opacity: .95; } }
.lf-oven-food { transform-origin: 100px 124px; transform-box: view-box; transition: transform 3s ease-out; }
.lf-appwrap.lf-on .lf-oven-food { transform: scale(1.25, 2.1); }
.lf-flame { transform-origin: center; transform-box: fill-box; opacity: 0; }
.lf-appwrap.lf-on .lf-flame { opacity: 1; animation: lf-flick .25s ease-in-out infinite alternate; }
@keyframes lf-flick { from { transform: scaleY(.8); } to { transform: scaleY(1.15); } }
.lf-bub { opacity: 0; transform-box: fill-box; }
.lf-appwrap.lf-on .lf-bub { animation: lf-bubble 1s ease-in infinite; }
.lf-appwrap.lf-on .lf-bub:nth-child(2n) { animation-delay: .35s; }
.lf-appwrap.lf-on .lf-bub:nth-child(3n) { animation-delay: .7s; }
@keyframes lf-bubble { 0% { opacity: 0; transform: translateY(6px) scale(.5); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px) scale(1.1); } }
.lf-steam { opacity: 0; }
.lf-appwrap.lf-on .lf-steam { animation: lf-steam 1.6s ease-out infinite; }
.lf-appwrap.lf-on .lf-steam:nth-of-type(2) { animation-delay: .5s; }
.lf-appwrap.lf-on .lf-steam:nth-of-type(3) { animation-delay: 1s; }
@keyframes lf-steam { 0% { opacity: 0; transform: translateY(10px); } 40% { opacity: .9; } 100% { opacity: 0; transform: translateY(-26px); } }
.lf-flake { opacity: .25; transform-box: fill-box; transform-origin: center; }
.lf-appwrap.lf-on .lf-flake { animation: sw-twinkle 1.1s ease-in-out infinite; }
.lf-appwrap.lf-on .lf-flake:nth-child(2n) { animation-delay: .4s; }
.lf-appwrap.lf-blend.lf-on { animation: lf-shake .12s linear infinite; }
@keyframes lf-shake { 0% { transform: translate(-2px, 0) rotate(-1deg); } 50% { transform: translate(2px, -1px) rotate(1deg); } 100% { transform: translate(-2px, 0) rotate(-1deg); } }
.lf-whirl { transform-origin: 100px 90px; transform-box: view-box; }
.lf-appwrap.lf-on .lf-whirl { animation: lf-spin .5s linear infinite; }
@keyframes lf-spin { to { transform: rotate(360deg); } }
.lf-appwrap.lf-mixing, .lf-bowl.lf-mixing { animation: lf-toss .5s var(--sw-bounce) 3; }
@keyframes lf-toss { 0%, 100% { transform: translateY(0) rotate(0); } 40% { transform: translateY(-18px) rotate(-6deg); } 70% { transform: translateY(-6px) rotate(5deg); } }

.lf-done { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 0 4px; overflow: hidden; }
.lf-rays { position: absolute; left: 50%; top: 150px; width: 720px; height: 720px; margin: -360px 0 0 -360px; border-radius: 50%; background: repeating-conic-gradient(from 0deg, rgba(255,201,77,.28) 0 12deg, rgba(255,255,255,0) 12deg 24deg); animation: lf-spin 16s linear infinite; pointer-events: none; -webkit-mask: radial-gradient(circle, #000 20%, transparent 62%); mask: radial-gradient(circle, #000 20%, transparent 62%); }
.lf-result-stage { position: relative; width: 280px; height: 280px; }
.lf-result-stage canvas, .lf-result-stage > img { width: 100%; height: 100%; display: block; }
.lf-result-title { position: relative; font-size: 32px; font-weight: 700; color: var(--sw-pink); text-shadow: 0 3px 0 #fff; text-align: center; }
.lf-result-sub { position: relative; font-size: 19px; font-weight: 700; color: var(--sw-lav); display: flex; align-items: center; gap: 6px; }
.lf-result-sub svg { width: 24px; height: 24px; color: var(--sw-sun); }
.lf-result-buttons { position: relative; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
.lf-confetti { position: absolute; width: 12px; height: 16px; border-radius: 3px; pointer-events: none; animation: lf-confetti 1.6s cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes lf-confetti { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--r)); } }

@media (max-width: 700px) {
  .lf-stage2 { grid-template-columns: 1fr; }
  .lf-shelf { order: 2; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 8px; }
  .lf-ing { min-height: 80px; }
  .lf-ing img { width: 50px; height: 50px; }
  .lf-work { min-height: 280px; }
  .lf-recipes { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .lf-recipe-pic { width: 80px; height: 80px; }
  .lf-recipe-pic img { width: 78px; height: 78px; }
  .lf-step { width: 48px; height: 48px; }
  .lf-step img { width: 36px; height: 36px; }
  .lf-result-stage { width: 220px; height: 220px; }
  .lf-say { font-size: 18px; }
}
`;

const STATION_NAME = { oven: 'Oven', stove: 'Stove', fridge: 'Fridge', counter: 'Kitchen' };
const STATION_ICON = { oven: 'oven', stove: 'pot', fridge: 'fridge', counter: 'bowl' };

// ---------- appliance drawings ----------

function ovenSvg() {
  return `<svg class="lf-app" viewBox="0 0 200 190" aria-hidden="true">
  <rect x="8" y="8" width="184" height="174" rx="26" fill="#FFC6DE" stroke="#fff" stroke-width="6"/>
  <path d="M8 34a26 26 0 0 1 26-26h132a26 26 0 0 1 26 26v22H8Z" fill="#FF8CC6"/>
  <circle cx="36" cy="32" r="11" fill="#fff"/><circle cx="68" cy="32" r="11" fill="#fff"/>
  <rect x="34" y="22" width="4" height="10" rx="2" fill="#FF5FA2"/><rect x="66" y="22" width="4" height="10" rx="2" fill="#FF5FA2" transform="rotate(50 68 32)"/>
  <rect x="104" y="19" width="70" height="26" rx="9" fill="#3A1F4D"/>
  <text class="lf-clock" x="139" y="38" text-anchor="middle" fill="#7CFFB2" font-size="17" font-weight="700" font-family="monospace">3</text>
  <rect x="44" y="62" width="112" height="9" rx="4.5" fill="#fff"/>
  <rect x="28" y="78" width="144" height="90" rx="18" fill="#3A1F4D"/>
  <rect class="lf-oven-glow" x="34" y="84" width="132" height="78" rx="14" fill="#FFB347"/>
  <rect x="56" y="134" width="88" height="10" rx="4" fill="#D9D5E6"/>
  <ellipse class="lf-oven-food" cx="100" cy="128" rx="30" ry="8" fill="var(--batter)"/>
  <rect x="40" y="92" width="8" height="54" rx="4" fill="#fff" opacity=".22" transform="rotate(14 44 119)"/>
</svg>`;
}

function potSvg() {
  return `<svg class="lf-app" viewBox="0 0 200 190" aria-hidden="true">
  <path class="lf-steam" d="M76 60c-8-10 8-16 0-28" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  <path class="lf-steam" d="M100 56c-8-10 8-16 0-28" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  <path class="lf-steam" d="M124 60c-8-10 8-16 0-28" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  <rect x="14" y="152" width="172" height="30" rx="12" fill="#C9B6FF" stroke="#fff" stroke-width="5"/>
  <ellipse class="lf-flame" cx="70" cy="150" rx="7" ry="11" fill="#FFB347"/><ellipse class="lf-flame" cx="100" cy="150" rx="7" ry="12" fill="#FF8C42"/><ellipse class="lf-flame" cx="130" cy="150" rx="7" ry="11" fill="#FFB347"/>
  <rect x="18" y="92" width="26" height="12" rx="6" fill="#6CB4F0"/><rect x="156" y="92" width="26" height="12" rx="6" fill="#6CB4F0"/>
  <path d="M38 80h124v44a24 24 0 0 1-24 24H62a24 24 0 0 1-24-24Z" fill="#8FD3FF" stroke="#fff" stroke-width="5"/>
  <rect x="32" y="72" width="136" height="16" rx="8" fill="#6CB4F0" stroke="#fff" stroke-width="4"/>
  <ellipse cx="100" cy="80" rx="58" ry="7" fill="var(--batter)"/>
  <g><circle class="lf-bub" cx="78" cy="78" r="5" fill="#fff" opacity=".8"/><circle class="lf-bub" cx="104" cy="77" r="6" fill="#fff" opacity=".8"/><circle class="lf-bub" cx="126" cy="79" r="4" fill="#fff" opacity=".8"/><circle class="lf-bub" cx="92" cy="80" r="3" fill="#fff" opacity=".8"/></g>
  <path d="M62 104c10 8 22 8 32 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
  <circle cx="68" cy="100" r="3.5" fill="#3A1F4D"/><circle cx="88" cy="100" r="3.5" fill="#3A1F4D"/>
</svg>`;
}

function fridgeSvg() {
  const flakes = [[76, 34], [120, 46], [96, 104], [70, 132], [124, 150], [100, 26]].map(([x, y]) => `<path class="lf-flake" d="M${x} ${y - 9}v18M${x - 9} ${y}h18M${x - 6} ${y - 6}l12 12M${x + 6} ${y - 6}l-12 12" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>`).join('');
  return `<svg class="lf-app" viewBox="0 0 200 190" aria-hidden="true">
  <rect x="44" y="6" width="112" height="178" rx="22" fill="#BDE8FF" stroke="#fff" stroke-width="6"/>
  <rect x="44" y="70" width="112" height="6" fill="#fff"/>
  <rect x="134" y="26" width="9" height="30" rx="4.5" fill="#fff"/><rect x="134" y="92" width="9" height="46" rx="4.5" fill="#fff"/>
  <path d="M68 40c0-6 8-8 10-2 2-6 10-4 10 2 0 6-10 12-10 12s-10-6-10-12Z" fill="#FF8CC6"/>
  <rect x="60" y="150" width="48" height="16" rx="6" fill="var(--batter)" stroke="#fff" stroke-width="3"/>
  ${flakes}
</svg>`;
}

function blenderSvg() {
  return `<svg class="lf-app" viewBox="0 0 200 190" aria-hidden="true">
  <rect x="54" y="12" width="92" height="16" rx="7" fill="#FF8CC6" stroke="#fff" stroke-width="4"/>
  <path d="M60 28h80l-13 104H73Z" fill="rgba(214,238,255,.75)" stroke="#fff" stroke-width="5"/>
  <path d="M66 70h68l-8 60H74Z" fill="var(--batter)"/>
  <g class="lf-whirl"><path d="M100 90c14-6 20 8 8 14M100 90c-14 6-20-8-8-14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".85"/></g>
  <rect x="48" y="132" width="104" height="50" rx="16" fill="#9C7BFF" stroke="#fff" stroke-width="5"/>
  <circle cx="80" cy="157" r="8" fill="#fff"/><circle cx="100" cy="157" r="8" fill="#FFC94D"/><circle cx="120" cy="157" r="8" fill="#fff"/>
</svg>`;
}

// ---------- panel ----------

export function installCookingPanel(game, { eatNow }) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const st = { station: 'counter', entity: null, view: 'book', recipe: null, step: 0, stir: 0, phase: 'add', timers: [], glowT: 0 };
  let root, bookView, makeView, doneView;
  let stepsEl, shelfEl, workEl, sayEl, bowlEl, layersEl, swirlEl, spoonEl, bottomEl;

  const later = (ms, fn) => {
    const id = setTimeout(() => {
      st.timers = st.timers.filter((t) => t !== id);
      fn();
    }, ms);
    st.timers.push(id);
    return id;
  };
  const clearTimers = () => {
    for (const t of st.timers) clearTimeout(t);
    st.timers = [];
  };

  const icon = (key, cls = '') => {
    const i = ui.el('img', cls);
    i.alt = '';
    i.draggable = false;
    i.style.visibility = 'hidden';
    foodIcon(game, key).then((u) => { if (u) { i.src = u; i.style.visibility = 'visible'; } });
    return i;
  };

  const show = (view) => {
    st.view = view;
    bookView.hidden = view !== 'book';
    makeView.hidden = view !== 'make';
    doneView.hidden = view !== 'done';
    if (view !== 'done') {
      const pv = preview(game);
      pv.clear();
      pv.unmount();
    }
  };

  // ----- 1. recipe book -----

  const missing = (recipe) => {
    const need = gardenNeeds(recipe);
    const out = [];
    for (const [crop, n] of Object.entries(need)) {
      const have = basketCount(game, crop);
      if (have < n) out.push([crop, n - have]);
    }
    return out;
  };

  const renderBook = () => {
    bookView.innerHTML = '';
    const head = ui.el('div', 'lf-book-head');
    const chip = ui.el('div', 'lf-station');
    chip.innerHTML = lifeIcon(STATION_ICON[st.station] || 'bowl');
    chip.appendChild(document.createTextNode(STATION_NAME[st.station] || 'Kitchen'));
    head.append(chip, ui.el('div', 'lf-pantry', 'Pick a recipe! Flour, milk, eggs and sugar are always in the pantry.'));
    const grid = ui.el('div', 'lf-recipes');
    const list = RECIPES.slice().sort((a, b) => (b.station === st.station) - (a.station === st.station));
    for (const r of list) {
      const miss = missing(r);
      const card = ui.el('button', 'lf-recipe' + (miss.length ? ' lf-locked' : '') + (r.station === st.station ? ' lf-here' : ''));
      card.type = 'button';
      card.dataset.recipe = r.key;
      card.setAttribute('aria-label', r.name);
      const pic = ui.el('span', 'lf-recipe-pic');
      pic.appendChild(icon(r.food));
      const ings = ui.el('span', 'lf-ings');
      for (const s of [...new Set(r.steps)]) ings.appendChild(icon(s));
      const m = ui.el('span', 'lf-method');
      m.innerHTML = lifeIcon(METHODS[r.method].icon);
      m.appendChild(document.createTextNode(METHODS[r.method].name));
      card.append(pic, ui.el('span', 'lf-recipe-name', r.name), ings);
      if (miss.length) {
        const need = ui.el('span', 'lf-need');
        need.appendChild(document.createTextNode('Grow'));
        for (const [crop, n] of miss) {
          need.appendChild(icon(crop));
          if (n > 1) need.appendChild(document.createTextNode('×' + n));
        }
        card.appendChild(need);
      } else {
        card.appendChild(m);
      }
      const have = basketCount(game, r.food);
      if (have > 0) card.appendChild(ui.el('span', 'lf-have', '×' + have));
      card.addEventListener('click', () => {
        const mm = missing(r);
        if (mm.length) {
          sfx(game, 'nope');
          const [crop, n] = mm[0];
          game.toast(`Grow ${n} more ${foodName(crop, n)} in your garden first!`, { icon: 'sparkle' });
          card.classList.remove('lf-wiggle');
          void card.offsetWidth;
          return;
        }
        game.audio.play('pop');
        start(r);
      });
      grid.appendChild(card);
    }
    bookView.append(head, grid);
  };

  // ----- 2. tap ingredients into the bowl -----

  const say = (text) => {
    sayEl.textContent = text;
    sayEl.style.animation = 'none';
    void sayEl.offsetWidth;
    sayEl.style.animation = '';
  };

  const renderSteps = () => {
    stepsEl.innerHTML = '';
    st.recipe.steps.forEach((k, i) => {
      const c = ui.el('div', 'lf-step' + (i < st.step ? ' lf-done' : i === st.step && st.phase === 'add' ? ' lf-next' : ''));
      c.appendChild(icon(k));
      c.appendChild(ui.el('span', 'lf-num', String(i + 1)));
      const tick = ui.el('span', 'lf-tick');
      tick.innerHTML = ui.icon('check');
      c.appendChild(tick);
      stepsEl.appendChild(c);
    });
  };

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const renderShelf = () => {
    shelfEl.innerHTML = '';
    const r = st.recipe;
    const uniq = [...new Set(r.steps)];
    const decoys = shuffle(PANTRY.filter((k) => !uniq.includes(k))).slice(0, uniq.length >= 5 ? 1 : 2);
    for (const k of shuffle([...uniq, ...decoys])) {
      const b = ui.el('button', 'lf-ing');
      b.type = 'button';
      b.dataset.ing = k;
      b.setAttribute('aria-label', ingredientName(k));
      b.append(icon(k), ui.el('span', '', ingredientName(k)));
      b.addEventListener('click', () => tapIngredient(k, b));
      shelfEl.appendChild(b);
    }
  };

  const glowNext = () => {
    if (st.phase !== 'add') return;
    const want = st.recipe.steps[st.step];
    for (const b of shelfEl.children) b.classList.toggle('lf-glow', b.dataset.ing === want);
  };

  const resetBowl = () => {
    layersEl.innerHTML = '';
    swirlEl.style.opacity = '0';
    bowlEl.classList.remove('lf-stirring');
    workEl.style.setProperty('--batter', '#FFE0B8');
    workEl.style.setProperty('--batter2', '#FFF1DE');
  };

  const addLayer = (k) => {
    const n = st.recipe.steps.length;
    const layer = ui.el('div', 'lf-layer');
    layer.style.background = ingredientColor(k);
    layersEl.appendChild(layer);
    requestAnimationFrame(() => { layer.style.height = Math.round(96 / n) + 'px'; });
  };

  const flyToBowl = (btn, k, done) => {
    const from = btn.querySelector('img').getBoundingClientRect();
    const to = bowlEl.getBoundingClientRect();
    const f = icon(k, 'lf-fly');
    document.body.appendChild(f);
    f.style.left = from.left + 'px';
    f.style.top = from.top + 'px';
    const dx = to.left + to.width / 2 - 32 - from.left, dy = to.top + 30 - from.top;
    const anim = f.animate([
      { transform: 'translate(0,0) scale(1) rotate(0)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.2) rotate(-20deg)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(20deg)` },
    ], { duration: 520, easing: 'ease-in-out' });
    anim.onfinish = () => { f.remove(); done(); };
    anim.oncancel = () => f.remove();
  };

  const tapIngredient = (k, btn) => {
    if (st.phase !== 'add') return;
    const want = st.recipe.steps[st.step];
    if (k !== want) {
      sfx(game, 'nope');
      btn.classList.remove('lf-wiggle');
      void btn.offsetWidth;
      btn.classList.add('lf-wiggle');
      say(`Oops! First the ${ingredientName(want)}!`);
      glowNext();
      return;
    }
    // the step counts right away (quick little fingers never lose a tap); the ingredient
    // lands in the bowl a moment later
    for (const b of shelfEl.children) b.classList.remove('lf-glow');
    st.step++;
    st.flying = (st.flying || 0) + 1;
    const last = st.step >= st.recipe.steps.length;
    if (!st.recipe.steps.slice(st.step).includes(k)) btn.classList.add('lf-used');
    if (last) st.phase = 'landing';
    else {
      say(['Yay!', 'Great!', 'Yummy!', 'Perfect!'][st.step % 4] + ` Now the ${ingredientName(st.recipe.steps[st.step])}!`);
      clearTimeout(st.glowT);
      st.glowT = later(3500, glowNext);
    }
    renderSteps();
    sfx(game, 'whoosh', { volume: 0.4 });
    const run = st.run;
    flyToBowl(btn, k, () => {
      if (st.view !== 'make' || st.run !== run) return;
      st.flying--;
      addLayer(k);
      sfx(game, 'plop', { pitch: 0.9 + Math.random() * 0.3 });
      bowlEl.classList.remove('lf-plop');
      void bowlEl.offsetWidth;
      bowlEl.classList.add('lf-plop');
      if (st.phase === 'landing' && st.flying <= 0) startStir();
    });
  };

  // ----- 3. stir -----

  const stirState = { active: false, angle: null, total: 0, downAt: 0, moved: 0, lastSound: 0 };
  const heartsEl = () => bottomEl.querySelector('.lf-hearts');

  const startStir = () => {
    st.phase = 'stir';
    st.stir = 0;
    const cols = st.recipe.steps.map(ingredientColor);
    let mix = cols[0];
    for (let i = 1; i < cols.length; i++) mix = mixHex(mix, cols[i], 1 / (i + 1));
    st.mix = mix;
    workEl.style.setProperty('--batter', mix);
    workEl.style.setProperty('--batter2', mixHex(mix, '#FFFFFF', 0.35));
    bowlEl.classList.add('lf-stirring');
    say(st.recipe.method === 'mix' ? 'Stir it all together!' : 'Stir, stir, stir!');
    bottomEl.innerHTML = '';
    const hearts = ui.el('div', 'lf-hearts');
    for (let i = 0; i < 5; i++) {
      const h = ui.el('span');
      h.innerHTML = ui.icon('heart');
      hearts.appendChild(h);
    }
    bottomEl.append(hearts, ui.el('div', 'lf-tip', 'Draw circles on the bowl, or tap it!'));
    updateStir(0);
  };

  const updateStir = (add) => {
    if (st.phase !== 'stir') return;
    st.stir = Math.min(1, st.stir + add);
    swirlEl.style.opacity = String(Math.min(1, st.stir * 1.3));
    for (const l of layersEl.children) l.style.opacity = String(1 - st.stir * 0.9);
    const hs = heartsEl();
    if (hs) [...hs.children].forEach((h, i) => h.classList.toggle('lf-on', st.stir >= (i + 1) / 5 - 0.001));
    if (st.stir >= 1) {
      st.phase = 'ready';
      bowlEl.classList.remove('lf-stirring');
      sfx(game, 'sparkle');
      later(250, readyToCook);
    }
  };

  const bowlCenter = () => {
    const r = bowlEl.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height * 0.6];
  };

  const onBowlDown = (e) => {
    if (st.phase !== 'stir' && st.phase !== 'landing') return;
    stirState.active = true;
    stirState.downAt = performance.now();
    stirState.moved = 0;
    const [cx, cy] = bowlCenter();
    stirState.angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    try { bowlEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onBowlMove = (e) => {
    if (!stirState.active || st.phase !== 'stir') return;
    const [cx, cy] = bowlCenter();
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    let d = a - stirState.angle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    stirState.angle = a;
    stirState.moved += Math.abs(d);
    stirState.total += d;
    spoonEl.style.transform = `rotate(${(stirState.total * 180) / Math.PI * 0.35}deg)`;
    swirlEl.style.transform = `rotate(${(stirState.total * 180) / Math.PI}deg)`;
    if (stirState.moved - stirState.lastSound > 1.6) {
      stirState.lastSound = stirState.moved;
      sfx(game, 'stir');
    }
    updateStir(Math.abs(d) / (Math.PI * 2) * 0.36);
  };
  const onBowlUp = () => {
    if (!stirState.active) return;
    stirState.active = false;
    stirState.lastSound = 0;
    if (st.phase === 'stir' && stirState.moved < 0.6 && performance.now() - stirState.downAt < 600) {
      // a tap: one little stir
      stirState.total += 1.2;
      spoonEl.style.transform = `rotate(${(stirState.total * 180) / Math.PI * 0.35}deg)`;
      swirlEl.style.transform = `rotate(${(stirState.total * 180) / Math.PI}deg)`;
      sfx(game, 'stir');
      updateStir(0.14);
    }
  };

  // ----- 4. cook -----

  const readyToCook = () => {
    const m = METHODS[st.recipe.method];
    bottomEl.innerHTML = '';
    if (st.recipe.method === 'mix') {
      say('Beautiful! Now toss it!');
    } else {
      say(`Yummy! Now ${m.verb.toLowerCase().replace('!', '')} it!`);
    }
    const go = ui.el('div', 'lf-go-cook');
    go.appendChild(lifeButton(ui, { icon: m.icon, label: m.verb, variant: 'pink', size: 'big', className: 'lf-cook-go', onClick: cook }));
    bottomEl.appendChild(go);
  };

  const cook = () => {
    if (st.phase !== 'ready') return;
    st.phase = 'cooking';
    const r = st.recipe, m = METHODS[r.method];
    bottomEl.innerHTML = '';
    say(m.doing);
    const dur = r.method === 'mix' ? 1600 : 3200;
    if (r.method === 'mix') {
      const wrap = bowlEl;
      wrap.classList.add('lf-mixing');
      sfx(game, 'stir');
      later(500, () => sfx(game, 'stir'));
      later(1000, () => sfx(game, 'stir'));
      later(dur, () => { wrap.classList.remove('lf-mixing'); finish(); });
      return;
    }
    bowlEl.hidden = true;
    const app = ui.el('div', 'lf-appwrap' + (r.method === 'blend' ? ' lf-blend' : ''));
    app.style.setProperty('--batter', st.mix);
    app.innerHTML = r.method === 'bake' ? ovenSvg() : r.method === 'freeze' ? fridgeSvg() : r.method === 'blend' ? blenderSvg() : potSvg();
    bowlEl.parentNode.insertBefore(app, bowlEl);
    const timer = ui.el('div', 'lf-timer');
    const fill = ui.el('div');
    timer.appendChild(fill);
    bottomEl.appendChild(timer);
    sfx(game, 'pop');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.classList.add('lf-on');
      fill.style.transition = `width ${dur}ms linear`;
      fill.style.width = '100%';
    }));
    const clock = app.querySelector('.lf-clock');
    const secs = Math.round(dur / 1000);
    for (let i = 0; i < secs; i++) {
      later(i * 1000, () => {
        if (clock) clock.textContent = String(secs - i);
        sfx(game, r.method === 'bake' ? 'tick' : r.method === 'freeze' ? 'freeze' : r.method === 'blend' ? 'whirr' : 'sizzle');
      });
    }
    later(dur, () => {
      if (clock) clock.textContent = '0';
      app.classList.remove('lf-on');
      sfx(game, r.method === 'bake' || r.method === 'fry' || r.method === 'boil' ? 'ding' : 'tada');
      say(r.method === 'bake' ? 'Ding!' : 'Ta-da!');
      later(650, finish);
    });
  };

  // ----- 5. result -----

  const confetti = (host) => {
    const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF8CC6'];
    for (let i = 0; i < 36; i++) {
      const c = ui.el('span', 'lf-confetti');
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
      c.style.left = '50%';
      c.style.top = '150px';
      c.style.background = cols[i % cols.length];
      c.style.setProperty('--dx', Math.cos(a) * d + 'px');
      c.style.setProperty('--dy', Math.sin(a) * d * 0.8 + 80 + 'px');
      c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      c.style.animationDelay = Math.random() * 0.15 + 's';
      host.appendChild(c);
      later(2000, () => c.remove());
    }
  };

  const finish = () => {
    const r = st.recipe;
    // garden crops are used up now (the pantry never runs out)
    for (const [crop, n] of Object.entries(gardenNeeds(r))) basketTake(game, crop, n);
    const total = basketAdd(game, r.food, r.makes);
    game.events.emit('cook:done', { recipe: r });
    renderDone(r, total);
  };

  const renderDone = (r, total) => {
    show('done');
    ui.setTitle('cooking', 'Ta-da!');
    doneView.innerHTML = '';
    const rays = ui.el('div', 'lf-rays');
    const stage = ui.el('div', 'lf-result-stage');
    const title = ui.el('div', 'lf-result-title', `You made ${r.makes > 1 ? FOOD[r.food].plural : r.name}!`);
    const sub = ui.el('div', 'lf-result-sub');
    sub.innerHTML = lifeIcon('basket');
    sub.appendChild(document.createTextNode(`+${r.makes} in your basket (you have ${total})`));
    const btns = ui.el('div', 'lf-result-buttons');
    btns.append(
      lifeButton(ui, { icon: 'eat', label: 'Eat!', variant: 'pink', className: 'lf-eat-now', onClick: () => { ui.close(); eatNow(r.food); } }),
      lifeButton(ui, { icon: 'spoon', label: 'Again', variant: 'mint', onClick: () => start(r) }),
      lifeButton(ui, { icon: 'book', label: 'Recipes', variant: 'lav', onClick: () => { show('book'); ui.setTitle('cooking', 'Recipe Book'); renderBook(); } }),
      lifeButton(ui, { icon: 'check', label: 'Done', variant: 'sky', onClick: () => ui.close() }),
    );
    doneView.append(rays, stage, title, sub, btns);
    const pv = preview(game);
    if (!pv.failed && pv.mount(stage, 280)) {
      const model = foodModel(r.food);
      let t = 0;
      pv.show(model, {
        spin: 0.9, yaw: 0.4, dir: [0, 0.75, 1], zoom: 1.05, lift: 0.4,
        onFrame: (dt, tt, obj) => {
          t += dt;
          const pop = Math.min(1, t / 0.45);
          const s = pop < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - pop, 3)) * (1 + Math.sin(pop * Math.PI) * 0.25) : 1 + Math.sin(tt * 2.5) * 0.03;
          obj.scale.setScalar(s);
        },
      });
    } else {
      stage.appendChild(icon(r.food));
    }
    confetti(doneView);
    sfx(game, 'success');
  };

  // ----- start a recipe -----

  const start = (r) => {
    clearTimers();
    st.recipe = r;
    st.step = 0;
    st.stir = 0;
    st.phase = 'add';
    st.flying = 0;
    st.run = (st.run || 0) + 1;
    stirState.total = 0;
    show('make');
    ui.setTitle('cooking', r.name);
    const app = workEl.querySelector('.lf-appwrap');
    if (app) app.remove();
    bowlEl.hidden = false;
    bowlEl.classList.remove('lf-mixing');
    spoonEl.style.transform = '';
    swirlEl.style.transform = '';
    bottomEl.innerHTML = '';
    bottomEl.appendChild(ui.el('div', 'lf-tip', 'Tap the ingredients in order!'));
    resetBowl();
    renderSteps();
    renderShelf();
    say(`Let's make ${r.name}! First, tap the ${ingredientName(r.steps[0])}!`);
    st.glowT = later(3000, glowNext);
  };

  ui.registerPanel('cooking', {
    title: 'Recipe Book',
    icon: 'star',
    width: 920,
    build(container) {
      root = ui.el('div', 'lf-cook');
      bookView = ui.el('div', 'lf-book');
      makeView = ui.el('div', 'lf-make');
      doneView = ui.el('div', 'lf-done');
      stepsEl = ui.el('div', 'lf-steps');
      const stage2 = ui.el('div', 'lf-stage2');
      shelfEl = ui.el('div', 'lf-shelf');
      workEl = ui.el('div', 'lf-work');
      sayEl = ui.el('div', 'lf-say', '');
      bowlEl = ui.el('div', 'lf-bowl');
      const glass = ui.el('div', 'lf-bowl-glass');
      layersEl = ui.el('div', 'lf-layers');
      swirlEl = ui.el('div', 'lf-swirl');
      glass.append(layersEl, swirlEl);
      spoonEl = ui.el('div', 'lf-spoon');
      bowlEl.append(glass, ui.el('div', 'lf-bowl-rim'), ui.el('div', 'lf-bowl-shine'), spoonEl);
      bowlEl.addEventListener('pointerdown', onBowlDown);
      bowlEl.addEventListener('pointermove', onBowlMove);
      bowlEl.addEventListener('pointerup', onBowlUp);
      bowlEl.addEventListener('pointercancel', onBowlUp);
      bottomEl = ui.el('div', 'lf-bottom');
      bottomEl.style.display = 'flex';
      bottomEl.style.flexDirection = 'column';
      bottomEl.style.alignItems = 'center';
      bottomEl.style.gap = '6px';
      workEl.append(sayEl, bowlEl, bottomEl);
      stage2.append(shelfEl, workEl);
      makeView.append(stepsEl, stage2);
      root.append(bookView, makeView, doneView);
      container.appendChild(root);
    },
    onOpen(args = {}) {
      clearTimers();
      st.station = (args && args.station) || 'counter';
      st.entity = (args && args.entity) || null;
      ui.setTitle('cooking', 'Recipe Book');
      show('book');
      renderBook();
    },
    onClose() {
      clearTimers();
      st.phase = 'add';
      st.flying = 0;
      st.run = (st.run || 0) + 1;
      const pv = preview(game);
      pv.clear();
      pv.unmount();
      for (const f of document.querySelectorAll('.lf-fly')) f.remove();
    },
  });

  return {
    open: (station = 'counter', entity = null) => ui.open('cooking', { station, entity }),
  };
}
