"""Design of the Riviera Resort display model (micro scale, about 1:250).

Build with the shared kit:  ./build.sh   (or python3 ../lego-kit/render.py . etc.)

Scale: 1 stud = 2 m of building, 1 plate = 0.8 m, one storey = 4 plates.
Footprint 48 x 32 studs (38 x 26 cm); the domes reach 49 plates (16 cm).
"""
from bricks import (Model, PARTS, row, fill_rect, fill_cells, place_rect,
                    rot_matrix, FACE,
                    WHITE, BLACK, DBG, LBG, RED, GREEN, DKGREEN, TAN, RBROWN, BLUE)

PROJECT = dict(
    model_name="riviera_resort",
    pdf_name="Riviera_Resort_Instructions.pdf",
    title="Riviera Resort",
    subtitle="A micro-scale display model in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC), inspired by Disney's Riviera Resort "
                "at Walt Disney World. It is not affiliated with, sponsored or endorsed by The "
                "LEGO Group or Disney. LEGO&reg; is a trademark of The LEGO Group."),
    about=("This model shows the grand entrance of the Riviera Resort: the arched porte-cochere, "
           "the mansard-roofed central pavilion with its oval dormers, two domed corner "
           "pavilions, and the guest wings with red awnings, all set in a lawn lined with palms."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), 16 cm tall at the domes"),
           ("Scale", "about 1:250 (one storey = 4 plates)"),
           ("Build time", "about 6 to 8 hours")],
    organisation=["The grounds: base, drive, lawn and hedges", "The central pavilion",
                  "The domed pavilions (build 2)", "The guest wings (build 2)",
                  "The porte-cochere", "Palms, flowers and flags"],
    organisation_note=("Each building is built on its own and then set on the base. Every "
                       "section starts with a list of the parts it needs, so you can sort "
                       "them before you start."),
    tips=["The facades use a lot of 1&times;1 bricks: 1 black brick for every window and 1 "
          "white brick for every pillar between windows. Keep black and white in separate trays.",
          "Each floor is one course of bricks topped with a band of white plates. Check the "
          "window pattern against the picture before you add the band.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice. Build both "
          "at the same time, one step at a time.",
          "Push the palms and flags down firmly. The flags clip onto the black bars."],
    legend=("palm.ldr", 1),
    sub_info={
        "central.ldr": ("The central pavilion",
                        "Eight storeys of French-style windows under a steep mansard "
                        "roof with oval dormers. The top floor has the red awnings."),
        "tower.ldr": ("The domed pavilions",
                      "Two identical ten-storey pavilions flank the centre. Each is topped "
                      "by a grey dome and a lantern."),
        "wing.ldr": ("The guest wings",
                     "Two identical eight-storey wings. Their top floor also has red awnings."),
        "palm.ldr": ("Palm tree", ""),
    },
    section_images={"The porte": "cover_front", "The grounds": "cover_high"},
    section_image_default="cover_front_left",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 12, 0), ("cover_high", 50, 20), ("back", 26, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. You can swap in any plates that cover "
        "48&times;32 studs, or a 48&times;48 grey baseplate.",
        "<b>Lawn:</b> any green plates. Keep the joints away from the joints in the base "
        "plates below.",
        "<b>Hidden plates:</b> the plates inside the buildings can be any colour.",
        "<b>Flags:</b> any colour. The current 2&times;2 flag (design 80326) wasn't on the "
        "Pick a Brick listings checked; BrickLink has it."],
    order_cap_note="Every element this model needs more than 10 of was in the Bestseller range.",
    colour_rows=[("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Dark Green", "Earth Green", "Dark Green"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Red / Blue", "Bright Red / Bright Blue", "Red / Blue")],
)

WALL = WHITE
WINDOW = BLACK
PLINTH = LBG
ROOF = DBG


# --------------------------------------------------------------------------
# Wall helpers
# --------------------------------------------------------------------------
def pattern_row(m, x0, z0, pattern, layer, axis="x"):
    """One brick course along a wall following a facade pattern.

    P = wall (white), W = single window (black 1x1), D = paired window cell
    (two D's become one black 1x2), . = leave empty.  Runs of P are merged
    into the longest available white bricks.
    """
    i = 0
    n = len(pattern)
    while i < n:
        c = pattern[i]
        j = i
        while j < n and pattern[j] == c:
            j += 1
        run = j - i
        pos = (x0 + i, z0) if axis == "x" else (x0, z0 + i)
        if c == "P":
            row(m, "b", WALL, pos[0], pos[1], run, layer, axis=axis)
        elif c == "W":
            for k in range(run):
                p = (pos[0] + k, pos[1]) if axis == "x" else (pos[0], pos[1] + k)
                m.add("b1x1", WINDOW, p[0], p[1], layer)
        elif c == "D":
            assert run % 2 == 0, pattern
            for k in range(0, run, 2):
                if axis == "x":
                    m.add("b1x2", WINDOW, pos[0] + k, pos[1], layer)
                else:
                    m.add("b1x2", WINDOW, pos[0], pos[1] + k, layer, rot=90)
        i = j


def course(m, w, d, layer, front, side, back=None):
    """A storey's window course around a w x d rectangle (1-stud walls)."""
    assert len(front) == w and len(side) == d - 2, (front, side)
    back = back or "P" * w
    pattern_row(m, 0, 0, front, layer)
    pattern_row(m, 0, d - 1, back, layer)
    pattern_row(m, 0, 1, side, layer, axis="z")
    pattern_row(m, w - 1, 1, side, layer, axis="z")


class Band:
    """Perimeter floor band; alternates which walls own the corners."""

    def __init__(self, w, d):
        self.w, self.d = w, d
        self.prev = {}

    def lay(self, m, layer, parity, color=WALL):
        w, d = self.w, self.d
        new = {}
        if parity == 0:
            new["f"] = row(m, "p", color, 0, 0, w, layer, avoid=self.prev.get("f", ()))
            new["b"] = row(m, "p", color, 0, d - 1, w, layer, avoid=self.prev.get("b", ()))
            new["l"] = {s + 1 for s in row(m, "p", color, 0, 1, d - 2, layer, axis="z",
                                           avoid={s - 1 for s in self.prev.get("l", ())})}
            new["r"] = {s + 1 for s in row(m, "p", color, w - 1, 1, d - 2, layer, axis="z",
                                           avoid={s - 1 for s in self.prev.get("r", ())})}
        else:
            new["l"] = row(m, "p", color, 0, 0, d, layer, axis="z", avoid=self.prev.get("l", ()))
            new["r"] = row(m, "p", color, w - 1, 0, d, layer, axis="z", avoid=self.prev.get("r", ()))
            new["f"] = {s + 1 for s in row(m, "p", color, 1, 0, w - 2, layer,
                                           avoid={s - 1 for s in self.prev.get("f", ())})}
            new["b"] = {s + 1 for s in row(m, "p", color, 1, d - 1, w - 2, layer,
                                           avoid={s - 1 for s in self.prev.get("b", ())})}
        self.prev = new


def floor_slab(m, w, d, layer, color, along):
    fill_rect(m, "p", color, 0, 0, w, d, layer, along=along)


def storey_layer(f):
    """Bottom layer of storey f's window course (plinth is layer 0)."""
    return 1 + 4 * (f - 1)


def awning_attic(m, w, d, front, layer):
    """Two plates above the top windows: red awnings over front windows."""
    for i, c in enumerate(front):
        if c in "WD":
            m.add("cheese", RED, i, 0, layer, rot=FACE["front"])
        else:
            m.add("p1x1", WALL, i, 0, layer)
            m.add("p1x1", WALL, i, 0, layer + 1)
    band = Band(w, d)
    for k in range(2):
        L = layer + k
        row(m, "p", WALL, 0, d - 1, w, L, avoid=() if k == 0 else {w // 2})
        row(m, "p", WALL, 0, 1, d - 2, L, axis="z", avoid=() if k == 0 else {(d - 2) // 2})
        row(m, "p", WALL, w - 1, 1, d - 2, L, axis="z", avoid=() if k == 0 else {(d - 2) // 2})


def slab_steps(m, w, d, floors, front, side, back=None, ties=(), top_awnings=False):
    """Build `floors` storeys (one step per window course and per floor band).

    Returns the layer on top of the last band.
    """
    band = Band(w, d)
    for f in range(1, floors + 1):
        L = storey_layer(f)
        course(m, w, d, L, front, side, back)
        m.step()
        if f == floors and top_awnings:
            awning_attic(m, w, d, front, L + 3)
            m.step()
            return L + 5
        if f in ties:
            floor_slab(m, w, d, L + 3, WALL, along="x" if f % 2 else "z")
        else:
            band.lay(m, L + 3, f % 2)
        m.step()
    return storey_layer(floors) + 4


# --------------------------------------------------------------------------
# Modules
# --------------------------------------------------------------------------
WING_W, WING_D = 11, 9
WING_FRONT = "PWPWPWPWPWP"
WING_SIDE = "WPWPWPW"


def build_wing():
    m = Model("wing.ldr", "Guest wing (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, WING_W, WING_D, 0, along="z")
    m.step()
    top = slab_steps(m, WING_W, WING_D, 8, WING_FRONT, WING_SIDE, ties=(3, 6),
                     top_awnings=True)
    # roof slab and tiled roof
    fill_rect(m, "p", WALL, 0, 0, WING_W, WING_D, top, along="x")
    m.step()
    fill_rect(m, "t", LBG, 0, 0, WING_W, WING_D, top + 1, along="x")
    m.step()
    m.width, m.depth = WING_W, WING_D
    return m


TOWER_W, TOWER_D = 6, 12
TOWER_FRONT = "PWPPWP"
TOWER_SIDE = "WPW" + "P" * 7


def build_tower():
    m = Model("tower.ldr", "Domed corner pavilion (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, TOWER_W, TOWER_D, 0, along="z")
    m.step()
    top = slab_steps(m, TOWER_W, TOWER_D, 10, TOWER_FRONT, TOWER_SIDE, ties=(3, 6, 10))
    # roof: a square mansard dome over the front 6 x 6, tiles behind it
    dome = {(x, z) for x in range(TOWER_W) for z in range(6)}
    roof = {(x, z) for x in range(TOWER_W) for z in range(TOWER_D)} - dome
    fill_cells(m, "t", LBG, roof, top)
    m.step()
    for x in range(TOWER_W):
        m.add("slope75", ROOF, x, 0, top, rot=FACE["front"])
        m.add("slope75", ROOF, x, 4, top, rot=FACE["back"])
    for z in (2, 3):
        m.add("slope75", ROOF, 0, z, top, rot=FACE["left"])
        m.add("slope75", ROOF, 4, z, top, rot=FACE["right"])
    m.step()
    m.add("p4x4", ROOF, 1, 1, top + 9)
    cap = m.add("dish2", ROOF, 2, 2, top + 10)
    m.step()
    # lantern on the dish's centre stud, half a stud off the grid
    cx, cz = 20 * 3, 20 * 3
    y = -8 * (top + 10 + PARTS["dish2"].height)
    lan = m.add_raw("round1", WHITE, (cx, y - PARTS["round1"].bmax_y, cz), rot_matrix(0),
                    attach_to=cap)
    m.add_raw("cone1", ROOF, (cx, y - 24 - PARTS["cone1"].bmax_y, cz), rot_matrix(0),
              attach_to=lan)
    m.step()
    m.width, m.depth = TOWER_W, TOWER_D
    return m


CEN_W, CEN_D = 12, 11
CEN_FRONT = "PWPWPDDPWPWP"
CEN_SIDE = "P" * (CEN_D - 2)


def build_central():
    m = Model("central.ldr", "Central pavilion")
    fill_rect(m, "p", PLINTH, 0, 0, CEN_W, CEN_D, 0, along="z")
    m.step()
    top = slab_steps(m, CEN_W, CEN_D, 8, CEN_FRONT, CEN_SIDE, ties=(3, 6),
                     top_awnings=True)
    fill_rect(m, "p", WALL, 0, 0, CEN_W, CEN_D, top, along="z")
    m.step()
    L = top + 1
    # --- mansard roof: 75-degree slopes, three bricks tall, with dormers ---
    front = "SDSDS" + "CC" + "SDSDS"
    for x, c in enumerate(front):
        if c == "S":
            m.add("slope75", ROOF, x, 0, L, rot=FACE["front"])
        elif c == "D":
            m.add("b1x2", ROOF, x, 0, L, rot=90)
    m.add("b1x2", BLACK, 5, 0, L)
    m.add("b1x2", ROOF, 5, 1, L)
    m.step()
    for x, c in enumerate(front):
        if c == "D":
            m.add("tech1x1", WHITE, x, 0, L + 3)
            m.add("b1x1", ROOF, x, 1, L + 3)
    m.add("tech1x2", WHITE, 5, 0, L + 3)
    m.add("b1x2", ROOF, 5, 1, L + 3)
    m.step()
    for x, c in enumerate(front):
        if c == "D":
            m.add("slope45", ROOF, x, 0, L + 6, rot=FACE["front"])
    m.add("b1x2", WHITE, 5, 0, L + 6)
    m.add("b1x2", ROOF, 5, 1, L + 6)
    m.step()
    for z in range(2, CEN_D - 2):
        m.add("slope75", ROOF, 0, z, L, rot=FACE["left"])
        m.add("slope75", ROOF, CEN_W - 2, z, L, rot=FACE["right"])
    for x in range(CEN_W):
        m.add("slope75", ROOF, x, CEN_D - 2, L, rot=FACE["back"])
    m.step()
    # --- flat top of the mansard ---
    T = L + 9
    top_cells = {(x, z) for x in range(1, CEN_W - 1) for z in range(1, CEN_D - 1)}
    fill_rect(m, "p", ROOF, 1, 1, CEN_W - 2, CEN_D - 2, T, along="x")
    m.add("p1x2", WHITE, 5, 0, T)
    for x, z in ((0, 1), (CEN_W - 1, 1), (0, CEN_D - 2), (CEN_W - 1, CEN_D - 2)):
        m.add("t1x1", ROOF, x, z, T)
    m.step()
    crest = {(5, 0), (6, 0), (5, 1), (6, 1)}
    fill_cells(m, "t", ROOF, top_cells - crest, T + 1)
    m.add("curve2x1", WHITE, 5, 0, T + 1, rot=FACE["front"])
    m.add("curve2x1", WHITE, 6, 0, T + 1, rot=FACE["front"])
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


def build_palm():
    m = Model("palm.ldr", "Palm tree")
    for k in range(5):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves1", GREEN, 0, 0, 15, rot=0)
    m.add("leaves1", GREEN, 0, 0, 16, rot=180)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# Main model
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
WING_L = (1, 22)
WING_R = (36, 22)
TOWER_L = (12, 19)
TOWER_R = (30, 19)
CENTRAL = (18, 20)


def mirror_x(x, w=1):
    return BASE_W - x - w


def build_main(wing, tower, central, palm):
    m = Model("riviera_resort.ldr", "Riviera Resort - micro-scale display model")
    m.header_notes = [
        "Unofficial fan design inspired by Disney's Riviera Resort; not affiliated with",
        "the LEGO Group or Disney. Generated by design.py (lego-kit).",
        "The 2x2 flags are drawn as 2335 (older mould, same shape). Order the current",
        "version, design 80326 (see parts/pick_a_brick_list.csv).",
    ]

    # ---- base: six 16x16 plates -----------------------------------------
    m.section("The grounds", "Six 16 x 16 plates form the base. The drive, pavements, "
              "lawn and gardens then lock them together.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()

    # ---- ground surface ---------------------------------------------------
    occupied = set()

    def claim(cells):
        cells = set(cells)
        assert not (cells & occupied), sorted(cells & occupied)[:5]
        occupied.update(cells)
        return cells

    rect = lambda x0, z0, w, d: {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}
    modules = (rect(*WING_L, WING_W, WING_D) | rect(*WING_R, WING_W, WING_D) |
               rect(*TOWER_L, TOWER_W, TOWER_D) | rect(*TOWER_R, TOWER_W, TOWER_D) |
               rect(*CENTRAL, CEN_W, CEN_D))
    claim(modules)

    # drive: 1x4 tiles running front-to-back so they bridge the base seam at z=16
    claim(rect(0, 14, BASE_W, 4))
    for x in range(BASE_W):
        place_rect(m, "t", LBG, x, 14, 1, 4, 1)
    m.step()

    # porte-cochere footings (tan plates under the arch legs)
    legs_plates = [((17, 12), (1, 2)), ((20, 12), (2, 1)), ((26, 12), (2, 1)),
                   ((30, 12), (1, 2)), ((17, 18), (1, 1)), ((30, 18), (1, 1))]
    for (x, z), (sx, sz) in legs_plates:
        claim(rect(x, z, sx, sz))
        place_rect(m, "p", TAN, x, z, sx, sz, 1)
    # pavements: tan tiles (runs chosen so tiles bridge the base seams)
    walk = (rect(0, 12, BASE_W, 2) | rect(0, 18, BASE_W, 1) | rect(18, 19, 12, 1)) - occupied
    claim(walk)
    m.step()
    for z in (12, 13, 18):
        row(m, "t", TAN, 0, z, 17, 1, avoid={16})
    m.step()
    for z in (12, 13, 18):
        row(m, "t", TAN, 31, z, 17, 1, avoid={1})
    m.step()
    place_rect(m, "t", TAN, 18, 12, 2, 2, 1)
    place_rect(m, "t", TAN, 22, 12, 2, 2, 1)
    place_rect(m, "t", TAN, 24, 12, 2, 2, 1)
    place_rect(m, "t", TAN, 28, 12, 2, 2, 1)
    place_rect(m, "t", TAN, 20, 13, 2, 1, 1)
    place_rect(m, "t", TAN, 26, 13, 2, 1, 1)
    row(m, "t", TAN, 18, 18, 12, 1, avoid={6})
    row(m, "t", TAN, 18, 19, 12, 1)
    m.step()

    # lawn: two rows of green 6 x 8 plates, ends offset by 4 so no joint
    # lines up with the joints of the base plates at x = 16 and x = 32
    claim(rect(0, 0, BASE_W, 12))
    for z in (0, 6):
        place_rect(m, "p", GREEN, 0, z, 4, 6, 1)
        for x in range(4, 44, 8):
            place_rect(m, "p", GREEN, x, z, 8, 6, 1)
        place_rect(m, "p", GREEN, 44, z, 4, 6, 1)
        m.step()
    # gardens beside and behind the building
    rest = rect(0, 0, BASE_W, BASE_D) - occupied
    claim(rest)
    left = {c for c in rest if c[0] < 24}
    right = {c for c in rest if c[0] >= 24}
    _fill_garden(m, left)
    _fill_garden(m, right)
    m.step()

    # ---- hedges -----------------------------------------------------------
    for x0 in (0, 31):
        row(m, "p", DKGREEN, x0, 11, 17, 2, avoid=())
    row(m, "p", DKGREEN, 17, 6, 14, 2)
    for x in (17, 30):
        row(m, "p", DKGREEN, x, 7, 4, 2, axis="z")
    for x0 in (1, 36):
        row(m, "p", DKGREEN, x0, 21, 11, 2)
    m.step()

    # ---- building modules -------------------------------------------------
    m.step()
    m.sub(central, *CENTRAL, 1)
    m.step()
    m.sub(tower, *TOWER_L, 1)
    m.sub(tower, *TOWER_R, 1)
    m.step()
    m.sub(wing, *WING_L, 1)
    m.sub(wing, *WING_R, 1)
    m.step()

    # ---- porte-cochere ----------------------------------------------------
    build_porte_cochere(m)

    # ---- landscaping ------------------------------------------------------
    m.section("Palms, flowers and flags", "Finish the grounds with an avenue of palms, "
              "flower beds and two flagpoles.")
    palms = [(2, 2), (2, 6), (7, 9), (3, 19), (9, 19), (14, 9)]
    for x, z in palms:
        m.sub(palm, x, z, 2)
        m.sub(palm, mirror_x(x), z, 2)
    m.step()
    # flower beds and flagpoles in the entrance garden
    for x, z in [(19, 9), (22, 7), (25, 7), (28, 9)]:
        m.add("round_p1", RED, x, z, 2)
    bases = []
    for x in (20, 27):
        bases.append((m.add("round1", LBG, x, 8, 2), 20 * x + 10, 20 * 8 + 10))
    m.step()
    # 4L bars pushed 4 LDU into the open studs; flags clip on near the top
    base_top = -8 * 5
    bar_top = base_top + 4 - 80
    for base, bx, bz in bases:
        m.add_raw("bar4", BLACK, (bx, bar_top, bz), rot_matrix(0), attach_to=base)
    m.step()
    # flags point outward so the main arch stays in view
    for (base, bx, bz), color, face in zip(bases, (RED, BLUE), ("right", "left")):
        m.add_raw("flag2x2", color, (bx, bar_top + 2, bz), rot_matrix(FACE[face]),
                  attach_to=base)
    m.step()
    return m


def _fill_garden(m, cells):
    fill_cells(m, "p", GREEN, cells, 1)


def build_porte_cochere(m):
    """Porte-cochere: three arches to the front, drive-through side arches."""
    m.section("The porte-cochere", "The arched entrance canopy is built in place "
              "in front of the central pavilion. The drive runs through its side arches.")
    # legs (one brick)
    m.add("b1x2", WHITE, 17, 12, 2, rot=90)
    m.add("b1x2", WHITE, 30, 12, 2, rot=90)
    m.add("b1x2", WHITE, 20, 12, 2)
    m.add("b1x2", WHITE, 26, 12, 2)
    m.add("b1x1", WHITE, 17, 18, 2)
    m.add("b1x1", WHITE, 30, 18, 2)
    m.step()
    # side arches on the front; extra leg bricks for the taller arches
    m.add("arch1x4", WHITE, 17, 12, 5)
    m.add("arch1x4", WHITE, 27, 12, 5)
    for x, z in ((21, 12), (26, 12), (17, 13), (17, 18), (30, 13), (30, 18)):
        m.add("b1x1", WHITE, x, z, 5)
    m.step()
    # raised 1x6 arches: the main entrance and the drive-through arches
    m.add("b1x4", WHITE, 17, 12, 8)
    m.add("b1x4", WHITE, 27, 12, 8)
    m.add("arch1x6r", WHITE, 21, 12, 8)
    m.add("arch1x6r", WHITE, 17, 13, 8, rot=90)
    m.add("arch1x6r", WHITE, 30, 13, 8, rot=90)
    m.step()
    # canopy slab
    for (x, z, sx, sz) in [(17, 12, 8, 2), (25, 12, 6, 2), (17, 14, 6, 2), (23, 14, 8, 2),
                           (17, 16, 8, 2), (25, 16, 6, 2), (18, 18, 12, 2),
                           (17, 18, 1, 1), (30, 18, 1, 1)]:
        place_rect(m, "p", WHITE, x, z, sx, sz, 11)
    m.step()
    # mansard with three oval dormers
    front = "S" + "DD" + "SSS" + "DD" + "SSS" + "DD" + "S"
    for i, c in enumerate(front):
        x = 17 + i
        if c == "S":
            m.add("slope45", ROOF, x, 12, 12, rot=FACE["front"])
    for x in (18, 23, 28):
        m.add("tech1x2", WHITE, x, 12, 12)
        m.add("b1x2", ROOF, x, 13, 12)
    for z in range(14, 19):
        m.add("slope45", ROOF, 17, z, 12, rot=FACE["left"])
        m.add("slope45", ROOF, 29, z, 12, rot=FACE["right"])
    m.step()
    # roof deck
    for (x, z, sx, sz) in [(18, 13, 6, 4), (24, 13, 6, 4), (18, 17, 12, 2), (18, 19, 8, 1), (26, 19, 4, 1)]:
        place_rect(m, "p", ROOF, x, z, sx, sz, 15)
    m.step()
    # upper tier and tiles
    for x in range(20, 28):
        m.add("curve2x1", ROOF, x, 14, 16, rot=FACE["front"])
    fill_rect(m, "p", ROOF, 20, 16, 8, 4, 16, along="x")
    m.step()
    fill_rect(m, "t", ROOF, 20, 16, 8, 4, 17, along="x")
    deck = ({(x, z) for x in range(18, 30) for z in range(13, 20)} -
            {(x, z) for x in range(20, 28) for z in range(14, 20)})
    fill_cells(m, "t", ROOF, deck, 16)
    m.step()


def build():
    wing, tower, central, palm = build_wing(), build_tower(), build_central(), build_palm()
    main_m = build_main(wing, tower, central, palm)
    return main_m, [main_m, central, tower, wing, palm]
