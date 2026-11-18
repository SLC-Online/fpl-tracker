#!/usr/bin/env python3
"""Generate the FPL Sorted logo and site icons.

    /usr/bin/python3 scripts/icons/make_icons.py

The mark is built as an Apple Icon Composer icon (white "FPL / Sorted"
lettering on a glass layer over a purple automatic gradient), compiled with
Xcode's actool and rendered by macOS itself, so the Liquid Glass look is
Apple's own rendering. Everything else is cut from that render:

  rounded tile  -> header logo, favicon.ico, favicon-96, icon-192/512 (PWA "any")
  square crop   -> apple-touch-icon (iOS rounds it), icon-maskable-512 (Android)

Needs: macOS with Xcode installed, Google Chrome (for the lettering), Pillow.
"""
import json, os, shutil, stat, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
STATIC = os.path.join(ROOT, "static")
sys.path.insert(0, HERE)
import letters  # noqa: E402

DEV = os.environ.get("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")

# Base colour for Apple's automatic gradient (it lightens towards the top).
# #5145d9: a step deeper than the site accent #6366f1, so the top of the tile
# lands near the accent and the bottom goes a deeper purple.
BASE = (0x51 / 255, 0x45 / 255, 0xd9 / 255)

# Lettering block width as a fraction of the icon canvas.
BLOCK_ROUNDED = 0.66   # rounded tile (the canvas is the tile)
BLOCK_SQUARE = 0.54    # square variant; after cropping to a full-bleed square
                       # the lettering ends up ~66% wide, clear of iOS/Android masks


def run(*cmd, **kw):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def render_glass(tmp, name, block, renderer):
    """Lettering -> .icon -> actool -> tiny app bundle -> macOS render at 1024px."""
    work = os.path.join(tmp, name)
    icon = os.path.join(work, f"{name}.icon")
    os.makedirs(os.path.join(icon, "Assets"))
    letters.make(os.path.join(icon, "Assets", "letters.png"), block)
    json.dump({
        "fill": {"automatic-gradient": "extended-srgb:%.5f,%.5f,%.5f,1.00000" % BASE},
        "groups": [{
            "layers": [{"glass": True, "image-name": "letters.png", "name": "Letters"}],
            "shadow": {"kind": "neutral", "opacity": 0.5},
            "translucency": {"enabled": True, "value": 0.3},
        }],
        "supported-platforms": {"squares": "shared"},
    }, open(os.path.join(icon, "icon.json"), "w"), indent=2)

    app = os.path.join(work, f"{name}.app")
    res = os.path.join(app, "Contents", "Resources")
    os.makedirs(res)
    os.makedirs(os.path.join(app, "Contents", "MacOS"))
    run("xcrun", "actool", icon, "--compile", res, "--platform", "macosx",
        "--minimum-deployment-target", "13.0", "--app-icon", name,
        "--output-partial-info-plist", os.path.join(work, "partial.plist"),
        "--errors", env={**os.environ, "DEVELOPER_DIR": DEV})
    # A bundle with no runnable executable gets a "prohibited" badge, so give it one.
    exe = os.path.join(app, "Contents", "MacOS", "stub")
    open(exe, "w").write("#!/bin/sh\n")
    os.chmod(exe, os.stat(exe).st_mode | stat.S_IEXEC)
    plist = os.path.join(app, "Contents", "Info.plist")
    for k, v in (("CFBundleIdentifier", f"local.fplsorted.iconrender.{name}.{os.getpid()}"),
                 ("CFBundlePackageType", "APPL"), ("CFBundleExecutable", "stub"),
                 ("CFBundleIconName", name), ("CFBundleIconFile", name)):
        run("/usr/libexec/PlistBuddy", "-c", f"Add :{k} string {v}", plist)
    run("codesign", "--force", "--sign", "-", app)

    out = os.path.join(work, "render.png")
    run(renderer, app, "1024", out)
    return Image.open(out).convert("RGBA")


def tile_box(img):
    """Bounds of the solid tile (excludes the soft drop shadow around it)."""
    a = img.getchannel("A").load()
    W, H = img.size
    xs = [x for x in range(W) if a[x, H // 2] > 200]
    ys = [y for y in range(H) if a[W // 2, y] > 200]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def full_bleed_square(img, box):
    """Largest centred square inside the tile that is fully opaque."""
    a = img.getchannel("A").load()
    l, t, r, b = box
    for d in range(0, (r - l) // 2):
        if all(a[x, y] == 255 for x, y in ((l + d, t + d), (r - 1 - d, t + d),
                                           (l + d, b - 1 - d), (r - 1 - d, b - 1 - d))):
            return l + d + 2, t + d + 2, r - d - 2, b - d - 2   # 2px for antialiasing
    raise RuntimeError("no opaque square found")


def save(img, name, size, rgb=False):
    out = img.resize((size, size), Image.LANCZOS)
    if rgb:
        out = out.convert("RGB")   # iOS shows transparency as black
    out.save(os.path.join(STATIC, name), optimize=True)
    print(f"wrote {name} ({size}px)")
    return out


def main():
    with tempfile.TemporaryDirectory() as tmp:
        renderer = os.path.join(tmp, "render_icon")
        run("xcrun", "swiftc", "-O", os.path.join(HERE, "render_icon.swift"), "-o", renderer)

        rounded = render_glass(tmp, "Rounded", BLOCK_ROUNDED, renderer)
        tile = rounded.crop(tile_box(rounded))

        square_src = render_glass(tmp, "Square", BLOCK_SQUARE, renderer)
        square = square_src.crop(full_bleed_square(square_src, tile_box(square_src)))

    # Header logo (shown at 40-46px CSS): 2x and 3x for sharp screens.
    save(tile, "logo@2x.png", 92)
    save(tile, "logo@3x.png", 138)
    # Browser tab / bookmarks / PWA "any".
    ico = [tile.resize((s, s), Image.LANCZOS) for s in (16, 32, 48)]
    ico[2].save(os.path.join(STATIC, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)],
                append_images=ico[:2])
    print("wrote favicon.ico (16, 32, 48)")
    save(tile, "favicon-96.png", 96)
    save(tile, "icon-192.png", 192)
    save(tile, "icon-512.png", 512)
    # Full-bleed squares: iOS and Android apply their own shape.
    save(square, "apple-touch-icon.png", 180, rgb=True)
    save(square, "icon-maskable-512.png", 512)


if __name__ == "__main__":
    main()
