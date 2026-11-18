#!/usr/bin/env python3
"""Render the "FPL / Sorted" lettering as a white-on-transparent 1024px layer.

Both words in Recoleta Bold, rendered by headless Chrome with the site's font
file. The two words are sized so their inked widths match exactly, and the
block is centred on the canvas — measured from the rendered pixels and
corrected, not estimated.

    letters.py OUT.png [block_width_fraction]
"""
import os, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.abspath(os.path.join(HERE, "..", "..", "static", "fonts", "Recoleta-Bold.woff2"))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
C = 1024


def render(fpl_px, sorted_px, fpl_top, sorted_top, fpl_dx, sorted_dx):
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:R;src:url('file://{FONT}');font-weight:700}}
html,body{{margin:0;background:transparent;width:{C}px;height:{C}px;overflow:hidden}}
div{{position:absolute;left:0;right:0;text-align:center;color:#fff;font:700 1px R;
     line-height:0;white-space:nowrap;-webkit-font-smoothing:antialiased}}
</style></head><body>
<div style="font-size:{fpl_px}px;top:{fpl_top}px;transform:translateX({fpl_dx}px);letter-spacing:-0.01em">FPL</div>
<div style="font-size:{sorted_px}px;top:{sorted_top}px;transform:translateX({sorted_dx}px);letter-spacing:-0.005em">Sorted</div>
</body></html>"""
    with tempfile.TemporaryDirectory() as tmp:
        page, shot = os.path.join(tmp, "l.html"), os.path.join(tmp, "l.png")
        open(page, "w").write(html)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--allow-file-access-from-files", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", "--virtual-time-budget=3000",
                        f"--window-size={C},{C}", f"--screenshot={shot}", f"file://{page}"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return Image.open(shot).convert("RGBA")


def measure(img):
    """Ink boxes of the two words: [(l, t, r, b), (l, t, r, b)]."""
    a = img.getchannel("A")
    W, H = a.size
    px = a.load()
    rows = [y for y in range(H) if any(px[x, y] > 128 for x in range(0, W, 2))]
    split = max(range(len(rows) - 1), key=lambda i: rows[i + 1] - rows[i])
    boxes = []
    for y0, y1 in ((rows[0], rows[split]), (rows[split + 1], rows[-1])):
        xs = [x for x in range(W) if any(px[x, y] > 128 for y in range(y0, y1 + 1, 2))]
        boxes.append((min(xs), y0, max(xs), y1))
    return boxes


def make(out, block_w=0.70, gap_frac=0.075):
    # Starting guesses (px on the 1024 canvas); corrected from measurements below.
    fpl, srt = 400.0, 230.0
    ftop, stop = 400.0, 700.0
    fdx = sdx = 0.0
    for _ in range(4):
        img = render(fpl, srt, ftop, stop, fdx, sdx)
        (fl, ft, fr, fb), (sl, st, sr, sb) = measure(img)
        fw, sw = fr - fl, sr - sl
        # widths: scale FPL to the target block width, Sorted to match FPL
        target = block_w * C
        fpl *= target / fw
        srt *= target / sw
        # horizontal: centre each word's ink
        fdx += (C / 2) - (fl + fr) / 2
        sdx += (C / 2) - (sl + sr) / 2
        # vertical: fixed gap between words, block centred
        fh, sh = (fb - ft) * target / fw, (sb - st) * target / sw
        gap = gap_frac * C
        block_h = fh + gap + sh
        top = (C - block_h) / 2
        # 'top' in CSS is the baseline (line-height 0); shift by measured offsets
        ftop += top - ft * 1.0 - (ft - ftop) * (target / fw - 1)
        stop += (top + fh + gap) - st - (st - stop) * (target / sw - 1)
    img = render(fpl, srt, ftop, stop, fdx, sdx)
    img.save(out)
    (fl, ft, fr, fb), (sl, st, sr, sb) = measure(img)
    print(f"FPL    x {fl}-{fr} (w {fr-fl})  y {ft}-{fb}")
    print(f"Sorted x {sl}-{sr} (w {sr-sl})  y {st}-{sb}")
    print(f"space above {ft}, below {C-1-sb}, gap {st-fb}, left {min(fl,sl)}, right {C-1-max(fr,sr)}")


if __name__ == "__main__":
    make(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.70)
