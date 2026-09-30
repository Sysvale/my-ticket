#!/usr/bin/env python3
"""Gera os ícones e o banner da extensão a partir de assets/logo.png (Pillow).

- extension/icons/icon{16,32,48,128}.png: só o símbolo (janela + tíquete + check) sobre um bloco
  arredondado na cor do fundo do logo. O texto ficaria ilegível em tamanhos tão pequenos.
- extension/logo.png: logo completo (símbolo + nome + slogan) com cantos arredondados, usado no
  cabeçalho da página de Opções.

Se trocar o logo, ajuste MARK_BOX e BANNER_BOX (medidos no arquivo 1254x1254 atual).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo.png"
ICONS = ROOT / "extension" / "icons"
BANNER = ROOT / "extension" / "logo.png"

MARK_BOX = (384, 243, 888, 664)  # símbolo, sem o texto (x0, y0, x1, y1)
BANNER_BOX = (150, 190, 1104, 1010)  # símbolo + nome + slogan, com folga
BANNER_WIDTH = 480  # 2x da largura exibida (240px) para telas de alta densidade

# fração do lado do bloco ocupada pelo símbolo (em ícones pequenos, maior para não virar ponto)
FILL = {16: 0.92, 32: 0.88, 48: 0.84, 128: 0.80}
RADIUS = 0.22  # cantos do bloco, como fração do lado


def rounded_mask(size: tuple[int, int], radius: int, scale: int = 4) -> Image.Image:
    """Máscara com cantos arredondados e bordas suaves (desenhada em escala maior)."""
    w, h = size
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def make_icon(src: Image.Image, bg: tuple[int, int, int], mark: Image.Image, size: int) -> Image.Image:
    tile = Image.new("RGBA", (size, size), bg + (255,))
    box = round(size * FILL[size])
    ratio = mark.width / mark.height
    mw, mh = (box, round(box / ratio)) if ratio >= 1 else (round(box * ratio), box)
    resized = mark.resize((mw, mh), Image.LANCZOS)
    tile.paste(resized, ((size - mw) // 2, (size - mh) // 2))
    tile.putalpha(rounded_mask((size, size), round(size * RADIUS)))
    return tile


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    bg = src.getpixel((5, 5))
    mark = src.crop(MARK_BOX)

    ICONS.mkdir(parents=True, exist_ok=True)
    for size in FILL:
        make_icon(src, bg, mark, size).save(ICONS / f"icon{size}.png")
        print("icon", size)

    banner = src.crop(BANNER_BOX)
    banner = banner.resize((BANNER_WIDTH, round(banner.height * BANNER_WIDTH / banner.width)), Image.LANCZOS).convert("RGBA")
    banner.putalpha(rounded_mask(banner.size, 36))
    banner.save(BANNER, optimize=True)
    print("banner", banner.size)


if __name__ == "__main__":
    main()
