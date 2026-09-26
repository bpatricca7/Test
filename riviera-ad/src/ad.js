// "94 Steps Back to the Riviera" - 30 s vertical ad, deterministic renderFrame(t).
// Every frame is a pure function of t: no CSS animation, no rAF, no Date/Math.random.
(() => {
  'use strict'
  const { clamp, lerp, seg, E, tw, kf, mulberry32, shade, srgbToLab, hexToRgb } = window.AdLib
  const Q = new URLSearchParams(location.search)
  const V45 = Q.get('variant') === '4x5'
  const VH = V45 ? 1350 : 1920 // viewport height
  const OFF = V45 ? 200 : 0 // stage y of the viewport top (4:5 crops the band y 200-1550)
  const FR = 1 / 30
  const GUIDES = Q.has('guides')
  const GRAIN = Q.has('grain') ? +Q.get('grain') : 1
  const GRAIN_MODE = Q.get('grainmode') || 'static'
  const TAU = Math.PI * 2

  let C = {
    navy: '#14304F', sky_top: '#A9CBEA', sky_bottom: '#EEF4FA', cream: '#FBF6EC', paper: '#F7F9FC', grid: '#DCE8F5', white: '#FFFFFF',
    real_blue: '#2F6FC4', brick_red: '#C4161C', booklet_blue: '#1F5FA8', stud_highlight: '#3C7BC6', orange: '#F29A2E', marker_red: '#E23B2E',
    lilac: '#CDB8E8', lawn_green: '#1F7A33', tan: '#D9C28A', muted: '#7F8FA6',
  }
  const SKY = () => `linear-gradient(180deg, ${C.sky_top} 0%, ${C.sky_bottom} 100%)`

  const SRC = {
    balcony: '/assets/photos/resort-balcony-view.jpg',
    arrival: '/assets/photos/resort-arrival-retouched.jpg', // copy of resort-arrival.jpg with the unreleased bystanders' heads blurred
    promenade: '/assets/photos/resort-promenade.jpg',
    cover: '/assets/instructions/pages/cover.webp',
    render: '/assets/instructions/cutouts/brick-model-render.webp',
    fv2: '/assets/instructions/cutouts/finished-view-2.webp',
    s88: '/assets/instructions/cutouts/step-88.webp',
    s94: '/assets/instructions/cutouts/step-94.webp',
    st01: '/assets/instructions/cutouts/step-01.webp',
    st10: '/assets/instructions/cutouts/step-10.webp',
    st34: '/assets/instructions/cutouts/step-34.webp',
    st60: '/assets/instructions/cutouts/step-60.webp',
    st80: '/assets/instructions/cutouts/step-80.webp',
    st91: '/assets/instructions/cutouts/step-91.webp',
    p01: '/assets/instructions/pages/page-01.jpg',
    p21: '/assets/instructions/pages/page-21.jpg',
    p71: '/assets/instructions/pages/page-71.jpg',
  }
  const IMG = {}

  // ------------------------------------------------------------------ DOM helpers
  const vp = document.getElementById('vp'), stage = document.getElementById('stage'), fxRoot = document.getElementById('fx')
  vp.style.height = VH + 'px'
  document.body.style.height = VH + 'px'
  stage.style.top = -OFF + 'px'
  fxRoot.style.height = VH + 'px'

  const NOPX = new Set(['opacity', 'zIndex', 'fontWeight', 'flex'])
  function sty(e, css) { for (const k in css) { const v = css[k]; e.style[k] = typeof v === 'number' && !NOPX.has(k) ? v + 'px' : v } return e }
  function div(parent, css, cls) { const e = document.createElement('div'); e.className = 'a' + (cls ? ' ' + cls : ''); if (css) sty(e, css); parent.appendChild(e); return e }
  const domImgs = []
  function imgEl(parent, src, css) { const e = document.createElement('img'); e.className = 'a'; e.decoding = 'sync'; e.src = src; if (css) sty(e, css); parent.appendChild(e); domImgs.push(e); return e }
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }
  function canvasEl(parent, c, css) { c.className = 'a'; if (css) sty(c, css); parent.appendChild(c); return c }
  // static canvas art -> <img> (canvas elements are costly to composite under transforms)
  function canvasImg(parent, c, css, type = 'image/png', q) { return imgEl(parent, c.toDataURL(type, q), css) }
  const SVGNS = 'http://www.w3.org/2000/svg'
  function svgEl(parent, x, y, w, h) {
    const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', 'a'); s.setAttribute('width', w); s.setAttribute('height', h)
    s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.style.left = x + 'px'; s.style.top = y + 'px'; parent.appendChild(s); return s
  }
  function sv(tag, parent, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e }
  function vis(e, on) { const d = on ? '' : 'none'; if (e.style.display !== d) e.style.display = d }
  function T(e, s) { e.style.transform = s }
  function O(e, o) { e.style.opacity = o < 0.001 ? 0 : o > 0.999 ? 1 : o.toFixed(4) }
  function draw(pathEl, len, p) { pathEl.style.strokeDasharray = `${len} ${len + 10}`; pathEl.style.strokeDashoffset = (len * (1 - clamp(p))).toFixed(2) }
  const fr = t => Math.round(t * 30)

  // ------------------------------------------------------------------ fonts / text
  const FAM = { slam: 'Anton', label: 'Bebas Neue', stat: 'Archivo Black', serif: 'Playfair Display', hand: 'Caveat', marker: 'Permanent Marker', body: 'Montserrat' }
  const fcss = (fam, size, weight = 400, style = 'normal') => `${style} ${weight} ${size}px "${fam}"`
  const MCTX = document.createElement('canvas').getContext('2d')
  function metrics(f) { MCTX.font = f; const m = MCTX.measureText('HOgx'), H = MCTX.measureText('H'); return { A: m.fontBoundingBoxAscent, D: m.fontBoundingBoxDescent, cap: H.actualBoundingBoxAscent } }
  const capShift = f => { const m = metrics(f); return m.cap / 2 - (m.A - m.D) / 2 }
  // baseline y inside a line box of height lh
  const baseIn = (f, lh) => { const m = metrics(f); return lh / 2 + (m.A - m.D) / 2 }
  const textW = (f, s) => { MCTX.font = f; return MCTX.measureText(s).width }

  // text block with per-word spans. o: {x, y, w, align, font:[fam,size,weight,style], lh, color, lines, ls, pen, shift}
  function textBlock(parent, o) {
    const [fam, size, weight = 400, style = 'normal'] = o.font
    const box = div(parent, { left: o.x, top: o.y + (o.shift || 0), width: o.w != null ? o.w : 'auto', color: o.color || C.navy, textAlign: o.align || 'left' }, 'txt')
    box.style.font = `${style} ${weight} ${size}px/${o.lh}px "${fam}"`
    if (o.ls) box.style.letterSpacing = o.ls
    const ws = []
    for (const ln of o.lines) {
      const l = document.createElement('div'); l.className = 'ln'; box.appendChild(l)
      ln.split(' ').forEach((wd, j) => {
        if (j) l.appendChild(document.createTextNode(' '))
        const s = document.createElement('span'); s.className = 'w' + (o.pen ? ' pen' : ''); s.textContent = wd; l.appendChild(s); ws.push(s)
      })
    }
    return { box, ws }
  }
  // pill / chip: o: {x, y, h, font, padX, bg, radius, color, text | lines(words), shadow}
  function chip(parent, o) {
    const [fam, size, weight = 400, style = 'normal'] = o.font
    const f = fcss(fam, size, weight, style)
    const e = div(parent, { left: o.x, top: o.y, height: o.h, padding: `0 ${o.padX}px`, background: o.bg, borderRadius: o.radius, color: o.color || '#fff' }, 'txt')
    e.style.font = `${style} ${weight} ${size}px/${o.h}px "${fam}"`
    if (o.ls) e.style.letterSpacing = o.ls
    if (o.shadow) e.style.boxShadow = o.shadow
    const inner = document.createElement('span'); inner.style.position = 'relative'; inner.style.display = 'inline-block'
    inner.style.top = (o.dy != null ? o.dy : capShift(f)).toFixed(1) + 'px'; e.appendChild(inner)
    const ws = []
    ;(o.text || '').split(' ').forEach((wd, j) => {
      if (j) inner.appendChild(document.createTextNode(' '))
      const s = document.createElement('span'); s.className = 'w'; s.textContent = wd; inner.appendChild(s); ws.push(s)
    })
    return { e, inner, ws }
  }

  // ------------------------------------------------------------------ VO timeline
  const VO = {}
  const MEASURED = { vo1: 0.92, vo2: 0.77, vo3: 1.86, vo4: 1.46, vo5: 0.55, vo6: 1.69, vo7: 1.32, vo8: 1.29, vo9: 1.0, vo10: 1.29, vo11: 1.04, vo12: 1.92, vo13: 2.19 }
  function setupVO(sb, tl) {
    for (const v of sb.vo || []) {
      const line = tl && tl.lines ? tl.lines.find(l => l.id === v.id) : null
      if (line && line.words && line.words.length) { VO[v.id] = { start: line.start, end: line.end, words: line.words }; continue }
      const start = line ? line.start : v.start
      const dur = line && line.end ? line.end - line.start : MEASURED[v.id] || v.max_dur * 0.8
      const toks = v.text.split(/\s+/).filter(Boolean)
      const wts = toks.map(w => w.length + 2), tot = wts.reduce((a, b) => a + b, 0)
      let acc = start
      const words = toks.map((w, i) => { const d = (dur * wts[i]) / tot; const o = { text: w, start: acc, end: acc + d }; acc += d; return o })
      VO[v.id] = { start, end: start + dur, words }
    }
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
  // sequentially match keys against a VO line's words -> [{start,end}]
  function vwords(id, keys, fallbackStart = 0) {
    const L = VO[id]
    if (!L) return keys.map((k, i) => ({ start: fallbackStart + i * 0.25, end: fallbackStart + i * 0.25 + 0.25 }))
    let from = 0
    return keys.map((k, i) => {
      let idx = -1
      for (let j = from; j < L.words.length; j++) if (norm(L.words[j].text).startsWith(norm(k))) { idx = j; break }
      if (idx < 0) idx = Math.min(L.words.length - 1, Math.round((i * L.words.length) / keys.length))
      from = idx + 1
      return L.words[idx]
    })
  }

  // ------------------------------------------------------------------ canvas art: bricks, studs, shadows
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
  function drawStudTop(ctx, cx, cy, r, color) {
    ctx.save(); ctx.filter = `blur(${Math.max(0.5, r * 0.14)}px)`; ctx.fillStyle = 'rgba(0,0,0,0.32)'
    ctx.beginPath(); ctx.arc(cx + r * 0.2, cy + r * 0.28, r * 1.02, 0, TAU); ctx.fill(); ctx.restore()
    ctx.fillStyle = shade(color, -0.1); ctx.beginPath(); ctx.arc(cx + r * 0.05, cy + r * 0.09, r, 0, TAU); ctx.fill()
    const g = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.05, cx, cy, r * 1.05)
    g.addColorStop(0, shade(color, 0.2)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.04))
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 0.93, 0, TAU); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = r * 0.15; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.66, Math.PI * 1.06, Math.PI * 1.44); ctx.stroke()
  }
  // top-down brick (handle, tally)
  function brickTop(nx, ny, pitch, color, S = 2, pitchY = pitch) {
    const W = nx * pitch, H = ny * pitchY, c = cnv(W * S, H * S), ctx = c.getContext('2d'); ctx.scale(S, S)
    const r = Math.min(pitch, pitchY) * 0.14
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H); g.addColorStop(0, shade(color, 0.05)); g.addColorStop(1, shade(color, -0.06))
    ctx.fillStyle = g; rr(ctx, 0, 0, W, H, r); ctx.fill()
    ctx.save(); rr(ctx, 0, 0, W, H, r); ctx.clip()
    ctx.lineWidth = pitch * 0.08
    ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, 0); ctx.lineTo(W, 0); ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.stroke()
    ctx.restore()
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) drawStudTop(ctx, (i + 0.5) * pitch, (j + 0.5) * pitchY, Math.min(pitch, pitchY) * 0.3, color)
    return c
  }
  function studSprite(r, color, S = 2) {
    const N = Math.ceil(r * 3), c = cnv(N * S, N * S), ctx = c.getContext('2d'); ctx.scale(S, S)
    drawStudTop(ctx, N / 2, N / 2, r, color)
    return c
  }
  // 3/4-view brick for confetti (top face + front face + stud cylinders)
  function brickIso(nx, ny, pitch, color, S = 2) {
    const W = nx * pitch, D = ny * pitch * 0.6, Hs = pitch * 0.46, sh = pitch * 0.15, pad = 2
    const c = cnv((W + pad * 2) * S, (sh + D + Hs + pad * 2) * S), ctx = c.getContext('2d'); ctx.scale(S, S); ctx.translate(pad, pad)
    const y0 = sh
    ctx.fillStyle = shade(color, -0.13); rr(ctx, 0, y0 + D - 2, W, Hs + 2, pitch * 0.08); ctx.fill()
    const gf = ctx.createLinearGradient(0, y0 + D, 0, y0 + D + Hs); gf.addColorStop(0, 'rgba(255,255,255,0.08)'); gf.addColorStop(1, 'rgba(0,0,0,0.18)')
    ctx.fillStyle = gf; rr(ctx, 0, y0 + D - 2, W, Hs + 2, pitch * 0.08); ctx.fill()
    const gt = ctx.createLinearGradient(0, y0, W, y0 + D); gt.addColorStop(0, shade(color, 0.08)); gt.addColorStop(1, shade(color, 0.0))
    ctx.fillStyle = gt; rr(ctx, 0, y0, W, D, pitch * 0.07); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(pitch * 0.06, y0 + D - 1.2, W - pitch * 0.12, 1.2)
    const rx = pitch * 0.3, ry = rx * 0.6
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = (i + 0.5) * pitch, cy = y0 + (j + 0.5) * (D / ny)
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(cx + rx * 0.15, cy + ry * 0.35, rx * 1.05, ry * 1.05, 0, 0, TAU); ctx.fill()
      ctx.fillStyle = shade(color, -0.1); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); ctx.lineTo(cx - rx, cy - sh); ctx.ellipse(cx, cy - sh, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill()
      const g = ctx.createRadialGradient(cx - rx * 0.4, cy - sh - ry * 0.4, 1, cx, cy - sh, rx)
      g.addColorStop(0, shade(color, 0.2)); g.addColorStop(1, shade(color, 0.03))
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy - sh, rx, ry, 0, 0, TAU); ctx.fill()
    }
    return c
  }
  function brickUnder(nx, ny, pitch, color, S = 2) {
    const W = nx * pitch, D = ny * pitch * 0.6, Hs = pitch * 0.46, sh = pitch * 0.15, pad = 2
    const c = cnv((W + pad * 2) * S, (sh + D + Hs + pad * 2) * S), ctx = c.getContext('2d'); ctx.scale(S, S); ctx.translate(pad, pad)
    ctx.fillStyle = shade(color, -0.16); rr(ctx, 0, sh, W, D + Hs, pitch * 0.08); ctx.fill()
    ctx.fillStyle = shade(color, -0.26); rr(ctx, pitch * 0.1, sh + pitch * 0.08, W - pitch * 0.2, D + Hs - pitch * 0.16, pitch * 0.05); ctx.fill()
    ctx.strokeStyle = shade(color, -0.06); ctx.lineWidth = pitch * 0.06
    for (let i = 0; i < Math.max(1, nx - 1); i++) { const cx = nx === 1 ? W / 2 : (i + 1) * pitch; ctx.beginPath(); ctx.ellipse(cx, sh + (D + Hs) / 2, pitch * 0.26, pitch * 0.2, 0, 0, TAU); ctx.stroke() }
    return c
  }
  // stud tile used by the brickify mosaic (light/shade only; the plate colour comes from underneath)
  function studTile(N = 96) {
    const c = cnv(N, N), ctx = c.getContext('2d')
    ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fillRect(0, 0, N, N * 0.045); ctx.fillRect(0, 0, N * 0.045, N)
    ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fillRect(0, N * 0.955, N, N * 0.045); ctx.fillRect(N * 0.955, 0, N * 0.045, N)
    const cx = N / 2, cy = N / 2, r = 0.36 * N
    ctx.save(); ctx.filter = `blur(${N * 0.03}px)`; ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.beginPath(); ctx.arc(cx + r * 0.14, cy + r * 0.2, r, 0, TAU); ctx.fill(); ctx.restore()
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
    g.addColorStop(0, 'rgba(255,255,255,0.36)'); g.addColorStop(0.42, 'rgba(255,255,255,0.07)'); g.addColorStop(0.58, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.26)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = N * 0.018; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = N * 0.05; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke()
    return c
  }
  // soft silhouette shadow from an image's alpha (drawn at 1/ds resolution; it is blurred anyway)
  function silShadow(im, blur, ds = 4, pad = 60, color = '#0e2640') {
    const w = Math.ceil(im.naturalWidth / ds), h = Math.ceil(im.naturalHeight / ds), pp = Math.ceil(pad / ds)
    const t = cnv(w, h), tx = t.getContext('2d'); tx.drawImage(im, 0, 0, w, h); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = color; tx.fillRect(0, 0, w, h)
    const c = cnv(w + 2 * pp, h + 2 * pp), x = c.getContext('2d'); x.filter = `blur(${blur / ds}px)`; x.drawImage(t, pp, pp)
    return { c, css: { left: -pp * ds, top: -pp * ds, width: (w + 2 * pp) * ds, height: (h + 2 * pp) * ds } }
  }
  // contact shadow: squashed silhouette of the bottom band of the model
  function contactShadow(parent, w, h, cx, cy, strength = 0.42) {
    const e = div(parent, { left: cx - w / 2, top: cy - h / 2, width: w, height: h, borderRadius: '50%', background: `radial-gradient(closest-side, rgba(14,38,64,${strength}) 0%, rgba(14,38,64,${strength * 0.55}) 45%, rgba(14,38,64,0) 100%)` })
    return e
  }
  // cloud plate: balcony photo SKY ONLY (source y 0-430) cover-scaled over y 0-PH, blurred, faded at the bottom
  function cloudPlate(im, PH, blur) {
    const M = 60, W = 1080
    const sc = Math.max(W / 1206, PH / 430), dw = 1206 * sc, dh = 430 * sc, ox = (W - dw) / 2
    const a = cnv(W + 2 * M, PH + 2 * M), ax = a.getContext('2d')
    ax.drawImage(im, 0, 0, 1206, 430, M + ox, M, dw, dh)
    ax.drawImage(im, 0, 0, 1206, 2, M + ox, 0, dw, M + 1) // clamp-to-edge above the top row
    const b = cnv(W + 2 * M, PH + 2 * M), bx = b.getContext('2d'); bx.drawImage(a, 0, 0); bx.filter = `blur(${blur}px)`; bx.drawImage(a, 0, 0)
    const c = cnv(W, PH), cx = c.getContext('2d'); cx.drawImage(b, M, M, W, PH, 0, 0, W, PH)
    cx.globalCompositeOperation = 'destination-in'
    const g = cx.createLinearGradient(0, 0, 0, PH); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    cx.fillStyle = g; cx.fillRect(0, 0, W, PH)
    return c
  }
  // orange "new part" glow mask for build steps
  function orangeGlow(im, ds = 2) {
    const w = Math.ceil(im.naturalWidth / ds), h = Math.ceil(im.naturalHeight / ds)
    const t = cnv(w, h), tx = t.getContext('2d'); tx.drawImage(im, 0, 0, w, h)
    const d = tx.getImageData(0, 0, w, h), p = d.data
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3]
      const orange = a > 100 && r > 150 && r - b > 85 && g > 90 && g < 205 && r - g > 35
      const cream = a > 100 && r > 238 && g > 220 && b > 180 && b < 222 && r - b > 26
      if (orange) { p[i] = 242; p[i + 1] = 154; p[i + 2] = 46; p[i + 3] = 255 } else if (cream) { p[i] = 242; p[i + 1] = 170; p[i + 2] = 70; p[i + 3] = 70 } else p[i + 3] = 0
    }
    tx.putImageData(d, 0, 0)
    const c = cnv(w, h), cx = c.getContext('2d'); cx.filter = 'blur(5px)'; cx.drawImage(t, 0, 0); cx.filter = 'none'; cx.globalAlpha = 0.9; cx.drawImage(t, 0, 0)
    return c
  }
  function dotTile(pitch, r, color) {
    const S2 = 2, c = cnv(pitch * S2, pitch * S2), x = c.getContext('2d')
    x.fillStyle = color; x.beginPath(); x.arc((pitch * S2) / 2, (pitch * S2) / 2, r * S2, 0, TAU); x.fill()
    return c.toDataURL('image/png')
  }
  function gridBg(parent, css, pitch, r, color, opacity = 1) {
    return div(parent, Object.assign({ backgroundImage: `url(${dotTile(pitch, r, color)})`, backgroundSize: `${pitch}px ${pitch}px`, opacity }, css))
  }
  // pre-blurred drop shadow for a w x h box (matches CSS box-shadow blur radii); returns {src, m}
  function shadowPng(w, h, layers, radius = 0) {
    const m = 120, c = cnv(w + 2 * m, h + 2 * m), x = c.getContext('2d')
    for (const [dy, blur, a] of layers) {
      x.save(); x.shadowColor = `rgba(20,48,79,${a})`; x.shadowBlur = blur; x.shadowOffsetX = 10000; x.shadowOffsetY = dy
      x.fillStyle = '#000'; rr(x, m - 10000, m, w, h, Math.max(0.01, radius)); x.fill(); x.restore()
    }
    return { src: c.toDataURL('image/png'), m }
  }
  function noiseTile(seed, N = 256) {
    const rnd = mulberry32(seed), c = cnv(N, N), ctx = c.getContext('2d'), d = ctx.createImageData(N, N), p = d.data
    for (let i = 0; i < p.length; i += 4) { const v = rnd(); const on = v > 0.5; const a = Math.abs(v - 0.5) * 2; p[i] = p[i + 1] = p[i + 2] = on ? 255 : 0; p[i + 3] = Math.round(a * a * 255) }
    ctx.putImageData(d, 0, 0); return c.toDataURL('image/png')
  }

  // ------------------------------------------------------------------ reusable bits: sparkle, washi tape, print
  function sparkle(parent, size) {
    const e = div(parent, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 })
    const s = svgEl(e, 0, 0, size, size)
    const h = size / 2
    const defs = sv('defs', s, {})
    const rg = sv('radialGradient', defs, { id: 'sg' + size, cx: '50%', cy: '50%', r: '50%' })
    sv('stop', rg, { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '0.9' }); sv('stop', rg, { offset: '100%', 'stop-color': '#fff', 'stop-opacity': '0' })
    sv('circle', s, { cx: h, cy: h, r: h * 0.42, fill: `url(#sg${size})` })
    const k = h * 0.07
    sv('path', s, { d: `M${h} 0 Q${h + k} ${h - k} ${size} ${h} Q${h + k} ${h + k} ${h} ${size} Q${h - k} ${h + k} 0 ${h} Q${h - k} ${h - k} ${h} 0Z`, fill: '#fff', style: 'filter: drop-shadow(0 0 3px rgba(255,236,190,0.95))' })
    sv('path', s, { d: `M${h} ${h * 0.5} L${h + k * 0.7} ${h} L${h} ${h * 1.5} L${h - k * 0.7} ${h}Z M${h * 0.5} ${h} L${h} ${h + k * 0.7} L${h * 1.5} ${h} L${h} ${h - k * 0.7}Z`, fill: '#FFF3CF', transform: `rotate(45 ${h} ${h})` })
    return e
  }
  function renderSparkle(e, t, t0, x, y, dur = 0.42, maxS = 1) {
    const on = t >= t0 && t < t0 + dur
    vis(e, on); if (!on) return
    const u = (t - t0) / dur
    const s = maxS * (u < 0.35 ? E.outBack(u / 0.35) : 1 - E.inCubic((u - 0.35) / 0.65))
    T(e, `translate(${x}px, ${y}px) rotate(${(u * 40).toFixed(1)}deg) scale(${Math.max(0, s).toFixed(3)})`)
  }
  function washi(parent, w, h, color, opacity) {
    const e = div(parent, { width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2, opacity })
    const zz = []
    const n = 6
    for (let i = 0; i <= n; i++) zz.push(`${i % 2 ? 3 : 0}% ${(i / n) * 100}%`)
    const zr = []
    for (let i = n; i >= 0; i--) zr.push(`${i % 2 ? 97 : 100}% ${(i / n) * 100}%`)
    e.style.clipPath = `polygon(${zz.join(',')},${zr.join(',')})`
    e.style.background = `repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 6px, rgba(255,255,255,0) 6px 14px), linear-gradient(180deg, ${shade(color, 0.04)}, ${shade(color, -0.03)})`
    e.style.boxShadow = '0 1px 2px rgba(0,0,0,0.12)'
    return e
  }
  // an instant print: o {src, sx, sy, sw, sh, iw, ih, bt, bs, bb, natW, natH}
  function makePrint(parent, o) {
    const w = o.iw + 2 * o.bs, h = o.bt + o.ih + o.bb
    const p = div(parent, { width: w, height: h })
    const sp = shadowPng(w, h, [[18, 40, 0.28], [2, 5, 0.14]])
    const shadow = imgEl(p, sp.src, { left: -sp.m, top: -sp.m, width: w + 2 * sp.m, height: h + 2 * sp.m, transformOrigin: '50% 50%' })
    const paper = div(p, { width: w, height: h }, 'print')
    paper.style.boxShadow = 'none'
    const win = div(p, { left: o.bs, top: o.bt, width: o.iw, height: o.ih, background: '#ddd' }, 'clip')
    const k = o.iw / o.sw
    const im = imgEl(win, o.src, { left: -o.sx * k, top: -o.sy * k, width: o.natW * k, height: o.natH * k })
    div(win, { width: o.iw, height: o.ih, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' })
    const gloss = div(win, null, 'gloss')
    return { p, win, im, gloss, w, h, k, shadow }
  }
  // Ken-Burns placement: image (natural px, transform-origin 0 0) at base scale k with source (sx0,sy0) at local (0,0),
  // pushed by p about local anchor (ax, ay)
  function kb(e, k, sx0, sy0, ax, ay, p) {
    T(e, `translate(${(ax + p * (-sx0 * k - ax)).toFixed(2)}px, ${(ay + p * (-sy0 * k - ay)).toFixed(2)}px) scale(${(k * p).toFixed(5)})`)
  }
  function natImg(parent, key, css) { const im = IMG[key]; return imgEl(parent, SRC[key], Object.assign({ width: im.naturalWidth, height: im.naturalHeight, transformOrigin: '0 0' }, css || {})) }

  // =================================================================== SCENES
  const S = {} // element registry

  // ---------------------------------------------------------- confetti engine (s4 + s9)
  const CONF_COLORS = () => [C.brick_red, C.booklet_blue, '#FFFFFF', C.lawn_green, C.tan]
  let SPR = null
  function makeSprites() {
    SPR = {}
    const types = [[1, 1], [1, 2], [2, 2]]
    for (const col of CONF_COLORS()) for (const [a, b] of types) {
      const nx = Math.max(a, b), ny = Math.min(a, b)
      SPR[col + nx + 'x' + ny] = { top: brickIso(nx, ny, 26, col), under: brickUnder(nx, ny, 26, col) }
    }
  }
  function makeConfetti(seed, n, t0, tEnd, spawn, power) {
    const rnd = mulberry32(seed), cols = CONF_COLORS(), types = [[1, 1], [2, 1], [2, 2]]
    const out = []
    let guard = 0
    while (out.length < n && guard++ < 5000) {
      const ty = types[Math.floor(rnd() * 3)], col = cols[Math.floor(rnd() * cols.length)]
      const x0 = spawn.x0 + rnd() * (spawn.x1 - spawn.x0), y0 = spawn.y0 + rnd() * (spawn.y1 - spawn.y0)
      const ang = -Math.PI / 2 + (rnd() - 0.5) * 2.4
      const sp = power * (0.55 + rnd() * 0.65)
      const vx = Math.cos(ang) * sp * 1.1, vy = Math.sin(ang) * sp
      const g = 3400 + rnd() * 900
      const delay = rnd() * 0.08
      const p = { ty, col, x0, y0, vx, vy, g, delay, r0: rnd() * TAU, wr: (rnd() - 0.5) * 14, f0: rnd() * TAU, wf: (4 + rnd() * 9) * (rnd() < 0.5 ? -1 : 1), s0: 0.75 + rnd() * 0.5, zs: 0.5 + rnd() * 0.6 }
      // must be off-frame by tEnd
      const tau = tEnd - t0 - delay, pos = confPos(p, tau)
      if (pos.y > 1920 + 90 || pos.x < -120 || pos.x > 1200) out.push(p)
    }
    return out
  }
  function confPos(p, tau) {
    const drag = 1.1
    const x = p.x0 + (p.vx * (1 - Math.exp(-drag * tau))) / drag
    const y = p.y0 + p.vy * tau + 0.5 * p.g * tau * tau
    return { x, y }
  }
  function drawConfetti(back, front, list, t, t0, frontAfter = 0.1) {
    const bx = back.getContext('2d'), fx = front.getContext('2d')
    bx.clearRect(0, 0, back.width, back.height); fx.clearRect(0, 0, front.width, front.height)
    for (const p of list) {
      const tau = t - t0 - p.delay
      if (tau < 0) continue
      const { x, y } = confPos(p, tau)
      const yy = V45 ? OFF + y * 0.7 : y
      const ctx = tau < frontAfter ? bx : fx
      const nx = p.ty[0], ny = p.ty[1]
      const key = p.col + Math.max(nx, ny) + 'x' + Math.min(nx, ny)
      const fl = Math.cos(p.f0 + p.wf * tau)
      const spr = fl >= 0 ? SPR[key].top : SPR[key].under
      const sc = (1.45 * p.s0 * (0.55 + p.zs * Math.min(1, tau * 1.6))) / 2
      ctx.save()
      ctx.translate(x, yy)
      ctx.rotate(p.r0 + p.wr * tau)
      ctx.scale(sc, sc * Math.max(0.12, Math.abs(fl)))
      ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
      ctx.restore()
    }
  }

  // ---------------------------------------------------------- S1 / S10 split screen
  // step-88 with the booklet's orange "new part" outlines on the canopy roof turned into dark-grey seams
  // (source box x 430-905, y 395-615), so the hero reads as a finished model rather than a wireframe
  function cleanS88() {
    const im = IMG.s88, c = cnv(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(im, 0, 0)
    const d = x.getImageData(430, 395, 476, 221), p = d.data
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2]
      if (p[i + 3] > 100 && r - b > 25 && r >= g && g >= b) p[i] = p[i + 1] = p[i + 2] = Math.round(0.6 * (0.299 * r + 0.587 * g + 0.114 * b))
    }
    x.putImageData(d, 430, 395)
    return c
  }
  function buildSplit() {
    const L = (S.split = div(stage, null, 'layer'))
    const divY = V45 ? 875 : 960
    const topH = divY - OFF, botH = OFF + VH - divY
    const dy = V45 ? -85 : 0
    Object.assign(S, { divY, topH, botH })
    S.topBox = div(L, { left: 0, top: OFF, width: 1080, height: topH }, 'clip')
    S.topImg = natImg(S.topBox, 'balcony')
    S.topVig = div(S.topBox, { width: 1080, height: topH, background: 'radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 55%, rgba(10,28,50,0.30) 100%)' })
    S.topShade = div(S.topBox, { top: topH - 260, width: 1080, height: 260, background: 'linear-gradient(180deg, rgba(10,28,50,0) 0%, rgba(10,28,50,0.30) 100%)' })
    S.botBox = div(L, { left: 0, top: divY, width: 1080, height: botH }, 'clip')
    div(S.botBox, { width: 1080, height: botH, background: SKY() })
    div(S.botBox, { width: 1080, height: botH, background: 'radial-gradient(90% 60% at 50% 45%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 70%)' })
    S.botImg = canvasImg(S.botBox, cleanS88(), { width: IMG.s88.naturalWidth, height: IMG.s88.naturalHeight, transformOrigin: '0 0' })
    S.botVig = div(S.botBox, { width: 1080, height: botH, background: 'radial-gradient(130% 100% at 50% 40%, rgba(0,0,0,0) 60%, rgba(10,28,50,0.16) 100%)' })
    S.botTopShade = div(S.botBox, { width: 1080, height: 40, background: 'linear-gradient(180deg, rgba(10,28,50,0.22), rgba(10,28,50,0))' })
    S.divider = div(L, { left: 0, top: 0, width: 1080, height: 8, background: '#fff', boxShadow: '0 0 22px rgba(10,28,50,0.35), 0 2px 4px rgba(10,28,50,0.28)' })
    S.handle = canvasImg(L, brickTop(2, 2, 38, C.brick_red), { width: 76, height: 76, borderRadius: 7, boxShadow: '0 8px 18px rgba(10,28,50,0.45), 0 2px 3px rgba(10,28,50,0.35)', transformOrigin: '50% 50%' })
    const lab = [FAM.label, 52]
    const slam = [FAM.slam, 104]
    S.cReal = chip(L, { x: 80, y: 745 + dy, h: 60, font: lab, padX: 18, bg: C.real_blue, radius: 10, text: 'REAL', ls: '0.04em', shadow: '0 6px 16px rgba(10,28,50,0.30)' })
    S.cStayed = chip(L, { x: 80, y: 820 + dy, h: 118, font: slam, padX: 22, bg: 'rgba(20,48,79,0.88)', radius: 16, text: 'ONE WE STAYED IN.', ls: '0.005em', shadow: '0 10px 28px rgba(10,28,50,0.30)' })
    S.cBuilt = chip(L, { x: 80, y: 982 + dy, h: 118, font: slam, padX: 22, bg: 'rgba(20,48,79,0.88)', radius: 16, text: 'ONE WE BUILT.', ls: '0.005em', shadow: '0 10px 28px rgba(10,28,50,0.30)' })
    S.cBrick = chip(L, { x: 80, y: 1115 + dy, h: 60, font: lab, padX: 18, bg: C.brick_red, radius: 10, text: 'BRICK', ls: '0.04em', shadow: '0 6px 16px rgba(10,28,50,0.30)' })
    for (const c of [S.cReal, S.cStayed, S.cBuilt, S.cBrick]) c.e.style.transformOrigin = '0% 50%'
    S.cBuilt.e.style.transformOrigin = '30% 50%'
    // focal anchors (half-local)
    S.topA = { k: 1.35, sx0: 100, sy0: 540, ax: (505 - 100) * 1.35, ay: (780 - 540) * 1.35 }
    const bsy = V45 ? 315 : 260
    S.botA = { k: 1.35, sx0: 250, sy0: bsy, ax: (635 - 250) * 1.35, ay: (590 - bsy) * 1.35 }
  }
  function renderSplit(t) {
    const on = t < 2.75 || t >= 29.5
    vis(S.split, on)
    if (!on) return
    const divY = S.divY
    let push = 1, punch = 1, topY = 0, botY = 0, divC = divY, hs = 1
    let topClip = S.topH, botTop = divY
    const st = { real: [1, 1], stayed: [1, 1], built: [0, 1.3, 0, 0], brick: [1, 1] }
    if (t < 2.75) {
      push = 1 + 0.05 * E.inOutSine(seg(t, 0, 2.5))
      if (t >= 1.5) {
        punch = lerp(1.03, 1, E.outQuad(seg(t, 1.5, 1.5 + 4 * FR)))
        hs = kf(t, [[1.5, 1], [1.575, 1.18, E.outQuad], [1.65, 1, E.inOutSine]])
        const sh = 1 - E.outQuad(seg(t, 1.5, 1.78)), f = fr(t)
        st.built = [1, lerp(1.3, 1, E.outCubic(seg(t, 1.5, 1.5 + 4 * FR))), 6 * sh * Math.sin(f * 2.1 + 0.5), 4 * sh * Math.cos(f * 2.9)]
      }
      const u = E.inCubic(seg(t, 2.5, 2.75))
      topY = -(S.topH + 50) * u
      botY = (S.botH + 50) * u
    } else {
      const u = E.outBack(seg(t, 29.5, 29.9))
      divC = lerp(OFF - 8, divY, u)
      topClip = Math.max(0, divC - OFF)
      botTop = lerp(OFF + VH, divY, E.outCubic(seg(t, 29.5, 29.9)))
      hs = kf(t, [[29.9, 1], [29.93, 1.12, E.outQuad], [29.962, 1, E.inOutSine]])
      const cp = t < 29.83 ? 0 : lerp(0.6, 1, E.outBack(seg(t, 29.83, 29.83 + 3 * FR)))
      st.real = [t >= 29.83 ? 1 : 0, cp]; st.brick = [t >= 29.83 ? 1 : 0, cp]
      st.stayed = [t >= 29.9 ? 1 : 0, lerp(0.9, 1, seg(t, 29.9, 29.9 + 2 * FR))]
    }
    // top half
    S.topBox.style.height = topClip.toFixed(2) + 'px'
    T(S.topBox, `translateY(${topY.toFixed(2)}px)`)
    const a = S.topA
    kb(S.topImg, a.k, a.sx0, a.sy0, a.ax, a.ay, push)
    // bottom half
    S.botBox.style.top = botTop.toFixed(2) + 'px'
    T(S.botBox, `translateY(${botY.toFixed(2)}px)`)
    const b = S.botA
    kb(S.botImg, b.k, b.sx0, b.sy0, b.ax, b.ay, push * punch)
    // divider + handle ride with the top half
    const dvy = divC - 4 + topY
    T(S.divider, `translateY(${dvy.toFixed(2)}px)`)
    T(S.handle, `translate(${905 - 38}px, ${(divC - 38 + topY).toFixed(2)}px) scale(${hs.toFixed(4)})`)
    const botOff = botY + (botTop - divY)
    O(S.cReal.e, st.real[0]); T(S.cReal.e, `translateY(${topY}px) scale(${st.real[1]})`)
    O(S.cStayed.e, st.stayed[0]); T(S.cStayed.e, `translateY(${topY}px) scale(${st.stayed[1]})`)
    O(S.cBuilt.e, st.built[0]); T(S.cBuilt.e, `translate(${st.built[2].toFixed(2)}px, ${(botOff + st.built[3]).toFixed(2)}px) scale(${st.built[1].toFixed(4)})`)
    O(S.cBrick.e, st.brick[0]); T(S.cBrick.e, `translateY(${botOff.toFixed(2)}px) scale(${st.brick[1]})`)
  }

  // ---------------------------------------------------------- S2 + S3 cream table, prints, brickify
  const PC = { W: 780, H: 631, K: 1.6, cx: 505 * (780 / 1075), cy: (780 - 560) * (780 / 1075) } // print C image area + canopy (local px)
  function camC(t) {
    // print C camera: canopy anchored; returns {s, x, y, rot}
    const lx = 24 + PC.cx, ly = 24 + PC.cy
    const w = 828, h = 735, r0 = (-1.5 * Math.PI) / 180
    const vx = lx - w / 2, vy = ly - h / 2
    const x0 = 540 + vx * Math.cos(r0) - vy * Math.sin(r0), y0 = 1000 + vx * Math.sin(r0) + vy * Math.cos(r0)
    const u = E.inOutSine(seg(t, 5.75, 7.5))
    let s = 1 + 0.6 * u
    s *= 1 + 0.02 * E.inOutSine(seg(t, 7.5, 7.9))
    const land = lerp(1.15, 1, E.outCubic(seg(t, 5.0, 5.25)))
    return { s, land, x: lerp(x0, 540, u), y: lerp(y0, 900, u), rot: -1.5 * (1 - u), lx, ly }
  }
  function buildTable() {
    const L = (S.tbl = div(stage, null, 'layer'))
    const bg = div(L, { left: 0, top: OFF, width: 1080, height: VH, background: C.cream, willChange: 'transform' })
    div(bg, { width: 1080, height: VH, background: 'radial-gradient(90% 70% at 30% 22%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 60%), radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(120,90,50,0.13) 100%)' })
    div(bg, { width: 1080, height: VH, opacity: 0.08, backgroundImage: `url(${S.grainTiles[0]})` })
    S.tblCam = div(L, { width: 1080, height: 1920, transformOrigin: '540px 950px' })
    // print A: arrival (drop the white strip at the top: source y >= 32)
    S.pA = makePrint(S.tblCam, { src: SRC.arrival, sx: 0, sy: 32, sw: 1171, sh: 1589, iw: 560, ih: 760, bt: 20, bs: 20, bb: 60, natW: 1171, natH: 1621 })
    S.pB = makePrint(S.tblCam, { src: SRC.promenade, sx: 0, sy: 0, sw: 1206, sh: 1288, iw: 470, ih: 502, bt: 18, bs: 18, bb: 56, natW: 1206, natH: 1288 })
    S.tapeB = washi(S.pB.p, 130, 34, C.lilac, 0.7)
    T(S.tapeB, `translate(${S.pB.w / 2 - 14}px, 2px) rotate(-8deg)`)
    // print C: balcony below the horizon (source y >= 560, x <= 1075)
    S.pC = makePrint(L, { src: SRC.balcony, sx: 0, sy: 560, sw: 1075, sh: 870, iw: 780, ih: 631, bt: 24, bs: 24, bb: 80, natW: 1206, natH: 1536 })
    S.pC.p.style.transformOrigin = `${24 + PC.cx}px ${24 + PC.cy}px`
    S.bk = canvasEl(S.pC.win, cnv(PC.W * PC.K, PC.H * PC.K), { width: PC.W, height: PC.H })
    S.pC.win.appendChild(S.pC.gloss)
    // text s2 (Caveat) and s3 (Playfair)
    S.t2 = textBlock(L, { x: 100, y: 300, font: [FAM.hand, 72], lh: 80, color: C.navy, lines: ['nobody wanted to leave', 'the Riviera.'], pen: true })
    S.t3 = textBlock(L, { x: 80, y: 300, font: [FAM.serif, 80, 700, 'italic'], lh: 90, color: C.navy, lines: ['So we took a little piece', 'of it home.'] })
    S.t2w = vwords('vo3', ['nobody', 'wanted', 'to', 'leave', 'the', 'riviera'], 2.72)
    S.t3w = vwords('vo4', ['so', 'we', 'took', 'a', 'little', 'piece', 'of', 'it', 'home'], 5.0)
  }
  function penReveal(span, t, w, lead = 0.03, minD = 0.14, maxD = 0.4) {
    const d = clamp(w.end - w.start, minD, maxD)
    const p = seg(t, w.start - lead, w.start - lead + d)
    if (p <= 0) { span.style.opacity = 0; return }
    span.style.opacity = 1
    if (p >= 1) { span.style.webkitMaskImage = 'none'; span.style.maskImage = 'none'; return }
    const a = lerp(-14, 100, E.inOutSine(p))
    const m = `linear-gradient(90deg, #000 ${a.toFixed(1)}%, rgba(0,0,0,0) ${(a + 14).toFixed(1)}%)`
    span.style.webkitMaskImage = m; span.style.maskImage = m
  }
  function riseIn(span, t, t0, dy = 12, dur = 0.28) {
    const p = seg(t, t0, t0 + dur)
    O(span, E.outQuad(p))
    T(span, `translateY(${(dy * (1 - E.outCubic(p))).toFixed(2)}px)`)
  }
  function printPose(pr, x, y, rot, s, lift) {
    T(pr.p, `translate(${(x - pr.w / 2).toFixed(2)}px, ${(y - pr.h / 2).toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${s.toFixed(4)})`)
    liftShadow(pr, lift)
  }
  function liftShadow(pr, lift) {
    const h = clamp(lift)
    T(pr.shadow, `translateY(${(46 * h).toFixed(2)}px) scale(${(1 + 0.06 * h).toFixed(4)})`)
    O(pr.shadow, 1 - 0.35 * h)
  }
  function renderTable(t) {
    const on = t >= 2.5 && t < 8.0
    vis(S.tbl, on)
    if (!on) return
    const cc = camC(t)
    const camS = (1 + 0.04 * E.inOutSine(seg(t, 2.5, 5.0))) * (1 + 0.22 * (cc.s - 1))
    T(S.tblCam, `scale(${camS.toFixed(5)})`)
    // print A
    const aOn = t >= 2.55 && t < 5.3
    vis(S.pA.p, aOn)
    if (aOn) {
      const land = seg(t, 2.55, 2.85), s = lerp(1.12, 1, E.outExpo(land))
      const out = E.inCubic(seg(t, 5.0, 5.3))
      printPose(S.pA, 360 - 700 * out, 930, -3 - 4 * out, s, (s - 1) / 0.12 + out * 0.3)
      O(S.pA.p, seg(t, 2.55, 2.61))
    }
    const bOn = t >= 3.5 && t < 5.3
    vis(S.pB.p, bOn)
    if (bOn) {
      const u = seg(t, 3.5, 3.8), x = lerp(700, 0, E.outBack(u))
      const out = E.inCubic(seg(t, 5.0, 5.3))
      printPose(S.pB, 760 + x + 800 * out, 1150, 4 + 5 * (1 - E.outCubic(u)) + 3 * out, 1, (1 - E.outCubic(u)) * 0.5 + out * 0.3)
    }
    // print C
    const cOn = t >= 5.0
    vis(S.pC.p, cOn)
    if (cOn) {
      const s = cc.s * cc.land
      T(S.pC.p, `translate(${(cc.x - cc.lx).toFixed(2)}px, ${(cc.y - cc.ly).toFixed(2)}px) rotate(${cc.rot.toFixed(3)}deg) scale(${s.toFixed(5)})`)
      liftShadow(S.pC, (cc.land - 1) / 0.15)
      O(S.pC.p, seg(t, 5.0, 5.05))
      renderBrickify(t, cc)
    }
    // s2 hand text
    const t2on = t >= 2.6 && t < 4.97
    vis(S.t2.box, t2on)
    if (t2on) { S.t2.ws.forEach((sp, i) => penReveal(sp, t, S.t2w[i])); O(S.t2.box, 1 - seg(t, 4.85, 4.97)) }
    const t3on = t >= 4.95 && t < 7.8
    vis(S.t3.box, t3on)
    if (t3on) { S.t3.ws.forEach((sp, i) => riseIn(sp, t, S.t3w[i].start - 0.02)); O(S.t3.box, 1 - seg(t, 7.65, 7.8)) }
  }

  // brickify: photo -> 1x1 stud mosaic -> model palette
  const MODEL_PAL = ['#F4F4F4', '#A0A5A9', '#6B6E70', '#1B2A34', '#237841', '#184D2E', '#D9BB7B', '#5C3A1E', '#1F5FBF', '#C4161C']
  const BK = {}
  function gridFor(c) {
    let gx = PC.cx - c / 2; gx -= Math.ceil(gx / c) * c
    let gy = PC.cy - c / 2; gy -= Math.ceil(gy / c) * c
    return { c, gx, gy, nx: Math.ceil((PC.W - gx) / c), ny: Math.ceil((PC.H - gy) / c) }
  }
  function prepBrickify() {
    const P = 40
    const pad = cnv(PC.W + 2 * P, PC.H + 2 * P), px = pad.getContext('2d')
    px.imageSmoothingQuality = 'high'
    px.drawImage(IMG.balcony, 0, 560, 1075, 870, P, P, PC.W, PC.H)
    // clamp-to-edge margins
    px.drawImage(pad, P, P, 1, PC.H, 0, P, P, PC.H); px.drawImage(pad, P + PC.W - 1, P, 1, PC.H, P + PC.W, P, P, PC.H)
    px.drawImage(pad, 0, P, PC.W + 2 * P, 1, 0, 0, PC.W + 2 * P, P); px.drawImage(pad, 0, P + PC.H - 1, PC.W + 2 * P, 1, 0, P + PC.H, PC.W + 2 * P, P)
    BK.pad = pad; BK.P = P
    BK.small = cnv(400, 400); BK.sctx = BK.small.getContext('2d', { willReadFrequently: true })
    BK.tile = studTile(96)
    BK.pat = S.bk.getContext('2d').createPattern(BK.tile, 'repeat')
    // final grid (locked at 7.20)
    const cF = 24 / camC(7.2).s
    const g = gridFor(cF)
    smallFor(g)
    const d = BK.sctx.getImageData(0, 0, g.nx, g.ny).data
    const pal = MODEL_PAL.map(h => { const rgb = hexToRgb(h); return { h, lab: srgbToLab(...rgb) } })
    const cells = []
    const ci = (PC.cx - g.gx) / g.c - 0.5, cj = (PC.cy - g.gy) / g.c - 0.5
    let dmax = 0
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const dd = Math.hypot(i - ci, (j - cj) * 1.0); if (dd > dmax) dmax = dd }
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const o = (j * g.nx + i) * 4, r = d[o], gg = d[o + 1], b = d[o + 2]
      // punch up contrast/saturation before snapping to the model palette (keeps white trim white, lawn green)
      const [hh, ss, ll] = AdLib.rgbToHsl(r, gg, b)
      const bst = AdLib.hslToRgb(hh, clamp(ss * 1.45), clamp(0.5 + (ll - 0.47) * 1.35))
      const lab = srgbToLab(bst[0], bst[1], bst[2])
      let best = pal[0], bd = 1e9
      for (const p of pal) { const dl = (lab[0] - p.lab[0]) * 0.85, da = lab[1] - p.lab[1], db = lab[2] - p.lab[2]; const dd = dl * dl + da * da + db * db; if (dd < bd) { bd = dd; best = p } }
      const dist = Math.hypot(i - ci, j - cj) / dmax
      cells.push({ i, j, avg: `rgb(${r},${gg},${b})`, pal: best.h, ts: 7.2 + 0.68 * Math.pow(dist, 0.9) })
    }
    BK.g = g; BK.cells = cells
  }
  function smallFor(g) {
    const s = BK.sctx
    s.clearRect(0, 0, 400, 400)
    s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high'
    const P = BK.P
    s.drawImage(BK.pad, 0, 0, PC.W + 2 * P, PC.H + 2 * P, (-P - g.gx) / g.c, (-P - g.gy) / g.c, (PC.W + 2 * P) / g.c, (PC.H + 2 * P) / g.c)
  }
  function renderBrickify(t, cc) {
    const on = t >= 6.75
    vis(S.bk, on)
    if (!on) return
    const ctx = S.bk.getContext('2d'), K = PC.K
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, S.bk.width, S.bk.height)
    if (t < 7.2) {
      const cs = 4 + 20 * E.inQuad(seg(t, 6.75, 7.2))
      const g = gridFor(cs / cc.s)
      smallFor(g)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(BK.small, 0, 0, g.nx, g.ny, g.gx * K, g.gy * K, g.nx * g.c * K, g.ny * g.c * K)
      const al = 0.45 + 0.55 * clamp((cs - 4) / 6)
      if (al > 0) {
        BK.pat.setTransform(new DOMMatrix([(g.c * K) / 96, 0, 0, (g.c * K) / 96, g.gx * K, g.gy * K]))
        ctx.globalAlpha = al; ctx.fillStyle = BK.pat; ctx.fillRect(0, 0, S.bk.width, S.bk.height); ctx.globalAlpha = 1
      }
      return
    }
    const g = BK.g
    ctx.imageSmoothingEnabled = true
    for (const c of BK.cells) {
      const x0 = Math.round((g.gx + c.i * g.c) * K), x1 = Math.round((g.gx + (c.i + 1) * g.c) * K)
      const y0 = Math.round((g.gy + c.j * g.c) * K), y1 = Math.round((g.gy + (c.j + 1) * g.c) * K)
      const snapped = t >= c.ts
      ctx.fillStyle = snapped ? c.pal : c.avg
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      let pop = 1
      if (snapped) pop = lerp(1.15, 1, E.outQuad(seg(t, c.ts, c.ts + 0.09)))
      const w = (x1 - x0) * pop, h = (y1 - y0) * pop
      ctx.drawImage(BK.tile, (x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h)
    }
  }

  // ---------------------------------------------------------- S4 reveal
  const COV = { cx: 785, cy: 560, rest: 0.64, x: 43 + 785 * 0.64, y: 560 + 560 * 0.64 }
  function buildReveal() {
    const L = (S.rv = div(stage, null, 'layer'))
    div(L, { top: OFF, width: 1080, height: VH, background: SKY(), willChange: 'transform' })
    S.rvCloud = canvasImg(L, S.plate14, { top: OFF, width: 1080, height: S.plate14.height, opacity: 0.3, willChange: 'transform' })
    div(L, { top: OFF, width: 1080, height: VH, background: 'radial-gradient(80% 45% at 50% 52%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)', willChange: 'transform' })
    S.rvConfB = canvasEl(L, cnv(1080, 1920), { width: 1080, height: 1920 })
    S.rvModel = div(L, { width: 1554, height: 1065, transformOrigin: '0 0' })
    const sh = silShadow(IMG.cover, 26, 4, 80)
    S.rvShadow = canvasImg(S.rvModel, sh.c, Object.assign({}, sh.css, { opacity: 0.32 }))
    T(S.rvShadow, 'translate(0px, 26px)')
    S.rvContact = contactShadow(S.rvModel, 1500, 180, 790, 1010, 0.30)
    S.rvGhosts = []
    for (let i = 0; i < 10; i++) S.rvGhosts.push(natImg(S.rvModel, 'cover', { transformOrigin: `${COV.cx}px ${COV.cy}px` }))
    S.rvImg = natImg(S.rvModel, 'cover')
    S.rvConfF = canvasEl(L, cnv(1080, 1920), { width: 1080, height: 1920 })
    S.rvVoila = textBlock(L, { x: 10, w: 1000, y: 300, align: 'center', font: [FAM.serif, 150, 900, 'italic'], lh: 170, lines: ['Voilà !'] })
    S.rvVoila.box.style.transformOrigin = '500px 95px'
    S.rvName = textBlock(L, { x: 10, w: 1000, y: 300, align: 'center', font: [FAM.serif, 84, 700, 'italic'], lh: 100, lines: ['The Riviera Resort'] })
    S.rvBM = textBlock(L, { x: 10 + 0.09 * 60, w: 1000, y: 410, align: 'center', font: [FAM.label, 60], lh: 60, color: C.booklet_blue, ls: '0.18em', lines: ['BRICK MODEL'] })
    S.rvNameW = vwords('vo6', ['the', 'riviera', 'resort', 'brick'], 8.75)
    // counter with fixed-width digit cells
    const f = fcss(FAM.stat, 130)
    const dw = Math.max(...'0123456789'.split('').map(d => textW(f, d))), cw = textW(f, ',')
    S.rvCount = div(L, { left: 80, top: 1285, height: 130, transformOrigin: '0% 60%' }, 'txt')
    S.rvCount.style.font = `400 130px/130px "${FAM.stat}"`; S.rvCount.style.color = C.navy
    S.rvCells = []
    const layout = ['d', ',', 'd', 'd', 'd']
    let x = 0
    for (const k of layout) { const w = k === 'd' ? dw : cw; const e = div(S.rvCount, { left: x, top: 0, width: w, textAlign: 'center' }); x += w; S.rvCells.push(e) }
    S.rvCountW = { dw, cw }
    S.rvPieces = textBlock(L, { x: 84, y: 1420, font: [FAM.label, 60], lh: 60, color: C.booklet_blue, ls: '0.12em', lines: ['PIECES'] })
    S.rvConf = makeConfetti(4242, 48, 8.05, 9.4, { x0: 330, x1: 760, y0: 640, y1: 900 }, 2350)
  }
  function renderReveal(t) {
    const on = t >= 8.0 && t < 10.5
    vis(S.rv, on)
    if (!on) return
    T(S.rvCloud, `translateY(${Math.round(-10 * (t - 8))}px)`)
    // model: whip-zoom out then drift + sway
    const u = E.outExpo(seg(t, 8.0, 8.45))
    const whip = s => Math.exp(lerp(Math.log(1.81), Math.log(COV.rest), s))
    let sc = whip(u)
    const q = E.inOutSine(seg(t, 8.45, 10.5))
    sc *= 1 + 0.04 * q
    const ry = t < 8.45 ? -3 * u : lerp(-3, 2, q)
    const cx = lerp(540, COV.x, u), cy = lerp(900, COV.y, u)
    const base = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) perspective(1800px) rotateY(${ry.toFixed(3)}deg)`
    T(S.rvModel, `${base} scale(${sc.toFixed(5)}) translate(${-COV.cx}px, ${-COV.cy}px)`)
    // radial motion blur on the first 4 frames: 10 equal-weight ghosts spaced FR/12 apart read as a smooth smear
    const gOn = t < 8.0 + 4 * FR - 1e-6
    S.rvGhosts.forEach((g, i) => {
      vis(g, gOn)
      if (!gOn) return
      const tp = Math.max(8.0, t - ((i + 1) * FR) / 12)
      const r = whip(E.outExpo(seg(tp, 8.0, 8.45))) / sc
      T(g, `scale(${r.toFixed(4)})`)
      O(g, 0.08)
    })
    O(S.rvImg, 1)
    // confetti
    const cOn = t < 9.45
    vis(S.rvConfB, cOn); vis(S.rvConfF, cOn)
    if (cOn) drawConfetti(S.rvConfB, S.rvConfF, S.rvConf, t, 8.05)
    // texts
    const vOn = t >= 8.02 && t < 8.72
    vis(S.rvVoila.box, vOn)
    if (vOn) {
      const s = kf(t, [[8.02, 0.85], [8.14, 1.06, E.outCubic], [8.22, 1.0, E.inOutSine]])
      T(S.rvVoila.box, `scale(${s.toFixed(4)})`); O(S.rvVoila.box, Math.min(seg(t, 8.02, 8.07), 1 - seg(t, 8.62, 8.72)))
    }
    const nOn = t >= 8.72
    vis(S.rvName.box, nOn)
    if (nOn) S.rvName.ws.forEach((sp, i) => riseIn(sp, t, Math.max(8.72, S.rvNameW[i].start - 0.02), 14, 0.3))
    const bt = Math.max(9.6, S.rvNameW[3].start - 0.02)
    vis(S.rvBM.box, t >= bt)
    if (t >= bt) { const p = seg(t, bt, bt + 0.28); O(S.rvBM.box, E.outQuad(p)); T(S.rvBM.box, `translateY(${(8 * (1 - E.outCubic(p))).toFixed(2)}px)`) }
    const kOn = t >= 8.6
    vis(S.rvCount, kOn); vis(S.rvPieces.box, kOn)
    if (kOn) {
      const n = Math.round(1746 * E.outCubic(seg(t, 8.6, 9.8)))
      const str = n.toLocaleString('en-US')
      const chars = str.split('')
      // right-to-left fill into the 5 cells, left-aligned block
      const cells = S.rvCells
      const L0 = chars.length
      const layoutOf = s => s.split('').map(ch => (ch === ',' ? 'c' : 'd'))
      let x = 0
      const lay = layoutOf(str)
      for (let i = 0; i < cells.length; i++) {
        if (i < L0) {
          const w = lay[i] === 'd' ? S.rvCountW.dw : S.rvCountW.cw
          cells[i].textContent = chars[i]; cells[i].style.left = x + 'px'; cells[i].style.width = w + 'px'; x += w; vis(cells[i], true)
        } else vis(cells[i], false)
      }
      const pulse = kf(t, [[9.8, 1], [9.9, 1.06, E.outQuad], [10.02, 1, E.inOutSine]])
      T(S.rvCount, `scale(${pulse.toFixed(4)})`)
      const fi = E.outQuad(seg(t, 8.6, 8.8))
      O(S.rvCount, fi); O(S.rvPieces.box, fi)
      T(S.rvPieces.box, `translateY(${(8 * (1 - fi)).toFixed(2)}px)`)
    }
  }

  // ---------------------------------------------------------- S5 real vs brick
  const WIN = { x: 90, y: 380, w: 900, h: 1013 }
  function buildCompare() {
    const L = (S.cmp = div(stage, null, 'layer'))
    S.cmpBg = div(L, { top: OFF, width: 1080, height: VH, background: SKY(), willChange: 'transform' })
    gridBg(L, { top: OFF, width: 1080, height: VH, willChange: 'transform' }, 32, 3.2, 'rgba(255,255,255,0.55)', 0.32)
    // window back (backdrop + drop shadow)
    S.wBack = div(L, { left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 28, background: `linear-gradient(180deg, ${shade(C.sky_top, 0.03)} 0%, ${C.sky_bottom} 100%)`, boxShadow: '0 24px 60px rgba(20,48,79,0.30), 0 3px 8px rgba(20,48,79,0.12)', transformOrigin: `${WIN.w / 2}px ${WIN.h / 2}px` })
    // shelf camera group (brick facade, plank, dimension line, dims text)
    S.cam5 = div(L, { width: 1080, height: 1920, transformOrigin: '540px 950px' })
    S.plank = div(S.cam5, { left: 60, top: 1147, width: 960, height: 18, background: `linear-gradient(180deg, ${shade(C.tan, 0.06)} 0%, ${C.tan} 40%, ${shade(C.tan, -0.08)} 100%)`, borderTop: `1px solid ${shade(C.tan, -0.22)}`, borderRadius: 3, boxShadow: '0 14px 22px rgba(20,48,79,0.28), 0 3px 4px rgba(20,48,79,0.25)' })
    S.plankTop = div(S.cam5, { left: 60, top: 1139, width: 960, height: 9, background: `linear-gradient(180deg, ${shade(C.tan, 0.1)}, ${shade(C.tan, 0.02)})`, clipPath: 'polygon(1.2% 0, 98.8% 0, 100% 100%, 0 100%)' })
    S.fv2 = div(S.cam5, { width: 1448, height: 770, transformOrigin: '0 0' })
    S.fv2Contact = contactShadow(S.fv2, 1520, 120, 724, 752, 0.34)
    S.fv2Img = natImg(S.fv2, 'fv2')
    S.dimSvg = svgEl(S.cam5, 0, 0, 1080, 1920)
    S.dimLine = sv('path', S.dimSvg, { d: 'M120 1195 L960 1195', stroke: C.navy, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'butt' })
    S.dimT1 = sv('path', S.dimSvg, { d: 'M122 1181 L122 1209', stroke: C.navy, 'stroke-width': 4, fill: 'none' })
    S.dimT2 = sv('path', S.dimSvg, { d: 'M958 1181 L958 1209', stroke: C.navy, 'stroke-width': 4, fill: 'none' })
    S.dims = textBlock(S.cam5, { x: 10, w: 1000, y: 1215, align: 'center', font: [FAM.stat, 46], lh: 55, lines: ['38 × 26 cm · 16 cm tall'] })
    // window front: clip (round-1 brick, REAL layers, blink, slider), frame border
    S.wFront = div(L, { width: 1080, height: 1920, transformOrigin: `${WIN.x + WIN.w / 2}px ${WIN.y + WIN.h / 2}px` })
    S.wClip = div(S.wFront, { left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 28 }, 'clip')
    S.wClip.style.isolation = 'isolate'
    S.b1 = natImg(S.wClip, 'fv2')
    S.r1 = div(S.wClip, { width: WIN.w, height: WIN.h }, 'clip')
    S.r1Img = natImg(S.r1, 'arrival')
    S.r2 = div(S.wClip, { width: WIN.w, height: WIN.h }, 'clip')
    S.r2Img = natImg(S.r2, 'arrival')
    S.wBlink = div(S.wClip, { width: WIN.w, height: WIN.h, background: '#fff' })
    S.slV = div(S.wClip, { left: -5, top: 0, width: 10, height: WIN.h, background: '#fff', boxShadow: '0 0 14px rgba(10,28,50,0.45)' })
    S.slH = div(S.wClip, { left: 0, top: -5, width: WIN.w, height: 10, background: '#fff', boxShadow: '0 0 14px rgba(10,28,50,0.45)' })
    S.wFrame = div(S.wFront, { left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 28, boxShadow: 'inset 0 0 0 6px #fff, inset 0 0 0 7px rgba(20,48,79,0.08)' })
    S.handle5 = canvasImg(S.wFront, brickTop(2, 2, 38, C.brick_red), { width: 76, height: 76, borderRadius: 7, boxShadow: '0 8px 18px rgba(10,28,50,0.45), 0 2px 3px rgba(10,28,50,0.35)' })
    S.chip5 = chip(S.wFront, { x: 114, y: 404, h: 58, font: [FAM.label, 52], padX: 18, bg: C.real_blue, radius: 10, text: 'REAL', ls: '0.04em', shadow: '0 6px 16px rgba(10,28,50,0.30)' })
    S.chip5.e.style.transformOrigin = '50% 50%'
    S.hdr5 = textBlock(S.wFront, { x: 90, y: 295, font: [FAM.label, 60], lh: 60, color: C.navy, ls: '0.03em', lines: ['REAL vs BRICK'] })
    S.tally = canvasImg(S.wFront, brickTop(2, 1, 65, '#FFFFFF', 2, 56), { left: 810, top: 298, width: 130, height: 56, borderRadius: 8, boxShadow: '0 6px 16px rgba(10,28,50,0.22), 0 1px 2px rgba(10,28,50,0.2)' })
    const sr = 56 * 0.3, sn = Math.ceil(sr * 3)
    S.tallyStuds = [0, 1].map(i => canvasImg(S.wFront, studSprite(sr, C.orange), { left: 810 + (i + 0.5) * 65 - sn / 2, top: 298 + 28 - sn / 2, width: sn, height: sn }))
    // marker ellipse (hand-drawn), "Mansard roof" + check
    S.mkSvg = svgEl(S.wFront, 0, 0, 1080, 1920)
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const a = -2.6 + (i / 64) * (TAU * 1.08)
      const rx = 210 * (1 + 0.035 * Math.sin(a * 2 + 0.6)), ry = 70 * (1 + 0.06 * Math.cos(a * 3))
      pts.push(`${(630 + rx * Math.cos(a)).toFixed(1)} ${(670 + ry * Math.sin(a) - 4 * (i / 64)).toFixed(1)}`)
    }
    S.mkEll = sv('path', S.mkSvg, { d: 'M' + pts.join(' L'), stroke: C.marker_red, 'stroke-width': 8, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    S.mkEllLen = S.mkEll.getTotalLength()
    S.mkTxt = textBlock(S.wFront, { x: 90, y: 1410, font: [FAM.marker, 64], lh: 75, color: C.marker_red, lines: ['Mansard roof'], pen: true })
    const mw = textW(fcss(FAM.marker, 64), 'Mansard roof')
    S.mkCheck = sv('path', S.mkSvg, { d: `M${90 + mw + 26} 1452 L${90 + mw + 44} 1472 L${90 + mw + 84} 1420`, stroke: C.marker_red, 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    S.mkCheckLen = S.mkCheck.getTotalLength()
    S.mkCheckC = { x: 90 + mw + 55, y: 1446 }
    // headline
    S.shelfTxt = textBlock(L, { x: 80, y: 300, font: [FAM.serif, 92, 700, 'italic'], lh: 110, lines: ['This one fits', 'on a shelf.'] })
    S.shelfW = vwords('vo7', ['this', 'one', 'fits', 'on', 'a', 'shelf'], 13.05)
  }
  function chipFlip(c, t, flips) {
    // flips: [[time, 'REAL'|'BRICK', instant?]]  returns state at t
    let label = 'REAL', ang = 0
    for (const [ft, lb, inst] of flips) {
      if (inst) { if (t >= ft) label = lb; continue }
      const a0 = ft - 0.03, a1 = ft + 0.11, mid = (a0 + a1) / 2
      if (t >= a1) label = lb
      else if (t >= a0) { if (t < mid) ang = 90 * E.inQuad(seg(t, a0, mid)); else { label = lb; ang = -90 * (1 - E.outQuad(seg(t, mid, a1))) } }
    }
    if (c.ws[0].textContent !== label) c.ws[0].textContent = label
    c.e.style.background = label === 'REAL' ? C.real_blue : C.brick_red
    T(c.e, `perspective(600px) rotateX(${ang.toFixed(2)}deg)`)
  }
  function renderCompare(t) {
    const on = t >= 10.5 && t < 15.35
    vis(S.cmp, on)
    if (!on) return
    // s6 pushes s5 up and out
    const up = E.outCubic(seg(t, 15.0, 15.35))
    T(S.cmp, `translateY(${(-VH * up).toFixed(2)}px)`)
    const pop = lerp(1.06, 1, E.outCubic(seg(t, 10.5, 10.5 + 4 * FR)))
    const fade = seg(t, 13.05, 13.35), fs = lerp(1, 1.04, E.outCubic(fade))
    const wS = pop * fs, wO = 1 - E.inOutSine(fade)
    const wOn = t < 13.35
    vis(S.wBack, wOn); vis(S.wFront, wOn)
    if (wOn) {
      T(S.wBack, `scale(${wS.toFixed(4)})`); O(S.wBack, wO)
      T(S.wFront, `scale(${wS.toFixed(4)})`); O(S.wFront, wO)
    }
    const r1 = t < 12.0
    // round 1: vertical slider L->R
    vis(S.b1, r1); vis(S.r1, r1); vis(S.slV, r1)
    vis(S.r2, !r1); vis(S.slH, !r1)
    let hx, hy, hs = 1
    if (r1) {
      kb(S.b1, 1.385, 330, 0, 540, 290, 1 + 0.02 * E.inOutSine(seg(t, 10.5, 12)))
      kb(S.r1Img, 1.5, 0, 32, 600, 87, 1 + 0.03 * E.inOutSine(seg(t, 10.5, 12)))
      const X = WIN.w * E.inOutCubic(seg(t, 11.0, 11.5))
      S.r1.style.clipPath = `inset(0 0 0 ${X.toFixed(2)}px)`
      T(S.slV, `translateX(${X.toFixed(2)}px)`)
      hx = WIN.x + X; hy = WIN.y + WIN.h / 2
      hs = kf(t, [[11.5, 1], [11.575, 1.18, E.outQuad], [11.65, 1, E.inOutSine]])
    } else {
      kb(S.r2Img, 0.769, 0, 32, 585 * 0.769, (200 - 32) * 0.769, 1 + 0.02 * E.inOutSine(seg(t, 12.0, 13.0)))
      const Y = WIN.h * E.inOutCubic(seg(t, 12.5, 13.0))
      S.r2.style.clipPath = `inset(${Y.toFixed(2)}px 0 0 0)`
      T(S.slH, `translateY(${Y.toFixed(2)}px)`)
      hx = 540; hy = WIN.y + Y
      // round 2: the handle pops in at top centre once the 2-frame blink has passed
      hs = t < 12.5 ? lerp(0.6, 1, E.outBack(seg(t, 12.0 + 2 * FR, 12.0 + 5 * FR))) : kf(t, [[13.0, 1], [13.075, 1.18, E.outQuad], [13.15, 1, E.inOutSine]])
    }
    T(S.handle5, `translate(${(hx - 38).toFixed(2)}px, ${(hy - 38).toFixed(2)}px) scale(${hs.toFixed(4)})`)
    // hidden during the round-1 -> round-2 white blink, so the jump across the window is never seen
    vis(S.handle5, !(t >= 12.0 && t < 12.0 + 2 * FR - 1e-6))
    O(S.wBlink, t >= 12.0 && t < 12.0 + 2 * FR - 1e-6 ? (t < 12.0 + FR - 1e-6 ? 1 : 0.55) : 0)
    chipFlip(S.chip5, t, [[11.5, 'BRICK'], [12.0, 'REAL', true], [13.0, 'BRICK']])
    O(S.chip5.e, 1 - seg(t, 13.1, 13.2))
    // header + tally
    O(S.hdr5.box, 1 - seg(t, 13.0, 13.1)); T(S.hdr5.box, `translateY(${(-14 * E.inQuad(seg(t, 13.0, 13.1))).toFixed(2)}px)`)
    S.tallyStuds.forEach((e, i) => {
      const ts = i ? 13.0 : 11.5
      vis(e, t >= ts)
      if (t >= ts) T(e, `scale(${lerp(1.5, 1, E.outBack(seg(t, ts, ts + 0.16))).toFixed(4)})`)
    })
    // marker + callout
    const mOn = t >= 11.52 && t < 12.0
    vis(S.mkSvg, mOn); vis(S.mkTxt.box, mOn)
    if (mOn) {
      draw(S.mkEll, S.mkEllLen, E.inOutSine(seg(t, 11.55, 11.85)))
      const p = seg(t, 11.52, 11.52 + 6 * FR)
      const a = lerp(-14, 100, p)
      const m = p >= 1 ? 'none' : `linear-gradient(90deg, #000 ${a}%, rgba(0,0,0,0) ${a + 14}%)`
      S.mkTxt.ws.forEach(w => { w.style.opacity = 1; w.style.webkitMaskImage = 'none'; w.style.maskImage = 'none' })
      S.mkTxt.box.style.webkitMaskImage = m; S.mkTxt.box.style.maskImage = m
      const cp = seg(t, 11.74, 11.74 + 3 * FR)
      draw(S.mkCheck, S.mkCheckLen, cp)
      const cs = lerp(1.35, 1, E.outBack(seg(t, 11.74, 11.9)))
      S.mkCheck.style.transformOrigin = `${S.mkCheckC.x}px ${S.mkCheckC.y}px`
      S.mkCheck.style.transform = `scale(${cs.toFixed(3)})`
    }
    // brick facade (round 2 -> shelf)
    const fOn = t >= 12.0
    vis(S.fv2, fOn)
    if (fOn) {
      const u = E.outCubic(seg(t, 13.05, 13.45))
      const w = lerp(860, 840, u), x = lerp(110, 120, u), y = lerp(622, 700, u)
      T(S.fv2, `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(w / 1448).toFixed(5)})`)
      O(S.fv2Contact, E.inOutSine(seg(t, 13.2, 13.5)))
    }
    const push = 1 + 0.03 * E.inOutSine(seg(t, 13.05, 15.0))
    T(S.cam5, `scale(${push.toFixed(5)})`)
    const pOn = t >= 13.2
    vis(S.plank, pOn); vis(S.plankTop, pOn)
    if (pOn) { const x = lerp(-1080, 0, E.outCubic(seg(t, 13.2, 13.5))); T(S.plank, `translateX(${x.toFixed(2)}px)`); T(S.plankTop, `translateX(${x.toFixed(2)}px)`) }
    const dOn = t >= 13.35
    vis(S.dimSvg, dOn)
    if (dOn) {
      const p = E.inOutCubic(seg(t, 13.35, 13.8))
      draw(S.dimLine, 840, p)
      O(S.dimT1, 1)
      S.dimT2.style.opacity = p >= 0.98 ? 1 : 0
    }
    const tOn = t >= 13.6
    vis(S.dims.box, tOn)
    if (tOn) { const p = seg(t, 13.6, 13.9); O(S.dims.box, E.outQuad(p)); T(S.dims.box, `translateY(${(10 * (1 - E.outCubic(p))).toFixed(2)}px)`) }
    const hOn = t >= 13.0
    vis(S.shelfTxt.box, hOn)
    if (hOn) S.shelfTxt.ws.forEach((sp, i) => riseIn(sp, t, Math.max(13.1, S.shelfW[i].start - 0.02), 14, 0.3))
  }

  // ---------------------------------------------------------- S6 booklet
  function buildBooklet() {
    const L = (S.bkl = div(stage, null, 'layer'))
    S.bklBg = div(L, { top: OFF - 40, width: 1080, height: VH + 80, background: C.paper, willChange: 'transform' })
    gridBg(S.bklBg, { width: 1080, height: VH + 80 }, 24, 2.8, C.grid)
    div(S.bklBg, { width: 1080, height: VH + 80, background: 'radial-gradient(110% 80% at 50% 45%, rgba(255,255,255,0) 60%, rgba(20,48,79,0.07) 100%)' })
    S.stack = div(L, { width: 1080, height: 1920, transformOrigin: '540px 950px' })
    const card = (w, h, key) => {
      const e = div(S.stack, { width: w, height: h, transformOrigin: '50% 50%' }, 'card')
      const im = IMG[key], sc = cnv(w * 1.25, (w * 1.25 * im.naturalHeight) / im.naturalWidth), sx = sc.getContext('2d')
      sx.imageSmoothingQuality = 'high'; sx.drawImage(im, 0, 0, sc.width, sc.height)
      canvasImg(e, sc, { width: w, height: (w * im.naturalHeight) / im.naturalWidth }, 'image/jpeg', 0.94)
      div(e, { width: w, height: h, borderRadius: 14, boxShadow: 'inset 0 0 0 1px rgba(20,48,79,0.08)' })
      return e
    }
    S.c01 = card(900, 650, 'p01') // page-01 cropped to source y 0-1192 by the card height
    S.c21 = card(900, 695, 'p21')
    S.c71 = card(900, 695, 'p71')
    const k = 900 / 1650
    const trace = (parent, x0, y0, x1, y1) => {
      const pad = 8, x = x0 * k - pad, y = y0 * k - pad, w = (x1 - x0) * k + 2 * pad, h = (y1 - y0) * k + 2 * pad
      const s = svgEl(parent, 0, 0, 900, 695)
      const r = 10
      const d = `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}`
      const glow = sv('path', s, { d, stroke: C.orange, 'stroke-width': 14, fill: 'none', opacity: 0.25, 'stroke-linecap': 'round' })
      const p = sv('path', s, { d, stroke: C.orange, 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      return { s, p, glow, len: p.getTotalLength() }
    }
    S.tr21 = trace(S.c21, 996, 45, 1597, 333)
    S.tr71 = trace(S.c71, 53, 112, 1597, 287)
    const ch = { font: [FAM.stat, 62], padX: 20, bg: '#FFFFFF', radius: 14, color: C.navy, h: 85, shadow: '0 10px 26px rgba(20,48,79,0.16), 0 2px 4px rgba(20,48,79,0.08)' }
    S.e1 = chip(L, Object.assign({ x: 80, y: 300, text: 'Every step illustrated.' }, ch))
    S.e2 = chip(L, Object.assign({ x: 80, y: 400, text: 'Every part listed.' }, ch))
    for (const c of [S.e1, S.e2]) {
      c.e.style.transformOrigin = '0% 50%'
      // background as its own layer so it can grow word by word
      c.bg = document.createElement('div'); c.bg.className = 'a'
      sty(c.bg, { height: ch.h, background: '#fff', borderRadius: ch.radius, boxShadow: ch.shadow })
      c.e.insertBefore(c.bg, c.e.firstChild)
      c.e.style.background = 'none'; c.e.style.boxShadow = 'none'
      c.edges = c.ws.map(sp => ch.padX + sp.offsetLeft + sp.offsetWidth + ch.padX)
      c.fullW = c.e.offsetWidth
    }
    S.e1w = vwords('vo8', ['every', 'step', 'illustrated'], 15.2)
    S.e2w = vwords('vo9', ['every', 'part', 'listed'], 16.85)
  }
  function renderBooklet(t) {
    const on = t >= 15.0 && t < 18.0
    vis(S.bkl, on)
    if (!on) return
    const up = E.outCubic(seg(t, 15.0, 15.35))
    T(S.bkl, `translateY(${(VH * (1 - up)).toFixed(2)}px)`)
    T(S.stack, `scale(${(1 + 0.04 * E.inOutSine(seg(t, 15.0, 18.0))).toFixed(5)})`)
    // cover card rises
    {
      const u = seg(t, 15.0, 15.35), e = E.outBack(u)
      const y = 1100 * (1 - e), rx = 18 * (1 - E.outCubic(u))
      T(S.c01, u < 1 ? `translate(${540 - 450}px, ${(880 - 325 + y).toFixed(2)}px) perspective(2200px) rotateX(${rx.toFixed(2)}deg) rotate(-3deg)` : `translate(${540 - 450}px, ${880 - 325}px) rotate(-3deg)`)
    }
    const d21 = t >= 15.5
    vis(S.c21, d21)
    if (d21) {
      const u = seg(t, 15.5, 15.8), e = E.outCubic(u)
      const x = 900 * (1 - e), ry = 25 * (1 - e), rz = lerp(9, 2, E.outBack(u))
      T(S.c21, `translate(${(600 - 450 + x).toFixed(2)}px, ${(1045 - 347.5 - 30 * (1 - e)).toFixed(2)}px)${u < 1 ? ` perspective(2200px) rotateY(${ry.toFixed(2)}deg)` : ''} rotate(${rz.toFixed(3)}deg)`)
      const p = E.inOutSine(seg(t, 15.8, 16.2))
      draw(S.tr21.p, S.tr21.len, p); draw(S.tr21.glow, S.tr21.len, p)
      // page 21's trace fades as the inventory page is dealt on top (no orphan bracket beside page 71)
      O(S.tr21.s, 1 - seg(t, 16.85, 17.0))
    }
    const d71 = t >= 16.75
    vis(S.c71, d71)
    if (d71) {
      const u = seg(t, 16.75, 17.05), e = E.outCubic(u)
      const x = -900 * (1 - e), ry = -25 * (1 - e), rz = lerp(-8, -1, E.outBack(u))
      T(S.c71, `translate(${(520 - 450 + x).toFixed(2)}px, ${(1050 - 347.5 - 30 * (1 - e)).toFixed(2)}px)${u < 1 ? ` perspective(2200px) rotateY(${ry.toFixed(2)}deg)` : ''} rotate(${rz.toFixed(3)}deg)`)
      const p = E.inOutSine(seg(t, 17.0, 17.4))
      draw(S.tr71.p, S.tr71.len, p); draw(S.tr71.glow, S.tr71.len, p)
    }
    const chipPop = (c, ws, t0) => {
      const on = t >= t0
      vis(c.e, on)
      if (!on) return
      const p = seg(t, t0, t0 + 3 * FR)
      T(c.e, `scale(${lerp(0.9, 1, E.outCubic(p)).toFixed(4)})`); O(c.e, E.outQuad(seg(t, t0, t0 + 2 * FR)))
      let bw = c.edges[0] * E.outCubic(p)
      c.ws.forEach((sp, i) => {
        const tw0 = Math.max(t0, ws[i].start - 0.02); const q = seg(t, tw0, tw0 + 3 * FR)
        O(sp, t >= tw0 ? 1 : 0); T(sp, `scale(${lerp(0.9, 1, E.outCubic(q)).toFixed(4)})`)
        if (i > 0 && t >= tw0) bw = lerp(c.edges[i - 1], c.edges[i], E.outCubic(seg(t, tw0, tw0 + 0.12)))
      })
      c.bg.style.width = Math.min(c.fullW, bw).toFixed(1) + 'px'
    }
    chipPop(S.e1, S.e1w, S.e1w[0].start - 0.02)
    chipPop(S.e2, S.e2w, S.e2w[0].start - 0.02)
  }

  // ---------------------------------------------------------- URL bug (15.0 - 22.0)
  function buildBug() {
    S.bug = chip(stage, { x: 80, y: 1440, h: 52, font: [FAM.body, 38, 800], padX: 22, bg: C.booklet_blue, radius: 26, text: 'brickcoodle.com', dy: 0, shadow: '0 8px 20px rgba(20,48,79,0.28)' })
    S.bug.e.style.transformOrigin = '0% 50%'
    // optical centring for lowercase: centre the x-height
    const f = fcss(FAM.body, 38, 800), m = metrics(f)
    MCTX.font = f
    const x = MCTX.measureText('x').actualBoundingBoxAscent
    S.bug.inner.style.top = (x / 2 - (m.A - m.D) / 2 + 1).toFixed(1) + 'px'
    S.bugW = S.bug.e.offsetWidth
  }
  function renderBug(t) {
    const on = t >= 15.0 && t < 25.12
    vis(S.bug.e, on)
    if (!on) return
    if (t < 22.0) {
      const s = kf(t, [[15.0, 0.8], [15.12, 1.04, E.outCubic], [15.2, 1.0, E.inOutSine]])
      S.bug.e.style.transformOrigin = '0% 50%'
      T(S.bug.e, `scale(${s.toFixed(4)})`); O(S.bug.e, seg(t, 15.0, 15.04))
      return
    }
    // end card: the URL stays up, centred in the CTA slot, until the 1x6 brick button lands on it at 25.12
    const dx = 540 - S.bugW / 2 - 80, dy = 1300 - 1440
    const s = kf(t, [[22.12, 0.7], [22.26, 1.06, E.outCubic], [22.36, 1.0, E.inOutSine]])
    S.bug.e.style.transformOrigin = '50% 50%'
    T(S.bug.e, `translate(${dx.toFixed(1)}px, ${dy}px) scale(${s.toFixed(4)})`)
    O(S.bug.e, Math.min(seg(t, 22.12, 22.18), 1 - seg(t, 25.04, 25.12)))
  }

  // ---------------------------------------------------------- S7 build flipbook
  const BUILD = [
    { t: 18.0, key: 'st01', L: 4, R: 1280, Y: 571, n: '01' },
    { t: 18.25, key: 'st10', L: 2, R: 1291, Y: 584, n: '10' },
    { t: 18.5, key: 'st34', L: 3, R: 1289, Y: 829, n: '34' },
    { t: 18.75, key: 'st60', L: 3, R: 1201, Y: 853, n: '60' },
    { t: 19.0, key: 'st80', L: 4, R: 1203, Y: 845, n: '80' },
    { t: 19.25, key: 'st91', L: 4, R: 1203, Y: 845, n: '91' },
    { t: 19.5, key: 'cover', L: 13, R: 1541, Y: 1052, n: '94' },
  ]
  function buildBuild() {
    const L = (S.bld = div(stage, null, 'layer'))
    const bg = div(L, { top: OFF, width: 1080, height: VH, background: C.paper, willChange: 'transform' })
    gridBg(bg, { width: 1080, height: VH }, 24, 2.8, C.grid)
    div(bg, { width: 1080, height: VH, background: 'radial-gradient(70% 40% at 50% 62%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%), radial-gradient(110% 80% at 50% 45%, rgba(255,255,255,0) 60%, rgba(20,48,79,0.07) 100%)' })
    S.bldCam = div(L, { width: 1080, height: 1920 })
    S.bldContact = contactShadow(S.bldCam, 1060, 170, 540, 1300, 0.30)
    S.frames = BUILD.map(f => {
      const im = IMG[f.key], s = 900 / (f.R - f.L)
      const g = div(S.bldCam, { width: im.naturalWidth, height: im.naturalHeight, transformOrigin: '0 0' })
      const sh = silShadow(im, 22, 4, 70)
      const shE = canvasImg(g, sh.c, Object.assign({}, sh.css, { opacity: 0.26 }))
      T(shE, 'translate(0px, 18px)')
      natImg(g, f.key)
      const gl = canvasImg(g, orangeGlow(im, 2), { width: im.naturalWidth, height: im.naturalHeight })
      return Object.assign({}, f, { g, gl, s, x: 90 - f.L * s, y: 1330 - f.Y * s })
    })
    S.stepLbl = textBlock(L, { x: 80, y: 450, font: [FAM.label, 44], lh: 45, color: C.booklet_blue, ls: '0.08em', lines: ['STEP'] })
    const f = fcss(FAM.stat, 120)
    const dw = Math.max(...'0123456789'.split('').map(d => textW(f, d)))
    S.odo = div(L, { left: 80, top: 495, width: dw * 2 + 6, height: 120 }, 'clip')
    S.odoA = div(S.odo, { width: dw * 2 + 6, height: 120 }, 'txt'); S.odoB = div(S.odo, { width: dw * 2 + 6, height: 120 }, 'txt')
    for (const e of [S.odoA, S.odoB]) { e.style.font = `400 120px/120px "${FAM.stat}"`; e.style.color = C.navy; e.style.letterSpacing = '0.01em' }
    const bl = 495 + baseIn(f, 120)
    const f2 = fcss(FAM.stat, 52)
    S.of94 = textBlock(L, { x: 80 + dw * 2 + 14, y: bl - baseIn(f2, 60), font: [FAM.stat, 52], lh: 60, color: C.muted, lines: ['/94'] })
    S.bldSpark1 = sparkle(L, 84); S.bldSpark2 = sparkle(L, 64)
  }
  function renderBuild(t) {
    const on = t >= 18.0 && t < 20.0
    vis(S.bld, on)
    // "6-8 HOURS OF..." spans s7 + s8
    const hOn = t >= 18.0 && t < 22.0
    vis(S.hours.box, hOn)
    if (hOn) S.hours.ws.forEach((sp, i) => {
      const t0 = S.hoursW[i].start - 0.02, p = seg(t, t0, t0 + 3 * FR)
      O(sp, t >= t0 ? 1 : 0); T(sp, `scale(${lerp(1.2, 1, E.outCubic(p)).toFixed(4)})`)
    })
    if (!on) return
    let k = 0
    for (let i = 0; i < BUILD.length; i++) if (t >= BUILD[i].t) k = i
    const f = S.frames[k], dt = t - f.t
    S.frames.forEach((fr_, i) => vis(fr_.g, i === k))
    const press = k === 0 ? 0 : dt < FR - 1e-6 ? 4 : 4 * (1 - E.outQuad(clamp((dt - FR) / (3 * FR))))
    let push = 1, ax = 0, ay = 0
    if (k === BUILD.length - 1) { push = 1 + 0.03 * E.inOutSine(seg(t, 19.5, 20.0)); ax = f.x + 555 * f.s; ay = f.y + 600 * f.s }
    T(S.bldCam, `translate(${(ax * (1 - push)).toFixed(2)}px, ${(ay * (1 - push)).toFixed(2)}px) scale(${push.toFixed(5)})`)
    T(f.g, `translate(${f.x.toFixed(2)}px, ${(f.y + press).toFixed(2)}px) scale(${f.s.toFixed(5)})`)
    const glow = k === 0 ? 0.3 : dt < 2 * FR ? 1 : lerp(1, 0.3, E.outQuad(seg(dt, 2 * FR, 0.2)))
    O(f.gl, glow)
    // odometer
    const prev = k > 0 ? S.frames[k - 1].n : f.n
    const rp = k === 0 ? 1 : E.outCubic(clamp(dt / (3 * FR)))
    S.odoA.textContent = prev; S.odoB.textContent = f.n
    T(S.odoA, `translateY(${(-120 * rp).toFixed(2)}px)`); T(S.odoB, `translateY(${(120 * (1 - rp)).toFixed(2)}px)`)
    vis(S.odoA, rp < 1)
    S.of94.box.style.color = t >= 19.5 ? C.orange : C.muted
    // sparkles on the flags
    const fx_ = S.frames[6]
    renderSparkle(S.bldSpark1, t, 19.52, fx_.x + 596 * fx_.s, fx_.y + 560 * fx_.s, 0.42, 1)
    renderSparkle(S.bldSpark2, t, 19.62, fx_.x + 838 * fx_.s, fx_.y + 646 * fx_.s, 0.38, 0.9)
  }

  // ---------------------------------------------------------- S8 red one
  function buildRed() {
    const L = (S.red = div(stage, null, 'layer'))
    const bg = div(L, { top: OFF, width: 1080, height: VH, background: C.paper, willChange: 'transform' })
    gridBg(bg, { width: 1080, height: VH }, 24, 2.8, C.grid)
    // punch-in anchored on the card's top edge (y 440) so it grows downward and never covers the headline
    S.redCam = div(L, { width: 1080, height: 1920, transformOrigin: '540px 440px' })
    S.card8 = div(S.redCam, { left: 70, top: 440, width: 940, height: 826, background: '#fff', borderRadius: 28, boxShadow: '0 22px 50px rgba(20,48,79,0.22), 0 3px 8px rgba(20,48,79,0.10)' })
    S.card8win = div(S.card8, { left: 20, top: 20, width: 900, height: 786, borderRadius: 14, background: `linear-gradient(180deg, ${shade(C.sky_top, 0.06)}, ${C.sky_bottom})` }, 'clip')
    S.card8img = natImg(S.card8win, 's94')
    div(S.card8, { width: 940, height: 826, borderRadius: 28, boxShadow: 'inset 0 0 0 3px #DCE3EE' })
    S.step94 = chip(S.redCam, { x: 100, y: 470, h: 60, font: [FAM.stat, 44], padX: 18, bg: C.booklet_blue, radius: 22, text: 'STEP 94', shadow: '0 6px 16px rgba(20,48,79,0.25)' })
    // arrow (hand drawn) from label to the red flag
    S.arrSvg = svgEl(S.redCam, 0, 0, 1080, 1920)
    const d = 'M338 1252 C 262 1182, 238 1010, 300 900 S 372 822, 388 806'
    S.arrHalo = sv('path', S.arrSvg, { d, stroke: '#fff', 'stroke-width': 17, fill: 'none', 'stroke-linecap': 'round', opacity: 0.85 })
    S.arr = sv('path', S.arrSvg, { d, stroke: C.navy, 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' })
    S.arrLen = S.arr.getTotalLength()
    const hd = 'M352 818 L389 804 L386 843'
    S.arrHeadHalo = sv('path', S.arrSvg, { d: hd, stroke: '#fff', 'stroke-width': 17, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85 })
    S.arrHead = sv('path', S.arrSvg, { d: hd, stroke: C.navy, 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    S.arrHeadLen = S.arrHead.getTotalLength()
    // label
    S.label = div(S.redCam, { left: 310, top: 1262, width: 620, height: 130, background: '#FFFEFB', borderRadius: 6, boxShadow: '0 14px 30px rgba(20,48,79,0.25), 0 2px 4px rgba(20,48,79,0.12)', transformOrigin: '50% 50%' })
    const tp = washi(S.label, 170, 36, C.lilac, 0.8); T(tp, 'translate(310px, 0px) rotate(3deg)')
    S.quote = textBlock(S.label, { x: 30, y: 28, w: 570, align: 'center', font: [FAM.hand, 64], lh: 80, color: C.navy, lines: ['“pass me the red one!”'], pen: true })
    const w = vwords('vo11', ['pass', 'me', 'the', 'red', 'one'], 20.0)
    // write-on 20.40 -> end of vo11, keeping the VO rhythm
    const v0 = w[0].start, v1 = w[w.length - 1].end, a = 20.42, b = Math.max(21.1, v1)
    S.quoteW = w.map(x => ({ start: a + ((x.start - v0) / (v1 - v0)) * (b - a), end: a + ((x.end - v0) / (v1 - v0)) * (b - a) }))
    S.redSpark = sparkle(S.redCam, 96)
  }
  function buildHours() {
    S.hours = textBlock(stage, { x: 80, y: 290, font: [FAM.slam, 120], lh: 130, color: C.navy, lines: ['6\u20138 HOURS OF\u2026'] })
    S.hours.ws.forEach(w => (w.style.transformOrigin = '50% 55%'))
    S.hoursW = vwords('vo10', ['six', 'hours', 'of'], 18.2)
  }
  function renderRed(t) {
    const on = t >= 20.0 && t < 22.0
    vis(S.red, on)
    if (!on) return
    const pi = lerp(1.12, 1, E.outCubic(seg(t, 20.0, 20.0 + 4 * FR)))
    T(S.redCam, `scale(${pi.toFixed(4)})`)
    const push = 1 + 0.1 * E.inOutSine(seg(t, 20.0, 22.0))
    // image inside the card: crop x 200-1200, y 138-1011 at 0.9, push anchored on the red flag (508,460)
    kb(S.card8img, 0.9, 200, 138, (508 - 200) * 0.9, (460 - 138) * 0.9, push)
    const lOn = t >= 20.4
    vis(S.label, lOn)
    if (lOn) {
      const s = kf(t, [[20.4, 0.6], [20.55, 1.05, E.outCubic], [20.65, 1, E.inOutSine]])
      T(S.label, `rotate(-4deg) scale(${s.toFixed(4)})`); O(S.label, seg(t, 20.4, 20.45))
      S.quote.ws.forEach((sp, i) => penReveal(sp, t, S.quoteW[i], 0, 0.12, 0.3))
    }
    const aOn = t >= 20.55
    vis(S.arrSvg, aOn)
    if (aOn) {
      const p = E.inOutSine(seg(t, 20.55, 20.8))
      draw(S.arr, S.arrLen, p); draw(S.arrHalo, S.arrLen, p)
      const h = seg(t, 20.8, 20.87)
      draw(S.arrHead, S.arrHeadLen, h); draw(S.arrHeadHalo, S.arrHeadLen, h)
    }
    { const pu = 1 + 0.1 * E.inOutSine(seg(t, 20.0, 22.0)), fx0 = 90 + (540 - 200) * 0.9, fy0 = 460 + (430 - 138) * 0.9; renderSparkle(S.redSpark, t, 20.7, 367 + pu * (fx0 - 367), 749.8 + pu * (fy0 - 749.8), 0.45, 1) }
  }

  // ---------------------------------------------------------- S9 end card + pinned CTA / disclaimer
  const RND = { k: 760 / 1388, x: 160, y: 560 }
  function buildEnd() {
    const L = (S.end = div(stage, null, 'layer'))
    div(L, { top: OFF, width: 1080, height: VH, background: SKY(), willChange: 'transform' })
    S.endCloud = canvasImg(L, S.plate6, { top: OFF, width: 1080, height: S.plate6.height, opacity: 0.35, willChange: 'transform' })
    div(L, { top: OFF, width: 1080, height: VH, background: 'radial-gradient(80% 40% at 50% 45%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)', willChange: 'transform' })
    S.endConfB = canvasEl(L, cnv(1080, 1920), { width: 1080, height: 1920 })
    S.endGroup = div(L, { width: 1080, height: 1920 })
    S.endContact = contactShadow(S.endGroup, 820, 90, 560, 1052, 0.34)
    S.endModel = div(S.endGroup, { width: 1388, height: 947, transformOrigin: '0 0' })
    const sh = silShadow(IMG.render, 24, 4, 70)
    const shE = canvasImg(S.endModel, sh.c, Object.assign({}, sh.css, { opacity: 0.25 })); T(shE, 'translate(0px, 22px)')
    natImg(S.endModel, 'render')
    S.endConfF = canvasEl(L, cnv(1080, 1920), { width: 1080, height: 1920 })
    // polaroid
    S.pol = div(S.endGroup, { width: 230, height: 276, background: '#FFFEFA', boxShadow: '0 16px 30px rgba(20,48,79,0.30), 0 2px 4px rgba(20,48,79,0.15)', transformOrigin: '50% 100%' })
    const pw = div(S.pol, { left: 14, top: 14, width: 202, height: 202 }, 'clip')
    const k = 202 / 1206
    imgEl(pw, SRC.promenade, { left: 0, top: -82 * k, width: 1206 * k, height: 1288 * k })
    div(pw, { width: 202, height: 202, background: 'linear-gradient(128deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%)' })
    // texts
    const f94 = fcss(FAM.stat, 92)
    S.kicker = textBlock(L, { x: 10 + 0.07 * 50, w: 1000, y: 228, align: 'center', font: [FAM.label, 50], lh: 50, color: C.booklet_blue, ls: '0.14em', lines: ['THE RIVIERA RESORT BRICK MODEL'] })
    S.tag1 = textBlock(L, { x: 10, w: 1000, y: 290, align: 'center', font: [FAM.stat, 92], lh: 100, lines: ['94 steps back'] })
    S.tag1.ws[0].style.color = C.brick_red
    S.tag2 = textBlock(L, { x: 10, w: 1000, y: 395, align: 'center', font: [FAM.serif, 104, 900, 'italic'], lh: 125, lines: ['to the Riviera.'] })
    const w12 = vwords('vo12', ['ninety', 'steps', 'back', 'to', 'the', 'riviera'], 22.15)
    S.tag1W = w12.slice(0, 3); S.tag2W = w12.slice(3)
    S.val = textBlock(L, { x: 10, w: 1000, y: 1090, align: 'center', font: [FAM.body, 44, 800], lh: 48, lines: ['Step-by-step instructions', '+ full parts list'] })
    S.s1at = textBlock(L, { x: 120, y: 1178, font: [FAM.hand, 64], lh: 62, lines: ['Step 1 starts at'], pen: true })
    S.s1atW = vwords('vo13', ['step', 'one', 'starts', 'at'], 25.0)
    S.endConf = makeConfetti(777, 30, 22.0, 23.2, { x0: 360, x1: 720, y0: 640, y1: 820 }, 1900)
    // pinned layer (above the loop split): CTA button + disclaimer
    S.pin = div(fxRoot, { width: 1080, height: VH })
    S.pinIn = div(S.pin, { top: -OFF, width: 1080, height: 1920 })
    S.disc = div(S.pinIn, { left: 0, top: 1400, width: 1080, height: 100, background: 'rgba(255,255,255,0.75)', boxShadow: '0 -1px 0 rgba(20,48,79,0.06)' })
    S.discT = textBlock(S.disc, { x: 10, w: 1000, y: 12, align: 'center', font: [FAM.body, 24, 600], lh: 38, lines: ['Unofficial fan design. Not affiliated with or endorsed by', 'The LEGO Group or Disney.'] })
    // button: 1x6 booklet-blue brick
    S.btn = div(S.pinIn, { left: 120, top: 1260, width: 800, height: 130, transformOrigin: '50% 100%' })
    const studs = div(S.btn, { width: 800, height: 20 })
    for (let i = 0; i < 6; i++) {
      const cx = (i + 0.5) * (800 / 6)
      div(studs, { left: cx - 44, top: 0, width: 88, height: 22, borderRadius: '7px 7px 0 0', background: `linear-gradient(180deg, ${C.stud_highlight} 0 5px, rgba(0,0,0,0) 5px), linear-gradient(90deg, ${shade(C.booklet_blue, -0.07)} 0%, ${shade(C.booklet_blue, 0.07)} 28%, ${C.booklet_blue} 55%, ${shade(C.booklet_blue, -0.09)} 100%)` })
    }
    S.btnBody = div(S.btn, { left: 0, top: 18, width: 800, height: 112, borderRadius: 22, background: `linear-gradient(180deg, ${shade(C.booklet_blue, 0.06)} 0%, ${C.booklet_blue} 45%, ${shade(C.booklet_blue, -0.05)} 100%)`, boxShadow: `inset 0 3px 0 rgba(255,255,255,0.22), inset 0 -7px 0 rgba(0,0,0,0.16), inset 3px 0 0 rgba(255,255,255,0.08), 0 16px 34px rgba(20,48,79,0.35), 0 3px 6px rgba(20,48,79,0.25)` })
    const fb = fcss(FAM.stat, 70)
    S.btnTxt = textBlock(S.btnBody, { x: 0, w: 800, y: 22 - 18 + 18, align: 'center', font: [FAM.stat, 70], lh: 72, color: '#fff', lines: ['brickcoodle.com'] })
    // centre the x-height of the lowercase URL in the body
    MCTX.font = fb
    const xh = MCTX.measureText('x').actualBoundingBoxAscent, mm = metrics(fb)
    const base = 72 / 2 + (mm.A - mm.D) / 2
    const targetBase = 56 + xh / 2 + 2 // body-local: x-height centred on 56 (body middle), slight optical drop
    S.btnTxt.box.style.top = (targetBase - base).toFixed(1) + 'px'
    S.btnTxt.box.style.textShadow = '0 2px 0 rgba(0,0,0,0.12)'
    S.btnTxt.box.style.left = '0px'
    // orange new-part outline around the brick silhouette (studs included)
    S.outSvg = svgEl(S.btn, -20, -20, 840, 170)
    const o = 7, r = 22 + o, ox = 20, oy = 20
    const bx0 = ox - o, by0 = oy + 18 - o, bx1 = ox + 800 + o, by1 = oy + 130 + o
    let dd = `M${bx0 + r} ${by0}`
    for (let i = 0; i < 6; i++) {
      const cx = ox + (i + 0.5) * (800 / 6), l = cx - 44 - o, rr_ = cx + 44 + o, top = oy - o
      dd += ` L${l} ${by0} L${l} ${top + 6} Q${l} ${top} ${l + 6} ${top} L${rr_ - 6} ${top} Q${rr_} ${top} ${rr_} ${top + 6} L${rr_} ${by0}`
    }
    dd += ` L${bx1 - r} ${by0} Q${bx1} ${by0} ${bx1} ${by0 + r} L${bx1} ${by1 - r} Q${bx1} ${by1} ${bx1 - r} ${by1} L${bx0 + r} ${by1} Q${bx0} ${by1} ${bx0} ${by1 - r} L${bx0} ${by0 + r} Q${bx0} ${by0} ${bx0 + r} ${by0}`
    S.outGlow = sv('path', S.outSvg, { d: dd, stroke: C.orange, 'stroke-width': 18, fill: 'none', 'stroke-linejoin': 'round', opacity: 0.3 })
    S.outLine = sv('path', S.outSvg, { d: dd, stroke: C.orange, 'stroke-width': 6, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
    S.outLen = S.outLine.getTotalLength()
  }
  function renderEnd(t) {
    const on = t >= 22.0
    vis(S.end, on)
    vis(S.pin, on)
    if (!on) return
    // CTA button + disclaimer fade out over the last 3 frames so the loop wraps cleanly onto frame 0
    O(S.pin, 1 - E.inOutSine(seg(t, 29.83, 29.93)))
    // end-card content fades 29.50-29.70 for the loop bridge
    const fo = 1 - E.inOutSine(seg(t, 29.5, 29.7))
    O(S.endGroup, fo); O(S.tag1.box, fo); O(S.tag2.box, fo); O(S.val.box, fo); O(S.s1at.box, fo)
    // product-name kicker rises in with the hit
    const kp = seg(t, 22.08, 22.4)
    O(S.kicker.box, Math.min(fo, E.outQuad(kp))); T(S.kicker.box, `translateY(${(10 * (1 - E.outCubic(kp))).toFixed(2)}px)`)
    // model lands + floats
    const land = seg(t, 22.0, 22.35)
    const ls = lerp(1.12, 1, E.outBack(land))
    const ph = ((t - 22.35) / 2) * TAU
    const fy = t < 22.35 ? 0 : -6 * Math.sin(ph)
    const ry = t < 22.35 ? 0 : 3 * Math.sin(ph + Math.PI / 2) - 3
    const mx = RND.x + 380, my = RND.y + 260
    T(S.endModel, `translate(${mx}px, ${(my + fy).toFixed(2)}px) perspective(1800px) rotateY(${ry.toFixed(3)}deg) scale(${(RND.k * ls).toFixed(5)}) translate(-694px, -475px)`)
    O(S.endModel, E.outQuad(seg(t, 22.0, 22.08)))
    T(S.endContact, `scale(${(1 - fy / 60).toFixed(4)})`); O(S.endContact, 0.9 + fy / 60)
    // polaroid
    const pOn = t >= 22.5
    vis(S.pol, pOn)
    if (pOn) {
      const u = seg(t, 22.5, 22.9)
      const x = lerp(-400, 0, E.outBack(u)), r = lerp(-20, -8, E.outBack(u))
      T(S.pol, `translate(${(60 + x).toFixed(2)}px, 790px) rotate(${r.toFixed(3)}deg)`)
    }
    // confetti
    const cOn = t < 23.3
    vis(S.endConfB, cOn); vis(S.endConfF, cOn)
    if (cOn) drawConfetti(S.endConfB, S.endConfF, S.endConf, t, 22.03, 0.08)
    // tagline stamps
    const stamp = (sp, t0) => { const p = seg(t, t0, t0 + 3 * FR); O(sp, t >= t0 ? 1 : 0); T(sp, `scale(${lerp(1.2, 1, E.outCubic(p)).toFixed(4)})`) }
    S.tag1.ws.forEach((sp, i) => stamp(sp, Math.max(22.15, S.tag1W[i].start - 0.02)))
    S.tag2.ws.forEach((sp, i) => stamp(sp, Math.max(22.9, S.tag2W[i].start - 0.02)))
    vis(S.val.box, t >= 24.2)
    if (t >= 24.2) { const p = seg(t, 24.2, 24.45); O(S.val.box, E.outQuad(p) * fo); T(S.val.box, `translateY(${(12 * (1 - E.outCubic(p))).toFixed(2)}px)`) }
    vis(S.s1at.box, t >= 24.95)
    if (t >= 24.95) S.s1at.ws.forEach((sp, i) => penReveal(sp, t, S.s1atW[i], 0.02, 0.14, 0.3))
    // disclaimer
    O(S.disc, E.inOutSine(seg(t, 22.0, 22.2)))
    // CTA button
    const bOn = t >= 25.0
    vis(S.btn, bOn)
    if (bOn) {
      const fall = seg(t, 25.0, 25.12)
      const y = -60 * (1 - E.inQuad(fall))
      let sy = 1, sx = 1
      if (t >= 25.12) { sy = kf(t, [[25.12, 0.92], [25.2, 1.03, E.outQuad], [25.28, 1, E.inOutSine]]); sx = 1 + (1 - sy) * 0.5 }
      const press = t >= 26.0 ? lerp(0.95, 1, E.outQuad(seg(t, 26.0, 26.12))) : 1
      T(S.btn, `translateY(${y.toFixed(2)}px) scale(${(sx * press).toFixed(4)}, ${(sy * press).toFixed(4)})`)
      O(S.btn, E.outQuad(seg(t, 25.0, 25.05)))
      const tr = seg(t, 25.5, 26.0)
      const oOn = t >= 25.5
      vis(S.outSvg, oOn)
      if (oOn) {
        draw(S.outLine, S.outLen, E.inOutSine(tr))
        let pulse = 1
        if (t >= 26.0) { const ph2 = ((t - 26.0) % 0.5) / 0.5; pulse = 0.35 + 0.65 * Math.exp(-ph2 * 4.2) }
        O(S.outLine, pulse)
        draw(S.outGlow, S.outLen, E.inOutSine(tr)); O(S.outGlow, 0.35 * pulse)
      }
    }
  }

  // ---------------------------------------------------------- FX: flash, vignette, grain
  function buildFx() {
    S.vig = div(fxRoot, { width: 1080, height: VH, background: 'radial-gradient(115% 85% at 50% 46%, rgba(0,0,0,0) 58%, rgba(10,26,46,0.20) 100%)', willChange: 'opacity' })
    // grain: one oversized static tile layer, moved by whole pixels on the compositor (no per-frame repaint)
    S.grainWrap = div(fxRoot, { width: 1080, height: VH, willChange: 'opacity' }, 'clip')
    S.grain = div(S.grainWrap, { left: -256, top: -256, width: 1080 + 512, height: VH + 512, backgroundImage: `url(${S.grainTiles[0]})`, willChange: 'transform' })
    S.flash = div(fxRoot, { width: 1080, height: VH, background: '#fff', willChange: 'opacity' })
    if (GUIDES) {
      const g = div(fxRoot, { left: 80, top: 290 - OFF, width: 860, height: 1205, border: '2px dashed rgba(255,0,255,0.8)', boxSizing: 'border-box' })
      div(fxRoot, { left: 0, top: 220 - OFF, width: 1080, height: 2, background: 'rgba(0,200,255,0.8)' })
      div(fxRoot, { left: 0, top: 1500 - OFF, width: 1080, height: 2, background: 'rgba(0,200,255,0.8)' })
    }
  }
  function renderFx(t) {
    let f = 0
    if (t >= 7.9 && t < 8.1) f = t < 8.0 - 1e-6 ? lerp(0.22, 0.86, clamp((t - 7.9) / (2 * FR))) : 0.92 * Math.pow(1 - seg(t, 8.0, 8.1), 1.5)
    if (t >= 22.0 && t < 22.0 + 2 * FR - 1e-6) f = t < 22.0 + FR - 1e-6 ? 0.9 : 0.45
    vis(S.flash, f > 0.001)
    O(S.flash, f)
    // grain: stronger on photo scenes
    const photo = t < 8.0 || (t >= 10.5 && t < 13.2) || t >= 29.5
    // grain re-seeds every 2 frames (film-like 15 fps grain, also friendlier to the encoder)
    const f_ = GRAIN_MODE === 'static' ? 0 : Math.floor(fr(t) / 2)
    T(S.grain, `translate(${(f_ * 73) % 256}px, ${(f_ * 151) % 256}px)`)
    O(S.grainWrap, GRAIN * (photo ? 0.05 : 0.028))
    O(S.vig, t < 2.75 || t >= 29.5 ? 0.0 : t < 8.0 ? 0.45 : 0.4)
  }

  // =================================================================== boot
  function renderFrame(t) {
    t = Math.max(0, Math.min(29.9999, +t || 0))
    renderTable(t)
    renderReveal(t)
    renderCompare(t)
    renderBooklet(t)
    renderBug(t)
    renderBuild(t)
    renderRed(t)
    renderEnd(t)
    renderSplit(t)
    renderFx(t)
  }

  async function loadJSON(u) { try { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) return null; return await r.json() } catch (e) { return null } }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.decoding = 'sync'; im.onload = () => im.decode().then(() => res(im), () => res(im)); im.onerror = () => rej(new Error('img ' + src)); im.src = src }) }

  window.adMeta = () => ({ duration: 30, variant: V45 ? '4x5' : '9x16', width: 1080, height: VH })
  window.adReady = (async () => {
    // ?novo=1 simulates a missing VO timeline (falls back to storyboard vo[].start + measured durations)
    const [sb, tl] = await Promise.all([loadJSON('/storyboard.json'), Q.has('novo') ? null : loadJSON('/src/data/vo_timeline.json')])
    if (sb && sb.palette) C = Object.assign(C, sb.palette)
    setupVO(sb || { vo: [] }, tl)
    const fontSpecs = [fcss(FAM.slam, 104), fcss(FAM.label, 52), fcss(FAM.stat, 62), fcss(FAM.serif, 80, 700, 'italic'), fcss(FAM.serif, 150, 900, 'italic'), fcss(FAM.hand, 72), fcss(FAM.marker, 64), fcss(FAM.body, 44, 800), fcss(FAM.body, 24, 600)]
    await Promise.all(fontSpecs.map(f => document.fonts.load(f, 'AaBb 0123456789 à×–…·“”')))
    await document.fonts.ready
    await Promise.all(Object.entries(SRC).map(async ([k, s]) => { IMG[k] = await loadImg(s) }))
    // pre-rendered plates / sprites
    S.plate14 = cloudPlate(IMG.balcony, V45 ? 650 : 900, 14)
    S.plate6 = cloudPlate(IMG.balcony, V45 ? 650 : 900, 6)
    makeSprites()
    S.grainTiles = [1, 2, 3, 4].map(s => noiseTile(s))
    buildTable(); buildReveal(); buildCompare(); buildBooklet(); buildBuild(); buildRed(); buildHours(); buildBug(); buildEnd(); buildSplit(); buildFx()
    stage.appendChild(S.bug.e) // URL pill stays above the end card (22.0-25.12)
    prepBrickify()
    await Promise.all(domImgs.map(im => (im.complete && im.naturalWidth ? im.decode().catch(() => {}) : new Promise(r => { im.onload = () => im.decode().then(r, r); im.onerror = r }))))
    renderFrame(0)
    return true
  })()
  window.renderFrame = renderFrame
})()
