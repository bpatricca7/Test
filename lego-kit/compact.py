"""The compact display format of the resort collection.

Every compact kit uses the same display:

  - a 24 x 16 stud base in dark bluish gray (one 16 x 16 and two 8 x 8 plates);
  - a two-row black band along the front edge, as a plinth;
  - the resort's signature building behind it, at the collection scale of the
    large builds: about 1:250, one storey = 4 plates (a course of bricks with
    the windows, then a plate band), 1 stud is about 2 m;
  - at most one or two small details in front (a palm, a lamp, a sign post);
  - the rest of the base tiled in one or two ground colours.

Renders, booklet layout and README follow the same pattern for every kit, so
the collection looks like one series. Use ``compact_project()`` for PROJECT and
``display_base()`` / ``finish_ground()`` in ``build()``.
"""
from bricks import Model, row, fill_rect, fill_cells, BLACK, DBG, WHITE, LBG, GREEN, RBROWN  # noqa: F401
from walls import WallRing

BASE_W, BASE_D = 24, 16
BAND_ROWS = 2                      # z = 0, 1 are the black band
BASE_COLOR, BAND_COLOR = DBG, BLACK
SCALE = "about 1:250 (one storey = 4 plates, 1 stud &asymp; 2 m), like the large resort models"
STOREY = 4                         # plates per storey: a brick course and a plate band
BASE_CM = (19.2, 12.8)

HERO_VIEWS = [("cover_front_right", 26, 32), ("cover_front_left", 26, -32),
              ("cover_front", 12, 0), ("cover_high", 55, 20), ("back", 28, 150)]
GALLERY = ["cover_front", "cover_front_left", "cover_high", "back"]

# Parts shared across the collection: designs should reach for these first, in
# the collection colours, before anything else (fewer unique part/colour lines
# across the series, larger combined orders, less sorting).
SHARED_PARTS = [
    "p1x1 p1x2 p1x4 p1x6 p2x2 p2x4 p2x6 p4x6 (plates)",
    "b1x1 b1x2 b1x4 b2x2 b2x4 (bricks)",
    "t1x1 t1x2 t1x4 t1x6 t1x8 t2x2 (tiles)",
    "slope45 s45x2 s45x4 s33x2 cheese (roofs: 45 and 33 degree slopes)",
    "round1 round_p1 tile_round1 cone1 bar4 (round details, spires, posts)",
]


def display_base(m):
    """Lay the standard base and the black front band (two steps).

    Returns the set of (x, z) cells at layer 1 taken by the band.
    """
    m.add("p16x16", BASE_COLOR, 0, 0, 0)
    m.add("p8x8", BASE_COLOR, 16, 0, 0)
    m.add("p8x8", BASE_COLOR, 16, 8, 0)
    m.step()
    # front row in 1x8 tiles; the second row is offset so it bridges the seams
    for x in (0, 8, 16):
        m.add("t1x8", BAND_COLOR, x, 0, 1)
    for x, n in ((0, 4), (4, 8), (12, 8), (20, 4)):
        m.add(f"t1x{n}", BAND_COLOR, x, 1, 1)
    m.step()
    return {(x, z) for x in range(BASE_W) for z in range(BAND_ROWS)}


# 1xN tile lengths that are Bestsellers per colour (checked with avail.py)
GROUND_TILE_SIZES = {
    2: [4, 2, 1],                      # green
    19: [6, 4, 2, 1],                  # tan
    28: [2, 1],                        # dark tan
    0: [8, 6, 4, 2, 1], 15: [8, 6, 4, 2, 1], 71: [8, 6, 4, 2, 1], 72: [8, 6, 4, 2, 1],
    1: [8, 6, 4, 2, 1],                # blue (water)
}


# plate sizes (width: lengths) that are Bestsellers, for studded lawns
GROUND_PLATE_SIZES = {
    2: {1: [4, 2, 1], 2: [6, 4, 2], 4: [6]},     # green: a short list shared by every kit
}
LAWN_COLOURS = {2}


def finish_ground(m, reserved, colour, layer=1, colour_at=None):
    """Cover every base cell (at ``layer``) that isn't reserved.

    Lawns (green) are plates with their studs showing, which reads as grass and
    costs a third of tiles. Everything else (paths, paving, sand, water) is
    tiles in runs along x that avoid seams at x = 8 and 16, so rows that cross
    the base plates' seam tie the plates together. ``colour_at(x, z)`` can
    give a different colour per cell. Returns the number of elements placed.
    """
    colour_at = colour_at or (lambda x, z: colour)
    free = [(x, z) for z in range(BASE_D) for x in range(BASE_W) if (x, z) not in reserved]
    n = 0
    lawns = {}
    for c in free:
        col = colour_at(*c)
        if col in LAWN_COLOURS:
            lawns.setdefault(col, set()).add(c)
    for col, cells in lawns.items():
        before = len(m.items) if hasattr(m, "items") else 0
        fill_cells(m, "p", col, cells, layer, sizes=GROUND_PLATE_SIZES[col])
        n += (len(m.items) - before) if hasattr(m, "items") else 0
    for z in range(BASE_D):
        x = 0
        while x < BASE_W:
            c = (x, z)
            if c in reserved or colour_at(*c) in LAWN_COLOURS:
                x += 1
                continue
            col = colour_at(x, z)
            x1 = x
            while x1 < BASE_W and (x1, z) not in reserved and colour_at(x1, z) == col:
                x1 += 1
            n += len(row(m, "t", col, x, z, x1 - x, layer, avoid={8 - x, 16 - x},
                         sizes=GROUND_TILE_SIZES.get(col, [4, 2, 1]))) + 1
            x = x1
    return n


def storey_layer(f, plinth=1):
    """Bottom layer of storey f's brick course (plinth plates are layers 0..plinth-1)."""
    return plinth + STOREY * (f - 1)


def block(m, w, d, floors, material, band=WHITE, plinth=LBG, plinth_layers=1):
    """A building block: plinth, storeys and a roof slab. Returns the roof base layer.

    Each storey is one brick course laid by WallRing (corners interlock, joints
    stagger) and a ring of plates on top as the floor band; the top band is a
    full slab, so roofs have studs everywhere. ``material(x, z, floor)``
    returns a colour for a wall cell, or None to leave it open.
    """
    for k in range(plinth_layers):
        fill_rect(m, "p", plinth, 0, 0, w, d, k, along="x" if k % 2 == 0 else "z")
    m.step()
    ring = WallRing([(0, 0), (w - 1, 0), (w - 1, d - 1), (0, d - 1)])
    ring_cells = {(x, z) for x in range(w) for z in range(d) if x in (0, w - 1) or z in (0, d - 1)}
    for f in range(1, floors + 1):
        L = storey_layer(f, plinth_layers)

        def mat(x, z, layer, f=f):
            c = material(x, z, f)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat)
        m.step()
        if f < floors:
            fill_cells(m, "p", band, ring_cells, L + 3)
        else:
            fill_rect(m, "p", band, 0, 0, w, d, L + 3, along="x")
        m.step()
    return storey_layer(floors, plinth_layers) + 4


def palm(name="palm.ldr", trunk=4, colour=GREEN):
    """The collection's palm: a trunk of round bricks and two layers of fronds."""
    m = Model(name, "Palm tree")
    for k in range(trunk):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves6x5", colour, 0, 0, 3 * trunk, rot=0)
    m.add("leaves6x5", colour, 0, 0, 3 * trunk + 1, rot=90)
    m.add("leaves1", colour, 0, 0, 3 * trunk + 2, rot=45)
    m.step()
    m.width, m.depth = 1, 1
    return m


def compact_project(*, slug, title, resort, about, features, omitted, colour_rows,
                    organisation, sub_info, legend, tips, build_time, height_cm=None,
                    category, merged=None, substitutions=(), main_parts_label=None,
                    **extra):
    """PROJECT dict for a compact kit, with the collection's shared settings.

    slug      file stem, e.g. "grand_floridian"  (model and PDF names)
    title     cover title, e.g. "Grand Floridian Resort"
    resort    full name for the fine print, e.g. "Disney's Grand Floridian Resort & Spa"
    features  the signature features the kit includes (README, booklet)
    omitted   what the compact version leaves out (README)
    category  Deluxe / Deluxe Villas / Moderate / Value (collection table)
    merged    other names covered by this kit (e.g. its DVC villas)
    """
    pdf_stem = "_".join(w for w in title.replace("&", "and").split())
    p = dict(
        main_parts_label=main_parts_label or "Display base and forecourt",
        model_name=f"{slug}_compact",
        pdf_name=f"{pdf_stem}_Compact_Instructions.pdf",
        title=title,
        subtitle="A compact display model in LEGO&reg; bricks",
        cover_stats=("19 &times; 13 cm", "24 &times; 16 studs"),
        badge="Unofficial fan design",
        fine_print=(f"An unofficial fan-designed model (MOC), inspired by "
                    f"{resort.replace('&', '&amp;')} at Walt Disney World. It is not affiliated "
                    "with, sponsored or endorsed by The LEGO Group or Disney. LEGO&reg; is a "
                    "trademark of The LEGO Group."),
        about=about,
        facts=[("Size", "24 &times; 16 studs (19.2 &times; 12.8 cm), {height} cm tall"),
               ("Scale", SCALE),
               ("Build time", build_time)],
        organisation=organisation,
        organisation_note=("Every kit in the compact resort collection stands on the same "
                           "24&times;16 display base with a black front band. Each section "
                           "starts with a list of the parts it needs."),
        tips=list(tips),
        legend=legend,
        sub_info=sub_info,
        section_images={},
        section_image_default="cover_front_right",
        hero_views=HERO_VIEWS,
        cover_view="cover_front_right",
        gallery=GALLERY,
        substitutions=list(substitutions) + [
            "<b>Ground:</b> any colour of tiles works for the base around the building.",
            "<b>Hidden parts:</b> bricks and plates inside the building can be any colour."],
        order_cap_note=("Every element in this kit was in Pick a Brick's Bestseller range, "
                        "which ships from the US warehouse."),
        colour_rows=colour_rows,
        bestseller_only=True,
        batch_sizes=[10, 25],
        # collection fields (README and comparison table)
        compact=True,
        resort=resort,
        category=category,
        merged=merged or [],
        features=list(features),
        omitted=list(omitted),
    )
    p.update(extra)
    return p
