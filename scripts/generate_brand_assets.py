"""One-off script: generate Fit Friends icon/logo assets from FFlogo.png."""
from PIL import Image, ImageOps, ImageChops
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, "FFlogo.png")).convert("RGBA")

# Crop just the "F" mark (top portion, no wordmark), with a little padding.
PAD = 15
mark_box = (102 - PAD, 67 - PAD, 503 + PAD, 401)
mark = src.crop(mark_box)

# Full logo (mark + wordmark), tightly cropped.
full_box = (90, 55, 510, 500)
full = src.crop(full_box)


def invert_rgba(img):
    r, g, b, a = img.split()
    r = ImageOps.invert(r)
    g = ImageOps.invert(g)
    b = ImageOps.invert(b)
    return Image.merge("RGBA", (r, g, b, a))


def black_to_transparent(img, threshold=30):
    r, g, b, a = img.split()
    gray = Image.merge("RGB", (r, g, b)).convert("L")
    mask = gray.point(lambda p: 0 if p < threshold else 255)
    new_alpha = ImageChops.multiply(a, mask)
    out = img.copy()
    out.putalpha(new_alpha)
    return out


def square_pad(img, size, bg, scale=0.8):
    canvas = Image.new("RGBA", (size, size), bg)
    w, h = img.size
    factor = (size * scale) / max(w, h)
    nw, nh = max(1, int(w * factor)), max(1, int(h * factor))
    resized = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas


# White-mark-on-transparent versions (for dark backgrounds)
mark_white_on_transparent = black_to_transparent(invert_rgba(mark))
full_white_on_transparent = black_to_transparent(invert_rgba(full))

assets = os.path.join(ROOT, "mobile", "assets")
public = os.path.join(ROOT, "mobile", "public")
os.makedirs(public, exist_ok=True)

# 1. App icon / web favicon source — white bg, black mark, opaque
icon = square_pad(mark, 1024, (255, 255, 255, 255), scale=0.8).convert("RGB")
icon.save(os.path.join(assets, "icon.png"))

# 2. Android adaptive icon foreground — transparent bg, white mark
#    (pairs with android.adaptiveIcon.backgroundColor "#0a0a0a")
adaptive = square_pad(mark_white_on_transparent, 1024, (0, 0, 0, 0), scale=0.55)
adaptive.save(os.path.join(assets, "adaptive-icon.png"))

# 3. Splash screen — transparent bg, white mark + wordmark
#    (pairs with splash backgroundColor "#0a0a0a", resizeMode "contain")
splash_w, splash_h = 1284, 2778
splash = Image.new("RGBA", (splash_w, splash_h), (0, 0, 0, 0))
fw, fh = full_white_on_transparent.size
target_w = int(splash_w * 0.55)
factor = target_w / fw
resized = full_white_on_transparent.resize((target_w, int(fh * factor)), Image.LANCZOS)
sx = (splash_w - resized.width) // 2
sy = int(splash_h * 0.34) - resized.height // 2
splash.paste(resized, (sx, sy), resized)
splash.save(os.path.join(assets, "splash.png"))

# 4. Full logo, white-on-transparent — for dark-background headers (e.g. login screen)
full_white_on_transparent.save(os.path.join(assets, "logo-full-white.png"))

# 5. PWA icons — white bg, black mark, opaque
for name, size, scale in [
    ("icon-192.png", 192, 0.8),
    ("icon-512.png", 512, 0.8),
    ("apple-touch-icon.png", 180, 0.75),
]:
    img = square_pad(mark, size, (255, 255, 255, 255), scale=scale).convert("RGB")
    img.save(os.path.join(public, name))

# Debug previews: composite transparent assets onto a dark bg for visual review
debug = os.path.join(ROOT, "scripts", "_debug_preview")
os.makedirs(debug, exist_ok=True)
for name, img in [
    ("adaptive-icon.png", adaptive),
    ("splash.png", splash),
    ("logo-full-white.png", full_white_on_transparent),
]:
    bg = Image.new("RGBA", img.size, (10, 10, 10, 255))
    bg.alpha_composite(img)
    bg.convert("RGB").save(os.path.join(debug, name))

print("done")
