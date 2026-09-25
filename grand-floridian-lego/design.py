"""Design of the Grand Floridian display model (micro scale, about 1:250).

Build with the shared kit:  ./build.sh

Scale: 1 stud = 2 m of building, 1 plate = 0.8 m, one storey = 4 plates.
Footprint 48 x 32 studs (38 x 26 cm).

Grid (studs): x to the right, z toward the back; the front is at z = 0.
  wings     x  2..17 and 30..45, z 20..29   four storeys under hipped roofs
  central   x 18..29,            z 20..29   seven storeys, gable and cupola
  porte     x  9..38,            z 10..19   porte-cochere, built on the base
"""
from bricks import (Model, PARTS, row, fill_rect, fill_cells, place_rect, rot_matrix,
                    FACE, WHITE, BLACK, DBG, LBG, RED, GREEN, DKGREEN, TAN, RBROWN,
                    TCLEAR, DKRED)
from roofs import Roof, build_roofs
from walls import WallRing

ROOF = RED
TRIM = WHITE
WALL = WHITE
WINDOW = BLACK
PLINTH = LBG

PROJECT = dict(
    main_parts_label="Grounds, porte-cochere and gardens",
    model_name="grand_floridian",
    pdf_name="Grand_Floridian_Instructions.pdf",
    title="Grand Floridian Resort",
    subtitle="A micro-scale display model in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC), inspired by Disney's Grand Floridian "
                "Resort &amp; Spa at Walt Disney World. It is not affiliated with, sponsored or "
                "endorsed by The LEGO Group or Disney. LEGO&reg; is a trademark of The LEGO Group."),
    about=("This model shows the main building of the Grand Floridian: the seven-storey central "
           "block with its white verandas, steep front gable, twin chimneys and red-spired cupola; "
           "the two guest wings under hipped red roofs with gables and dormers; and the "
           "porte-cochere with its arched entrance. Palms, green lamp posts, a fountain and a red "
           "brick walk fill the entrance garden."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), 16 cm tall at the spire"),
           ("Scale", "about 1:250 (one storey = 4 plates)"),
           ("Build time", "about 6 to 8 hours")],
    organisation=["The grounds: base, drive, brick walk and lawns",
                  "The central block", "The guest wings (build 2)",
                  "The porte-cochere", "Gardens, palms and lamp posts"],
    organisation_note=("The central block and the guest wings are built on their own and then "
                       "set on the base. Every section starts with a list of the parts it needs, "
                       "so you can sort them before you start."),
    tips=["Each storey takes three steps: the wall, then the veranda (a white railing with "
          "slim round columns), then the white floor band that ties them together.",
          "The walls behind the verandas are mostly black bricks. Keep black and white parts in "
          "separate trays.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice: the two guest "
          "wings are identical.",
          "Roofs go up one row of slopes at a time. Where a gable meets a roof, a few red "
          "1&times;1 bricks go in first as hidden supports, in a step of their own just "
          "before the slopes that rest on them."],
    legend=("palm.ldr", 1),
    sub_info={
        "central.ldr": ("The central block",
                        "Seven storeys of white verandas under a red roof, with a steep front "
                        "gable, two chimneys and the cupola with its red spire."),
        "wing.ldr": ("The guest wings",
                     "Two identical four-storey wings with hipped red roofs. Each has a front "
                     "gable at both ends and a dormer between them."),
        "palm.ldr": ("Palm tree", ""),
        "lamp.ldr": ("Lamp post", ""),
    },
    section_images={"The grounds": "cover_high", "The porte": "cover_front",
                    "Gardens": "cover_front_left"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 10, 0), ("cover_high", 50, 20), ("back", 26, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. Any plates that cover 48&times;32 studs will do.",
        "<b>Hidden parts:</b> the floor slabs inside the buildings and the red 1&times;1 "
        "supports inside the roofs can be any colour.",
        "<b>Lawn:</b> any green plates. Keep the joints away from the joints in the base.",
        "<b>Lamp posts:</b> black 3L bars work if dark green ones are hard to find."],
    order_cap_note=("Every element this model needs more than 10 of was in the Bestseller "
                    "range. The six Standard elements (the entrance arch, the fountain's round "
                    "bricks, the spire cone, and the lamp posts' bars and caps) are needed 4 or "
                    "fewer times each."),
    colour_rows=[("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Red / Dark Red", "Bright Red / New Dark Red", "Red / Dark Red"),
                 ("Green", "Dark Green", "Green"),
                 ("Dark Green", "Earth Green", "Dark Green"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
)

# --------------------------------------------------------------------------
# storeys
# --------------------------------------------------------------------------
def storey_layer(f):
    """Bottom layer of storey f's brick course (the plinth is layer 0)."""
    return 1 + 4 * (f - 1)


def veranda(m, x0, x1, z, layer, columns, ground=False):
    """Front veranda row: end posts, a railing and slim columns.

    The row sits one stud in front of the recessed wall; the floor band laid
    on top ties it to the wall.
    """
    m.add("b1x1", WALL, x0, z, layer)
    m.add("b1x1", WALL, x1, z, layer)
    if ground:
        for x in columns:
            m.add("round1", WALL, x, z, layer)
        return
    row(m, "p", WALL, x0 + 1, z, x1 - x0 - 1, layer)
    for x in columns:
        m.add("round_p1", WALL, x, z, layer + 1)
        m.add("round_p1", WALL, x, z, layer + 2)


def facade_material(w, d, columns, side_windows, back_windows, plain_sides=False):
    """Material function for a block with a recessed veranda wall at z = 1."""
    def mat(x, z, layer):
        if z == 1 and 0 < x < w - 1:
            return ("b", WALL if x in columns else WINDOW)
        if x in (0, w - 1) and 1 < z < d - 1:
            if plain_sides:
                return ("b", WALL)
            return ("b", WINDOW if z in side_windows else WALL)
        if z == d - 1 and 0 < x < w - 1:
            return ("b", WINDOW if x in back_windows else WALL)
        return ("b", WALL)
    return mat


def band(m, w, d, layer, slab=False):
    """Floor band: the wall ring plus the veranda row; or a full slab."""
    if slab:
        fill_rect(m, "p", WALL, 0, 0, w, d, layer, along="x")
        return
    cells = {(x, z) for x in range(w) for z in range(d)
             if z <= 1 or z == d - 1 or x in (0, w - 1)}
    fill_cells(m, "p", WALL, cells, layer)


def build_block(m, w, d, floors, columns, side_windows, back_windows, slabs,
                plain_sides_below=0):
    """Plinth, storeys with verandas and floor bands.  Returns the roof base layer."""
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="z")
    m.step()
    ring = WallRing([(0, 1), (w - 1, 1), (w - 1, d - 1), (0, d - 1)])
    inner = [x for x in columns if 0 < x < w - 1]
    for f in range(1, floors + 1):
        L = storey_layer(f)
        mat = facade_material(w, d, set(inner), side_windows, back_windows,
                              plain_sides=f <= plain_sides_below)
        ring.course(m, L, f % 2, mat)
        m.step()
        veranda(m, 0, w - 1, 0, L, inner, ground=(f == 1))
        m.step()
        band(m, w, d, L + 3, slab=(f in slabs or f == floors))
        m.step()
    return storey_layer(floors) + 4


# --------------------------------------------------------------------------
# guest wing (build 2)
# --------------------------------------------------------------------------
WING_W, WING_D = 16, 10
WING_COLS = (3, 6, 9, 12)


def dormer_wall(m, cells, layer):
    """Dormer front: white with a window band."""
    xs = sorted(c[0] for c in cells)
    z = cells[0][1]
    if len(xs) == 2:
        m.add("p1x2", WALL, xs[0], z, layer)
        m.add("p1x2", WINDOW, xs[0], z, layer + 1)
        m.add("p1x2", WALL, xs[0], z, layer + 2)
        return
    for (x, zz) in cells:
        m.add("b1x1", WALL, x, zz, layer)


def build_wing():
    m = Model("wing.ldr", "Guest wing (build 2)")
    base = build_block(m, WING_W, WING_D, 4, WING_COLS, side_windows=(3, 5, 7),
                       back_windows=(2, 4, 6, 9, 11, 13), slabs=(2,))
    build_roofs(m, [
        Roof(0, WING_W, 0, WING_D, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
             priority=1, name="wing roof"),
        Roof(0, 6, 0, 5, base, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
             wall=dormer_wall, wall_ends=("start",), name="gable"),
        Roof(6, 10, 1, 4, base + 3, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
             wall=dormer_wall, wall_ends=("start",), name="dormer"),
        Roof(10, 16, 0, 5, base, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
             wall=dormer_wall, wall_ends=("start",), name="gable"),
    ], fill_color=ROOF, support_caps=True)
    m.width, m.depth = WING_W, WING_D
    return m


# --------------------------------------------------------------------------
# central block: seven storeys, a big front gable, cupola and chimneys
# --------------------------------------------------------------------------
CEN_W, CEN_D = 12, 10
CEN_COLS = (2, 4, 7, 9)
CUPOLA = (5, 4)
CHIMNEYS = ((1, 4), (10, 4))


def central_gable_wall(m, cells, layer):
    xs = sorted(c[0] for c in cells)
    z = cells[0][1]
    if z == 0 and len(xs) == 4:
        m.add("arch1x4", WALL, xs[0], z, layer)          # the fan over the gable window
        return
    if z == 0 and len(xs) == 2:
        m.add("grille1x2", WALL, xs[0], z, layer)
        return
    for (x, n) in _runs_x(cells):
        row(m, "b", WALL, x, z, n, layer)


def _runs_x(cells):
    xs = sorted(c[0] for c in cells)
    out = []
    for x in xs:
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


def build_central():
    m = Model("central.ldr", "Central block")
    base = build_block(m, CEN_W, CEN_D, 7, CEN_COLS, side_windows=(3, 5, 7),
                       back_windows=(2, 4, 7, 9), slabs=(3, 5), plain_sides_below=4)
    cx, cz = CUPOLA
    cup = {(cx + i, cz + j) for i in (0, 1) for j in (0, 1)}
    chim = {(x, z + j) for x, z in CHIMNEYS for j in (0, 1)}
    main = Roof(0, CEN_W, 0, CEN_D, base, "x", pitch=33, color=ROOF, trim=TRIM,
                trim_ends=("start", "end"), wall=WALL, priority=1, widths=(1,),
                name="central roof")
    gable = Roof(2, 10, 0, 6, base, "z", pitch=45, color=ROOF, trim=TRIM,
                 trim_ends=("start",), wall=central_gable_wall, name="central gable")
    build_roofs(m, [main, gable], fill_color=ROOF, keep_open=cup | chim, support_caps=True)
    # chimneys on the ridge
    top = main.layer(main.K + 1)
    for x, z in CHIMNEYS:
        m.add("b1x2", RED, x, z, top, rot=90)
        m.add("b1x2", RED, x, z, top + 3, rot=90)
        m.add("t1x2", DBG, x, z, top + 6, rot=90)
    m.step()
    # cupola on the back of the gable ridge: windows, eave, spire
    L = gable.layer(gable.K + 1)
    m.add("tech1x2", WALL, cx, cz, L)
    m.add("tech1x2", WALL, cx, cz + 1, L)
    m.add("p2x2", WALL, cx, cz, L + 3)
    m.step()
    cone = m.add("cone2", ROOF, cx, cz, L + 4)
    tip_y = -8 * (L + 4 + PARTS["cone2"].height)
    m.add_raw("round_p1", WALL, (20 * cx + 20, tip_y - PARTS["round_p1"].bmax_y, 20 * cz + 20),
              rot_matrix(0), attach_to=cone)
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


# --------------------------------------------------------------------------
# palm tree and lamp post
# --------------------------------------------------------------------------
def build_palm():
    m = Model("palm.ldr", "Palm tree")
    for k in range(6):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves6x5", GREEN, 0, 0, 18, rot=0)
    m.add("leaves6x5", GREEN, 0, 0, 19, rot=90)
    m.add("leaves1", GREEN, 0, 0, 20, rot=45)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_lamp():
    """A stone pedestal, a slim green post (a 3L bar) and a glass lantern."""
    m = Model("lamp.ldr", "Lamp post")
    m.add("b1x1", TAN, 0, 0, 0)
    pedestal = m.add("round1", TAN, 0, 0, 3)
    m.step()
    c = 10                                   # centre of the stud cell, in LDU
    top = -8 * 6                             # top of the pedestal
    bar_y = top + 4 - 60                     # bar pushed 4 LDU into the hollow stud
    bar = m.add_raw("bar3", DKGREEN, (c, bar_y, c), rot_matrix(0), attach_to=pedestal)
    lantern_y = bar_y + 8 - PARTS["round1"].bmax_y     # lantern slid 8 LDU onto the bar
    lantern = m.add_raw("round1", TCLEAR, (c, lantern_y, c), rot_matrix(0), attach_to=bar)
    m.add_raw("cone1", DKGREEN, (c, lantern_y - PARTS["cone1"].bmax_y, c), rot_matrix(0),
              attach_to=lantern)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model: grounds, buildings, porte-cochere, landscaping
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
WING_L, WING_R, CENTRAL = (2, 20), (30, 20), (18, 20)
PX0, PX1, PZ0, PZ1 = 9, 39, 10, 20                 # porte-cochere x 9..38, z 10..19
ARCH_X = 20                                        # main arch x 20..27
FRONT_PILLARS = (9, 10, 18, 29, 37, 38)
BACK_PILLARS = (9, 18, 20, 27, 29, 38)
PALMS = [(6, 5), (15, 3), (32, 3), (41, 5), (1, 11), (46, 11)]
LAMPS = [(19, 2), (28, 2), (20, 7), (27, 7)]
FOUNTAIN = (22, 6)                                 # 4 x 4


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def build_main(wing, central, palm, lamp):
    m = Model("grand_floridian.ldr", "Grand Floridian Resort - micro-scale display model")
    m.header_notes = [
        "Unofficial fan design inspired by Disney's Grand Floridian Resort & Spa; not",
        "affiliated with the LEGO Group or Disney. Generated by design.py (lego-kit).",
    ]
    m.section("The grounds", "Six 16 x 16 plates form the base. The drive, lawns and the "
              "brick walk then lock them together.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()

    # drive: tiles running front to back so they bridge the base seam at z = 16
    pillar_cells = {(x, PZ0) for x in FRONT_PILLARS + (ARCH_X, ARCH_X + 7)} | \
                   {(x, PZ1 - 1) for x in BACK_PILLARS}
    for x in list(range(0, PX0)) + list(range(PX1, BASE_W)):
        row(m, "t", LBG, x, 12, 6, 1, axis="z")
    m.step()
    for x in range(PX0, PX1):
        z = PZ0
        while z < PZ1:
            if (x, z) in pillar_cells:
                m.add("p1x1", LBG, x, z, 1)
                z += 1
                continue
            z1 = z
            while z1 < PZ1 and (x, z1) not in pillar_cells:
                z1 += 1
            row(m, "t", LBG, x, z, z1 - z, 1, axis="z")
            z = z1
    m.step()

    # brick walk to the entrance, and the fountain's footing
    fx, fz = FOUNTAIN
    for x in range(21, 27):
        if fx <= x < fx + 4:
            row(m, "t", DKRED, x, 0, fz, 1, axis="z")
        else:
            row(m, "t", DKRED, x, 0, PZ0, 1, axis="z")
    place_rect(m, "p", WALL, fx, fz, 4, 4, 1)
    m.step()

    # lawns (plate joints kept off the base seams at x = 16 and x = 32)
    fill_rect(m, "p", GREEN, 0, 0, 21, 10, 1, along="x", avoid={16})
    fill_rect(m, "p", GREEN, 27, 0, 21, 10, 1, along="x", avoid={5})
    m.step()
    for x0 in (0, PX1):
        fill_rect(m, "p", GREEN, x0, 10, 9, 2, 1, along="x")
        fill_rect(m, "p", GREEN, x0, 18, 9, 2, 1, along="x")
    fill_rect(m, "p", GREEN, 0, 20, 2, 10, 1, along="z")
    fill_rect(m, "p", GREEN, 46, 20, 2, 10, 1, along="z")
    fill_rect(m, "p", GREEN, 0, 30, BASE_W, 2, 1, along="x", avoid={16, 32})
    m.step()

    # ---- the main building --------------------------------------------------
    m.step()
    m.sub(central, *CENTRAL, 1)
    m.step()
    m.sub(wing, *WING_L, 1)
    m.sub(wing, *WING_R, 1)
    m.step()

    build_porte(m)

    # ---- landscaping ----------------------------------------------------------
    m.section("Gardens, palms and lamps", "Hedges, the fountain, lamp posts and an "
              "avenue of palms finish the entrance garden.")
    for x0, x1 in ((0, 9), (PX1, BASE_W)):
        row(m, "b", DKGREEN, x0, 19, x1 - x0, 2)
    for x0, x1 in ((0, 14), (34, BASE_W)):
        row(m, "b", DKGREEN, x0, 0, x1 - x0, 2)
    for x0 in (PX0, 30):
        row(m, "b", DKGREEN, x0, PZ0 - 1, 9, 2)
    m.step()
    # fountain: round basin, red flowers, and an urn in the middle
    m.add("round4", WALL, fx, fz, 2)
    m.step()
    m.add("round2", WALL, fx + 1, fz + 1, 5)
    for (dx, dz) in ((0, 1), (0, 2), (3, 1), (3, 2), (1, 0), (2, 0), (1, 3), (2, 3)):
        m.add("flower1", RED, fx + dx, fz + dz, 5)
    for (dx, dz) in ((1, 1), (2, 1), (1, 2), (2, 2)):
        m.add("flower1", RED, fx + dx, fz + dz, 8)
    m.step()
    for x, z in LAMPS:
        m.sub(lamp, x, z, 2)
    m.step()
    for x, z in PALMS:
        m.sub(palm, x, z, 2)
    m.step()
    return m


def build_porte(m):
    """The porte-cochere: pillars, the main arch, the canopy deck and its roofs."""
    m.section("The porte-cochere", "The entrance canopy is built in place in front of the "
              "central block. The drive runs through it from side to side.")
    for x in FRONT_PILLARS:
        m.add("b1x1x3", WALL, x, PZ0, 2)
    for x in BACK_PILLARS:
        m.add("b1x1x3", WALL, x, PZ1 - 1, 2)
    for x in (ARCH_X, ARCH_X + 7):
        m.add("b1x1", WALL, x, PZ0, 2)
    m.step()
    m.add("arch1x8", WALL, ARCH_X, PZ0, 5)
    m.step()
    fill_rect(m, "p", WALL, PX0, PZ0, PX1 - PX0, PZ1 - PZ0, 11, along="x")
    m.step()

    def side_gable_wall(mm, cells, layer):
        xs = sorted(c[0] for c in cells)
        if len(xs) == 2:
            mm.add("tech1x2", WALL, xs[0], cells[0][1], layer)
        else:
            for x, n in _runs_x(cells):
                row(mm, "b", WALL, x, cells[0][1], n, layer)

    build_roofs(m, [
        Roof(PX0, PX1, PZ0, PZ1, 12, "x", pitch=33, color=ROOF, hips=("start", "end"),
             widths=(1,), priority=1, name="porte roof"),
        Roof(ARCH_X, ARCH_X + 8, PZ0, PZ1, 12, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=central_gable_wall, wall_ends=("start",),
             name="porte gable"),
        Roof(12, 18, PZ0, PZ0 + 5, 12, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=side_gable_wall, wall_ends=("start",), name="left gable"),
        Roof(30, 36, PZ0, PZ0 + 5, 12, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=side_gable_wall, wall_ends=("start",),
             name="right gable"),
    ], fill_color=ROOF, support_caps=True)


def build():
    wing, central = build_wing(), build_central()
    palm, lamp = build_palm(), build_lamp()
    main_m = build_main(wing, central, palm, lamp)
    return main_m, [main_m, central, wing, palm, lamp]
