"""README images for a kit: three finished views and two booklet pages.

    python3 readme_images.py <project>

Writes images/<model_name>_front_right.jpg, _front.jpg and _aerial.jpg from the
final renders, and sample_section_page.jpg / sample_step_page.jpg from the
booklet (the second section's intro page and the page after it).
"""
import os
import sys

from PIL import Image
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects  # noqa: E402

VIEWS = {"cover_front_right": "front_right", "cover_front": "front", "cover_high": "aerial"}


def main(proj):
    out = os.path.join(proj.root, "images")
    os.makedirs(out, exist_ok=True)
    stem = proj.meta["model_name"]
    for src, dst in VIEWS.items():
        im = Image.open(os.path.join(proj.renders, "final", src + ".png")).convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        bg.thumbnail((1400, 1000))
        bg.save(os.path.join(out, f"{stem}_{dst}.jpg"), quality=85, optimize=True)
    doc = pymupdf.open(os.path.join(proj.instr_dir, proj.meta["pdf_name"]))
    intros = [i for i, p in enumerate(doc) if "elements in this section" in p.get_text()]
    sec = intros[1] if len(intros) > 1 else (intros[0] if intros else 2)
    for name, i in (("sample_section_page", sec), ("sample_step_page", min(sec + 1, len(doc) - 1))):
        pix = doc[i].get_pixmap(dpi=90)
        png = os.path.join(out, name + ".png")
        pix.save(png)
        Image.open(png).convert("RGB").save(os.path.join(out, name + ".jpg"), quality=80,
                                            optimize=True)
        os.remove(png)
    print("images:", sorted(os.listdir(out)))


if __name__ == "__main__":
    main(projects.load(sys.argv))
