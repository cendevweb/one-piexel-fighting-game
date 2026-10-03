"""Build every character's texture atlas from the ripped sheets.

    python3 tools/sprites/build_atlas.py [--contact out_dir] [id ...]

Reads `chars/<id>.json`, which says which detected frames make which
animation, and writes for each character:

    apps/web/public/sprites/<id>.png         the packed atlas
    apps/web/public/sprites/<id>-<name>.png  portraits and cut-in art
    apps/web/src/generated/sprites/<id>.json frame rectangles and anchors

Every animation is baked facing right. A row the rip drew facing left is
mirrored here (`"flip": true`), so the game only ever mirrors a fighter as a
whole.

Frame references in `chars/<id>.json`:
    "12:3"     band 12, frame 3
    "12:3+4"   band 12, frames 3 and 4 merged into one (a limb the detector
               separated from its body)
    "@x0,y0,x1,y1"  a raw sheet rectangle, for the few places where rows
               overlap and no band split can separate them
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from config import load_config
from sheet import Box, detect, feet_anchor, key_background, load

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(ROOT, "apps", "web", "public", "sprites")
GENERATED = os.path.join(ROOT, "apps", "web", "src", "generated", "sprites")
ATLAS_WIDTH = 1024
PAD = 1
# A limb this far in front of the feet counts as reaching out.
REACH_FROM = 10


def resolve(ref: str, bands: list[list[Box]]) -> Box:
    if ref.startswith("@"):
        x0, y0, x1, y1 = (int(v) for v in ref[1:].split(","))
        return Box(x0, y0, x1, y1)
    band_s, frames_s = ref.split(":")
    band = bands[int(band_s)]
    parts = [band[int(i)] for i in frames_s.split("+")]
    return Box(min(p.x0 for p in parts), min(p.y0 for p in parts),
               max(p.x1 for p in parts), max(p.y1 for p in parts))


def fx_anchor(img: np.ndarray, color: str | None = None, bottom: bool = False) -> tuple[int, int]:
    """Centre of an effect. `color: "blue"` only counts the blue part, so
    sound-effect lettering drawn over a blue blast does not drag the anchor
    from one frame to the next; `bottom` anchors on the lowest such pixel
    (a pillar growing from the ground)."""
    solid = img[:, :, 3] > 0
    if color == "blue":
        rgb = img[:, :, :3].astype(int)
        blue = solid & (rgb[:, :, 2] - rgb[:, :, 0] > 40)
        if blue.sum() > 8:
            solid = blue
    ys, xs = np.nonzero(solid)
    return int(round(xs.mean())), int(ys.max() if bottom else round(ys.mean()))


def reach(img: np.ndarray, ax: int, ay: int, front: int) -> list[int] | int:
    """What the frame holds in front of the body, relative to the feet
    (x forward, y up): [x0, y0, x1, y1], or 0 when nothing reaches out.

    This is what an attack's hitbox defaults to, so a stretched arm hits as
    far as it is drawn. `front` is how far the idle pose already reaches:
    only what sticks out beyond it counts."""
    solid = img[:, :, 3] > 96
    solid[:, :max(0, ax + front)] = False
    ys, xs = np.nonzero(solid)
    if xs.size < 6:
        return 0
    # The vertical extent comes from the outer part only: a lunging foot
    # sticks out a little, the fist sticks out a lot, and the box should be
    # where the fist is.
    far = xs >= ax + front + int((xs.max() - ax - front) * 0.35)
    return [front, ay - int(ys[far].max()) - 1, int(xs.max()) + 1 - ax, ay - int(ys[far].min())]


class Packer:
    """Shelf packing: good enough for a few hundred small frames."""

    def __init__(self, width: int) -> None:
        self.width = width
        self.x = PAD
        self.y = PAD
        self.shelf = 0

    def place(self, w: int, h: int) -> tuple[int, int]:
        if self.x + w + PAD > self.width:
            self.x = PAD
            self.y += self.shelf + PAD
            self.shelf = 0
        pos = (self.x, self.y)
        self.x += w + PAD
        self.shelf = max(self.shelf, h)
        return pos

    @property
    def height(self) -> int:
        return self.y + self.shelf + PAD


def build(cid: str, src: dict, contact_dir: str | None) -> None:
    seg = src.get("segment", {})
    path = os.path.join(ROOT, "assets", "sheets", src["sheet"])
    rgba = load(path, src.get("ignore"), src.get("cut", 24), src.get("fade", 24))
    bands = detect(rgba, seg.get("rowGap", 2), seg.get("colGap", 3))

    # Cut every referenced frame once, even when several animations share it.
    cache: dict[tuple, dict] = {}
    anims_out: dict[str, dict] = {}
    order: list[tuple] = []
    for name, anim in src["anims"].items():
        flip = bool(anim.get("flip"))
        fx = bool(anim.get("fx"))
        refs = []
        for i, ref in enumerate(anim["frames"]):
            back = anim.get("anchor") == "back" or i in anim.get("anchorBack", [])
            key = (ref, flip, fx, back, anim.get("anchorColor"), anim.get("anchorY"))
            if key not in cache:
                box = resolve(ref, bands)
                img = rgba[box.y0:box.y1, box.x0:box.x1].copy()
                if fx:
                    ax, ay = fx_anchor(img, anim.get("anchorColor"), anim.get("anchorY") == "bottom")
                else:
                    # "anchor": "back" looks for the feet behind the fighter
                    # only; a giant fist on the ground in front would
                    # otherwise drag the anchor forward.
                    side = None
                    if back:
                        side = "right" if flip else "left"
                    fx_, fy_ = feet_anchor(rgba, box, side)
                    ax, ay = fx_ - box.x0, fy_ - box.y0
                if flip:
                    img = img[:, ::-1]
                    ax = box.w - ax
                cache[key] = {"img": img, "ax": ax, "ay": ay}
                order.append(key)
            refs.append(key)
        nudges = anim.get("nudge", {})
        anims_out[name] = {"refs": refs, "nudges": nudges, "anim": anim}

    # Pack tallest first so shelves waste little.
    packer = Packer(ATLAS_WIDTH)
    for key in sorted(order, key=lambda k: -cache[k]["img"].shape[0]):
        h, w = cache[key]["img"].shape[:2]
        cache[key]["x"], cache[key]["y"] = packer.place(w, h)
    atlas = np.zeros((packer.height, ATLAS_WIDTH, 4), dtype=np.uint8)
    for key in order:
        c = cache[key]
        h, w = c["img"].shape[:2]
        atlas[c["y"]:c["y"] + h, c["x"]:c["x"] + w] = c["img"]

    os.makedirs(PUBLIC, exist_ok=True)
    os.makedirs(GENERATED, exist_ok=True)
    Image.fromarray(atlas).save(os.path.join(PUBLIC, f"{cid}.png"), optimize=True)

    front = REACH_FROM
    if "idle" in anims_out:
        idle = cache[anims_out["idle"]["refs"][0]]
        cols = np.flatnonzero((idle["img"][:, :, 3] > 96).any(axis=0))
        front = max(REACH_FROM, int(cols.max()) + 1 - idle["ax"] + 2)

    manifest: dict = {"id": cid, "front": front, "image": f"sprites/{cid}.png", "anims": {}, "images": {}}
    for name, a in anims_out.items():
        frames = []
        for i, key in enumerate(a["refs"]):
            c = cache[key]
            h, w = c["img"].shape[:2]
            dx, dy = a["nudges"].get(str(i), [0, 0])
            frames.append([c["x"], c["y"], w, h, c["ax"] - dx, c["ay"] - dy, reach(c["img"], c["ax"] - dx, c["ay"] - dy, front)])
        entry = {"frames": frames}
        for k in ("fps", "loop", "fx", "alpha", "behind"):
            if k in a["anim"]:
                entry[k] = a["anim"][k]
        manifest["anims"][name] = entry

    sheet_img = Image.open(path).convert("RGBA")
    for name, spec in src.get("images", {}).items():
        x0, y0, x1, y1 = spec["rect"]
        if spec.get("sheet"):
            # A still taken from another sheet of the same fighter (a better
            # portrait on a later game's sheet, for instance).
            other = Image.open(os.path.join(os.path.dirname(path), spec["sheet"])).convert("RGBA")
            if spec.get("key"):
                raw = np.asarray(other.convert("RGB"))
                img = Image.fromarray(key_background(raw, src.get("cut", 24), src.get("fade", 24))[y0:y1, x0:x1].copy())
            else:
                img = other.crop((x0, y0, x1, y1))
        elif spec.get("key"):
            # Keyed from the untouched sheet: art usually sits inside an
            # ignore rect, which would blank it.
            raw = np.asarray(sheet_img.convert("RGB"))
            img = Image.fromarray(key_background(raw, src.get("cut", 24), src.get("fade", 24))[y0:y1, x0:x1].copy())
        else:
            img = sheet_img.crop((x0, y0, x1, y1))
        if spec.get("flip"):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        img.save(os.path.join(PUBLIC, f"{cid}-{name}.png"), optimize=True)
        manifest["images"][name] = {"src": f"sprites/{cid}-{name}.png", "w": img.width, "h": img.height}

    with open(os.path.join(GENERATED, f"{cid}.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print(f"{cid}: {len(anims_out)} anims, {len(order)} frames, atlas {ATLAS_WIDTH}x{packer.height}")

    if contact_dir:
        write_contact(cid, manifest, atlas, contact_dir)


def write_contact(cid: str, manifest: dict, atlas: np.ndarray, out: str) -> None:
    """One strip per animation, every frame drawn at its anchor on a shared
    ground line with a cross at the anchor. Drift and wrong facing show up
    here and nowhere else."""
    os.makedirs(out, exist_ok=True)
    img_atlas = Image.fromarray(atlas)
    strips = []
    for name, anim in manifest["anims"].items():
        frames = anim["frames"]
        above = max(f[5] for f in frames)
        below = max(f[3] - f[5] for f in frames)
        left = max(f[4] for f in frames)
        right = max(f[2] - f[4] for f in frames)
        cell_w = left + right + 4
        h = above + below + 14
        strip = Image.new("RGBA", (70 + cell_w * len(frames), h), (44, 48, 56, 255))
        d = ImageDraw.Draw(strip)
        d.text((2, 2), name[:11], fill=(255, 220, 90, 255))
        for i, (x, y, w, fh, ax, ay, _reach) in enumerate(frames):
            ox = 70 + i * cell_w + left
            oy = 12 + above
            d.line((ox - cell_w // 2 + 2, oy, ox + cell_w // 2 - 2, oy), fill=(80, 90, 100, 255))
            strip.alpha_composite(img_atlas.crop((x, y, x + w, y + fh)), (ox - ax, oy - ay))
            d.line((ox - 2, oy, ox + 2, oy), fill=(255, 60, 60, 255))
            d.line((ox, oy - 2, ox, oy + 2), fill=(255, 60, 60, 255))
            d.text((ox - left + 1, 0), str(i), fill=(255, 255, 255, 255))
        strips.append(strip)
    # Pages of strips, so one image stays readable.
    page, pages, height = [], [], 0
    for s in strips:
        if height + s.height > 900 and page:
            pages.append(page)
            page, height = [], 0
        page.append(s)
        height += s.height + 2
    if page:
        pages.append(page)
    for n, pg in enumerate(pages):
        W = max(s.width for s in pg)
        H = sum(s.height + 2 for s in pg)
        img = Image.new("RGBA", (W, H), (18, 18, 22, 255))
        y = 0
        for s in pg:
            img.alpha_composite(s, (0, y))
            y += s.height + 2
        scale = 2 if W <= 900 else 1
        img.resize((W * scale, H * scale), Image.NEAREST).save(os.path.join(out, f"{cid}_anims_{n}.png"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--contact")
    args = ap.parse_args()
    config = load_config()
    for cid, src in config.items():
        if args.ids and cid not in args.ids:
            continue
        if "anims" not in src:
            continue
        build(cid, src, args.contact)


if __name__ == "__main__":
    main()
