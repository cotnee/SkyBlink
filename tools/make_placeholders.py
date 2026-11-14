"""Generate placeholder PNG/GIF images for the SkyBlink discovery-page sample data.

Run from the deliverable root:  python3 tools/make_placeholders.py
Needs Pillow + numpy. Real images come from the engine notebook; these only
exist so the pages can be tested before real data lands in site/data/.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sample-data", "data", "barnard")
FAST = os.path.join(ROOT, "fast")
SLOW = os.path.join(ROOT, "slow")
GRID = 60          # engine grid is 60x60 px
SCALE = 4          # upscale for display
rng = np.random.default_rng(42)


def blob(img, x, y, amp, sigma=1.3):
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
    img += amp * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma ** 2))


def to_pil(arr, lo=-2.5, hi=6.0, tint=(1.0, 1.0, 1.0)):
    a = np.clip((arr - lo) / (hi - lo), 0, 1)
    a = np.sqrt(a)
    rgb = np.stack([a * tint[0], a * tint[1], a * tint[2]], axis=-1)
    im = Image.fromarray((rgb * 255).astype(np.uint8), "RGB")
    return im.resize((arr.shape[1] * SCALE, arr.shape[0] * SCALE), Image.NEAREST)


def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def label(im, text, size=13):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, size + 8], fill=(0, 0, 0))
    d.text((5, 3), text, fill=(255, 255, 255), font=font(size))
    return im


def ring(im, x, y, r=14, color=(255, 80, 120)):
    d = ImageDraw.Draw(im)
    d.ellipse([x - r, y - r, x + r, y + r], outline=color, width=2)
    return im


def star_field(n=14):
    base = rng.normal(0, 1, (GRID, GRID))
    stars = [(rng.uniform(3, 57), rng.uniform(3, 57), rng.uniform(4, 20)) for _ in range(n)]
    return base, stars


def candidate_images(cid, gx, gy, vx, vy, amp, days, placeholder_note):
    """3-panel PNG (half 1 stack | half 2 stack | full shift-and-stack) and a GIF."""
    # candidates.json uses bottom-left origin; images use top-left
    px, py = gx, GRID - 1 - gy
    panels = []
    for title, a, noise in (("Half 1 stack", amp * 0.68, 1.0), ("Half 2 stack", amp * 0.72, 1.0),
                            ("Full shift-and-stack", amp, 0.75)):
        arr = rng.normal(0, noise, (GRID, GRID))
        blob(arr, px, py, a)
        im = label(to_pil(arr), title)
        ring(im, px * SCALE, py * SCALE)
        panels.append(im)
    w = sum(p.width for p in panels) + 8 * (len(panels) - 1)
    out = Image.new("RGB", (w, panels[0].height + 22), (12, 14, 24))
    x = 0
    for p in panels:
        out.paste(p, (x, 0))
        x += p.width + 8
    ImageDraw.Draw(out).text((6, panels[0].height + 4), placeholder_note, fill=(160, 170, 200), font=font(12))
    out.save(os.path.join(FAST, f"{cid}.png"))

    frames = []
    base, stars = star_field()
    n = 12
    for i in range(n):
        t = days * i / (n - 1)
        arr = base * 0.4 + rng.normal(0, 0.9, (GRID, GRID))
        for sx, sy, sa in stars:
            blob(arr, sx, sy, sa, 1.1)
        ox = px + vx * (t - days / 2)
        oy = py - vy * (t - days / 2)
        blob(arr, ox, oy, amp * 0.9)
        im = to_pil(arr, -2.5, 12)
        ring(im, ox * SCALE, oy * SCALE, 12)
        label(im, f"day {t:4.1f}  (placeholder)", 12)
        frames.append(im.convert("P", palette=Image.ADAPTIVE))
    frames[0].save(os.path.join(FAST, f"{cid}.gif"), save_all=True, append_images=frames[1:],
                   duration=250, loop=0)


SLOW_SIZE = 80     # manifest frames are 80x80 px; highlight x,y are in these pixels (top-left origin)
SLOW_POS = {"wise_2010.png": (40, 54), "spherex_2026.png": (40, 27)}


def slow_images():
    # Barnard's Star moved ~168" north between WISE 2010 and SPHEREx 2026 (~27 px at 6.15"/px)
    base = rng.normal(0, 1, (SLOW_SIZE, SLOW_SIZE))
    stars = [(rng.uniform(3, 77), rng.uniform(3, 77), rng.uniform(4, 20)) for _ in range(24)]
    for name, (bx, by) in SLOW_POS.items():
        arr = base * 0.5 + rng.normal(0, 0.6, (SLOW_SIZE, SLOW_SIZE))
        for sx, sy, sa in stars:
            blob(arr, sx, sy, sa, 1.1)
        blob(arr, bx, by, 60, 1.6)
        a = np.sqrt(np.clip((arr + 2) / 32, 0, 1))
        Image.fromarray((a * 255).astype(np.uint8), "L").save(os.path.join(SLOW, name))


if __name__ == "__main__":
    os.makedirs(FAST, exist_ok=True)
    os.makedirs(SLOW, exist_ok=True)
    note = "PLACEHOLDER image - replace with engine output"
    candidate_images("barnard_cand_1", 45, 12, -0.2, 0.15, 7.0, 37, note)
    candidate_images("barnard_cand_2", 22, 41, 0.31, -0.05, 5.5, 37, note)
    candidate_images("barnard_rej_1", 30, 30, 0.01, 0.0, 9.0, 37, note)
    slow_images()
    print("done")
