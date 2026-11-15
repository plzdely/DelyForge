"""Draws the DelyForge mark (same geometry as components/brand/logo.tsx) into build/icon.png and build/icon.ico."""
from PIL import Image, ImageDraw

S = 1024
u = S / 32  # one logo unit in pixels


def P(x, y):
    return (x * u, y * u)


# Diagonal gradient #9a7cff -> #5a56f0
a, b = (0x9A, 0x7C, 0xFF), (0x5A, 0x56, 0xF0)
grad = Image.new('RGB', (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * (S - 1))
        px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=8.5 * u, fill=255)
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
white = (255, 255, 255, 255)
w1, w2 = round(2.4 * u), round(2.2 * u)


def dot(x, y, w):
    r = w / 2
    d.ellipse((x * u - r, y * u - r, x * u + r, y * u + r), fill=white)


# The "D": top bar, half circle (centre 15.75,16, radius 7.5), bottom bar, left side
d.line([P(9.5, 8.5), P(15.75, 8.5)], fill=white, width=w1)
# Pillow draws arc width inward from the box, so grow the box by half the stroke to centre it on radius 7.5.
h = w1 / 2
d.arc((15.75 * u - 7.5 * u - h, 8.5 * u - h, 15.75 * u + 7.5 * u + h, 23.5 * u + h), start=-90, end=90, fill=white, width=w1)
d.line([P(15.75, 23.5), P(9.5, 23.5)], fill=white, width=w1)
d.line([P(9.5, 23.5), P(9.5, 8.5)], fill=white, width=w1)
for x, y in [(9.5, 8.5), (9.5, 23.5)]:
    dot(x, y, w1)
# The prompt chevron
d.line([P(13.4, 13.2), P(16, 16), P(13.4, 18.8)], fill=white, width=w2, joint='curve')
for x, y in [(13.4, 13.2), (16, 16), (13.4, 18.8)]:
    dot(x, y, w2)

big = img.resize((512, 512), Image.LANCZOS)
big.save('build/icon.png')
img.resize((256, 256), Image.LANCZOS).save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon written')
