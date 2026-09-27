// Sparkle World home page: the header state, the tap-along picture-code demo (a pretend
// version of the game's Play with Friends screens, with the game's own 12 pictures) and the
// sticker wiggle. No libraries, no network requests, nothing stored.
(function () {
  'use strict';
  var doc = document;
  doc.documentElement.classList.remove('no-js');
  doc.documentElement.classList.add('js');

  // ---------------------------------------------------------------- header
  var top = doc.querySelector('.top');
  if (top) {
    var onScroll = function () { top.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------------------------------------------------------------- stickers
  doc.querySelectorAll('.stk button').forEach(function (b) {
    b.addEventListener('click', function () {
      b.classList.remove('is-peeled');
      void b.offsetWidth; // restart the animation
      b.classList.add('is-peeled');
    });
    b.addEventListener('animationend', function () { b.classList.remove('is-peeled'); });
  });

  // ---------------------------------------------------------------- picture-code demo
  var demo = doc.getElementById('demo');
  if (!demo) return;

  // the game's 12 code pictures, in keypad order (src/net/pictures.js)
  var PICS = [
    ['heart', 'Heart', '#FFE3EF'], ['star', 'Star', '#FFF4CC'], ['moon', 'Moon', '#EFE9FF'], ['sun', 'Sun', '#FFEBD1'],
    ['flower', 'Flower', '#FFE8F3'], ['rainbow', 'Rainbow', '#E6F6FF'], ['cat', 'Cat', '#FFEEDB'], ['bunny', 'Bunny', '#FFF0F6'],
    ['fish', 'Fish', '#E3F4FF'], ['cupcake', 'Cupcake', '#F1ECFF'], ['crown', 'Crown', '#FFF6D6'], ['gem', 'Gem', '#DDFBF2'],
  ];
  var NAME = {};
  PICS.forEach(function (p) { NAME[p[0]] = p[1]; });
  var src = function (word) { return 'img/pics/' + word + '.svg'; };

  var hostCode = doc.getElementById('host-code');
  var keys = doc.getElementById('keys');
  var slots = [].slice.call(doc.querySelectorAll('#slots li'));
  var goBtn = doc.getElementById('go');
  var clearBtn = doc.getElementById('clear');
  var msg = doc.getElementById('pad-msg');
  var hint = doc.getElementById('demo-hint');
  var letIn = doc.getElementById('let-in');
  var notNow = doc.getElementById('not-now');
  var host = doc.getElementById('host');
  var guest = doc.getElementById('guest');
  var code = [];
  var typed = [];
  var timer = 0;

  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Bring a device into view when it is not (phones: the iPad is above the keypad). */
  function reveal(el) {
    var r = el.getBoundingClientRect();
    var head = top ? top.getBoundingClientRect().height : 0;
    if (r.top < head + 8 || r.bottom > window.innerHeight - 8) el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  }

  function show(root, view) {
    root.querySelectorAll('[data-view]').forEach(function (el) { el.hidden = el.getAttribute('data-view') !== view; });
  }

  function img(word, size) {
    var i = doc.createElement('img');
    i.src = src(word);
    i.alt = '';
    i.width = size;
    i.height = size;
    i.decoding = 'async';
    return i;
  }

  function newCode() {
    var pool = PICS.map(function (p) { return p[0]; });
    code = [];
    for (var k = 0; k < 4; k++) code.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    hostCode.textContent = '';
    hostCode.setAttribute('aria-label', "Lily's code: " + code.map(function (w) { return NAME[w]; }).join(', '));
    code.forEach(function (w) {
      var li = doc.createElement('li');
      li.appendChild(img(w, 72));
      var s = doc.createElement('span');
      s.textContent = NAME[w];
      li.appendChild(s);
      hostCode.appendChild(li);
    });
  }

  function renderSlots() {
    slots.forEach(function (li, k) {
      li.textContent = '';
      li.className = '';
      if (typed[k]) {
        li.classList.add('is-full');
        li.appendChild(img(typed[k], 56));
        li.setAttribute('aria-label', NAME[typed[k]]);
      } else {
        li.removeAttribute('aria-label');
        if (k === typed.length) li.classList.add('is-next');
      }
    });
    goBtn.disabled = typed.length < 4;
  }

  function buildKeys() {
    PICS.forEach(function (p) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.style.setProperty('--tint', p[2]);
      b.setAttribute('aria-label', p[1]);
      b.appendChild(img(p[0], 48));
      var s = doc.createElement('span');
      s.textContent = p[1];
      s.setAttribute('aria-hidden', 'true');
      b.appendChild(s);
      b.addEventListener('click', function () {
        if (typed.length >= 4) return;
        typed.push(p[0]);
        msg.textContent = '';
        renderSlots();
      });
      keys.appendChild(b);
    });
  }

  function reset() {
    clearTimeout(timer);
    typed = [];
    newCode();
    renderSlots();
    msg.textContent = '';
    show(host, 'code');
    show(guest, 'keypad');
    hint.textContent = "Try it! Tap Lily's 4 pictures on Mia's phone.";
  }

  clearBtn.addEventListener('click', function () {
    typed = [];
    msg.textContent = '';
    renderSlots();
  });

  goBtn.addEventListener('click', function () {
    if (typed.length < 4) return;
    var ok = typed.every(function (w, k) { return w === code[k]; });
    if (!ok) {
      msg.textContent = 'Nobody is playing with those pictures. Check them with your friend!';
      var row = doc.getElementById('slots');
      row.classList.remove('shake');
      void row.offsetWidth;
      row.classList.add('shake');
      return;
    }
    show(guest, 'wait');
    show(host, 'knock');
    hint.textContent = 'Knock knock! Now be Lily: tap Let in!';
    reveal(host);
    letIn.focus({ preventScroll: true });
  });

  letIn.addEventListener('click', function () {
    show(host, 'done');
    hint.textContent = "That's it! Mia is in Lily's world.";
    var wait = guest.querySelector('[data-view="wait"] .pad-sub');
    if (wait) wait.textContent = "Flying to Lily's world…";
    timer = setTimeout(function () {
      show(guest, 'in');
      reveal(guest);
      doc.getElementById('again').focus({ preventScroll: true });
    }, 900);
  });

  notNow.addEventListener('click', function () {
    show(host, 'no');
    show(guest, 'no');
    reveal(guest);
    hint.textContent = 'Only the host can say yes.';
    doc.getElementById('again2').focus({ preventScroll: true });
  });

  function again() {
    var wait = guest.querySelector('[data-view="wait"] .pad-sub');
    if (wait) wait.textContent = 'Waiting for Lily to say yes…';
    reset();
    var first = keys.querySelector('.key');
    if (first) first.focus({ preventScroll: true });
  }
  doc.getElementById('again').addEventListener('click', again);
  doc.getElementById('again2').addEventListener('click', again);

  buildKeys();
  reset();
})();
