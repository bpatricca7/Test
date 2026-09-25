"""Load a model project and build it.

A project is a folder with a ``design.py`` that defines:

  PROJECT  a dict of names and booklet text (see riviera-lego/design.py)
  build()  returns (main_model, [main_model, submodel, ...])

The kit writes everything else inside the project folder:
  model/<name>.mpd, build/ (renders), instructions/, parts/, data/elements.csv
"""
import importlib.util
import os
import sys

KIT = os.path.dirname(os.path.abspath(__file__))
if KIT not in sys.path:
    sys.path.insert(0, KIT)

from bricks import validate  # noqa: E402


class Project:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        spec = importlib.util.spec_from_file_location(
            "design_" + os.path.basename(self.root).replace("-", "_"),
            os.path.join(self.root, "design.py"))
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.meta = self.mod.PROJECT
        self.build_dir = os.path.join(self.root, "build")
        self.renders = os.path.join(self.build_dir, "renders")
        self.model_dir = os.path.join(self.root, "model")
        self.parts_dir = os.path.join(self.root, "parts")
        self.data_dir = os.path.join(self.root, "data")
        self.instr_dir = os.path.join(self.root, "instructions")
        self._built = None

    def build(self, verbose=True):
        """Build, validate and write the LDraw file (cached per process)."""
        if self._built is None:
            main_m, models = self.mod.build()
            problems = validate(main_m, verbose)
            for sm in models:
                if sm is not main_m:
                    validate(sm, verbose)
            os.makedirs(self.model_dir, exist_ok=True)
            lines = []
            for mm in models:
                lines += mm.ldraw_lines() + [""]
            with open(self.mpd, "w", newline="\r\n") as fh:
                fh.write("\n".join(lines))
            if verbose:
                total = main_m.parts_count()
                print(f"total elements: {sum(total.values())}, unique part/colour: {len(total)}")
            self._built = (main_m, models, problems)
        return self._built

    @property
    def main_name(self):
        return self.meta["model_name"]

    @property
    def mpd(self):
        return os.path.join(self.model_dir, self.main_name + ".mpd")


def load(argv):
    """Project from the first command-line argument (a project folder)."""
    if len(argv) < 2:
        raise SystemExit("usage: <script> <project folder> ...")
    return Project(argv[1])
