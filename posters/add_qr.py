# Pastes a real, scannable QR into the blank white square the image model left on a poster.
# usage: python3 add_qr.py poster.png out.png URL [scale]
# The model can't draw a working QR, so it only draws the empty square; this finds that square,
# upscales the poster for print and draws the QR crisply at the final size.
import subprocess, sys
from pathlib import Path
from PIL import Image

src, out, url = sys.argv[1], sys.argv[2], sys.argv[3]
scale = int(sys.argv[4]) if len(sys.argv) > 4 else 3
img = Image.open(src).convert('RGB')
W, H = img.size
px = img.load()
white = lambda x, y: min(px[x, y]) >= 238

def run(x, y, dx, dy):
    n = 0
    while 0 <= x < W and 0 <= y < H and white(x, y):
        x += dx; y += dy; n += 1
    return n

# The square sits on the vertical centre line in the lower half: find the longest white run there.
cx, best = W // 2, (0, 0)
y = H - 1
while y > H // 2:
    if white(cx, y):
        n = run(cx, y, 0, -1)
        if n > best[1]:
            best = (y - n + 1, n)
        y -= n
    else:
        y -= 1
top, height = best
mid = top + height // 2
left = cx - run(cx, mid, -1, 0) + 1
right = cx + run(cx, mid, 1, 0) - 1
width = right - left + 1
assert height > 0.12 * H and abs(width - height) < 0.08 * width, f'no blank square found: {left},{top} {width}x{height}'

big = img.resize((W * scale, H * scale), Image.LANCZOS)
inset = int(width * 0.04)
side = (min(width, height) - 2 * inset) * scale
qr_path = Path(out).resolve().with_suffix('.qr.png')
subprocess.run(['node', '-e', "require('qrcode').toFile(process.argv[1], process.argv[2], { width: +process.argv[3], margin: 1, errorCorrectionLevel: 'M' })",
                str(qr_path), url, str(side)], cwd=Path(__file__).parent.parent, check=True)
qr = Image.open(qr_path).convert('RGB').resize((side, side), Image.NEAREST)
big.paste(qr, (left * scale + (width * scale - side) // 2, top * scale + (height * scale - side) // 2))
qr_path.unlink()
big.save(out)
print(f'square {left},{top} {width}x{height} -> {out} {big.size}')
