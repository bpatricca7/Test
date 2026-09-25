"""Lay out the instruction booklet (HTML) and print it to PDF.

Usage:   python3 lego-kit/make_booklet.py <project folder>
Inputs:  <project>/build/manifest.json   (from render.py)
         <project>/data/elements.csv     (LEGO element IDs / BrickLink mapping)
         PROJECT texts in <project>/design.py
Output:  <project>/instructions/<pdf_name>, <project>/build/booklet.html
"""
import csv
import html
import json
import os
import subprocess
import sys
from collections import Counter, OrderedDict

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects
from bricks import PARTS, COLOR_NAMES, SubRef

ROOT = BUILD = IMG = None          # set by setup() for the project being laid out


def setup(proj):
    global ROOT, BUILD, IMG
    ROOT, BUILD = proj.root, proj.build_dir
    IMG = os.path.join(BUILD, "booklet_img")

PX2IN = 0.0036           # part render pixels -> inches in callouts
CAP_IN_PER_LDU = 0.02    # never draw models larger than this (1 stud = 0.4 in)
FULL_ART = (10.0, 6.1)   # art box of a full-page step, inches
HALF_ART = (4.65, 5.8)   # art box of a half-page step
DAT_NAMES = {p.dat: p.name for p in PARTS.values()}
COLOR_HEX = {15: "#F4F4F4", 0: "#1B2A34", 72: "#6C6E68", 71: "#A0A5A9", 4: "#C91A09",
             2: "#237841", 288: "#184632", 19: "#E4CD9E", 70: "#582A12", 1: "#0055BF",
             28: "#958A73", 10: "#4B9F4A", 5: "#C870A0", 26: "#923978", 29: "#E4ADC8",
             308: "#352100", 47: "#FCFCFC", 46: "#F5CD2F", 31: "#CDA4DE", 30: "#AC78BA",
             25: "#FE8A18", 14: "#F2CD37", 320: "#720E0F",
             226: "#FFF03A", 297: "#AA7F2E"}


def e(s):
    return html.escape(str(s))


# --------------------------------------------------------------------------
def load_elements():
    path = os.path.join(ROOT, "data", "elements.csv")
    db = {}
    if os.path.exists(path):
        with open(path, newline="") as fh:
            for r in csv.DictReader(fh):
                db[(r["ldraw_part"], int(r["ldraw_color"]))] = r
    return db


def prep_image(rel, max_px=1300, jpeg=True):
    """Copy a render into the booklet image folder, flattened and resized."""
    src = os.path.join(BUILD, rel)
    name = rel.replace("/", "_").replace("renders_", "")
    im = Image.open(src).convert("RGBA")
    if max(im.size) > max_px:
        f = max_px / max(im.size)
        im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
    os.makedirs(IMG, exist_ok=True)
    if jpeg:
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[3])
        name = os.path.splitext(name)[0] + ".jpg"
        bg.save(os.path.join(IMG, name), quality=82, optimize=True, progressive=True)
    else:
        name = os.path.splitext(name)[0] + ".png"
        im.save(os.path.join(IMG, name), optimize=True)
    return "booklet_img/" + name, im.size


# --------------------------------------------------------------------------
class Booklet:
    def __init__(self, man, elements):
        self.man = man
        self.el = elements
        self.pages = []
        self.step_no = 0
        self.part_img = {}
        for key, p in man["parts"].items():
            rel, size = prep_image(p["image"], max_px=900, jpeg=False)
            self.part_img[key] = (rel, size)
        self.sub_img = {}
        for name, m in man["models"].items():
            self.sub_img[name] = prep_image(m["image"], max_px=1400)

    # -- building blocks ---------------------------------------------------
    def part_fig(self, key, qty, show_id=False):
        rel, (w, h) = self.part_img[key]
        p = self.man["parts"][key]
        wi, hi = w * PX2IN * 900 / max(900, 1), h * PX2IN
        wi = w * PX2IN
        cap = f"{qty}x"
        extra = ""
        if show_id:
            info = self.el.get((p["dat"], p["color"]), {})
            extra = f'<div class="eid">{e(info.get("element_id") or "—")}</div>'
        return (f'<figure class="pf"><img src="{rel}" style="width:{wi:.2f}in">'
                f'<figcaption>{cap}</figcaption>{extra}</figure>')

    def callout(self, parts, subs):
        figs = []
        for s in subs:
            rel, (w, h) = self.sub_img[s["model"]]
            hi = 1.35
            figs.append(f'<figure class="sf"><img src="{rel}" style="height:{hi}in">'
                        f'<figcaption>{s["qty"]}x</figcaption></figure>')
        for p in parts:
            figs.append(self.part_fig(p["key"], p["qty"]))
        if not figs:
            return ""
        return f'<div class="callout">{"".join(figs)}</div>'

    def cell(self, st, model_name, width_in):
        self.step_no += 1
        rel, size = prep_image(st["image"], max_px=1300)
        call = self.callout(st["parts"], st["subs"])
        n = st.get("note") or ""
        foot = f'<div class="note">{e(n)}</div>' if n else ""
        return (f'<div class="cell"><div class="head"><div class="num">{self.step_no}</div>'
                f'{call}</div><div class="art"><img src="{rel}" style="width:{width_in:.2f}in">'
                f'</div>{foot}</div>')

    # scale (inches per rendered pixel) for a step drawn in a given art box
    def fit(self, st, box):
        w, h = self.man["sizes"][st["image"]]
        return min(box[0] / w, box[1] / h, CAP_IN_PER_LDU / st["px_per_ldu"])

    def page(self, inner, cls="", header=None):
        self.pages.append((cls, header, inner))

    # -- sections ------------------------------------------------------------
    def section_intro(self, number, title, blurb, image, parts_counter, mult=1, sub=None):
        figs = []
        for key, qty in sorted(parts_counter.items(),
                               key=lambda kv: (self.man["parts"][kv[0]]["color_name"], kv[0])):
            figs.append(self.part_fig(key, qty))
        total = sum(parts_counter.values())
        mult_badge = f'<div class="mult">Build {mult}</div>' if mult > 1 else ""
        img_html = ""
        if image:
            img_html = f'<div class="hero"><img src="{image[0]}"></div>'
        inner = (f'<div class="sec"><div class="sec-left"><div class="sec-num">{number}</div>'
                 f'<h1>{e(title)}</h1><p>{e(blurb)}</p>{mult_badge}'
                 f'<div class="sec-count">{total} elements in this section'
                 f'{" (all copies)" if mult > 1 else ""}</div>{img_html}</div>'
                 f'<div class="sec-right"><h3>Parts for this section</h3>'
                 f'<div class="inv">{"".join(figs)}</div></div></div>')
        self.page(inner, "section")

    def is_half(self, st, scale=None):
        """Does this step fit in half a page?"""
        w, h = self.man["sizes"][st["image"]]
        if len(st["parts"]) + len(st["subs"]) > 7:
            return False
        if scale is not None:
            return w * scale <= HALF_ART[0] + 0.01 and h * scale <= HALF_ART[1] + 0.01
        return (w / h) < 1.15

    def steps_pages(self, steps, model_name, header, mult=1):
        """Pack steps: two per page when they fit in half a page.

        Steps of a submodel share one scale so the building does not jump in
        size from step to step.
        """
        shared = None
        if steps and steps[0].get("fixed_camera"):
            shared = min(self.fit(st, HALF_ART if self.is_half(st) else FULL_ART)
                         for st in steps)
        pending = []

        def flush():
            if pending:
                self._emit(list(pending), header, mult, shared)
                pending.clear()

        for st in steps:
            if self.is_half(st, shared):
                pending.append(st)
                if len(pending) == 2:
                    flush()
            else:
                flush()
                pending.append(st)
                flush()
        flush()

    def _emit(self, sts, header, mult, shared):
        cells = []
        for st in sts:
            box = HALF_ART if len(sts) == 2 or self.is_half(st, shared) else FULL_ART
            s = shared if shared is not None else self.fit(st, box)
            w, _ = self.man["sizes"][st["image"]]
            cells.append(self.cell(st, None, w * s))
        cls = "steps two" if len(sts) == 2 else "steps"
        badge = f"Build {mult}" if mult > 1 else None
        self.page("".join(cells), cls, header=(header, badge))

    # -- final pages ------------------------------------------------------------
    def inventory_pages(self):
        items = list(self.man["parts"].items())
        items.sort(key=lambda kv: (kv[1]["color_name"], DAT_NAMES[kv[1]["dat"]]))
        per = 30
        for i in range(0, len(items), per):
            chunk = items[i:i + per]
            cells = []
            for key, p in chunk:
                info = self.el.get((p["dat"], p["color"]), {})
                rel, (w, h) = self.part_img[key]
                cells.append(
                    f'<div class="ic"><div class="ii"><img src="{rel}" style="max-width:{min(w * PX2IN, 1.25):.2f}in"></div>'
                    f'<div class="iq">{p["qty"]}x</div>'
                    f'<div class="iid">{e(info.get("element_id") or "see list")}</div>'
                    f'<div class="in">{e(p["name"])}<br><span class="sw" style="background:{COLOR_HEX[p["color"]]}"></span>'
                    f'{e(info.get("lego_color") or p["color_name"])}</div></div>')
            head = ("Parts inventory" + (" (continued)" if i else ""))
            self.page(f'<h2 class="ph">{head}</h2><div class="invgrid">{"".join(cells)}</div>',
                      "inventory")


# --------------------------------------------------------------------------
CSS = r"""
@page { size: 11in 8.5in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', 'DejaVu Sans', sans-serif; color: #1c2430; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 11in; height: 8.5in; position: relative; overflow: hidden; page-break-after: always; background: #fff; }
.pageinner { position: absolute; inset: 0.3in 0.35in 0.45in 0.35in; }
.pno { position: absolute; bottom: 0.14in; font-size: 11pt; font-weight: 700; color: #fff; background: #1f5f99; padding: 3px 10px; border-radius: 10px; }
.pno.l { left: 0.3in; } .pno.r { right: 0.3in; }
.runhead { position: absolute; bottom: 0.16in; left: 50%; transform: translateX(-50%); font-size: 8.5pt; color: #7a8594; letter-spacing: .04em; text-transform: uppercase; }
.badge { position: absolute; top: 0.18in; right: 0.3in; background: #ffcf00; color: #1c2430; font-weight: 800; padding: 4px 12px; border-radius: 8px; font-size: 12pt; }

/* steps */
.steps .pageinner { display: flex; gap: 0.25in; }
.cell { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.steps.two .cell + .cell { border-left: 1.5px solid #dfe6ee; padding-left: 0.25in; }
.head { display: flex; align-items: flex-start; gap: 0.18in; }
.num { font-size: 40pt; font-weight: 800; line-height: 0.95; color: #1c2430; min-width: 0.7in; }
.callout { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.08in 0.16in; background: #e3eef9; border: 1.5px solid #b9d1ea; border-radius: 10px; padding: 0.08in 0.14in; max-width: 100%; }
.pf, .sf { margin: 0; display: flex; flex-direction: column; align-items: center; }
.pf img, .sf img { display: block; }
.pf figcaption, .sf figcaption { font-weight: 700; font-size: 11pt; margin-top: 2px; }
.sf { background: #fff; border-radius: 8px; padding: 4px 8px; border: 1px solid #b9d1ea; }
.art { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding-top: 0.08in; }
.art img { max-width: 100%; max-height: 100%; height: auto; object-fit: contain; }
.note { font-size: 10.5pt; color: #3d4a5a; background: #fff7d6; border-left: 4px solid #ffcf00; padding: 5px 10px; border-radius: 4px; align-self: flex-start; }

/* section intro */
.section .pageinner { background: linear-gradient(180deg, #eaf3fb 0%, #ffffff 70%); border-radius: 16px; padding: 0.3in; }
.sec { display: flex; gap: 0.35in; height: 100%; }
.sec-left { flex: 1.05; display: flex; flex-direction: column; min-width: 0; }
.sec-right { flex: 1; min-width: 0; overflow: hidden; }
.sec-num { width: 0.7in; height: 0.7in; border-radius: 50%; background: #1f5f99; color: #fff; font-weight: 800; font-size: 26pt; display: flex; align-items: center; justify-content: center; }
.sec h1 { font-size: 26pt; margin: 0.14in 0 0.06in; letter-spacing: -0.01em; }
.sec p { font-size: 12pt; line-height: 1.4; margin: 0 0 0.1in; color: #3d4a5a; max-width: 4.6in; }
.mult { align-self: flex-start; background: #ffcf00; font-weight: 800; font-size: 14pt; padding: 4px 14px; border-radius: 8px; margin-bottom: 0.08in; }
.sec-count { font-size: 10pt; color: #6b7684; }
.hero { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.hero img { max-width: 100%; max-height: 100%; object-fit: contain; }
.sec-right h3 { margin: 0 0 0.08in; font-size: 12pt; color: #1f5f99; text-transform: uppercase; letter-spacing: .05em; }
.inv { display: flex; flex-wrap: wrap; gap: 0.08in 0.14in; align-items: flex-end; }
.inv .pf img { max-width: 1.2in; }

/* inventory */
.ph { font-size: 20pt; margin: 0 0 0.12in; }
.invgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.07in; }
.ic { border: 1px solid #dfe6ee; border-radius: 8px; padding: 0.05in; height: 1.15in; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; font-size: 7.5pt; text-align: center; }
.ii { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
.ii img { max-height: 0.52in; }
.iq { font-weight: 800; font-size: 10.5pt; }
.iid { font-weight: 700; font-size: 8.5pt; color: #1f5f99; }
.in { color: #4b5563; line-height: 1.2; }
.sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; border: 1px solid #999; margin-right: 3px; vertical-align: middle; }

/* cover */
.cover { background: linear-gradient(180deg, #9cc3e6 0%, #d8e8f5 45%, #f5f8fb 70%); }
.cover .title { position: absolute; left: 0.55in; top: 0.45in; }
.cover .kicker { font-size: 12pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #1f5f99; }
.cover h1 { font-size: 52pt; margin: 0.04in 0 0; letter-spacing: -0.02em; color: #14304d; font-weight: 800; }
.cover .sub { font-size: 15pt; color: #2d4660; margin-top: 0.04in; }
.cover .heroimg { position: absolute; left: 0.3in; right: 0.3in; top: 1.75in; bottom: 0.75in; display: flex; justify-content: center; align-items: center; }
.cover .heroimg img { max-width: 100%; max-height: 100%; }
.cover .stats { position: absolute; right: 0.55in; top: 0.55in; text-align: right; }
.cover .stat { font-size: 11pt; color: #2d4660; } .cover .stat b { font-size: 22pt; color: #14304d; display: block; line-height: 1; }
.cover .fine { position: absolute; left: 0.55in; right: 0.55in; bottom: 0.25in; font-size: 7.5pt; color: #5b6b7c; }
.cover .agebadge { position: absolute; left: 0.55in; bottom: 0.6in; background: #14304d; color: #fff; font-weight: 800; padding: 6px 14px; border-radius: 8px; font-size: 12pt; }

/* text pages */
.text .pageinner { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35in; }
.text h2 { font-size: 18pt; margin: 0 0 0.08in; color: #14304d; }
.text h3 { font-size: 12pt; margin: 0.14in 0 0.04in; color: #1f5f99; }
.text p, .text li { font-size: 10pt; line-height: 1.45; color: #2f3b4a; }
.text ul, .text ol { padding-left: 0.2in; margin: 0.04in 0; }
.text table { border-collapse: collapse; font-size: 9pt; width: 100%; }
.text td, .text th { border-bottom: 1px solid #e3e8ee; padding: 3px 4px; text-align: left; }
.legend { display: flex; gap: 0.15in; align-items: center; background: #f3f7fb; border-radius: 10px; padding: 0.1in; }
.legend img { height: 1.4in; }
.gallery .pageinner { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 0.15in; }
.gallery .g { display: flex; align-items: center; justify-content: center; background: #f5f8fb; border-radius: 12px; overflow: hidden; }
.gallery .g img { max-width: 100%; max-height: 100%; }
.gallery .g.wide { grid-column: span 2; }
"""


def render_html(bk, title):
    out = [f"<!doctype html><html><head><meta charset='utf-8'><title>{e(title)}</title>"
           f"<style>{CSS}</style></head><body>"]
    for i, (cls, header, inner) in enumerate(bk.pages, start=1):
        pno = ""
        run = ""
        badge = ""
        if "cover" not in cls:
            side = "r" if i % 2 else "l"
            pno = f'<div class="pno {side}">{i}</div>'
            if header and header[0]:
                run = f'<div class="runhead">{e(header[0])}</div>'
            if header and header[1]:
                badge = f'<div class="badge">{e(header[1])}</div>'
            inner = f'<div class="pageinner">{inner}</div>'
        out.append(f'<div class="page {cls}">{inner}{pno}{run}{badge}</div>')
    out.append("</body></html>")
    return "\n".join(out)


def model_parts(models_by_name, name, steps=None, mult=1):
    m = models_by_name[name]
    c = Counter()
    for it in m.items:
        if steps is not None and it.step not in steps:
            continue
        if isinstance(it, SubRef):
            continue
        c[f"{PARTS[it.key].dat[:-4]}_{it.color}"] += mult
    return c


def build(proj, man, elements):
    P = proj.meta
    main_m, models, _ = proj.build(verbose=False)
    main_name = main_m.name
    by_name = {m.name: m for m in models}
    bk = Booklet(man, elements)
    total = sum(p["qty"] for p in man["parts"].values())
    n_colors = len({p["color"] for p in man["parts"].values()})

    # ---------------- cover ----------------
    hero, _ = prep_image(f"renders/final/{P['cover_view']}.png", max_px=2200, jpeg=False)
    big, small = P["cover_stats"]
    bk.page(f"""
      <div class="title"><div class="kicker">Build instructions</div>
        <h1>{P['title']}</h1>
        <div class="sub">{P['subtitle']}</div></div>
      <div class="stats"><div class="stat"><b>{total:,}</b>pieces</div>
        <div class="stat" style="margin-top:8px"><b>{big}</b>{small}</div></div>
      <div class="heroimg"><img src="{hero}"></div>
      <div class="agebadge">{P['badge']}</div>
      <div class="fine">{P['fine_print']}</div>""", "cover")

    # ---------------- intro ----------------
    lg_model, lg_step = P["legend"]
    legend_img, _ = prep_image(man["models"][lg_model]["steps"][lg_step]["image"], max_px=600)
    facts = "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in P["facts"])
    org = "".join(f"<li>{x}</li>" for x in P["organisation"])
    tips = "".join(f"<li>{x}</li>" for x in P["tips"])
    bk.page(f"""
      <div>
        <h2>About this model</h2>
        <p>{P['about']}</p>
        <table>
          <tr><th>Pieces</th><td>{total:,} elements, {len(man['parts'])} kinds, {n_colors} colours</td></tr>
          {facts}
          <tr><th>Model files</th><td><code>{P['model_name']}.mpd</code> (LDraw). Opens in BrickLink Studio, LeoCAD and LDCad.</td></tr>
        </table>
        <h3>How the build is organised</h3>
        <ol>{org}</ol>
        <p>{P['organisation_note']}</p>
      </div>
      <div>
        <h2>Reading the steps</h2>
        <div class="legend"><img src="{legend_img}"><p>Parts added in each step are
        <b style="color:#e07b00">outlined in orange</b>. The blue box shows the parts for that
        step and how many of each you need. Part pictures are drawn to scale; plates longer
        than 8 studs are drawn at half size.</p></div>
        <h3>Tips</h3>
        <ul>{tips}</ul>
        <h3>Getting the parts</h3>
        <p>Every element is listed with its LEGO Element ID in the inventory at the back, and in
        <code>parts/</code> as CSV and BrickLink XML files. See &ldquo;Ordering the parts&rdquo; on
        the last pages.</p>
      </div>""", "text")

    # ---------------- sections and steps ----------------
    main_steps = man["models"][main_name]["steps"]
    built = set()
    sec_no = 0
    main_sections = main_m.sections
    sec_bounds = sorted(main_sections)
    header = None

    def main_range(start):
        later = [s for s in sec_bounds if s > start]
        end = later[0] if later else 10 ** 6
        return set(range(start, end))

    def section_image(title):
        for prefix, view in P["section_images"].items():
            if title.startswith(prefix):
                return prep_image(f"renders/final/{view}.png", max_px=1400)
        return prep_image(f"renders/final/{P['section_image_default']}.png", max_px=1400)

    buffer = []

    def flush():
        if buffer:
            bk.steps_pages(list(buffer), main_name, header)
            buffer.clear()

    for st in main_steps:
        s = st["step"]
        if s in main_sections:
            flush()
            sec_no += 1
            title, blurb = main_sections[s]
            rng = main_range(s)
            counter = model_parts(by_name, main_name, rng)
            # small submodels placed in this section are listed here too
            for st2 in main_steps:
                if st2["step"] in rng:
                    for sub in st2["subs"]:
                        if len(by_name[sub["model"]].steps()) <= 3:
                            counter.update(model_parts(by_name, sub["model"], mult=sub["qty"]))
            bk.section_intro(sec_no, title, blurb, section_image(title), counter)
            header = title
        for sub in st["subs"]:
            name = sub["model"]
            if name in built:
                continue
            built.add(name)
            flush()
            sm = man["models"][name]
            mult = sub["qty"]
            if len(sm["steps"]) > 3:
                sec_no += 1
                title, blurb = P["sub_info"][name]
                bk.section_intro(sec_no, title, blurb, bk.sub_img[name],
                                 model_parts(by_name, name, mult=mult), mult=mult)
                header = title
            bk.steps_pages(sm["steps"], name, header, mult=mult)
        buffer.append(st)
    flush()

    # ---------------- gallery ----------------
    g = [prep_image(f"renders/final/{n}.png", max_px=1600)[0] for n in P["gallery"]]
    bk.page("".join(f'<div class="g"><img src="{x}"></div>' for x in g),
            "gallery", header=("The finished model", None))

    bk.inventory_pages()
    ordering_pages(bk, man, elements, P)
    return bk


def ordering_pages(bk, man, el, P):
    priced, cost = 0, 0.0
    for p in man["parts"].values():
        info = el.get((p["dat"], p["color"]), {})
        v = info.get("pab_price_2025") or info.get("pab_price_2022")
        if v:
            priced += p["qty"]
            cost += p["qty"] * float(v)
    items = sorted(man["parts"].values(), key=lambda p: (p["color_name"], DAT_NAMES[p["dat"]]))
    missing = [p for p in items if not el.get((p["dat"], p["color"]), {}).get("element_id")]
    bk.page(f"""
      <div>
        <h2>Ordering the parts</h2>
        <h3>1 &middot; LEGO Pick a Brick (lego.com)</h3>
        <ol>
          <li>Go to <b>lego.com &rarr; Pick and Build &rarr; Pick a Brick</b> and choose <b>Upload list</b>.</li>
          <li>Upload <code>parts/pick_a_brick_upload.csv</code>. It lists all {len(man['parts'])} kinds of element by Element ID
          with their quantities, and fills your bag in one go.</li>
          <li>If anything isn't matched, upload <code>pick_a_brick_upload_retry.csv</code>. It has LEGO's newer
          IDs for the same parts; many white parts got new IDs in 2025. Or search the inventory's design number and colour.</li>
          <li>Bestseller elements can be ordered up to 999 at a time. Many Standard elements are limited to 10 per order.
          {P.get("order_cap_note", "")}</li>
        </ol>
        <h3>2 &middot; BrickLink or Rebrickable (backup)</h3>
        <p>The files in <code>parts/</code> cover anything Pick a Brick does not stock:</p>
        <ul>
          <li><code>bricklink_wanted_list.xml</code>: BrickLink &rarr; Want &rarr; Upload.</li>
          <li><code>rebrickable_parts.csv</code>: import it as a Rebrickable part list, then compare stores.</li>
          <li><code>pick_a_brick_mapping.csv</code>: how each part maps to Pick a Brick, with the evidence, the last price seen and a BrickLink backup.</li>
        </ul>
        <h3>What it costs</h3>
        <p>At Pick a Brick prices seen in 2022&ndash;2025, the {priced:,} elements with a known price
        come to about <b>US${cost:.0f}</b>, plus shipping. LEGO raised prices on about a third of
        Pick a Brick elements in 2026, so expect to pay more. The bag total after uploading shows the current price.</p>
        <p>Order a few spare 1&times;1 bricks and plates, because small parts go missing easily.</p>
      </div>
      <div>
        <h2>Substitutions</h2>
        <ul>{"".join(f"<li>{x}</li>" for x in P["substitutions"])}</ul>
        <h3>Colour names</h3>
        <table>
          <tr><th>In this booklet</th><th>LEGO name</th><th>BrickLink</th></tr>
          {"".join(f"<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>" for a, b, c in P["colour_rows"])}
        </table>
      </div>""", "text", header=("Ordering the parts", None))


def print_pdf(html_path, pdf_path):
    js = f"""
const {{ chromium }} = require('playwright');
(async () => {{
  const b = await chromium.launch({{ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }});
  const p = await b.newPage();
  await p.goto('file://{html_path}', {{ waitUntil: 'load' }});
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({{ path: '{pdf_path}', width: '11in', height: '8.5in', printBackground: true }});
  await b.close();
}})();
"""
    env = dict(os.environ, NODE_PATH="/opt/node22/lib/node_modules")
    subprocess.run(["node", "-e", js], check=True, env=env)


def main(proj):
    setup(proj)
    with open(os.path.join(BUILD, "manifest.json")) as fh:
        man = json.load(fh)
    el = load_elements()
    bk = build(proj, man, el)
    html_s = render_html(bk, f"{proj.meta['title']} - Build instructions")
    hp = os.path.join(BUILD, "booklet.html")
    with open(hp, "w") as fh:
        fh.write(html_s)
    os.makedirs(proj.instr_dir, exist_ok=True)
    pdf = os.path.join(proj.instr_dir, proj.meta["pdf_name"])
    print_pdf(hp, pdf)
    print(f"{len(bk.pages)} pages, {bk.step_no} steps -> {pdf} "
          f"({os.path.getsize(pdf) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(projects.load(sys.argv))
