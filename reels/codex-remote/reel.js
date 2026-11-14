/* Codex Remote — Instagram Reel (1080x1920, 30fps).
 * Everything on screen is a pure function of t; see ../lib/render.cjs. */
(() => {
  const DUR = 47.6, FPS = 30;
  window.REEL = { duration: DUR, fps: FPS, width: 1080, height: 1920, ready: false };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const stage = $('#stage');
  const capBox = $('#captions');
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const frameFns = [];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const MINT = '#35f2b0', CLAUDE = '#d97757';

  // ---------------------------------------------------------------- helpers
  function scene(id, a, b, html) {
    const s = document.createElement('section');
    s.className = 'scene'; s.id = id; s.innerHTML = html;
    stage.insertBefore(s, capBox);
    tl.set(s, { autoAlpha: 1 }, a);
    if (b < DUR) tl.set(s, { autoAlpha: 0 }, b);
    tl.fromTo(s, { scale: 1.07 }, { scale: 1, duration: 0.45, ease: 'expo.out', immediateRender: false }, a);
    tl.to(s, { scale: 1.035, duration: b - a - 0.45, ease: 'none' }, a + 0.45);
    if (a > 0) flash(a, 0.3);
    return s;
  }
  const flash = (at, level = 0.25) => tl.fromTo('#flash', { opacity: level }, { opacity: 0, duration: 0.22, ease: 'power1.out', immediateRender: false }, at);
  const pop = (target, at, o = {}) => tl.fromTo(target,
    { autoAlpha: 0, scale: o.from ?? 0.55, y: o.y ?? 0, rotation: o.rot0 ?? 0 },
    { autoAlpha: 1, scale: 1, y: 0, rotation: o.rot ?? 0, duration: o.dur ?? 0.42, ease: o.ease ?? 'back.out(2)', stagger: o.stagger ?? 0 }, at);
  const fade = (target, at, to = 1, dur = 0.25) => tl.to(target, { autoAlpha: to, duration: dur, ease: 'power1.out' }, at);
  function type(elm, text, at, dur) {
    elm.textContent = '';
    const o = { n: 0 };
    tl.to(o, { n: text.length, duration: dur, ease: 'none', onUpdate() { elm.textContent = text.slice(0, Math.round(o.n)); } }, at);
  }
  function click(ripple, at, x, y) {
    if (x !== undefined) tl.set(ripple, { x, y }, at - 0.01);
    tl.fromTo(ripple, { scale: 0.25, opacity: 0.95 }, { scale: 1.5, opacity: 0, duration: 0.45, ease: 'power2.out' }, at);
  }
  function tap(elm, at) {
    tl.fromTo(elm, { scale: 1.5, opacity: 0 }, { scale: 0.8, opacity: 1, duration: 0.16, ease: 'power2.in' }, at - 0.16);
    tl.to(elm, { scale: 1.7, opacity: 0, duration: 0.4, ease: 'power2.out' }, at);
  }
  function fit(elm, maxW) {
    const range = document.createRange();
    range.selectNodeContents(elm);
    let size = parseFloat(getComputedStyle(elm).fontSize);
    while (range.getBoundingClientRect().width > maxW && size > 20) { size -= 2; elm.style.fontSize = size + 'px'; }
  }
  function bars(host, n, { a, b, min = 10, max = 90, w, speak }) {
    host.innerHTML = '<i></i>'.repeat(n);
    const kids = $$('i', host);
    if (w) kids.forEach((k) => (k.style.width = w + 'px'));
    frameFns.push((t) => {
      if (t < a - 0.1 || t > b + 0.1) return;
      const level = speak ? speak(t) : 1;
      kids.forEach((k, i) => {
        const v = 0.5 + 0.5 * Math.sin(t * (9 + (i % 5) * 2.3) + i * 1.7) * Math.cos(t * 3.1 + i * 0.6);
        const env = Math.sin((i / (n - 1)) * Math.PI) * 0.75 + 0.25;
        k.style.height = (min + (max - min) * v * env * level).toFixed(1) + 'px';
      });
    });
  }
  function rings(host, n, { a, b, period = 1.6, size = 200, grow = 5, alpha = 0.5 }) {
    host.innerHTML = '<div class="ring"></div>'.repeat(n);
    const kids = $$('.ring', host);
    kids.forEach((k) => { k.style.width = k.style.height = size + 'px'; k.style.left = k.style.top = -size / 2 + 'px'; });
    frameFns.push((t) => {
      if (t < a || t > b) { kids.forEach((k) => (k.style.opacity = 0)); return; }
      kids.forEach((k, i) => {
        const p = (((t - a) / period + i / n) % 1 + 1) % 1;
        k.style.transform = `scale(${(1 + p * grow).toFixed(3)})`;
        k.style.opacity = ((1 - p) * alpha * clamp((t - a) * 3)).toFixed(3);
      });
    });
  }
  const CURSOR = '<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2l15 9.6-6.7 1.4L16 20.2l-3 1.3-3.4-7L5 18z" fill="#fff" stroke="#0b0b0f" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const MIC = (c = '#06070a', s = 28) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3" fill="${c}"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/></svg>`;
  const SPARK = (s = 90, c = CLAUDE) => {
    let p = '';
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + 0.13, r = i % 2 ? 36 : 46, r0 = 9;
      p += `<line x1="${(50 + Math.cos(ang) * r0).toFixed(1)}" y1="${(50 + Math.sin(ang) * r0).toFixed(1)}" x2="${(50 + Math.cos(ang) * r).toFixed(1)}" y2="${(50 + Math.sin(ang) * r).toFixed(1)}"/>`;
    }
    return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" stroke="${c}" stroke-width="8.5" stroke-linecap="round">${p}</svg>`;
  };
  const DOCK = (cols) => `<div class="dock">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`;
  const STATUS = '<div class="island"></div><div class="statusbar"><span>9:41</span><span style="letter-spacing:2px;opacity:.9">●●● ▮</span></div>';
  function qr(n, cell, seed) {
    // decorative QR-style pattern (does not encode anything)
    let s = seed, h = '';
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const finder = (x, y) => {
      for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        const dx = x - fx, dy = y - fy;
        if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) {
          if (dx < 0 || dx > 6 || dy < 0 || dy > 6) return 0;
          return (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)) ? 1 : 0;
        }
      }
      return -1;
    };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const f = finder(x, y), on = f === -1 ? rnd() > 0.52 : f;
      h += `<i style="width:${cell}px;height:${cell}px;background:${on ? '#0a0b0e' : '#fff'}"></i>`;
    }
    return `<div class="qr" style="grid-template-columns:repeat(${n},${cell}px)">${h}</div>`;
  }

  // ---------------------------------------------------------------- S1 · hook (0 – 4.6)
  {
    const s = scene('s1', 0, 4.6, `
      <div class="hook">
        <div class="h1 l1"><span>Control</span> <span>your</span></div>
        <div class="h1 l2"><span>entire</span> <span>computer</span></div>
        <div class="underline"></div>
        <div class="pill"><span>just</span><span>by</span><span>talking</span><span>to</span><span>your</span><span>phone</span></div>
      </div>
      <div class="monitor" id="m1" style="left:56px;top:730px;width:790px;height:500px"><div class="display">
        <div class="menubar"><b>●</b><span>File</span><span>Edit</span><span>View</span><span class="r">Tue 9:41</span></div>
        <div class="win" id="m1a" style="left:38px;top:66px;width:430px;height:300px"><div class="bar"><b></b><b></b><b></b><em>deploy.ts</em></div>
          <div style="padding:14px 22px">${[72, 48, 86, 60, 38, 78, 54, 66].map((w, i) => `<div class="codeline" style="width:${w}%;background:${['#6aa8ff', '#3b4252', '#35f2b0', '#3b4252', '#c792ea', '#3b4252', '#6aa8ff', '#3b4252'][i]}"></div>`).join('')}</div></div>
        <div class="win" id="m1b" style="left:340px;top:150px;width:410px;height:270px"><div class="bar"><b></b><b></b><b></b><em>Dashboard</em></div>
          <div style="display:flex;align-items:flex-end;gap:14px;height:130px;padding:20px 24px 0">${[40, 64, 52, 88, 70, 100].map((h) => `<div class="chartbar" style="flex:1;height:${h}%;border-radius:8px 8px 0 0;background:linear-gradient(#6aa8ff,#3558d8);transform-origin:50% 100%"></div>`).join('')}</div>
          <div id="m1btn" style="margin:22px 24px 0 auto;width:150px;height:46px;border-radius:12px;background:#35f2b0;color:#04130d;font:800 20px Inter;display:flex;align-items:center;justify-content:center">Deploy</div></div>
        <div class="win" style="left:530px;top:58px;width:220px;height:150px;background:#f4f1ea;border-radius:12px"><div class="bar" style="height:30px;background:#e2ddd2"><b></b><b></b><b></b></div>
          <div style="padding:10px 16px">${[80, 62, 90, 48].map((w) => `<div style="height:10px;border-radius:6px;margin:10px 0;width:${w}%;background:#b9b3a6"></div>`).join('')}</div></div>
        <div class="toast" id="m1toast" style="right:22px;top:228px">✓ Deployed</div>
        ${DOCK(['#ff6b6b', '#6aa8ff', '#ffd166', '#35f2b0', '#c792ea', '#f5f7fa'])}
        <div class="ripple" id="m1r"></div>${CURSOR}
      </div></div>
      <div id="s1rings" style="position:absolute;left:810px;top:1335px"></div>
      <div class="phone" id="p1" style="left:610px;top:960px;width:400px;height:830px;--r:62px"><div class="screen">${STATUS}
        <div style="position:absolute;top:120px;left:0;right:0;text-align:center;font:800 30px 'Inter Display';color:${MINT}">Listening…</div>
        <div class="orb" style="left:105px;top:215px;width:190px;height:190px"></div>
        <div class="bars" id="p1bars" style="position:absolute;left:0;right:0;top:470px;height:110px"></div>
        <div style="position:absolute;left:0;right:0;top:630px;text-align:center;font:600 21px Inter;color:#c7cdd8"><span class="dot" style="background:${MINT};margin-right:9px"></span>MacBook Pro · Connected</div>
      </div></div>`);
    const m = $('#m1'), p = $('#p1'), cur = $('.cursor', m), rip = $('#m1r');
    fit($('.l2', s), 990); fit($('.l1', s), 990);
    gsap.set(m, { transformPerspective: 1700, rotationY: 13, rotationX: 4, rotation: -2 });
    gsap.set(p, { rotation: 5 });
    gsap.set(['#m1a', '#m1b', '#m1toast'], { autoAlpha: 0 });
    gsap.set($$('.codeline', m), { scaleX: 0 });
    gsap.set($$('.chartbar', m), { scaleY: 0 });
    gsap.set($$('.pill span', s), { opacity: 0.28 });
    gsap.set($('.pill', s), { autoAlpha: 0 });
    gsap.set($('.underline', s), { scaleX: 0 });
    // headline is fully set from frame 0 (the first frame is what people see before they decide to stay);
    // the scene's own punch-in gives it the landing motion
    tl.to($('.underline', s), { scaleX: 1, duration: 0.5, ease: 'expo.out' }, 1.42);
    tl.fromTo($$('.l2 span', s), { scale: 1 }, { scale: 1.035, duration: 0.14, yoyo: true, repeat: 1, stagger: 0.5, ease: 'power2.out' }, 1.42);
    tl.fromTo($('.pill', s), { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, 2.7);
    // the whole line is readable as soon as the pill lands; each word firms up as it is spoken
    [2.78, 2.96, 3.24, 3.5, 3.68, 3.92].forEach((at, i) => {
      tl.to($$('.pill span', s)[i], { opacity: 1, duration: 0.1 }, at);
      tl.fromTo($$('.pill span', s)[i], { y: 0 }, { y: -9, duration: 0.09, yoyo: true, repeat: 1, ease: 'power2.out' }, at);
    });
    tl.fromTo(m, { scale: 0.94, x: -30 }, { scale: 1, x: 0, duration: 0.9, ease: 'expo.out' }, 0);
    tl.fromTo(p, { y: 70 }, { y: 0, duration: 0.9, ease: 'expo.out' }, 0);
    tl.to(p, { y: -18, rotation: 3.5, duration: 3.6, ease: 'sine.inOut' }, 0.9);
    // the computer works on its own
    gsap.set(cur, { x: 610, y: 120 });
    tl.to(cur, { x: 297, y: 440, duration: 0.6, ease: 'power2.inOut' }, 0.15);
    click(rip, 0.8, 300, 455);
    tl.fromTo('#m1a', { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 100%' }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(1.7)' }, 0.86);
    tl.to(cur, { x: 190, y: 210, duration: 0.45, ease: 'power2.inOut' }, 1.2);
    tl.to($$('.codeline', m), { scaleX: 1, duration: 0.22, stagger: 0.12, ease: 'power1.out' }, 1.35);
    tl.to(cur, { x: 421, y: 440, duration: 0.4, ease: 'power2.inOut' }, 2.1);
    click(rip, 2.52, 424, 455);
    tl.fromTo('#m1b', { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 100%' }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(1.7)' }, 2.56);
    tl.to($$('.chartbar', m), { scaleY: 1, duration: 0.4, stagger: 0.06, ease: 'back.out(1.5)' }, 2.75);
    tl.to(cur, { x: 640, y: 372, duration: 0.5, ease: 'power2.inOut' }, 3.05);
    click(rip, 3.62, 644, 386);
    tl.fromTo('#m1btn', { scale: 1 }, { scale: 0.9, duration: 0.08, yoyo: true, repeat: 1 }, 3.6);
    pop('#m1toast', 3.78, { from: 0.6 });
    bars($('#p1bars'), 22, { a: 0, b: 4.6, min: 12, max: 104 });
    rings($('#s1rings'), 4, { a: 0, b: 4.6, period: 1.5, size: 220, grow: 5.5, alpha: 0.45 });
  }

  // ---------------------------------------------------------------- S2 · the name (4.6 – 6.45)
  {
    const s = scene('s2', 4.6, 6.45, `
      <div id="s2rings" style="position:absolute;left:540px;top:890px"></div>
      <div class="devices">
        <svg width="74" height="130" viewBox="0 0 74 130" fill="none" stroke="#fff" stroke-width="6"><rect x="5" y="5" width="64" height="120" rx="15"/><line x1="28" y1="18" x2="46" y2="18" stroke-linecap="round"/></svg>
        <svg id="s2arrow" width="190" height="30" viewBox="0 0 190 30" fill="none" stroke="${MINT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="15" x2="170" y2="15" stroke-dasharray="2 20"/><path d="M162 4l16 11-16 11"/></svg>
        <svg width="190" height="130" viewBox="0 0 190 130" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"><rect x="26" y="8" width="138" height="92" rx="10"/><path d="M6 118h178l-14-18H20z"/></svg>
      </div>
      <div class="t-small">IT’S CALLED</div>
      <div class="t-big" id="s2a" style="top:680px">Codex</div>
      <div class="t-big mint" id="s2b" style="top:900px;text-shadow:0 0 90px rgba(53,242,176,.45)">Remote</div>
      <div class="t-pill"><span class="glass">Inside the ChatGPT app · iPhone + Android</span></div>`);
    rings($('#s2rings'), 5, { a: 4.6, b: 6.45, period: 1.8, size: 260, grow: 4.5, alpha: 0.28 });
    tl.fromTo($$('.devices svg', s), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.08 }, 4.62);
    tl.fromTo($('.t-small', s), { autoAlpha: 0, letterSpacing: '.7em' }, { autoAlpha: 1, letterSpacing: '.34em', duration: 0.35 }, 4.68);
    pop('#s2a', 5.14, { from: 1.5, dur: 0.3, ease: 'expo.out' });
    pop('#s2b', 5.58, { from: 1.5, dur: 0.3, ease: 'expo.out' });
    pop($('.t-pill span', s), 5.92, { from: 0.8, y: 30 });
  }

  // ---------------------------------------------------------------- S3 · setup (6.45 – 11.85)
  {
    const s = scene('s3', 6.45, 11.85, `
      <div class="steps"><div>1 · Open ChatGPT</div><div>2 · Scan the QR</div><div>3 · Paired</div></div>
      <div class="win" id="w3" style="left:60px;top:372px;width:960px;height:520px"><div class="bar"><b></b><b></b><b></b><em>ChatGPT</em></div>
        <div class="side"><div>＋&nbsp; New chat</div><div>◇&nbsp; Codex</div><div>▢&nbsp; Library</div><div id="w3set">⚙&nbsp; Settings</div></div>
        <div id="w3home" style="position:absolute;left:250px;right:0;top:42px;bottom:0;display:flex;align-items:center;justify-content:center;font:700 38px 'Inter Display';color:#d5dae3">What can I help with?</div>
        <div id="w3panel" style="position:absolute;left:250px;right:0;top:42px;bottom:0;padding:26px 34px">
          <div style="font:600 21px Inter;color:#8b93a1">Settings &nbsp;›&nbsp; Connections</div>
          <div style="font:800 40px 'Inter Display';margin-top:14px;letter-spacing:-.02em">Control this Mac</div>
          <div id="w3desc" style="font:500 22px Inter;color:#9aa2af;margin-top:8px">Use Codex on this computer from your phone.</div>
          <div class="toggle" id="w3tog" style="right:34px;top:62px"><b></b></div>
          <div id="w3qr" style="position:absolute;left:34px;top:196px">${qr(21, 11, 7)}</div>
        </div>
        <div class="ripple" id="w3r"></div>${CURSOR}
      </div>
      <div id="s3burst" style="position:absolute;left:805px;top:980px"></div>
      <div class="phone" id="p3" style="left:640px;top:640px;width:330px;height:680px;--r:54px"><div class="screen" style="background:radial-gradient(circle at 50% 40%,#1b2a4a,#07080c 75%)">${STATUS}
        <div id="p3cam" style="position:absolute;inset:0">
          <div style="position:absolute;left:55px;top:190px;width:220px;height:220px;border-radius:26px;border:5px solid rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center">${qr(21, 7, 7)}</div>
          <div id="p3scan" style="position:absolute;left:55px;top:190px;width:220px;height:5px;border-radius:5px;background:${MINT};box-shadow:0 0 26px 6px rgba(53,242,176,.7)"></div>
          <div style="position:absolute;left:0;right:0;top:450px;text-align:center;font:700 25px Inter">Scan to pair</div>
        </div>
        <div id="p3ok" style="position:absolute;inset:0;background:#0b0c10;text-align:center">
          <div id="p3check" style="margin:190px auto 0;width:140px;height:140px;border-radius:50%;background:${MINT};color:#04130d;font:900 84px Inter;display:flex;align-items:center;justify-content:center">✓</div>
          <div style="font:900 44px 'Inter Display';margin-top:30px;letter-spacing:-.02em">Paired</div>
          <div style="font:600 22px Inter;color:#9aa2af;margin-top:10px">MacBook Pro</div>
          <div style="font:700 21px Inter;color:${MINT};margin-top:10px">● Online</div>
        </div>
      </div></div>`);
    const w = $('#w3'), cur = $('.cursor', w), rip = $('#w3r'), steps = $$('.steps div', s), p = $('#p3');
    const stepOn = (i, at) => {
      tl.to(steps[i], { backgroundColor: MINT, color: '#04130d', borderColor: MINT, scale: 1.04, duration: 0.2 }, at);
      if (i > 0) tl.to(steps[i - 1], { backgroundColor: 'rgba(53,242,176,.14)', color: MINT, scale: 1, duration: 0.2 }, at);
    };
    gsap.set(w, { transformPerspective: 1800, rotationX: 4, rotationY: -4 });
    tl.to(w, { scale: 1.4, x: -170, y: 120, rotationY: -2, duration: 0.6, ease: 'expo.inOut' }, 7.0);
    gsap.set(['#w3panel', '#w3qr', '#p3ok'], { autoAlpha: 0 });
    gsap.set(p, { rotation: 5 });
    gsap.set(cur, { x: 640, y: 360 });
    stepOn(0, 6.56);
    tl.to(cur, { x: 120, y: 256, duration: 0.42, ease: 'power2.inOut' }, 6.6);
    click(rip, 7.05, 124, 266);
    tl.to('#w3set', { backgroundColor: '#262a34', color: '#fff', duration: 0.12 }, 7.05);
    fade('#w3home', 7.08, 0, 0.12);
    tl.fromTo('#w3panel', { autoAlpha: 0, x: 26 }, { autoAlpha: 1, x: 0, duration: 0.25 }, 7.12);
    tl.to(cur, { x: 872, y: 120, duration: 0.42, ease: 'power2.inOut' }, 7.3);
    click(rip, 7.78, 876, 130);
    tl.to('#w3tog', { backgroundColor: MINT, duration: 0.18 }, 7.8);
    tl.to('#w3tog b', { x: 36, duration: 0.18, ease: 'back.out(2)' }, 7.8);
    tl.to(cur, { x: 700, y: 430, duration: 0.5, ease: 'power2.inOut' }, 8.1);
    stepOn(1, 8.9);
    pop('#w3qr', 8.82, { from: 0.8, y: 30, dur: 0.35 });
    tl.fromTo(p, { x: 480, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5, ease: 'expo.out' }, 8.9);
    frameFns.push((t) => {
      if (t < 8.8 || t > 10.3) return;
      $('#p3scan').style.transform = `translateY(${(107 + 107 * Math.sin((t - 8.9) * 6)).toFixed(1)}px)`;
    });
    stepOn(2, 10.12);
    tl.to('#p3ok', { autoAlpha: 1, duration: 0.15 }, 10.12);
    pop('#p3check', 10.14, { from: 0.2, dur: 0.5, ease: 'back.out(2.6)' });
    tl.to(p, { scale: 1.06, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' }, 10.12);
    tl.set('#w3desc', { textContent: '✓ iPhone connected · Remote is on', color: MINT, fontWeight: 700 }, 10.2);
    rings($('#s3burst'), 3, { a: 10.12, b: 11.85, period: 1.1, size: 240, grow: 5, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- S4+S5 · your real machine, then voice (11.85 – 19.55)
  {
    const thread = (title, color, status, pulse) => `<div class="thread"><h4>${title}</h4><p style="color:${color}"><span class="dot${pulse ? ' pulse' : ''}" style="background:${color}"></span>${status}</p></div>`;
    const s = scene('s4', 11.85, 19.55, `
      <div class="kicker"><span>YOUR PHONE IS THE REMOTE</span></div>
      <div class="monitor" id="m4" style="left:36px;top:400px;width:400px;height:262px;border-radius:18px"><div class="display" style="border-radius:18px">
        <div class="win" style="left:22px;top:26px;width:210px;height:150px;border-radius:10px"><div class="bar" style="height:24px"></div></div>
        <div class="win" style="left:150px;top:74px;width:220px;height:150px;border-radius:10px"><div class="bar" style="height:24px"></div></div>
      </div></div>
      <div style="position:absolute;inset:0;transform:scale(1.1);transform-origin:540px 340px"><div class="phone" id="p4" style="left:330px;top:340px;width:420px;height:880px;--r:64px"><div class="screen">${STATUS}
        <div style="position:absolute;left:26px;right:22px;top:82px;display:flex;align-items:center;justify-content:space-between">
          <b style="font:900 42px 'Inter Display';letter-spacing:-.02em">Remote</b>
          <span style="font:700 18px Inter;color:${MINT};padding:9px 14px;border-radius:30px;background:rgba(53,242,176,.12)">● MacBook Pro</span></div>
        <div style="position:absolute;left:0;right:0;top:166px">
          ${thread('Fix checkout tests', MINT, 'Running · 2 min', 1)}
          ${thread('Update pricing page', '#ffb84d', 'Needs your approval')}
          ${thread('Rename 240 invoices', MINT, 'Running · 40 sec', 1)}
          ${thread('Weekly metrics report', '#8b93a1', '✓ Done')}
        </div>
        <div class="composer">Ask Codex to do anything…<div class="mic" id="p4mic">${MIC()}</div></div>
        <div class="tap" id="p4tap" style="left:362px;top:813px"></div>
        <div class="sheet" id="p4sheet" style="height:430px">
          <div style="text-align:center;margin-top:34px;font:800 30px 'Inter Display';color:${MINT}">Listening…</div>
          <div class="orb" style="left:145px;top:92px;width:130px;height:130px"></div>
          <div class="bars" id="p4bars" style="position:absolute;left:0;right:0;top:250px;height:110px"></div>
        </div>
      </div></div></div>
      <div class="card glass" id="c4a" style="left:28px;top:720px"><span class="e">📁</span><div><b>Your files</b><small>right where they are</small></div></div>
      <div class="card glass" id="c4b" style="left:668px;top:500px"><span class="e">🧩</span><div><b>Your apps</b><small>the ones you use</small></div></div>
      <div class="card glass" id="c4c" style="left:640px;top:940px"><span class="e">🔐</span><div><b>Your logins</b><small>already signed in</small></div></div>`);
    const p = $('#p4');
    gsap.set('#m4', { rotation: -7, autoAlpha: 0 });
    gsap.set('#p4sheet', { y: 440 });
    gsap.set(p, { transformOrigin: '50% 85%' });
    tl.fromTo(p, { y: 90, rotation: -3 }, { y: 0, rotation: 0, duration: 0.6, ease: 'expo.out' }, 11.85);
    tl.fromTo($$('.thread', s), { autoAlpha: 0, x: 40 }, { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.09 }, 11.95);
    pop('#m4', 12.5, { from: 0.6, rot0: -20, rot: -7, dur: 0.5 });
    pop('#c4a', 14.3, { rot0: -18, rot: -6 });
    pop('#c4b', 15.32, { rot0: 18, rot: 5 });
    pop('#c4c', 16.16, { rot0: -16, rot: -4 });
    frameFns.push((t) => {
      if (t < 11.8 || t > 19.6) return;
      const a = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 7));
      $$('.pulse', s).forEach((d) => (d.style.opacity = a.toFixed(2)));
    });
    // S5: push in on the composer, tap the mic, start listening
    tl.to(['#c4a', '#c4b', '#c4c', '#m4', $('.kicker', s)], { autoAlpha: 0, scale: 0.8, duration: 0.25, stagger: 0.03, ease: 'power2.in' }, 17.2);
    tl.to(p, { scale: 1.16, y: -96, duration: 0.6, ease: 'expo.inOut' }, 17.3);
    flash(17.4, 0.18);
    tap('#p4tap', 17.94);
    tl.to('#p4mic', { backgroundColor: MINT, scale: 1.15, duration: 0.15 }, 17.94);
    tl.to('#p4sheet', { y: 0, duration: 0.4, ease: 'expo.out' }, 18.05);
    bars($('#p4bars'), 24, { a: 18.0, b: 19.6, min: 10, max: 100 });
  }

  // ---------------------------------------------------------------- S6 · computer use (19.55 – 25.3)
  {
    const row = (a, b, c, col) => `<div class="row"><span>${a}</span><span style="color:${col}">${b}</span><span>${c}</span></div>`;
    const s = scene('s6', 19.55, 25.3, `
      <div class="kicker"><span>COMPUTER USE</span></div>
      <div class="tiles">
        <div class="tile"><span class="e">👀</span>Sees</div><div class="tile"><span class="e">🖱️</span>Clicks</div><div class="tile"><span class="e">⌨️</span>Types</div>
      </div>
      <div class="monitor" id="m6" style="left:50px;top:548px;width:980px;height:640px"><div class="display">
        <div class="menubar"><b>●</b><span>Ledger</span><span>File</span><span>Edit</span><span class="r">Tue 9:41</span></div>
        <div class="win" id="w6" style="left:40px;top:54px;width:900px;height:486px"><div class="bar"><b></b><b></b><b></b><em>Ledger — Invoices</em></div>
          <div id="w6field" style="position:absolute;left:24px;top:62px;width:440px;height:56px;border-radius:14px;background:#0e1015;border:2px solid rgba(255,255,255,.14);display:flex;align-items:center;padding:0 18px;font:600 26px Inter;color:#fff"><span style="opacity:.5;margin-right:10px">⌕</span><span id="w6text"></span><span id="w6caret" style="width:2px;height:26px;background:${MINT};margin-left:2px;opacity:0"></span></div>
          <div id="w6btn" style="position:absolute;right:24px;top:62px;width:230px;height:56px;border-radius:14px;background:#3b82f6;color:#fff;font:700 24px Inter;display:flex;align-items:center;justify-content:center">＋ New invoice</div>
          <div id="w6table" style="position:absolute;left:24px;right:24px;top:140px;border-radius:14px;background:#191c23;border:1px solid rgba(255,255,255,.07)">
            <div class="row" style="color:#7d8594;font-weight:700"><span>Client</span><span>Status</span><span>Amount</span></div>
            ${row('Acme Co', 'Overdue', '$4,200', '#ff8a7a')}${row('Northwind', 'Paid', '$1,850', '#6fe3a5')}${row('Globex', 'Overdue', '$9,400', '#ff8a7a')}${row('Initech', 'Paid', '$620', '#6fe3a5')}
          </div>
          <div class="det" id="d6a" style="left:16px;top:54px;width:456px;height:72px"><u>text field</u></div>
          <div class="det" id="d6b" style="right:16px;top:54px;width:246px;height:72px"><u>button</u></div>
          <div class="det" id="d6c" style="left:16px;right:16px;top:134px;height:316px"><u style="top:auto;bottom:-34px">table</u></div>
        </div>
        <div id="m6scan" style="position:absolute;left:0;right:0;top:0;height:120px;background:linear-gradient(rgba(53,242,176,0),rgba(53,242,176,.28));border-bottom:4px solid ${MINT};opacity:0"></div>
        ${DOCK(['#ff6b6b', '#6aa8ff', '#ffd166', '#35f2b0', '#c792ea', '#f5f7fa'])}
        <div class="ripple" id="m6r"></div>${CURSOR}
      </div></div>`);
    const m = $('#m6'), cur = $('.cursor', m), rip = $('#m6r'), tiles = $$('.tile', s), rows = $$('#w6table .row', s);
    const tileOn = (i, at) => {
      tl.to(tiles[i], { backgroundColor: MINT, borderColor: MINT, color: '#04130d', duration: 0.14 }, at);
      tl.to($('.e', tiles[i]), { filter: 'grayscale(0) opacity(1)', duration: 0.14 }, at);
      tl.fromTo(tiles[i], { scale: 1 }, { scale: 1.1, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' }, at);
    };
    gsap.set(m, { transformPerspective: 1900, rotationX: 5 });
    gsap.set(cur, { x: 560, y: 430 });
    tl.fromTo(tiles, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.08 }, 19.9);
    tl.fromTo(m, { y: 80 }, { y: 0, duration: 0.6, ease: 'expo.out' }, 19.55);
    // sees
    tileOn(0, 21.1);
    tl.fromTo('#m6scan', { y: -120, opacity: 1 }, { y: 640, duration: 0.95, ease: 'power1.inOut' }, 21.08);
    tl.set('#m6scan', { opacity: 0 }, 22.04);
    tl.fromTo(['#d6a', '#d6b', '#d6c'], { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.2, stagger: 0.18, ease: 'power2.out' }, 21.25);
    // clicks
    tl.to(cur, { x: 250, y: 132, duration: 0.42, ease: 'power2.inOut' }, 22.12);
    tileOn(1, 22.5);
    click(rip, 22.6, 254, 144);
    tl.to('#w6field', { borderColor: MINT, boxShadow: '0 0 0 5px rgba(53,242,176,.2)', duration: 0.1 }, 22.6);
    tl.set('#w6caret', { opacity: 1 }, 22.6);
    tl.to(['#d6a', '#d6b', '#d6c'], { opacity: 0, duration: 0.2 }, 22.7);
    // types
    tileOn(2, 23.14);
    type($('#w6text'), 'overdue invoices', 23.14, 0.72);
    tl.to([rows[2], rows[4]], { height: 0, opacity: 0, borderBottomWidth: 0, duration: 0.25 }, 23.9);
    // right inside your apps
    tl.to($$('.dock i', m), { y: -26, duration: 0.16, yoyo: true, repeat: 1, stagger: 0.12, ease: 'power2.out' }, 23.95);
    tl.to(cur, { x: 520, y: 590, duration: 0.6, ease: 'power2.inOut' }, 23.95);
  }

  // ---------------------------------------------------------------- S7 · even Claude Code (25.3 – 26.55)
  {
    const s = scene('s7', 25.3, 26.55, `
      <div class="mega" id="s7a" style="top:320px;font-size:128px">Even</div>
      <div class="mega orange" id="s7b" style="top:450px;font-size:170px;text-shadow:0 0 90px rgba(217,119,87,.5)">Claude Code.</div>
      <div class="win cl" id="w7" style="left:60px;top:730px;width:960px;height:600px;border-radius:26px;background:#2d2c29;box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 160px rgba(217,119,87,.4)"><div class="bar" style="height:50px"><b></b><b></b><b></b><em style="font-size:18px">Claude</em></div>
        <div style="display:flex;align-items:center;justify-content:center;gap:26px;margin-top:62px">${SPARK(124)}<span class="serif" style="font-size:108px;color:#f3efe6">Claude</span></div>
        <div style="display:flex;justify-content:center;margin-top:40px"><div class="cl-tabs" style="padding:7px;border-radius:18px"><span style="font-size:30px;padding:13px 34px;border-radius:13px">Chat</span><span style="font-size:30px;padding:13px 34px;border-radius:13px">Cowork</span><span class="on" style="font-size:30px;padding:13px 34px;border-radius:13px;background:#d97757;color:#fff">Code</span></div></div>
        <div class="cl-input" style="left:70px;right:70px;top:432px;height:104px;border-radius:26px;color:#a39f96;font-size:32px">Describe a task…</div>
      </div>`);
    fit($('#s7b'), 990);
    tl.fromTo('#tint', { backgroundColor: CLAUDE, opacity: 0.45 }, { opacity: 0.14, duration: 0.5, immediateRender: false }, 25.3);
    tl.to('#tint', { opacity: 0, duration: 0.2 }, 26.5);
    pop('#s7a', 25.42, { from: 1.4, dur: 0.25, ease: 'expo.out' });
    pop('#s7b', 25.74, { from: 1.5, dur: 0.3, ease: 'expo.out' });
    gsap.set('#w7', { transformPerspective: 1500 });
    tl.fromTo('#w7', { autoAlpha: 0, scale: 0.7, y: 160, rotationX: 28 }, { autoAlpha: 1, scale: 1, y: 0, rotationX: 6, duration: 0.55, ease: 'back.out(1.5)' }, 25.34);
  }

  // ---------------------------------------------------------------- S8 · the spoken command (26.55 – 29.75)
  const CMD = [['Open', 26.63], ['Claude,', 26.99], ['and', 27.77], ['have', 27.87], ['it', 28.01], ['fix', 28.23], ['my', 28.41], ['failing', 28.67], ['tests.', 28.99]];
  const cmdLevel = (t) => (t > 26.6 && t < 27.5) || (t > 27.72 && t < 29.5) ? 1 : 0.16;
  {
    const s = scene('s8', 26.55, 29.75, `
      <div class="kicker"><span>JUST SAY IT</span></div>
      <div id="s8rings" style="position:absolute;left:540px;top:690px"></div>
      <div class="phone" id="p8" style="left:260px;top:372px;width:560px;height:1150px;--r:84px"><div class="screen">${STATUS}
        <div style="position:absolute;left:0;right:0;top:100px;text-align:center"><span style="font:700 22px Inter;color:${MINT};padding:11px 20px;border-radius:30px;background:rgba(53,242,176,.12)">● MacBook Pro</span></div>
        <div class="orb" id="p8orb" style="left:170px;top:208px;width:220px;height:220px"></div>
        <div class="bars" id="p8bars" style="position:absolute;left:0;right:0;top:470px;height:120px"></div>
        <div id="p8text" style="position:absolute;left:44px;right:44px;top:630px;font:900 62px/1.14 'Inter Display';letter-spacing:-.025em">${CMD.map(([w]) => `<span style="display:inline-block;margin-right:14px">${w}</span>`).join('')}</div>
        <div style="position:absolute;left:0;right:0;bottom:60px;display:flex;justify-content:center"><div style="width:96px;height:96px;border-radius:50%;background:${MINT};display:flex;align-items:center;justify-content:center">${MIC('#04130d', 46)}</div></div>
      </div></div>`);
    const words = $$('#p8text span', s);
    gsap.set(words, { autoAlpha: 0 });
    tl.fromTo('#p8', { y: 120, rotation: 3 }, { y: 0, rotation: 0, duration: 0.55, ease: 'expo.out' }, 26.55);
    CMD.forEach(([, at], i) => tl.fromTo(words[i], { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.16, ease: 'back.out(2.2)' }, at));
    tl.to([words[1]], { color: CLAUDE, duration: 0.1 }, 26.99);
    bars($('#p8bars'), 30, { a: 26.5, b: 29.8, min: 10, max: 118, speak: cmdLevel });
    rings($('#s8rings'), 4, { a: 26.55, b: 29.75, period: 1.3, size: 250, grow: 4.2, alpha: 0.4 });
    frameFns.push((t) => {
      if (t < 26.5 || t > 29.8) return;
      const k = 1 + 0.07 * cmdLevel(t) * (0.5 + 0.5 * Math.sin(t * 21));
      $('#p8orb').style.transform = `scale(${k.toFixed(3)})`;
    });
  }

  // ---------------------------------------------------------------- S9 · Codex drives Claude, screenshots come back (29.75 – 35.15)
  {
    const claudeWin = (id, extra = '') => `
      <div class="win cl" id="${id}" style="left:60px;top:84px;width:880px;height:500px"><div class="bar"><b></b><b></b><b></b><em>Claude</em></div>
        <div class="cl-side"><div style="color:#f3efe6">＋ New session</div><div style="background:#34322f;color:#f3efe6">checkout-service</div><div>pricing-page</div><div>docs-site</div></div>
        <div style="position:absolute;left:246px;top:60px"><div class="cl-tabs"><span>Chat</span><span>Cowork</span><span class="on">Code</span></div></div>
        ${extra}
      </div>`;
    const s = scene('s9', 29.75, 35.15, `
      <div class="monitor" id="m9" style="left:40px;top:262px;width:1000px;height:620px"><div class="display">
        <div class="menubar"><b>●</b><span>Claude</span><span>File</span><span>Edit</span><span class="r">Tue 9:41</span></div>
        ${claudeWin('w9', `
          <div id="w9lines" style="position:absolute;left:250px;top:136px;right:24px">
            <div class="cl-line"><span class="orange">&gt;</span> Fix the failing tests in checkout-service</div>
            <div class="cl-line" style="color:#a8a49b">● Reading the test output…</div>
            <div class="cl-line" style="color:#a8a49b">● Editing cart.test.ts</div>
            <div class="cl-line" style="color:${MINT}">✓ 42 tests passing</div>
          </div>
          <div class="cl-input" id="w9input" style="left:250px;top:404px;width:606px;height:70px"><span id="w9text"></span><span id="w9ph" style="color:#8f8b82">Describe a task…</span></div>`)}
        <div style="position:absolute;left:16px;top:44px;padding:8px 16px;border-radius:30px;background:rgba(6,7,10,.85);border:1.5px solid ${MINT};color:${MINT};font:700 18px Inter;z-index:40">● Codex is using your computer</div>
        ${DOCK(['#ff6b6b', '#6aa8ff', '#ffd166', CLAUDE, '#c792ea', '#f5f7fa'])}
        <div id="m9flash" style="position:absolute;inset:0;background:#fff;opacity:0;z-index:45"></div>
        <div class="ripple" id="m9r" style="border-color:${CLAUDE}"></div>${CURSOR}
      </div></div>
      <div class="stepline" id="st9a" style="top:938px"><i>✓</i>Opens</div>
      <div class="stepline" id="st9b" style="top:1036px"><i>✓</i>Types</div>
      <div class="stepline" id="st9c" style="top:1134px"><i>✓</i>Screenshots</div>
      <div class="phone" id="p9" style="left:612px;top:716px;width:400px;height:612px;--r:58px"><div class="screen">${STATUS}
        <div style="position:absolute;left:24px;right:20px;top:76px;display:flex;align-items:center;justify-content:space-between">
          <b style="font:900 34px 'Inter Display';letter-spacing:-.02em">Remote</b><span style="font:700 17px Inter;color:${MINT};padding:8px 13px;border-radius:30px;background:rgba(53,242,176,.12)">● Live</span></div>
        <div style="position:absolute;left:0;right:0;top:138px">
          <div class="bubble" id="b9a"><span class="mint">✓</span>Opening Claude</div>
          <div class="bubble" id="b9b"><span class="mint">✓</span>Typing your prompt</div>
          <div id="b9slot" style="margin:0 18px 12px;height:216px;border-radius:18px;background:#14161c;border:1px dashed rgba(255,255,255,.14)"></div>
        </div>
      </div></div>
      <div id="shot9" style="position:absolute;left:40px;top:262px;width:1000px;height:620px;border-radius:26px;overflow:hidden;border:6px solid #fff;background:radial-gradient(120% 90% at 20% 10%,#3a2a7a 0%,#15214f 45%,#0a2f3d 100%);transform-origin:0 0;z-index:70">
        ${claudeWin('w9copy', `
          <div style="position:absolute;left:250px;top:136px;right:24px">
            <div class="cl-line" style="opacity:1"><span class="orange">&gt;</span> Fix the failing tests in checkout-service</div>
            <div class="cl-line" style="opacity:1;color:#a8a49b">● Reading the test output…</div>
          </div>`)}
      </div>`);
    const m = $('#m9'), cur = $('.cursor', m), rip = $('#m9r'), lines = $$('#w9lines .cl-line', s);
    gsap.set(m, { transformPerspective: 1900, rotationX: 4 });
    gsap.set(['#w9', '#st9a', '#st9b', '#st9c', '#b9a', '#b9b', '#shot9'], { autoAlpha: 0 });
    gsap.set('#p9', { rotation: 4 });
    gsap.set(cur, { x: 860, y: 560 });
    // opens the app
    tl.to(cur, { x: 482, y: 578, duration: 0.3, ease: 'power2.inOut' }, 29.8);
    click(rip, 30.14, 486, 592);
    tl.fromTo('#w9', { autoAlpha: 0, scale: 0.5, transformOrigin: '50% 100%' }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(1.6)' }, 30.18);
    pop('#st9a', 30.3, { from: 0.7, y: 20 });
    tl.fromTo('#p9', { x: 420, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5, ease: 'expo.out' }, 30.0);
    pop('#b9a', 30.5, { from: 0.8, y: 16 });
    // types the prompt
    tl.to(cur, { x: 520, y: 510, duration: 0.4, ease: 'power2.inOut' }, 30.75);
    click(rip, 31.22, 524, 522);
    tl.to('#w9input', { borderColor: CLAUDE, duration: 0.1 }, 31.22);
    tl.set('#w9ph', { display: 'none' }, 31.44);
    pop('#st9b', 31.46, { from: 0.7, y: 20 });
    pop('#b9b', 31.6, { from: 0.8, y: 16 });
    type($('#w9text'), 'Fix the failing tests in checkout-service', 31.46, 0.9);
    tl.set('#w9text', { textContent: '' }, 32.44);
    tl.set('#w9ph', { display: 'inline' }, 32.44);
    [32.44, 32.62, 33.3, 33.95].forEach((at, i) => tl.fromTo(lines[i], { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.2 }, at));
    // screenshot flies to the phone
    pop('#st9c', 32.92, { from: 0.7, y: 20 });
    tl.fromTo('#m9flash', { opacity: 0.9 }, { opacity: 0, duration: 0.3, ease: 'power1.out', immediateRender: false }, 32.9);
    tl.set('#shot9', { autoAlpha: 1, x: 0, y: 0, scale: 1, rotation: 0 }, 32.9);
    tl.to('#shot9', { x: 598, y: 722, scale: 0.343, rotation: 4, duration: 0.75, ease: 'expo.inOut' }, 33.02);
    tl.to('#shot9', { borderWidth: 10, duration: 0.75 }, 33.02);
    tl.fromTo('#p9', { scale: 1 }, { scale: 1.05, duration: 0.12, yoyo: true, repeat: 1 }, 33.72);
  }

  // ---------------------------------------------------------------- S10 · approve from anywhere (35.15 – 39.85)
  {
    const s = scene('s10', 35.15, 39.85, `
      <div class="kicker"><span>ONE TAP TO APPROVE</span></div>
      <div style="position:absolute;inset:0;transform:scale(1.07);transform-origin:540px 356px"><div class="phone" id="p10" style="left:320px;top:356px;width:440px;height:900px;--r:66px"><div class="screen">${STATUS}
        <div style="position:absolute;left:26px;right:22px;top:82px;display:flex;align-items:center;justify-content:space-between">
          <b style="font:900 40px 'Inter Display';letter-spacing:-.02em">Remote</b><span style="font:700 18px Inter;color:${MINT};padding:9px 14px;border-radius:30px;background:rgba(53,242,176,.12)">● MacBook Pro</span></div>
        <div style="position:absolute;left:0;right:0;top:160px">
          <div class="bubble" style="font-size:22px"><span class="mint">✓</span>42 tests passing</div>
          <div class="bubble" style="font-size:22px"><span style="color:#ffb84d">●</span>Ready to push the fix</div>
        </div>
        <div class="sheet" id="sh10" style="height:440px;padding:20px 28px">
          <div style="width:64px;height:6px;border-radius:6px;background:#3a3f4b;margin:0 auto 24px"></div>
          <div style="font:900 34px 'Inter Display';letter-spacing:-.02em">Approve this step?</div>
          <div style="font:500 21px Inter;color:#9aa2af;margin-top:8px">Codex wants to run a command</div>
          <div style="margin-top:22px;padding:20px 20px;border-radius:18px;background:#07080b;border:1px solid var(--stroke);font:600 21px 'JetBrains Mono';color:#dfe4ec;white-space:nowrap">$ git push origin fix/tests</div>
          <div style="display:flex;gap:14px;margin-top:26px">
            <div class="btn" style="background:#22262f;color:#c9cfda">Deny</div>
            <div class="btn" id="ok10" style="background:${MINT};color:#04130d">Approve</div>
          </div>
          <div class="tap" id="tap10" style="left:319px;top:278px"></div>
        </div>
      </div></div></div>
      <div class="sticker" id="k10a" style="left:36px;top:430px"><div class="c glass">🛋️</div><b>The couch</b></div>
      <div class="sticker" id="k10b" style="left:794px;top:640px"><div class="c glass">🏋️</div><b>The gym</b></div>
      <div class="sticker" id="k10c" style="left:36px;top:880px"><div class="c glass">🌍</div><b>Anywhere</b></div>`);
    gsap.set('#sh10', { y: 450 });
    tl.fromTo('#p10', { y: 90 }, { y: 0, duration: 0.55, ease: 'expo.out' }, 35.15);
    tl.to('#sh10', { y: 0, duration: 0.45, ease: 'expo.out' }, 35.34);
    tap('#tap10', 36.72);
    tl.to('#ok10', { scale: 0.93, duration: 0.08, yoyo: true, repeat: 1 }, 36.72);
    tl.set('#ok10', { textContent: '✓ Approved' }, 36.8);
    tl.to('#sh10', { boxShadow: '0 -30px 90px rgba(53,242,176,.35)', duration: 0.3 }, 36.8);
    tl.to('#p10', { scale: 1.04, duration: 0.14, yoyo: true, repeat: 1 }, 36.8);
    pop('#k10a', 37.98, { rot0: -20, rot: -6 });
    pop('#k10b', 38.62, { rot0: 20, rot: 6 });
    pop('#k10c', 39.06, { rot0: -20, rot: -4 });
    tl.fromTo('#tint', { backgroundColor: '#ffb84d', opacity: 0 }, { opacity: 0.16, duration: 0.2, immediateRender: false }, 37.98);
    tl.to('#tint', { backgroundColor: '#ff5d7a', duration: 0.2 }, 38.62);
    tl.to('#tint', { backgroundColor: '#3d7bff', duration: 0.2 }, 39.06);
    tl.to('#tint', { opacity: 0, duration: 0.15 }, 39.8);
  }

  // ---------------------------------------------------------------- S11 · the new way to work (39.85 – 43.8)
  {
    const s = scene('s11', 39.85, 43.8, `
      <div id="s11a">
        <div class="mega muted" id="n1" style="top:590px;font-size:70px;letter-spacing:.02em">This is the</div>
        <div class="mega" id="n2" style="top:680px">NEW WAY</div>
        <div class="mega mint" id="n3" style="top:890px;text-shadow:0 0 90px rgba(53,242,176,.45)">TO WORK</div>
      </div>
      <div id="s11b">
        <div class="mega" id="n4" style="top:330px;font-size:190px">YOU TALK.</div>
        <div class="bars" id="n4bars" style="position:absolute;left:0;right:0;top:560px;height:220px;gap:12px"></div>
        <div style="position:absolute;left:140px;right:140px;top:850px;height:4px;border-radius:4px;background:rgba(255,255,255,.14)"></div>
        <div class="mega" id="n5" style="top:920px;font-size:120px">YOUR COMPUTER</div>
        <div class="mega mint" id="n6" style="top:1050px;font-size:260px;text-shadow:0 0 90px rgba(53,242,176,.45)">DOES.</div>
        <div id="n7" style="position:absolute;left:195px;top:1370px;display:flex;gap:30px"><div class="check"></div><div class="check"></div><div class="check"></div><div class="check"></div></div>
      </div>`);
    ['#n2', '#n3', '#n4', '#n5'].forEach((q) => fit($(q), 1000));
    gsap.set('#s11b', { autoAlpha: 0 });
    gsap.set(['#n1', '#n2', '#n3', '#n4', '#n5', '#n6'], { autoAlpha: 0 });
    tl.fromTo('#n1', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.25 }, 39.92);
    pop('#n2', 40.36, { from: 1.5, dur: 0.28, ease: 'expo.out' });
    pop('#n3', 40.72, { from: 1.5, dur: 0.28, ease: 'expo.out' });
    tl.set('#s11a', { autoAlpha: 0 }, 41.5);
    tl.set('#s11b', { autoAlpha: 1 }, 41.5);
    flash(41.5, 0.25);
    pop('#n4', 41.56, { from: 1.4, dur: 0.26, ease: 'expo.out' });
    bars($('#n4bars'), 34, { a: 41.5, b: 43.8, min: 16, max: 220, w: 14, speak: (t) => (t < 42.25 ? 1 : 0.22) });
    pop('#n5', 42.26, { from: 1.4, dur: 0.26, ease: 'expo.out' });
    pop('#n6', 42.76, { from: 1.6, dur: 0.3, ease: 'expo.out' });
    $$('#n7 .check', s).forEach((c, i) => {
      const at = 42.5 + i * 0.22;
      tl.set(c, { textContent: '✓' }, at);
      tl.fromTo(c, { backgroundColor: 'rgba(255,255,255,.06)', scale: 1 }, { backgroundColor: MINT, borderColor: MINT, scale: 1.14, duration: 0.12, yoyo: true, repeat: 1 }, at);
      tl.set(c, { backgroundColor: MINT, borderColor: MINT }, at + 0.24);
    });
  }

  // ---------------------------------------------------------------- S12 · follow (43.8 – end)
  {
    const s = scene('s12', 43.8, DUR, `
      <div id="s12rings" style="position:absolute;left:540px;top:925px"></div>
      <div class="mega" id="f1" style="top:540px;font-size:250px">Follow</div>
      <div class="follow-btn" id="f2"><span id="f2t">＋ Follow</span></div>
      <div class="tap" id="f2tap" style="left:540px;top:925px;width:170px;height:170px;margin:-85px 0 0 -85px"></div>
      <div class="mega" id="f3" style="top:1090px;font-size:76px;letter-spacing:-.025em"><span>for</span> <span>more</span> <span>AI</span> <span>you</span> <span>can</span></div>
      <div class="mega mint" id="f4" style="top:1185px;font-size:112px;letter-spacing:-.035em">actually use.</div>
      <div class="mega muted" id="f5" style="top:1450px;font:600 30px Inter;letter-spacing:.02em">Codex Remote · in the ChatGPT app</div>`);
    gsap.set($$('#f3 span', s), { display: 'inline-block', autoAlpha: 0 });
    gsap.set(['#f4', '#f5'], { autoAlpha: 0 });
    pop('#f1', 43.88, { from: 1.4, dur: 0.3, ease: 'expo.out' });
    pop('#f2', 44.0, { from: 0.6, y: 40 });
    [44.06, 44.22, 44.48, 44.86, 45.08].forEach((at, i) => tl.fromTo($$('#f3 span', s)[i], { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.16, ease: 'back.out(2.2)' }, at));
    pop('#f4', 45.3, { from: 1.3, dur: 0.28, ease: 'expo.out' });
    tap('#f2tap', 45.0);
    tl.to('#f2', { scale: 0.93, duration: 0.08, yoyo: true, repeat: 1 }, 45.0);
    tl.set('#f2t', { textContent: 'Following ✓' }, 45.08);
    tl.to('#f2', { backgroundColor: MINT, duration: 0.15 }, 45.08);
    tl.fromTo('#f5', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 46.0);
    rings($('#s12rings'), 4, { a: 45.05, b: DUR, period: 1.6, size: 300, grow: 3.6, alpha: 0.3 });
  }

  // ---------------------------------------------------------------- captions
  // "word@start"; "/" ends a caption line. Typographic scenes carry their own words.
  const CAPS = `
    Open@6.56 ChatGPT@6.78/ on@7.58 your@7.72 computer,@7.90/ scan@8.90 one@9.14 QR@9.44 code,@9.82/ and@10.10 your@10.54 phone@10.80/ is@10.96 paired.@11.24/
    Now@11.96 it's@12.12 a@12.32 remote@12.44/ for@12.78 your@12.92 real@13.12 machine.@13.40/ Your@14.30 files.@14.52/ Your@15.32 apps.@15.62/ Your@16.16 logins.@16.40/
    Tap@17.50 the@17.70 mic,@17.94/ and@18.30 say@18.44 what@18.66 you@18.82 want.@19.02/
    With@19.66 computer@19.80 use,@20.24/ Codex@21.10 sees@21.30 your@21.56 screen,@21.80/ clicks,@22.50 and@22.82 types,@23.14/ right@23.92 inside@24.18 your@24.50 apps.@24.74/
    Codex@29.80 opens@30.30 the@30.70 app,@30.92/ types@31.46 the@31.76 prompt,@32.00/ and@32.58 sends@32.70 screenshots@32.92/ straight@33.50 back@33.94/ to@34.14 your@34.24 phone.@34.50/
    You@35.22 approve@35.34 each@35.66 step@35.98/ with@36.16 one@36.34 tap.@36.72/ From@37.42 the@37.62 couch.@38.00/ The@38.26 gym.@38.64/ Anywhere.@39.08/`;
  const chunks = [];
  {
    let cur = [];
    CAPS.trim().split(/\s+/).forEach((tok) => {
      const end = tok.endsWith('/');
      const [text, at] = tok.replace('/', '').split('@');
      cur.push({ text, s: parseFloat(at) });
      if (end) { chunks.push(cur); cur = []; }
    });
    chunks.forEach((c, i) => {
      const next = chunks[i + 1] ? chunks[i + 1][0].s : Infinity;
      c.forEach((w, j) => (w.e = c[j + 1] ? c[j + 1].s : Math.min(w.s + 0.55, next)));
      c.a = c[0].s - 0.04;
      c.b = Math.min(next - 0.04, c[c.length - 1].e + 0.3);
      c.el = document.createElement('div');
      c.el.className = 'cap';
      c.el.innerHTML = c.map((w) => `<span class="w">${w.text}</span>`).join('');
      capBox.appendChild(c.el);
      c.spans = $$('.w', c.el);
      let size = 80;
      while (c.el.scrollWidth > 1000 && size > 48) { size -= 2; c.el.style.fontSize = size + 'px'; }
    });
  }
  frameFns.push((t) => {
    for (const c of chunks) {
      const on = t >= c.a && t < c.b;
      c.el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) continue;
      const k = clamp((t - c.a) / 0.1);
      c.el.style.transform = `scale(${(0.86 + 0.14 * (1 - Math.pow(1 - k, 3))).toFixed(3)})`;
      c.forEach((w, j) => {
        const curr = t >= w.s - 0.03 && t < w.e - 0.03;
        c.spans[j].className = curr ? 'w cur' : 'w';
        const p = clamp((t - w.s + 0.03) / 0.12);
        c.spans[j].style.transform = curr ? `scale(${(1.1 - 0.04 * p).toFixed(3)}) translateY(-4px)` : 'none';
      });
    }
  });

  // ---------------------------------------------------------------- ambient: background drift + film grain
  {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256);
    let seed = 1234567;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = seed % 256; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
    const b1 = $('#b1'), b2 = $('#b2'), b3 = $('#b3'), grain = $('#grain');
    frameFns.push((t) => {
      b1.style.transform = `translate(${(Math.sin(t * 0.23) * 160).toFixed(1)}px,${(Math.cos(t * 0.19) * 120).toFixed(1)}px)`;
      b2.style.transform = `translate(${(Math.cos(t * 0.21) * 180).toFixed(1)}px,${(Math.sin(t * 0.27) * 150).toFixed(1)}px)`;
      b3.style.transform = `translate(${(Math.sin(t * 0.31 + 2) * 150).toFixed(1)}px,${(Math.cos(t * 0.17 + 1) * 130).toFixed(1)}px)`;
      const f = Math.round(t * FPS);
      grain.style.transform = `translate(${(f * 37) % 97}px,${(f * 53) % 89}px)`;
    });
  }

  // ---------------------------------------------------------------- driver
  window.seek = (t) => {
    t = clamp(t, 0.0005, DUR - 0.0005);
    tl.time(t, false);
    for (const fn of frameFns) fn(t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  document.fonts.ready.then(() => window.seek(0)).then(() => { window.REEL.ready = true; });
})();
