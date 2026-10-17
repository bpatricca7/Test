"""The current Pick a Brick Bestseller list, from a live snapshot of lego.com.

    python3 lego-kit/pab_live.py <snapshot.json> <data dir>

converts a snapshot of LEGO's PickABrickQuery (every AVAILABLE Bestseller
element in the US store, with unit prices) into <data dir>/pab_live.json.
element_lookup.py reads that file when it is there and then prefers these
element IDs and prices over the older 2022 and 2025 listings; export_parts.py
treats a part on this list as Bestseller. A copy of each imported snapshot is
kept in lego-kit/pab_live/ (pab_live_<date>.json); without a pab_live.json in
the data dir, the newest copy there is used.

The snapshot holds element rows [element_id, design_key, color_key, cents],
with design_key -> [design_id, name, ...] and color_key -> [color_id, name,
hex, family]. LEGO colour IDs are not LDraw or BrickLink IDs, so parts are
matched by element ID, or by design ID and the LEGO colour name.
"""
import glob
import hashlib
import json
import os
import shutil
import sys

# Our LEGO colour names (element_lookup.COLORS) where the live list spells them differently
NAME_ALIASES = {
    "Transparent Red": "Tr. Red", "Transparent Blue": "Tr. Blue",
    "Transparent Light Blue": "Tr. Light Blue", "Transparent Green": "Tr. Green",
    "Transparent Yellow": "Tr. Yellow", "Transparent Bright Orange": "Tr. Bright Orange",
}
FILE = "pab_live.json"
KEEP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pab_live")


def convert(raw_path, data_dir):
    raw = json.load(open(raw_path))
    meta = raw["metadata"]
    out = {}
    for eid, dk, ck, cents in raw["elements"]:
        design = raw["designs"][dk]
        colour = raw["colors"][ck]
        out[str(eid)] = [str(design[0]), design[1], colour[1], round(cents / 100, 2)]
    doc = {
        "source": meta["source_url"],
        "store": meta.get("store"),
        "snapshot_utc": meta["snapshot_start_utc"],
        "date": meta["snapshot_start_utc"][:10],
        "sha256": hashlib.sha256(open(raw_path, "rb").read()).hexdigest(),
        "note": "Every element listed was Bestseller (deliveryChannel=pab) and AVAILABLE at the "
                "snapshot time. No stock counts or order caps were published.",
        "elements": out,
    }
    path = os.path.join(data_dir, FILE)
    with open(path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
    os.makedirs(KEEP, exist_ok=True)
    shutil.copy(path, os.path.join(KEEP, f"pab_live_{doc['date']}.json"))
    return path, len(out)


class Live:
    """Lookup by element ID, and by (design ID, LEGO colour name)."""

    def __init__(self, doc):
        self.date = doc["date"]
        self.elements = doc["elements"]
        self.by_design = {}
        for eid, (design, name, colour, price) in self.elements.items():
            self.by_design.setdefault((design, colour), []).append(eid)

    def __contains__(self, eid):
        return eid in self.elements

    def price(self, eid):
        return self.elements[eid][3]

    def name(self, eid):
        return self.elements[eid][1]

    def find(self, design_ids, lego_colour):
        colour = NAME_ALIASES.get(lego_colour, lego_colour)
        for d in design_ids:
            eids = self.by_design.get((str(d), colour))
            if eids:
                return max(eids, key=int)
        return None


def load(data_dir):
    path = os.path.join(data_dir, FILE)
    if not os.path.exists(path):
        kept = sorted(glob.glob(os.path.join(KEEP, "pab_live_*.json")))
        if not kept:
            return None
        path = kept[-1]
    return Live(json.load(open(path)))


if __name__ == "__main__":
    path, n = convert(sys.argv[1], sys.argv[2])
    print(f"{n} live Bestseller elements -> {path}")
