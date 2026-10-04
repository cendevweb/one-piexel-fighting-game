"""Turn the stage paintings into the backdrops the game draws.

    python3 tools/stages/build_stages.py

Each source in assets/backgrounds/ is a 16:9 panorama (1672×941). It is
kept whole and scaled to the backdrop width: the game scrolls it at half
speed behind the fighters and pins its horizon line on the top edge of the
floor it draws itself (render/stage.ts). The floor the fighters stand on is
never taken from the image, so their feet do not slide over a backdrop that
scrolls slower than they do.
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "assets", "backgrounds")
OUT = os.path.join(ROOT, "apps", "web", "public", "stages")

# Backdrop width in screen pixels at the game's 2× render scale: 440 world
# pixels, 120 more than the screen, the scroll for the 240 px the camera
# travels across the stage.
WIDTH = 880

# The line of the painting that meets the floor, as a fraction of its
# height: a little below the foot of the landmark, so a strip of sea, sand
# or grass shows between the two.
HORIZON = {
    "arlong-park": 0.785,
    "enies-lobby": 0.885,
    "impel-down": 0.875,
    "rain-dinners": 0.795,
    "shandora": 0.82,
    "marineford": 0.93,
}


def source(name: str) -> str:
    for ext in ("webp", "png"):
        path = os.path.join(SRC, f"{name}.{ext}")
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"no painting for {name} in {SRC}")


def hexcolor(pixels: np.ndarray) -> str:
    return "#%02x%02x%02x" % tuple(pixels.reshape(-1, 3).mean(axis=0).astype(int))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name, horizon in HORIZON.items():
        src = Image.open(source(name)).convert("RGB")
        W, H = src.size
        img = src.resize((WIDTH, round(H * WIDTH / W)), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.png"), optimize=True)
        a = np.asarray(img).astype(int)
        meta[name] = {
            # Line pinned on the floor's top edge (fraction of the height).
            "horizon": horizon,
            # Fills whatever the backdrop leaves uncovered.
            "sky": hexcolor(a[:6]),
        }
        print(name, img.size, meta[name])
    with open(os.path.join(ROOT, "apps", "web", "src", "generated", "stages.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
