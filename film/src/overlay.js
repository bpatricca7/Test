// Title cards drawn as HTML over the 3D canvas (captured together in each frame).
export class Overlay {
  constructor(parent, W, H) {
    const make = (html) => {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = html;
      parent.appendChild(d);
      return d;
    };
    const u = H / 1080;
    this.title = make(`<div class="title" style="font-size:${190 * u}px">Bolt <span class="amp">&amp;</span> Luma</div>
      <div class="sub" style="font-size:${34 * u}px;margin-top:${34 * u}px">a tiny robot &middot; a tiny sprout &middot; a great big friendship</div>`);
    this.end = make(`<div class="title" style="font-size:${170 * u}px">The End</div>`);
    this.credit = make(`<div class="title" style="font-size:${110 * u}px">Bolt <span class="amp">&amp;</span> Luma</div>
      <div class="credit" style="font-size:${34 * u}px;margin-top:${40 * u}px">Every picture, sound and note in this film was made with code.</div>
      <div class="credit" style="font-size:${28 * u}px;margin-top:${16 * u}px;opacity:0.8">Sweet dreams!</div>`);
    this.cards = { title: this.title, end: this.end, credit: this.credit };
  }
  reset() {
    for (const c of Object.values(this.cards)) { c.style.opacity = 0; c.style.transform = ''; }
  }
  show(name, opacity, scale = 1, y = 0) {
    const c = this.cards[name];
    c.style.opacity = opacity;
    c.style.transform = `translateY(${y}px) scale(${scale})`;
  }
}
