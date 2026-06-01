#!/usr/bin/env python3
"""Genera los stickers de productos (estilo ícono-app: azulejo redondeado de
color + símbolo blanco) en src/assets/stickers/ a @1x/@2x/@3x.

Requisitos: Python 3 + Pillow  ->  pip3 install pillow
Uso:        python3 tools/gen_stickers.py

Para sumar un sticker: agregá una función g_<id>(d, color), sumá (id, color) a
STICKERS, y agregá la línea correspondiente en src/assets/stickers/index.ts.
"""
from PIL import Image, ImageDraw
import math
import os

M = 512                      # lienzo maestro (supersample); se reduce al final
PAD = int(M * 0.06)
R = int(M * 0.235)           # radio de esquina del azulejo
WHITE = (255, 255, 255, 255)
CX = CY = M // 2
U = (M - 2 * PAD) // 2       # media-área interna
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "stickers")
SIZES = {"": 64, "@2x": 128, "@3x": 192}


def tile(color):
    img = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([PAD, PAD, M - PAD, M - PAD], radius=R, fill=color + (255,))
    return img, d


def poly(d, pts, fill=WHITE): d.polygon(pts, fill=fill)
def circ(d, cx, cy, r, fill=WHITE): d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
def rr(d, box, rad, fill=WHITE): d.rounded_rectangle(box, radius=rad, fill=fill)


def g_droplet(d, *_):
    r = int(U * 0.6); cy = CY + int(U * 0.32)
    circ(d, CX, cy, r)
    poly(d, [(CX, CY - int(U * 0.82)), (CX - r, cy - int(r * 0.2)), (CX + r, cy - int(r * 0.2))])


def g_bidon(d, *_):
    w = int(U * 0.95); h = int(U * 1.45)
    rr(d, [CX - w // 2, CY - h // 2 + int(U * 0.18), CX + w // 2, CY + h // 2], int(U * 0.22))
    nw = int(U * 0.34)
    rr(d, [CX - nw // 2, CY - h // 2 - int(U * 0.10), CX + nw // 2, CY - h // 2 + int(U * 0.28)], int(U * 0.06))
    rr(d, [CX - nw, CY - h // 2 - int(U * 0.30), CX + nw, CY - h // 2 - int(U * 0.02)], int(U * 0.08))


def g_bidon_mini(d, *_):
    w = int(U * 0.8); h = int(U * 1.05)
    rr(d, [CX - w // 2, CY - h // 2 + int(U * 0.18), CX + w // 2, CY + h // 2], int(U * 0.20))
    nw = int(U * 0.30)
    rr(d, [CX - nw, CY - h // 2 - int(U * 0.16), CX + nw, CY - h // 2 + int(U * 0.20)], int(U * 0.07))


def g_bottle(d, *_):
    w = int(U * 0.62); h = int(U * 1.55); bot = CY + int(h * 0.5)
    rr(d, [CX - w // 2, CY - int(h * 0.12), CX + w // 2, bot], int(U * 0.16))
    poly(d, [(CX - w // 2, CY - int(h * 0.10)), (CX - int(U * 0.16), CY - int(h * 0.40)),
             (CX + int(U * 0.16), CY - int(h * 0.40)), (CX + w // 2, CY - int(h * 0.10))])
    rr(d, [CX - int(U * 0.16), CY - int(h * 0.55), CX + int(U * 0.16), CY - int(h * 0.34)], int(U * 0.04))


def g_truck(d, color):
    cw = int(U * 0.95); ch = int(U * 0.85)
    rr(d, [CX - int(U * 1.05), CY - ch // 2, CX - int(U * 1.05) + cw, CY + ch // 2], int(U * 0.10))
    cab_x = CX - int(U * 1.05) + cw
    poly(d, [(cab_x, CY - int(ch * 0.5)), (cab_x + int(U * 0.55), CY - int(ch * 0.18)),
             (cab_x + int(U * 0.85), CY - int(ch * 0.18)), (cab_x + int(U * 0.85), CY + ch // 2), (cab_x, CY + ch // 2)])
    rr(d, [cab_x, CY - int(ch * 0.5), cab_x + int(U * 0.3), CY + ch // 2], int(U * 0.05))
    wy = CY + int(ch * 0.5)
    for wx in [CX - int(U * 0.6), cab_x + int(U * 0.45)]:
        circ(d, wx, wy, int(U * 0.26)); circ(d, wx, wy, int(U * 0.13), fill=color + (255,))


def g_star(d, *_):
    pts = []; R1 = int(U * 0.95); R2 = int(U * 0.42)
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5; r = R1 if i % 2 == 0 else R2
        pts.append((CX + r * math.cos(ang), CY + r * math.sin(ang)))
    poly(d, pts)


def g_cart(d, color):
    poly(d, [(CX - int(U * 0.75), CY - int(U * 0.45)), (CX + int(U * 0.85), CY - int(U * 0.45)),
             (CX + int(U * 0.6), CY + int(U * 0.4)), (CX - int(U * 0.5), CY + int(U * 0.4))])
    d.line([(CX - int(U * 0.95), CY - int(U * 0.8)), (CX - int(U * 0.75), CY - int(U * 0.8)),
            (CX - int(U * 0.6), CY - int(U * 0.45))], fill=WHITE, width=int(U * 0.16), joint="curve")
    wy = CY + int(U * 0.72)
    for wx in [CX - int(U * 0.35), CX + int(U * 0.45)]:
        circ(d, wx, wy, int(U * 0.18))


def g_soda(d, color):
    poly(d, [(CX - int(U * 0.6), CY - int(U * 0.55)), (CX + int(U * 0.6), CY - int(U * 0.55)),
             (CX + int(U * 0.42), CY + int(U * 0.9)), (CX - int(U * 0.42), CY + int(U * 0.9))])
    d.line([(CX + int(U * 0.2), CY - int(U * 0.55)), (CX + int(U * 0.55), CY - int(U * 1.0))], fill=WHITE, width=int(U * 0.16))


def g_dispenser(d, color):
    rr(d, [CX - int(U * 0.7), CY - int(U * 0.1), CX + int(U * 0.7), CY + int(U * 1.0)], int(U * 0.14))
    poly(d, [(CX - int(U * 0.5), CY - int(U * 0.15)), (CX + int(U * 0.5), CY - int(U * 0.15)),
             (CX + int(U * 0.36), CY - int(U * 0.55)), (CX - int(U * 0.36), CY - int(U * 0.55))])
    rr(d, [CX - int(U * 0.45), CY - int(U * 1.15), CX + int(U * 0.45), CY - int(U * 0.5)], int(U * 0.16))
    circ(d, CX, CY + int(U * 0.45), int(U * 0.16), fill=color + (255,))


def g_box(d, color):
    s = int(U * 0.9)
    rr(d, [CX - s, CY - int(s * 0.82), CX + s, CY + int(s * 0.95)], int(U * 0.12))
    lid = CY - int(s * 0.38)
    d.line([(CX - s, lid), (CX + s, lid)], fill=color + (255,), width=int(U * 0.13))            # costura de tapa
    d.line([(CX, CY - int(s * 0.82)), (CX, lid)], fill=color + (255,), width=int(U * 0.13))      # cinta entre solapas


def g_juice(d, color):
    w = int(U * 0.62)
    rr(d, [CX - w, CY - int(U * 0.35), CX + w, CY + int(U * 1.0)], int(U * 0.08))
    poly(d, [(CX - w, CY - int(U * 0.3)), (CX, CY - int(U * 0.85)), (CX + w, CY - int(U * 0.3))])  # techo de cartón
    d.line([(CX + int(U * 0.28), CY - int(U * 0.6)), (CX + int(U * 0.62), CY - int(U * 1.02))], fill=WHITE, width=int(U * 0.13))


def g_drop_plus(d, color):
    r = int(U * 0.6); cy = CY + int(U * 0.32)
    circ(d, CX, cy, r)
    poly(d, [(CX, CY - int(U * 0.82)), (CX - r, cy - int(r * 0.2)), (CX + r, cy - int(r * 0.2))])
    d.line([(CX - int(U * 0.26), cy), (CX + int(U * 0.26), cy)], fill=color + (255,), width=int(U * 0.15))
    d.line([(CX, cy - int(U * 0.26)), (CX, cy + int(U * 0.26))], fill=color + (255,), width=int(U * 0.15))


def g_ice(d, color):  # copo de nieve
    n = int(U * 0.9); w = int(U * 0.13)
    for k in range(3):
        a = math.radians(90 + k * 60); dx, dy = math.cos(a) * n, math.sin(a) * n
        d.line([(CX - dx, CY - dy), (CX + dx, CY + dy)], fill=WHITE, width=w)
    for k in range(6):
        a = math.radians(k * 60); tx, ty = CX + math.cos(a) * n, CY + math.sin(a) * n
        for sgn in (1, -1):
            b = a + math.radians(40 * sgn); bl = U * 0.28
            d.line([(tx, ty), (tx + math.cos(b) * -bl, ty + math.sin(b) * -bl)], fill=WHITE, width=w)
    circ(d, CX, CY, int(U * 0.14))


def g_home(d, color):
    apex = (CX, CY - int(U * 0.9)); base = int(U * 0.92)
    poly(d, [apex, (CX - base, CY - int(U * 0.05)), (CX + base, CY - int(U * 0.05))])            # techo
    bw = int(U * 0.58)
    rr(d, [CX - bw, CY - int(U * 0.05), CX + bw, CY + int(U * 0.85)], int(U * 0.05))             # cuerpo
    dw = int(U * 0.2)
    d.rectangle([CX - dw, CY + int(U * 0.2), CX + dw, CY + int(U * 0.85)], fill=color + (255,))  # puerta


def g_leaf(d, color):
    layer = Image.new("RGBA", (M, M), (0, 0, 0, 0)); dl = ImageDraw.Draw(layer)
    r = int(U * 0.55); cy = CY + int(U * 0.3)
    circ(dl, CX, cy, r)
    poly(dl, [(CX, CY - int(U * 0.78)), (CX - r, cy - int(r * 0.2)), (CX + r, cy - int(r * 0.2))])
    dl.line([(CX, CY - int(U * 0.6)), (CX, cy + int(r * 0.7))], fill=color + (255,), width=int(U * 0.09))  # nervadura
    layer = layer.rotate(-38, resample=Image.BICUBIC, center=(CX, cy))
    d._image.alpha_composite(layer)


# (id, color RGB). El orden define la grilla del picker (ver index.ts).
STICKERS = [
    ("bidon", (46, 155, 230)), ("bidon_mini", (91, 188, 239)), ("dispenser", (21, 179, 166)),
    ("bottle", (25, 167, 206)), ("droplet", (46, 125, 230)), ("drop_plus", (37, 99, 235)),
    ("ice", (120, 196, 238)), ("soda", (232, 80, 58)), ("juice", (242, 107, 33)),
    ("truck", (242, 137, 47)), ("box", (201, 136, 59)), ("cart", (124, 92, 214)),
    ("leaf", (52, 168, 83)), ("home", (79, 99, 210)), ("star", (242, 183, 5)),
]


def main():
    out = os.path.normpath(OUT)
    os.makedirs(out, exist_ok=True)
    for sid, color in STICKERS:
        img, d = tile(color)
        globals()["g_" + sid](d, color)
        for suffix, px in SIZES.items():
            img.resize((px, px), Image.LANCZOS).save(os.path.join(out, f"{sid}{suffix}.png"))
    print(f"Generados {len(STICKERS)} stickers (x{len(SIZES)} tamaños) en {out}")


if __name__ == "__main__":
    main()
