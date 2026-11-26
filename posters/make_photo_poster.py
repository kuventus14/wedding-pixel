# Photo poster: the real album photo stays untouched, text + a real QR are laid on top.
# usage: python3 make_photo_poster.py PHOTO OUT URL "장소"
# Names and date come from data/db.json so no personal details live in this script.
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
ROOT = HERE.parent
photo_path, out, url, venue = sys.argv[1:5]
couple = json.load(open(ROOT / 'data/db.json'))['couple']

W, H = 2400, 3600
INK, GOLD, BLUSH = (47, 40, 34), (156, 123, 74), (217, 120, 140)
MYUNGJO = '/System/Library/Fonts/Supplemental/AppleMyungjo.ttf'
GOTHIC = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
DIDOT = '/System/Library/Fonts/Supplemental/Didot.ttc'
font = lambda path, size, index=0: ImageFont.truetype(path, size, index=index)

def korean_date(s):  # "2026. 11. 29. 일요일 오후 12시 30분" -> "2026년 11월 29일 일요일 오후 12시 30분"
    y, m, d, rest = [p.strip() for p in s.split('.', 3)]
    return f'{y}년 {m}월 {d}일 {rest}'

img = Image.open(photo_path).convert('RGB')
assert abs(img.width / img.height - 2 / 3) < 0.01, 'photo must be 2:3'
img = img.resize((W, H), Image.LANCZOS)

# Soft light behind the text so curtain shadows never fight the letters.
glow = Image.new('L', (W, H), 0)
ImageDraw.Draw(glow).ellipse((150, 160, W - 150, 1180), fill=150)
img.paste((255, 253, 249), mask=glow.filter(ImageFilter.GaussianBlur(140)))
d = ImageDraw.Draw(img)

def centered(text, y, f, fill, tracking=0):
    widths = [d.textlength(c, font=f) for c in text]
    x = (W - sum(widths) - tracking * (len(text) - 1)) / 2
    for c, w in zip(text, widths):
        d.text((x, y), c, font=f, fill=fill)
        x += w + tracking

centered('WEDDING GUESTBOOK', 300, font(DIDOT, 62), GOLD, tracking=22)

# Names with the app's pixel heart between them.
nf = font(MYUNGJO, 176)
g, b = couple['groom'], couple['bride']
gw, bw = d.textlength(g, font=nf), d.textlength(b, font=nf)
cell, gap = 12, 70
heart_w = 7 * cell
x = (W - gw - bw - heart_w - 2 * gap) / 2
d.text((x, 450), g, font=nf, fill=INK)
d.text((x + gw + 2 * gap + heart_w, 450), b, font=nf, fill=INK)
hx, hy = x + gw + gap, 450 + 70
for r, row in enumerate(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']):
    for c, on in enumerate(row):
        if on == '#':
            d.rectangle((hx + c * cell, hy + r * cell, hx + (c + 1) * cell - 1, hy + (r + 1) * cell - 1), fill=BLUSH)

d.line((W / 2 - 110, 735, W / 2 + 110, 735), fill=GOLD, width=3)
info = font(GOTHIC, 74, index=2)
centered(korean_date(couple['date']), 800, info, INK)
centered(venue, 910, info, INK)

# QR card on the clear floor right of the groom.
CARD = (1828, 2690, 2344, 3430)
shadow = Image.new('L', (W, H), 0)
ImageDraw.Draw(shadow).rounded_rectangle((CARD[0] + 8, CARD[1] + 18, CARD[2] + 8, CARD[3] + 18), 30, fill=110)
img.paste((70, 58, 45), mask=shadow.filter(ImageFilter.GaussianBlur(26)))
d = ImageDraw.Draw(img)
d.rounded_rectangle(CARD, 30, fill=(255, 253, 248), outline=GOLD, width=4)
side = 420
qx, qy = (CARD[0] + CARD[2] - side) // 2, CARD[1] + 48
qr_tmp = Path(out).resolve().with_suffix('.qr.png')
subprocess.run(['node', '-e', "require('qrcode').toFile(process.argv[1], process.argv[2], { width: +process.argv[3], margin: 1, errorCorrectionLevel: 'M' })",
                str(qr_tmp), url, str(side)], cwd=ROOT, check=True)
img.paste(Image.open(qr_tmp).convert('RGB').resize((side, side), Image.NEAREST), (qx, qy))
qr_tmp.unlink()
cap = font(GOTHIC, 40, index=4)
for i, line in enumerate(['QR을 찍고', '축하 메시지를 남겨 주세요']):
    w = d.textlength(line, font=cap)
    d.text(((CARD[0] + CARD[2] - w) / 2, qy + side + 46 + i * 60), line, font=cap, fill=INK)

# Hairline frame.
d.rectangle((56, 56, W - 57, H - 57), outline=(255, 255, 255), width=3)
img.save(out, quality=95)
print('ok', out, img.size)
