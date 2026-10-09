// The shop panel ('shop', args { kind: 'candy' | 'parlor' | 'truck', entity }):
//  - a shopkeeper (a real avatar portrait from the shared Dress-Up stage) with a speech bubble
//    and her Sparkle Coins wallet;
//  - Candy Shop: twenty candies, tap one to buy it;
//  - Ice Cream Parlor / Truck: Build Your Own (style -> up to three scoops of twelve flavors ->
//    toppings, a live spinning 3D preview on the shared preview stage, the price adds up by
//    parts) and four ready-made Favorites.
// Buying spends coins, puts the treat in the basket ('treat_*'), emits 'shop:buy' { item,
// price, shop, name } and offers Hold / Eat / More.

import * as THREE from 'three';
import { FOOD } from '../food-models.js';
import { basketAdd, basketCount } from '../pets/kit.js';
import { preview } from '../pets/preview.js';
import { getStage } from '../../ui/dressup/stage.js';
import { CANDY } from './candy.js';
import * as IC from './icecream.js';
import { shopSfx } from './sfx.js';
import { shopIcon, shopButton, scoopSvg, toppingSvg } from './icons.js';

const CSS = /* css */ `
.sh-shop { position: relative; display: flex; flex-direction: column; gap: 10px; }
.sh-shop [hidden] { display: none !important; }
.sh-top { position: sticky; top: -8px; z-index: 4; display: flex; align-items: center; gap: 12px; margin: -8px -6px 0; padding: 8px 6px 8px; background: var(--sw-cream); border-radius: 0 0 22px 22px; }
.sh-keeper { position: relative; flex: none; width: 96px; height: 96px; border-radius: 50%; overflow: hidden; border: 5px solid #fff; box-shadow: 0 5px 14px var(--sw-shadow);
  background: radial-gradient(circle at 50% 38%, #FFFFFF 0 30%, var(--kc, #FFD1E6) 72%); }
.sh-keeper canvas, .sh-keeper > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.sh-keeper > svg { inset: 18px; width: calc(100% - 36px); height: calc(100% - 36px); color: var(--sw-pink); }
.sh-keeper-name { position: absolute; left: 50%; bottom: -2px; transform: translateX(-50%); padding: 0 8px; border-radius: 999px; background: var(--sw-pink); color: #fff; font-size: 13px; font-weight: 700; border: 2px solid #fff; white-space: nowrap; }
.sh-say { position: relative; flex: 1; min-width: 0; padding: 10px 18px; border-radius: 22px; background: #fff; border: 4px solid var(--kc, var(--sw-pink-soft)); font-size: 20px; font-weight: 700; color: var(--sw-ink); line-height: 1.2; box-shadow: 0 4px 12px rgba(58,31,77,.12); }
.sh-say::before { content: ''; position: absolute; left: -16px; top: 50%; margin-top: -10px; border: 10px solid transparent; border-right: 14px solid var(--kc, var(--sw-pink-soft)); border-left: 0; }
.sh-say.sh-new { animation: sw-pop .3s var(--sw-bounce); }
.sh-wallet { flex: none; display: flex; align-items: center; gap: 6px; height: 54px; padding: 0 18px 0 10px; border-radius: 999px; background: #FFF6C8; border: 4px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); font-size: 24px; font-weight: 700; color: #B86E00; }
.sh-wallet svg { width: 34px; height: 34px; color: #F5A300; }
.sh-wallet.sh-bump { animation: sh-bump .35s var(--sw-bounce); }
@keyframes sh-bump { 0% { transform: scale(1); } 40% { transform: scale(1.15); } 100% { transform: scale(1); } }
.sh-tabs { display: flex; gap: 10px; }
.sh-tab { display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 6px 20px 6px 12px; border-radius: 999px; border: 4px solid #fff; background: rgba(255,255,255,.75); color: var(--sw-ink); font-size: 19px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); font-family: var(--sw-font); touch-action: manipulation; }
.sh-tab svg { width: 28px; height: 28px; color: var(--sw-pink); }
.sh-tab.sh-sel { background: var(--sw-pink); color: #fff; }
.sh-tab.sh-sel svg { color: #fff; }

.sh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 12px; }
.sh-item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px 10px; border-radius: 22px; background: #fff; border: 4px solid var(--sw-pink-soft); cursor: pointer; font-family: var(--sw-font); color: var(--sw-ink);
  box-shadow: 0 4px 10px rgba(58,31,77,.1); transition: transform .18s var(--sw-bounce), border-color .15s; touch-action: manipulation; }
.sh-item:hover { transform: translateY(-3px) scale(1.03); border-color: var(--sw-pink); }
.sh-item:active { transform: scale(.95); }
.sh-item-pic { width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 50% 40%, #fff, #FFEAF4 65%, #F3ECFF); }
.sh-item-pic img { width: 88px; height: 88px; pointer-events: none; }
.sh-item-name { font-size: 17px; font-weight: 700; text-align: center; line-height: 1.05; min-height: 2.1em; display: flex; align-items: center; }
.sh-price { display: inline-flex; align-items: center; gap: 3px; padding: 1px 10px 1px 6px; border-radius: 999px; background: #FFF1B8; color: #A86200; font-size: 17px; font-weight: 700; border: 2px solid #FFE27A; }
.sh-price svg { width: 20px; height: 20px; color: #F5A300; }
.sh-have { position: absolute; top: 6px; right: 6px; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 15px; background: var(--sw-mint); color: #fff; font-weight: 700; font-size: 15px; display: grid; place-items: center; border: 3px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); }
.sh-item.sh-poor .sh-price { background: #F1ECF7; color: #9A8BB0; border-color: #E2DAF0; }
.sh-item.sh-bought { animation: sh-bump .4s var(--sw-bounce); border-color: var(--sw-mint); }
.sh-shake { animation: sw-wiggle .3s ease-in-out 2; }

.sh-build { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
.sh-left { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px; border-radius: 26px; background: radial-gradient(circle at 50% 34%, #FFFFFF, #FFF1F8 60%, #EAF6FF); border: 4px solid #fff; box-shadow: 0 4px 12px rgba(58,31,77,.1); }
.sh-stage { position: relative; width: 270px; height: 270px; touch-action: none; cursor: grab; }
.sh-stage canvas, .sh-stage > img { width: 100%; height: 100%; display: block; }
.sh-stage > img { object-fit: contain; }
.sh-made { font-size: 22px; font-weight: 700; color: var(--sw-pink); text-align: center; line-height: 1.1; text-shadow: 0 2px 0 #fff; }
.sh-buyrow { display: flex; align-items: center; gap: 10px; }
.sh-tag { display: inline-flex; align-items: center; gap: 4px; height: 52px; padding: 0 16px 0 10px; border-radius: 999px; background: #FFF6C8; border: 4px solid #FFE27A; font-size: 26px; font-weight: 700; color: #A86200; }
.sh-tag svg { width: 30px; height: 30px; color: #F5A300; }
.sh-tag.sh-bump { animation: sh-bump .35s var(--sw-bounce); }
.sh-buy.sw-btn { min-height: 58px; font-size: 22px; padding: 6px 22px; }
.sh-right { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sh-steps { display: flex; gap: 8px; flex-wrap: wrap; }
.sh-stepbtn { display: inline-flex; align-items: center; gap: 8px; min-height: 50px; padding: 4px 16px 4px 6px; border-radius: 999px; border: 4px solid #fff; background: rgba(255,255,255,.8); font-family: var(--sw-font); font-size: 18px; font-weight: 700; color: var(--sw-ink); cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); touch-action: manipulation; }
.sh-stepbtn b { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--sw-lav-soft); color: var(--sw-lav); font-size: 18px; }
.sh-stepbtn.sh-sel { background: var(--sw-lav); color: #fff; }
.sh-stepbtn.sh-sel b { background: #fff; }
.sh-stepbody { min-height: 300px; }
.sh-hint { font-size: 16px; font-weight: 600; color: var(--sw-lav); margin: 2px 2px 8px; }
.sh-styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.sh-opt { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px 8px; border-radius: 20px; background: #fff; border: 4px solid #fff; cursor: pointer; font-family: var(--sw-font); color: var(--sw-ink);
  box-shadow: 0 3px 8px rgba(58,31,77,.12); transition: transform .16s var(--sw-bounce); touch-action: manipulation; }
.sh-opt:active { transform: scale(.94); }
.sh-opt.sh-sel { border-color: var(--sw-pink); box-shadow: 0 0 0 3px #fff, 0 0 14px rgba(255,95,162,.55); }
.sh-opt > img { width: 78px; height: 78px; pointer-events: none; }
.sh-opt-name { font-size: 16px; font-weight: 700; line-height: 1.05; text-align: center; }
.sh-opt .sh-price { font-size: 14px; padding: 0 8px 0 4px; }
.sh-opt .sh-price svg { width: 16px; height: 16px; }
.sh-check { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; border-radius: 50%; background: var(--sw-mint); color: #fff; display: none; place-items: center; border: 3px solid #fff; }
.sh-check svg { width: 16px; height: 16px; }
.sh-opt.sh-sel .sh-check { display: grid; }
.sh-scoops { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.sh-slot { position: relative; width: 68px; height: 68px; border-radius: 50%; border: 4px dashed var(--sw-lav-soft); background: rgba(255,255,255,.7); display: grid; place-items: center; cursor: pointer; padding: 0; font-family: var(--sw-font); color: var(--sw-lav); font-size: 26px; font-weight: 700; touch-action: manipulation; }
.sh-slot.sh-full { border: 4px solid #fff; background: #fff; box-shadow: 0 3px 8px rgba(58,31,77,.15); }
.sh-slot svg { width: 56px; height: 56px; }
.sh-slot .sh-x { position: absolute; top: -6px; right: -6px; width: 26px; height: 26px; border-radius: 50%; background: #FF7A9A; color: #fff; display: grid; place-items: center; border: 3px solid #fff; }
.sh-slot .sh-x svg { width: 12px; height: 12px; }
.sh-scoops-label { font-size: 17px; font-weight: 700; color: var(--sw-ink); }
.sh-flavors { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.sh-flavor { display: flex; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; min-height: 60px; border-radius: 18px; background: #fff; border: 3px solid #fff; cursor: pointer; font-family: var(--sw-font); font-size: 15px; font-weight: 700; color: var(--sw-ink); line-height: 1.05; text-align: left;
  box-shadow: 0 3px 8px rgba(58,31,77,.12); transition: transform .15s var(--sw-bounce); touch-action: manipulation; }
.sh-flavor svg { flex: none; width: 50px; height: 50px; }
.sh-flavor:active { transform: scale(.92); }
.sh-flavor.sh-in { border-color: var(--sw-pink-soft); background: #FFF6FA; }
.sh-tops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.sh-tops .sh-opt > svg { width: 64px; height: 64px; pointer-events: none; }
.sh-nav { display: flex; justify-content: flex-end; gap: 10px; }

.sh-sheet { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; margin-top: 4px; border-radius: 26px; background: #fff; border: 4px solid var(--sw-mint);
  box-shadow: 0 -2px 0 rgba(255,255,255,.6), 0 8px 24px rgba(58,31,77,.28); animation: sh-up .35s var(--sw-bounce); }
@keyframes sh-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.sh-sheet img { width: 64px; height: 64px; flex: none; }
.sh-sheet-text { flex: 1; min-width: 160px; font-size: 20px; font-weight: 700; color: var(--sw-ink); line-height: 1.15; }
.sh-sheet-text small { display: block; font-size: 15px; color: var(--sw-lav); }
.sh-sheet .sw-btn { min-height: 52px; }
.sh-confetti { position: absolute; width: 10px; height: 14px; border-radius: 3px; pointer-events: none; z-index: 5; animation: sh-confetti 1.2s cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes sh-confetti { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
.sh-spend { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; pointer-events: none; z-index: 90;
  background: radial-gradient(circle at 35% 30%, #FFF6C8 0 22%, #FFD84D 23% 62%, #F2A900 63%); box-shadow: 0 0 0 2px #fff, 0 3px 8px rgba(58,31,77,.3); }

@media (max-width: 760px) {
  .sh-build { grid-template-columns: 1fr; }
  .sh-left { flex-direction: row; flex-wrap: wrap; justify-content: center; }
  .sh-stage { width: 190px; height: 190px; }
  .sh-flavors { grid-template-columns: repeat(2, 1fr); }
  .sh-styles, .sh-tops { grid-template-columns: repeat(2, 1fr); }
  .sh-keeper { width: 72px; height: 72px; }
  .sh-say { font-size: 16px; padding: 8px 12px; }
  .sh-wallet { height: 46px; font-size: 20px; padding: 0 12px 0 6px; }
  .sh-tab { font-size: 16px; min-height: 46px; padding: 4px 14px 4px 8px; white-space: nowrap; }
  .sh-stepbtn { font-size: 15px; min-height: 44px; padding: 3px 12px 3px 4px; gap: 5px; }
  .sh-stepbtn b { width: 28px; height: 28px; font-size: 15px; }
}
@media (max-width: 520px) {
  /* phones: shopkeeper and wallet on one row, her words under them, nothing sticky */
  .sh-top { position: static; flex-wrap: wrap; margin: 0; padding: 0; }
  .sh-keeper { width: 60px; height: 60px; }
  .sh-keeper-name { font-size: 11px; }
  .sh-wallet { margin-left: auto; }
  .sh-say { order: 3; flex-basis: 100%; font-size: 15px; }
  .sh-say::before { left: 26px; top: -16px; margin: 0; border: 9px solid transparent; border-bottom: 12px solid var(--kc, var(--sw-pink-soft)); border-top: 0; }
  .sh-tabs { gap: 6px; }
  .sh-tab svg { width: 22px; height: 22px; }
  .sh-steps { gap: 4px; flex-wrap: nowrap; }
  .sh-stepbtn { padding: 3px 9px 3px 3px; font-size: 14px; }
  .sh-grid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
  .sh-item-pic, .sh-item-pic img { width: 72px; height: 72px; }
}
`;

const acc = (o) => ({ head: 'none', headColor: '#FF5FA2', face: 'none', faceColor: null, back: 'none', backColor: '#B8E1FF', neck: 'none', neckColor: '#FFD54A', hand: 'none', handColor: null, ...o });

export const KEEPERS = {
  candy: {
    name: 'Coco', title: 'Candy Shop', icon: 'candy', color: '#FFB6D9',
    look: {
      name: 'Coco', skin: '#F6D2B8', hair: { style: 'space_buns', color: '#FF8CC6', color2: '#FFFFFF', mix: 'tips' },
      eyes: { color: '#7A4A9E', lashes: true }, face: { blush: true, freckles: true, smile: 'grin' },
      top: { type: 'blouse', color: '#FFFFFF', pattern: 'dots', patternColor: '#FF8CC6' },
      bottom: { type: 'skirt', color: '#FF5FA2', pattern: 'stripes', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FF8CC6' },
      acc: acc({ head: 'bow', headColor: '#9C7BFF', neck: 'bowtie', neckColor: '#FF5FA2' }),
    },
    greet: ["Hi, sweetie! Welcome to Coco's Candy Shop!", 'Hello! Every candy is extra yummy today!', 'Welcome! Pick any candy you like!'],
    idle: ['Tap a candy to buy it!', 'Lollipops are only 3 coins!', 'The heart chocolates are so fancy!', 'Rainbow lollipops make you smile!'],
    buy: ['Ooh, great choice!', 'Yum! Enjoy it!', "That one's my favorite too!", 'Sweet! Here you go!', 'Share one with a friend!'],
  },
  parlor: {
    name: 'Gigi', title: 'Ice Cream Parlor', icon: 'cone', color: '#9BE8CF',
    look: {
      name: 'Gigi', skin: '#C98E6B', hair: { style: 'ponytail', color: '#3B2419', color2: '#9BE8CF', mix: 'tips' },
      eyes: { color: '#3C2A1E', lashes: true }, face: { blush: true, freckles: false, smile: 'happy' },
      top: { type: 'tshirt', color: '#9BE8CF', pattern: 'stripes', patternColor: '#FFFFFF' },
      bottom: { type: 'overalls', color: '#FFB6D9', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FFFFFF' },
      acc: acc({ head: 'headband', headColor: '#FF5FA2' }),
    },
    greet: ["Welcome to Gigi's Ice Cream Parlor!", "Hi! Let's build your dream ice cream!", 'Hello! Cones, cups, sundaes... anything you like!'],
    idle: ['Pick a style, then scoops, then toppings!', 'Tap a scoop to take it off!', 'You can spin the ice cream!'],
    buy: ['Here you go! Enjoy!', 'Wow, that looks amazing!', 'Yummy yum yum!', 'A masterpiece!'],
  },
  truck: {
    name: 'Sunny', title: 'Ice Cream Truck', icon: 'truck', color: '#A6D8FF',
    look: {
      name: 'Sunny', skin: '#8C5535', hair: { style: 'curly', color: '#1F1614', color2: '#FFD43B', mix: 'streaks' },
      eyes: { color: '#2E1E14', lashes: true }, face: { blush: true, freckles: false, smile: 'open' },
      top: { type: 'tshirt', color: '#A6D8FF', pattern: 'hearts', patternColor: '#FFFFFF' },
      bottom: { type: 'shorts', color: '#FFE38F', pattern: 'none', patternColor: '#FFFFFF' },
      shoes: { type: 'sneakers', color: '#FF5FA2' },
      acc: acc({ head: 'sun_hat', headColor: '#FFE38F', face: 'heart_glasses', faceColor: '#FF5FA2' }),
    },
    greet: ['Ding ding! The ice cream truck is here!', 'Hi there! Want something cold and yummy?', "Beep beep! Sunny's ice cream!"],
    idle: ['Build your own, or pick a favorite!', 'Popsicles are great on sunny days!', 'Milkshakes come with a straw!'],
    buy: ['Here you go! Stay cool!', 'Enjoy, friend!', 'Ding ding! Yummy!', 'That looks super tasty!'],
  },
};

const STEPS = [['style', 'Style'], ['scoops', 'Scoops'], ['tops', 'Toppings']];
const STYLE_PICS = { cone: ['straw'], cup: ['mint'], sundae: ['van'], popsicle: ['mango'], shake: ['choc'], sandwich: ['van'] };
const STYLE_TOPS = { sundae: 'c', shake: 'w' };

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const coinHtml = (n) => `${n}${shopIcon('coin')}`;

export function installShopPanel(game, { treats, coins }) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const stage = getStage();
  const st = {
    kind: 'candy', entity: null, view: 'candy', step: 'style',
    spec: { style: 'cone', flavors: ['straw'], tops: '' },
    sheetKey: null, sayTimer: 0,
  };
  let root, keeperEl, sayEl, walletEl, tabsEl, candyView, buildView, favView, sheetEl;
  let stageEl, madeEl, tagEl, buyBtn, stepsEl, stepBody, nextBtn;
  let lastSpecKey = null;

  // ---------- small helpers ----------
  const img = (url) => {
    const i = ui.el('img');
    i.alt = '';
    i.draggable = false;
    i.style.visibility = 'hidden';
    Promise.resolve(url).then((u) => { if (u) { i.src = u; i.style.visibility = 'visible'; } });
    return i;
  };
  const keeper = () => KEEPERS[st.kind] || KEEPERS.candy;
  const say = (text, { quiet = false } = {}) => {
    if (!sayEl) return;
    sayEl.textContent = text;
    sayEl.classList.remove('sh-new');
    void sayEl.offsetWidth;
    sayEl.classList.add('sh-new');
    if (!quiet && game.speak) game.speak(text);
  };
  const refreshWallet = (bump = false) => {
    if (!walletEl) return;
    walletEl.innerHTML = coinHtml(coins.value);
    walletEl.setAttribute('aria-label', `${coins.value} Sparkle Coins`);
    if (bump) {
      walletEl.classList.remove('sh-bump');
      void walletEl.offsetWidth;
      walletEl.classList.add('sh-bump');
    }
  };
  const confetti = (host, x, y) => {
    const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF'];
    for (let i = 0; i < 18; i++) {
      const c = ui.el('div', 'sh-confetti');
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.background = cols[i % cols.length];
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
      c.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      c.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
      c.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      host.appendChild(c);
      setTimeout(() => c.remove(), 1300);
    }
  };
  /** Coins hop from the wallet to what she bought. */
  const spendFly = (toEl, n) => {
    if (!walletEl || !toEl || typeof Element.prototype.animate !== 'function') return;
    const a = walletEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const k = Math.max(2, Math.min(6, Math.round(n / 3)));
    for (let i = 0; i < k; i++) {
      const c = ui.el('div', 'sh-spend');
      document.body.appendChild(c);
      const x0 = a.left + 24, y0 = a.top + a.height / 2, x1 = b.left + b.width / 2 + (Math.random() - 0.5) * 30, y1 = b.top + b.height * 0.4;
      c.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 70}px) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px) scale(.4)`, opacity: 0.2 },
      ], { duration: 520, delay: i * 55, easing: 'ease-in-out', fill: 'both' }).onfinish = () => c.remove();
    }
  };

  // ---------- the shopkeeper ----------
  const showKeeper = () => {
    const k = keeper();
    root.style.setProperty('--kc', k.color);
    keeperEl.innerHTML = '';
    keeperEl.appendChild(ui.el('span', 'sh-keeper-name', k.name));
    const fallback = () => { if (!keeperEl.querySelector('canvas')) keeperEl.insertAdjacentHTML('afterbegin', shopIcon(k.icon)); };
    if (stage.failed) return fallback();
    const kind = st.kind;
    stage.snapshot(`shopkeeper|${kind}`, k.look, { frame: { cy: 1.24, span: 1.34, yaw: 0.3, pitch: 0.05 }, pose: { emote: 'wave', t: 0.55 }, size: 200 })
      .then((c) => {
        if (st.kind !== kind || !ui.isOpen('shop')) return;
        if (!c) return fallback();
        const copy = document.createElement('canvas');
        copy.width = c.width;
        copy.height = c.height;
        copy.getContext('2d').drawImage(c, 0, 0);
        keeperEl.insertBefore(copy, keeperEl.firstChild);
      }, fallback);
  };

  // ---------- buying ----------
  const buy = (key, price, fromEl) => {
    if (!treats.ensureTreat(key)) return false;
    if (!coins.canAfford(price)) {
      const need = price - coins.value;
      say(`Oops! You need ${need} more coin${need === 1 ? '' : 's'}. Find gems, cook or grow food to earn more!`);
      shopSfx(game, 'nope');
      if (fromEl) { fromEl.classList.remove('sh-shake'); void fromEl.offsetWidth; fromEl.classList.add('sh-shake'); }
      return false;
    }
    coins.spend(price, 'shop');
    const n = basketAdd(game, key, 1);
    const p = game.profile;
    p.stats = p.stats || {};
    p.stats.treatsBought = (p.stats.treatsBought || 0) + 1;
    game.saveProfile();
    shopSfx(game, 'kaching');
    spendFly(fromEl, price);
    refreshWallet(true);
    if (fromEl) {
      fromEl.classList.remove('sh-bought');
      void fromEl.offsetWidth;
      fromEl.classList.add('sh-bought');
      const r = fromEl.getBoundingClientRect(), rr = root.getBoundingClientRect();
      confetti(root, r.left - rr.left + r.width / 2, r.top - rr.top + r.height / 2);
    }
    say(pick(keeper().buy));
    game.events.emit('shop:buy', { item: key, price, shop: st.kind, name: FOOD[key].name });
    if (game.award) game.award('sweet_tooth');
    if (sheetEl) showSheet(key, n); // (not before the panel was first built: debug buys)
    refreshCounts();
    return true;
  };

  const showSheet = (key, n) => {
    st.sheetKey = key;
    sheetEl.hidden = false;
    sheetEl.innerHTML = '';
    sheetEl.style.animation = 'none';
    void sheetEl.offsetWidth;
    sheetEl.style.animation = '';
    const f = FOOD[key];
    const text = ui.el('div', 'sh-sheet-text');
    text.appendChild(document.createTextNode(`${f.name} is in your basket!`));
    text.appendChild(ui.el('small', '', n > 1 ? `You have ${n} now.` : 'Hold it, eat it, or share it!'));
    sheetEl.append(
      img(treats.icon(key)),
      text,
      shopButton(ui, { icon: 'hold', label: 'Hold', variant: 'lav', className: 'sh-hold', onClick: () => { ui.close(); treats.hold(key); } }),
      shopButton(ui, { icon: 'bite', label: 'Eat', variant: 'pink', className: 'sh-eat', onClick: () => { ui.close(); treats.hold(key, { quiet: true }); treats.eat(key); } }),
      shopButton(ui, { icon: 'shop', label: 'More', variant: 'mint', className: 'sh-more', onClick: () => { sheetEl.hidden = true; } }),
    );
  };

  // ---------- candy ----------
  const renderCandy = () => {
    candyView.innerHTML = '';
    const grid = ui.el('div', 'sh-grid');
    for (const c of CANDY) {
      const b = ui.el('button', 'sh-item');
      b.type = 'button';
      b.dataset.key = c.key;
      b.setAttribute('aria-label', `${c.name}, ${c.price} coins`);
      const pic = ui.el('span', 'sh-item-pic');
      pic.appendChild(img(treats.icon(c.key)));
      const price = ui.el('span', 'sh-price');
      price.innerHTML = coinHtml(c.price);
      b.append(pic, ui.el('span', 'sh-item-name', c.name), price);
      b.addEventListener('click', () => buy(c.key, c.price, b));
      grid.appendChild(b);
    }
    candyView.appendChild(grid);
    refreshCounts();
  };

  const refreshCounts = () => {
    if (!root) return;
    for (const b of root.querySelectorAll('.sh-item[data-key]')) {
      const key = b.dataset.key;
      const n = basketCount(game, key);
      let have = b.querySelector('.sh-have');
      if (n > 0) {
        if (!have) { have = ui.el('span', 'sh-have'); b.appendChild(have); }
        have.textContent = `×${n}`;
      } else if (have) have.remove();
      const price = Number(b.dataset.price || (FOOD[key] && FOOD[key].price) || 0);
      b.classList.toggle('sh-poor', price > coins.value);
    }
  };

  // ---------- build your own ----------
  const spec = () => st.spec;
  const specKey = () => IC.encode(st.spec);

  const framing = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, -0.22, 0.22, 0.6, 0.22], 3));
    return g;
  })();
  framing.userData.shared = true;
  const FRAME_MAT = new THREE.MeshBasicMaterial({ visible: false });
  FRAME_MAT.userData.shared = true;

  let popT = 1;
  const showPreview = () => {
    const key = specKey();
    if (!key || !treats.ensureTreat(key)) return;
    const pv = preview(game);
    if (!stageEl) return;
    if (pv.failed) {
      stageEl.innerHTML = '';
      stageEl.appendChild(img(treats.icon(key)));
      return;
    }
    if (!pv.mount(stageEl)) return;
    const holder = new THREE.Group();
    const m = treats.model(key);
    // the hand pose turns some treats; the preview shows them as they stand
    const inner = m.userData.inner;
    inner.rotation.set(0, 0, 0);
    inner.position.y = 0;
    m.scale.setScalar(1);
    holder.add(m);
    const f = new THREE.Mesh(framing, FRAME_MAT);
    f.visible = false;
    holder.add(f);
    const yaw = pv.object ? pv.yaw : 0.5;
    popT = key === lastSpecKey ? 1 : 0;
    lastSpecKey = key;
    pv.show(holder, {
      spin: 0.55, yaw, dir: [0, 0.45, 1], zoom: 0.92, lift: 0.47,
      onFrame: (dt) => {
        popT = Math.min(1, popT + dt / 0.4);
        const s = popT < 1 ? 0.82 + 0.18 * (1 - Math.pow(1 - popT, 3)) + Math.sin(popT * Math.PI) * 0.12 : 1;
        m.scale.setScalar(s);
      },
    });
  };

  const refreshBuild = () => {
    const s = spec();
    const key = specKey();
    const p = IC.price(s);
    madeEl.textContent = IC.name(s);
    tagEl.innerHTML = coinHtml(p);
    tagEl.classList.remove('sh-bump');
    void tagEl.offsetWidth;
    tagEl.classList.add('sh-bump');
    buyBtn.querySelector('.sw-btn-label').textContent = 'Buy!';
    buyBtn.dataset.key = key;
    showPreview();
  };

  const setStep = (id) => {
    st.step = id;
    for (const b of stepsEl.children) b.classList.toggle('sh-sel', b.dataset.step === id);
    renderStep();
    const i = STEPS.findIndex(([k]) => k === id);
    nextBtn.hidden = i >= STEPS.length - 1;
    const tips = {
      style: st.kind === 'truck' ? 'What would you like? A cone? A popsicle?' : 'Pick a cone, a cup, a sundae... anything!',
      scoops: 'Pick up to three scoops! Tap a scoop up top to take it off.',
      tops: 'Now the toppings! Sprinkles? A cherry on top?',
    };
    say(tips[id], { quiet: true });
  };

  const renderStep = () => {
    stepBody.innerHTML = '';
    const s = spec();
    if (st.step === 'style') {
      const grid = ui.el('div', 'sh-styles');
      for (const sty of IC.STYLES) {
        const b = ui.el('button', 'sh-opt' + (s.style === sty.id ? ' sh-sel' : ''));
        b.type = 'button';
        b.dataset.style = sty.id;
        b.setAttribute('aria-label', sty.long || sty.name);
        const picKey = IC.encode({ style: sty.id, flavors: STYLE_PICS[sty.id], tops: STYLE_TOPS[sty.id] || '' });
        const price = ui.el('span', 'sh-price');
        price.innerHTML = coinHtml(sty.price);
        const check = ui.el('span', 'sh-check');
        check.innerHTML = shopIcon('ok');
        b.append(img(treats.icon(picKey)), ui.el('span', 'sh-opt-name', sty.name), price, check);
        b.addEventListener('click', () => {
          st.spec = { ...s, style: sty.id };
          shopSfx(game, 'pop', { pitch: 1.1 });
          renderStep();
          refreshBuild();
        });
        grid.appendChild(b);
      }
      stepBody.appendChild(grid);
    } else if (st.step === 'scoops') {
      const row = ui.el('div', 'sh-scoops');
      const layered = s.style === 'popsicle' || s.style === 'shake' || s.style === 'sandwich';
      row.appendChild(ui.el('span', 'sh-scoops-label', layered ? 'Flavors:' : 'Scoops:'));
      for (let i = 0; i < IC.MAX_SCOOPS; i++) {
        const id = s.flavors[i];
        const f = id && IC.flavorOf(id);
        const slot = ui.el('button', 'sh-slot' + (f ? ' sh-full' : ''));
        slot.type = 'button';
        slot.dataset.slot = String(i);
        if (f) {
          slot.innerHTML = scoopSvg(f, 56);
          slot.setAttribute('aria-label', `Take off ${f.name}`);
          if (s.flavors.length > 1) {
            const x = ui.el('span', 'sh-x');
            x.innerHTML = shopIcon('x');
            slot.appendChild(x);
          }
          slot.addEventListener('click', () => {
            if (s.flavors.length <= 1) { say('Every treat needs at least one scoop!'); shopSfx(game, 'nope'); return; }
            st.spec = { ...s, flavors: s.flavors.filter((_, j) => j !== i) };
            shopSfx(game, 'pop', { pitch: 0.8 });
            renderStep();
            refreshBuild();
          });
        } else {
          slot.textContent = '+';
          slot.setAttribute('aria-label', 'Empty scoop');
        }
        row.appendChild(slot);
      }
      const price = ui.el('span', 'sh-price');
      price.innerHTML = `+${coinHtml(IC.SCOOP_PRICE)} each`;
      row.appendChild(price);
      const grid = ui.el('div', 'sh-flavors');
      for (const f of IC.FLAVORS) {
        const b = ui.el('button', 'sh-flavor' + (s.flavors.includes(f.id) ? ' sh-in' : ''));
        b.type = 'button';
        b.dataset.flavor = f.id;
        b.innerHTML = scoopSvg(f, 50);
        b.appendChild(ui.el('span', '', f.name));
        b.addEventListener('click', () => {
          let flavors = s.flavors.slice();
          if (flavors.length >= IC.MAX_SCOOPS) {
            flavors[flavors.length - 1] = f.id;
            say('Three scoops is the most! I swapped the top one.');
          } else {
            flavors.push(f.id);
            if (flavors.length === IC.MAX_SCOOPS) say(layered ? 'Three flavors! So colorful!' : 'Wow, a triple scoop!');
          }
          st.spec = { ...s, flavors };
          shopSfx(game, 'plop');
          renderStep();
          refreshBuild();
        });
        grid.appendChild(b);
      }
      stepBody.append(row, grid);
    } else {
      const grid = ui.el('div', 'sh-tops');
      for (const t of IC.TOPPINGS) {
        const on = s.tops.includes(t.id);
        const b = ui.el('button', 'sh-opt' + (on ? ' sh-sel' : ''));
        b.type = 'button';
        b.dataset.top = t.key;
        b.setAttribute('aria-label', t.name);
        b.insertAdjacentHTML('afterbegin', toppingSvg(t.id, 64));
        const price = ui.el('span', 'sh-price');
        price.innerHTML = `+${coinHtml(t.price)}`;
        const check = ui.el('span', 'sh-check');
        check.innerHTML = shopIcon('ok');
        b.append(ui.el('span', 'sh-opt-name', t.short || t.name), price, check);
        b.addEventListener('click', () => {
          const tops = on ? s.tops.replace(t.id, '') : s.tops + t.id;
          st.spec = IC.normalize({ ...s, tops });
          shopSfx(game, on ? 'pop' : 'sparkle', { pitch: on ? 0.8 : 1.2 });
          renderStep();
          refreshBuild();
        });
        grid.appendChild(b);
      }
      stepBody.appendChild(grid);
    }
  };

  const buildBuilder = () => {
    buildView.innerHTML = '';
    const wrap = ui.el('div', 'sh-build');
    const left = ui.el('div', 'sh-left');
    stageEl = ui.el('div', 'sh-stage');
    madeEl = ui.el('div', 'sh-made', '');
    const buyRow = ui.el('div', 'sh-buyrow');
    tagEl = ui.el('div', 'sh-tag');
    buyBtn = shopButton(ui, { icon: 'coin', label: 'Buy!', variant: 'pink', className: 'sh-buy', onClick: () => {
      const s = spec();
      buy(IC.encode(s), IC.price(s), buyBtn);
      if (preview(game).object) popT = 0;
    } });
    buyRow.append(tagEl, buyBtn);
    left.append(stageEl, madeEl, buyRow);
    const right = ui.el('div', 'sh-right');
    stepsEl = ui.el('div', 'sh-steps');
    STEPS.forEach(([id, label], i) => {
      const b = ui.el('button', 'sh-stepbtn');
      b.type = 'button';
      b.dataset.step = id;
      b.innerHTML = `<b>${i + 1}</b>`;
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => { shopSfx(game, 'click'); setStep(id); });
      stepsEl.appendChild(b);
    });
    stepBody = ui.el('div', 'sh-stepbody');
    const nav = ui.el('div', 'sh-nav');
    nextBtn = shopButton(ui, { icon: 'star', label: 'Next', variant: 'lav', className: 'sh-next', onClick: () => {
      const i = STEPS.findIndex(([k]) => k === st.step);
      setStep(STEPS[Math.min(STEPS.length - 1, i + 1)][0]);
    } });
    nav.appendChild(nextBtn);
    right.append(stepsEl, stepBody, nav);
    wrap.append(left, right);
    buildView.appendChild(wrap);
  };

  // ---------- favorites ----------
  const renderFavs = () => {
    favView.innerHTML = '';
    const grid = ui.el('div', 'sh-grid');
    for (const fav of IC.FAVORITES) {
      const key = IC.encode(fav.spec);
      treats.ensureTreat(key);
      const price = IC.price(fav.spec);
      const b = ui.el('button', 'sh-item');
      b.type = 'button';
      b.dataset.key = key;
      b.dataset.price = String(price);
      b.setAttribute('aria-label', `${fav.name}, ${price} coins`);
      const pic = ui.el('span', 'sh-item-pic');
      pic.appendChild(img(treats.icon(key)));
      const tag = ui.el('span', 'sh-price');
      tag.innerHTML = coinHtml(price);
      b.append(pic, ui.el('span', 'sh-item-name', fav.name), tag);
      b.addEventListener('click', () => buy(key, price, b));
      grid.appendChild(b);
    }
    favView.appendChild(grid);
    const again = ui.el('div', 'sh-nav');
    again.style.justifyContent = 'flex-start';
    again.style.marginTop = '10px';
    again.appendChild(shopButton(ui, { icon: 'build', label: 'Build my own', variant: 'lav', className: 'sh-own', onClick: () => setView('build') }));
    favView.appendChild(again);
    refreshCounts();
  };

  const setView = (view) => {
    st.view = view;
    for (const t of tabsEl.children) t.classList.toggle('sh-sel', t.dataset.view === view);
    candyView.hidden = view !== 'candy';
    buildView.hidden = view !== 'build';
    favView.hidden = view !== 'favs';
    const pv = preview(game);
    if (view === 'build') {
      setStep(st.step || 'style');
      refreshBuild();
    } else {
      pv.clear();
      pv.unmount();
      lastSpecKey = null;
      if (view === 'favs') { renderFavs(); say('These are our favorites! Tap one to buy it.', { quiet: true }); }
    }
  };

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    tabsEl.hidden = st.kind === 'candy';
    if (st.kind === 'candy') return;
    for (const [view, label, ic] of [['build', 'Build Your Own', 'build'], ['favs', 'Favorites', 'star']]) {
      const t = ui.el('button', 'sh-tab');
      t.type = 'button';
      t.dataset.view = view;
      t.innerHTML = shopIcon(ic);
      t.appendChild(document.createTextNode(label));
      t.addEventListener('click', () => { shopSfx(game, 'click'); setView(view); });
      tabsEl.appendChild(t);
    }
  };

  // ---------- the panel ----------
  const setTitle = () => {
    const k = keeper();
    ui.setTitle('shop', k.title);
    const t = ui.panelLayer.querySelector('.sw-panel-wrap[data-panel="shop"] .sw-card-title svg');
    if (t) t.outerHTML = shopIcon(k.icon);
  };

  ui.registerPanel('shop', {
    title: 'Shop',
    icon: 'star',
    width: 1010,
    build(container) {
      root = ui.el('div', 'sh-shop');
      const top = ui.el('div', 'sh-top');
      keeperEl = ui.el('div', 'sh-keeper');
      sayEl = ui.el('div', 'sh-say', '');
      walletEl = ui.el('div', 'sh-wallet');
      top.append(keeperEl, sayEl, walletEl);
      tabsEl = ui.el('div', 'sh-tabs');
      candyView = ui.el('div', 'sh-candy');
      buildView = ui.el('div', 'sh-builder');
      favView = ui.el('div', 'sh-favs');
      sheetEl = ui.el('div', 'sh-sheet');
      sheetEl.hidden = true;
      root.append(top, tabsEl, candyView, buildView, favView, sheetEl);
      container.appendChild(root);
      buildBuilder();
    },
    onOpen(args = {}) {
      const kind = args.kind === 'parlor' || args.kind === 'truck' ? args.kind : 'candy';
      const fresh = kind !== st.kind || !candyView.childElementCount;
      st.kind = kind;
      st.entity = args.entity || null;
      sheetEl.hidden = true;
      setTitle();
      showKeeper();
      refreshWallet();
      renderTabs();
      if (kind === 'candy') {
        if (fresh) renderCandy();
        else refreshCounts();
        setView('candy');
      } else {
        if (fresh) { st.step = 'style'; st.spec = { style: kind === 'truck' ? 'popsicle' : 'cone', flavors: ['straw'], tops: kind === 'truck' ? '' : 's' }; }
        setView(args.view || 'build');
      }
      say(pick(keeper().greet));
      shopSfx(game, 'chime');
    },
    onClose() {
      const pv = preview(game);
      pv.clear();
      pv.unmount();
      lastSpecKey = null;
    },
  });

  game.events.on('coins:change', () => { if (ui.isOpen('shop')) { refreshWallet(true); refreshCounts(); } });
  game.events.on('basket:change', () => { if (ui.isOpen('shop')) refreshCounts(); });

  return {
    open: (kind = 'candy', entity = null, view = null) => ui.open('shop', { kind, entity, view }),
    get state() { return st; },
    setSpec(s) {
      const n = IC.normalize(s);
      if (!n) return false;
      st.spec = n;
      if (ui.isOpen('shop') && st.view === 'build') { renderStep(); refreshBuild(); }
      return true;
    },
    buy,
  };
}
