#!/usr/bin/env python3
"""Generate the FPL Sorted site icons (favicon, Apple touch icon, PWA icons).

    /usr/bin/python3 scripts/icons/make_icons.py

Renders the mark with the site's own fonts (Söhne Bold for "FPL", Recoleta Bold
for "Sorted") in headless Chrome, so the lettering matches the site exactly,
then writes the PNG/ICO files into static/.

Needs Google Chrome and Pillow.
"""
import os, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FONTS = os.path.join(ROOT, "static", "fonts")
OUT = os.path.join(ROOT, "static")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ACCENT = "#6366f1"   # --color-accent, same as the header badge

# Layout, as fractions of the icon's side. Tuned by eye at real sizes.
FPL_SIZE = 0.40      # cap height drives this: "FPL" is the dominant word
SORTED_SIZE = 0.215
FPL_Y = 0.392        # baseline of "FPL"
SORTED_Y = 0.688     # baseline of "Sorted"
RADIUS = 0.225       # corner radius for the rounded (favicon / "any") variant
FPL_DX = -0.008      # optical nudge: Söhne's F/L side bearings leave "FPL" sitting right of centre

# Each job: (file name, pixel size, variant)
#   rounded  - rounded square on transparency (favicons, PWA "any")
#   square   - full-bleed square, no transparency (Apple touch icon; iOS rounds it)
#   maskable - full-bleed, content shrunk into the 80% safe zone (Android masks)
JOBS = [
    ("_ico16", 16, "rounded"),
    ("_ico32", 32, "rounded"),
    ("_ico48", 48, "rounded"),
    ("favicon-96.png", 96, "rounded"),
    ("apple-touch-icon.png", 180, "square"),
    ("icon-192.png", 192, "rounded"),
    ("icon-512.png", 512, "rounded"),
    ("icon-maskable-512.png", 512, "maskable"),
]


def tile(size, variant):
    scale = 0.80 if variant == "maskable" else 1.0
    radius = f"{RADIUS * size:.2f}px" if variant == "rounded" else "0"

    def word(text, cls, frac, base, dx=0.0):
        fs = frac * size * scale
        # Baseline position measured from the centre so the maskable variant
        # shrinks towards the middle.
        top = size / 2 + (base - 0.5) * size * scale
        return (f'<div class="w {cls}" style="font-size:{fs:.3f}px;'
                f'top:{top:.3f}px;transform:translateX({dx * size * scale:.3f}px)">{text}</div>')

    return (f'<div class="tile" style="width:{size}px;height:{size}px;border-radius:{radius}">'
            + word("FPL", "fpl", FPL_SIZE, FPL_Y, FPL_DX)
            + word("Sorted", "sorted", SORTED_SIZE, SORTED_Y)
            + "</div>")


def build_page():
    gap = 24
    y = gap
    placed = []
    body = []
    for name, size, variant in JOBS:
        body.append(f'<div style="position:absolute;left:{gap}px;top:{y}px">{tile(size, variant)}</div>')
        placed.append((name, size, y))
        y += size + gap
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Sohne;src:url('file://{FONTS}/Sohne-Bold.otf');font-weight:700}}
@font-face{{font-family:Recoleta;src:url('file://{FONTS}/Recoleta-Bold.woff2');font-weight:700}}
html,body{{margin:0;background:transparent}}
.tile{{position:relative;background:{ACCENT};overflow:hidden}}
.w{{position:absolute;left:0;right:0;text-align:center;color:#fff;line-height:0;
    font-weight:700;white-space:nowrap;-webkit-font-smoothing:antialiased}}
.fpl{{font-family:Sohne;letter-spacing:-0.01em}}
.sorted{{font-family:Recoleta;letter-spacing:-0.005em}}
</style></head><body>{''.join(body)}</body></html>"""
    return html, placed, y


def main():
    html, placed, height = build_page()
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "icons.html")
        shot = os.path.join(tmp, "sheet.png")
        open(page, "w").write(html)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--allow-file-access-from-files", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", "--virtual-time-budget=4000",
                        f"--window-size=600,{height}", f"--screenshot={shot}", f"file://{page}"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sheet = Image.open(shot).convert("RGBA")

    gap = 24
    ico = {}
    for name, size, y in placed:
        img = sheet.crop((gap, y, gap + size, y + size))
        if name.startswith("_ico"):
            ico[size] = img
            continue
        if name == "apple-touch-icon.png":
            img = img.convert("RGB")          # iOS shows transparency as black
        img.save(os.path.join(OUT, name), optimize=True)
        print("wrote", name, img.size)

    ico[48].save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)],
                 append_images=[ico[16], ico[32]])
    print("wrote favicon.ico (16, 32, 48)")
    if "--sheet" in sys.argv:
        sheet.save(os.path.join(tempfile.gettempdir(), "icon_sheet.png"))


if __name__ == "__main__":
    main()
