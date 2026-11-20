#!/usr/bin/env python3
"""アプリアイコン・ファビコンを作り直す。

  python3 tools/make-icons.py

3種類（a / b / c）を icons/a, icons/b, icons/c に書き出す。
形は下の GEOMETRY にまとめてあり、SVG と PNG の両方を同じ寸法から作る。
PNG は 4倍で描いてから縮めて、ふちをなめらかにしている。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

ROOT = Path(__file__).resolve().parent.parent
S = 512          # 基準の大きさ
SS = 4           # 何倍で描くか（なめらかにするため）
SIZES = {'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180,
         'favicon-32.png': 32, 'favicon-16.png': 16}

NAVY = '#214B86'
AMBER = '#F6B335'
CREAM = '#FBF7EF'

# ---- 形の定義（512×512 の中での位置）----
# a：K の字。縦棒と、上下2枚の葉
A_BAR = (150, 120, 214, 392)
A_LEAF_UP = (214, 118, 384, 288)     # 右上を向く葉（黄）
A_LEAF_DOWN = (214, 222, 384, 392)   # 右下を向く葉（紺）
# b：丸と四分円
B_CIRCLE = (133, 133, 277, 277)      # 黄の丸
B_QUARTER = (200, 200, 392, 392)     # クリームの四分円（右下が直角）
# c：半分ずつの丸
C_CIRCLE = (126, 126, 386, 386)


def mask(size, draw_fn):
    m = Image.new('L', (size, size), 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def leaf_mask(size, box, up):
    """葉の形＝2つの円が重なった部分。up=True なら右上を向く"""
    x0, y0, x1, y1 = [v * size // S for v in box]
    r = x1 - x0
    c1 = (x0, y0) if up else (x0, y1)          # 円の中心（左上 or 左下）
    c2 = (x1, y1) if up else (x1, y0)          # 円の中心（右下 or 右上）
    a = mask(size, lambda d: d.ellipse([c1[0] - r, c1[1] - r, c1[0] + r, c1[1] + r], fill=255))
    b = mask(size, lambda d: d.ellipse([c2[0] - r, c2[1] - r, c2[0] + r, c2[1] + r], fill=255))
    return ImageChops.multiply(a, b)


def paste(img, color, m):
    img.paste(Image.new('RGB', img.size, color), (0, 0), m)


def render(variant, size):
    px = lambda v: v * size // S
    img = Image.new('RGB', (size, size), {'a': CREAM, 'b': NAVY, 'c': AMBER}[variant])
    d = ImageDraw.Draw(img)
    if variant == 'a':
        d.rectangle([px(A_BAR[0]), px(A_BAR[1]), px(A_BAR[2]), px(A_BAR[3])], fill=NAVY)
        paste(img, AMBER, leaf_mask(size, A_LEAF_UP, True))
        paste(img, NAVY, leaf_mask(size, A_LEAF_DOWN, False))
    elif variant == 'b':
        d.ellipse([px(v) for v in B_CIRCLE], fill=AMBER)
        x0, y0, x1, y1 = [px(v) for v in B_QUARTER]
        r = x1 - x0
        # 右下を直角にした四分円（中心は右下の角）
        d.pieslice([x1 - r, y1 - r, x1 + r, y1 + r], 180, 270, fill=CREAM)
    else:
        d.ellipse([px(v) for v in C_CIRCLE], fill=CREAM)
        x0, y0, x1, y1 = [px(v) for v in C_CIRCLE]
        d.pieslice([x0, y0, x1, y1], -90, 90, fill=NAVY)
    return img


def svg(variant):
    bg = {'a': CREAM, 'b': NAVY, 'c': AMBER}[variant]
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="KESELA">\n'
            f'  <rect width="{S}" height="{S}" rx="112" fill="{bg}"/>\n')
    if variant == 'a':
        x0, y0, x1, y1 = A_BAR
        u = A_LEAF_UP
        dn = A_LEAF_DOWN
        ru = u[2] - u[0]
        rd = dn[2] - dn[0]
        body = (f'  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="{NAVY}"/>\n'
                f'  <path d="M {u[0]} {u[3]} A {ru} {ru} 0 0 1 {u[2]} {u[1]} A {ru} {ru} 0 0 1 {u[0]} {u[3]} Z" fill="{AMBER}"/>\n'
                f'  <path d="M {dn[0]} {dn[1]} A {rd} {rd} 0 0 0 {dn[2]} {dn[3]} A {rd} {rd} 0 0 0 {dn[0]} {dn[1]} Z" fill="{NAVY}"/>\n')
    elif variant == 'b':
        cx = (B_CIRCLE[0] + B_CIRCLE[2]) / 2
        cy = (B_CIRCLE[1] + B_CIRCLE[3]) / 2
        r = (B_CIRCLE[2] - B_CIRCLE[0]) / 2
        qx0, qy0, qx1, qy1 = B_QUARTER
        qr = qx1 - qx0
        body = (f'  <circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="{AMBER}"/>\n'
                f'  <path d="M {qx1} {qy1} L {qx1} {qy0} A {qr} {qr} 0 0 0 {qx0} {qy1} Z" fill="{CREAM}"/>\n')
    else:
        cx = (C_CIRCLE[0] + C_CIRCLE[2]) / 2
        cy = (C_CIRCLE[1] + C_CIRCLE[3]) / 2
        r = (C_CIRCLE[2] - C_CIRCLE[0]) / 2
        body = (f'  <path d="M {cx:g} {cy - r:g} A {r:g} {r:g} 0 0 0 {cx:g} {cy + r:g} Z" fill="{CREAM}"/>\n'
                f'  <path d="M {cx:g} {cy - r:g} A {r:g} {r:g} 0 0 1 {cx:g} {cy + r:g} Z" fill="{NAVY}"/>\n')
    return head + body + '</svg>\n'


for variant in ('a', 'b', 'c'):
    out = ROOT / 'icons' / variant
    out.mkdir(parents=True, exist_ok=True)
    big = render(variant, S * SS)
    for name, size in SIZES.items():
        big.resize((size, size), Image.LANCZOS).save(out / name)
    (out / 'favicon.svg').write_text(svg(variant), encoding='utf-8')
    print(f'icons/{variant}/ に {len(SIZES)} 個の PNG と favicon.svg を書き出しました')
