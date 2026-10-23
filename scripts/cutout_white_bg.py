"""Quita el fondo blanco liso de una foto de producto y la recorta a su contenido.

Solo se vuelve transparente el blanco CONECTADO a los bordes (relleno desde las
orillas), así que los brillos blancos dentro del objeto (metal pulido, reflejos)
se conservan.

Uso: python3 scripts/cutout_white_bg.py <entrada.png> <salida.png>
"""

import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

WHITE_THRESHOLD = 218
EDGE_FEATHER_PX = 1.2
PADDING_PX = 12
HOLE_MIN_FRACTION = 0.004


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    image = Image.open(src).convert("RGB")
    width, height = image.size

    # 255 donde el pixel es casi blanco, 0 donde no.
    r, g, b = image.split()
    near_white = ImageChops.darker(ImageChops.darker(r, g), b).point(lambda v: 255 if v >= WHITE_THRESHOLD else 0)

    # Marca con 128 todo el blanco alcanzable desde cualquier orilla.
    mask = near_white.copy()
    for x in range(0, width, 8):
        for y in (0, height - 1):
            if mask.getpixel((x, y)) == 255:
                ImageDraw.floodfill(mask, (x, y), 128)
    for y in range(0, height, 8):
        for x in (0, width - 1):
            if mask.getpixel((x, y)) == 255:
                ImageDraw.floodfill(mask, (x, y), 128)

    # Huecos blancos grandes encerrados por el objeto (ej. el lazo de una honda) también son
    # fondo; los brillos chicos del metal no llegan a este tamaño y se conservan.
    min_hole = int(width * height * HOLE_MIN_FRACTION)
    pixels = mask.load()
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            if pixels[x, y] == 255:
                before = mask.histogram()[200]
                ImageDraw.floodfill(mask, (x, y), 200)
                if mask.histogram()[200] - before >= min_hole:
                    ImageDraw.floodfill(mask, (x, y), 128)
                    pixels = mask.load()

    alpha = mask.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.GaussianBlur(EDGE_FEATHER_PX))
    out = image.convert("RGBA")
    out.putalpha(alpha)

    bbox = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    if bbox:
        left, top, right, bottom = bbox
        out = out.crop(
            (max(0, left - PADDING_PX), max(0, top - PADDING_PX), min(width, right + PADDING_PX), min(height, bottom + PADDING_PX))
        )
    out.save(dst)


if __name__ == "__main__":
    main()
