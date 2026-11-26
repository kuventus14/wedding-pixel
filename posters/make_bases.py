# Builds the inputs for the GPT poster generations: a QR png, the pixel-hall reference crop,
# and the photo-poster base (album photo 7 + an empty QR card the model must keep blank).
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
ROOT = HERE.parent
url = sys.argv[1]

# QR: real modules come from the qrcode package, never from the image model.
subprocess.run(['node', '-e', f"require('qrcode').toFile('{HERE / 'qr.png'}', process.argv[1], {{ width: 600, margin: 2, errorCorrectionLevel: 'M' }})", url],
               cwd=ROOT, check=True)

# Pixel reference: stage, couple and the first rows of guests from the live hall.
Image.open(HERE / 'hall-shot.png').convert('RGB').crop((0, 160, 1000, 760)).save(HERE / 'ref-hall.png')

# Photo base: photo 7 is exactly 2:3, the model's 2:3 output is 1024x1536.
photo = Image.open(ROOT / 'data/photos/43840c97-7da0-4365-9300-003ee581bb64.jpg').convert('RGB').resize((1024, 1536), Image.LANCZOS)
CARD = (780, 1150, 1000, 1470)   # x0, y0, x1, y1 — clear floor/curtain right of the groom
QR_BOX = (805, 1175, 975, 1345)  # the blank square the real QR goes into later
shadow = Image.new('L', photo.size, 0)
ImageDraw.Draw(shadow).rounded_rectangle((CARD[0] + 4, CARD[1] + 8, CARD[2] + 4, CARD[3] + 8), 18, fill=90)
photo.paste((60, 50, 40), mask=shadow.filter(ImageFilter.GaussianBlur(12)))
d = ImageDraw.Draw(photo)
d.rounded_rectangle(CARD, 18, fill=(255, 253, 248), outline=(201, 168, 106), width=3)
d.rectangle(QR_BOX, fill=(226, 226, 226))
photo.save(HERE / 'base-photo.png')
print('ok', QR_BOX)
