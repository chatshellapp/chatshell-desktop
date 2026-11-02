#!/usr/bin/env python3
"""Generate provider/model brand avatars for desktop, iOS, and Android.

Avatars are rendered from the lobe-icons `static-avatar` package
(references/libs/lobe-icons/packages/static-avatar/avatars), which already
carries each brand's original colors, background, and circle-safe padding.
Brands missing from lobe-icons are composed here from the official artwork
in `sources/` (or drawn as vectors when no usable artwork exists).

Every output is a square PNG with an opaque brand background, so it renders
correctly when clipped to a circle and in both light and dark themes.

Usage (from the workspace root that contains chatshell-desktop/):
    python3 chatshell-desktop/scripts/brand-avatars/generate.py
    python3 chatshell-desktop/scripts/brand-avatars/generate.py --check
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
SUPERSAMPLE = 4

SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE = SCRIPT_DIR.parents[2]
LOBE_AVATARS = WORKSPACE / 'references/libs/lobe-icons/packages/static-avatar/avatars'
LOBE_PNG = WORKSPACE / 'references/libs/lobe-icons/packages/static-png/light'
SOURCES = SCRIPT_DIR / 'sources'

DESKTOP = WORKSPACE / 'chatshell-desktop/src/assets/avatars'
IOS = WORKSPACE / 'chatshell-ios/Sources/ChatShellCore/Resources/Avatars'
ANDROID = WORKSPACE / 'chatshell-android/app/src/main/assets/avatars'

# Output asset name -> source. Sources are a lobe-icons static avatar name,
# `color:<name>` (lobe-icons color icon on white, for brands whose lobe avatar
# is monochrome although an original color mark exists), or `custom:<name>`
# (brands missing from lobe-icons).
PROVIDERS: dict[str, str] = {
    'anthropic': 'anthropic',
    'azure': 'azure',
    'baichuan': 'baichuan',
    'baiducloud': 'baiducloud',
    'bailian': 'bailian',
    'cerebras': 'cerebras',
    'cohere': 'cohere',
    'deepseek': 'deepseek',
    'fireworks': 'fireworks',
    'galadriel': 'custom:galadriel',
    'github': 'github',
    'google': 'google',
    'gpustack': 'custom:gpustack',
    'groq': 'groq',
    'huggingface': 'huggingface',
    'hyperbolic': 'hyperbolic',
    'lmstudio': 'lmstudio',
    'mimo': 'xiaomimimo',
    'minimax': 'minimax',
    'mira': 'custom:mira',
    'mistral': 'mistral',
    'modelscope': 'modelscope',
    'moonshot': 'moonshot',
    'nvidia': 'nvidia',
    'ollama': 'ollama',
    'openai': 'openai',
    'openrouter': 'openrouter',
    'ovms': 'custom:ovms',
    'perplexity': 'perplexity',
    'siliconflow': 'siliconcloud',
    'statecloud': 'statecloud',
    'stepfun': 'color:stepfun',
    'tencentcloud': 'tencentcloud',
    'together': 'together',
    'volcengine': 'volcengine',
    'xai': 'xai',
    'yi': 'zeroone',
    'zai': 'zai',
    'zenmux': 'zenmux',
    'zhipu': 'zhipu',
}

MODELS: dict[str, str] = {
    'baichuan': 'baichuan',
    'claude': 'claude',
    'codegeex': 'codegeex',
    'cohere': 'cohere',
    'copilot': 'copilot',
    'dbrx': 'dbrx',
    'deepseek': 'deepseek',
    'dolphin': 'dolphin',
    'doubao': 'doubao',
    'flux': 'flux',
    'gemini': 'gemini',
    'gemma': 'gemma',
    'glm': 'zai',
    'gpt': 'openai',
    'grok': 'grok',
    'groq': 'groq',
    'hailuo': 'hailuo',
    'hunyuan': 'hunyuan',
    'internlm': 'internlm',
    'jamba': 'ai21',
    'kimi': 'kimi',
    'llama': 'meta',
    'microsoft': 'microsoft',
    'midjourney': 'midjourney',
    'mimo': 'xiaomimimo',
    'minimax': 'minimax',
    'mistral': 'mistral',
    'nvidia': 'nvidia',
    'perplexity': 'perplexity',
    'qwen': 'qwen',
    'rwkv': 'rwkv',
    'spark': 'spark',
    'stability': 'stability',
    'stepfun': 'color:stepfun',
    'upstage': 'upstage',
    'voyage': 'voyage',
    'wenxin': 'wenxin',
    'yi': 'yi',
}

# lobe-icons avatars whose mark reaches the circular edge: shrink the
# artwork around its center (on its solid background) by this factor.
SHRINK = {
    'grok': 0.86,
    'hailuo': 0.9,
    'midjourney': 0.9,
}

# Mobile bundles are flat (iOS resources are flattened by SwiftPM, Android
# uses a single assets folder), so model assets that share a name with a
# provider asset get a `model-` prefix there.
MOBILE_MODEL_PREFIX = 'model-'


def load_lobe(name: str) -> Image.Image:
    path = LOBE_AVATARS / f'{name}.webp'
    if not path.exists():
        raise SystemExit(f'lobe-icons avatar not found: {path}')
    img = Image.open(path).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    factor = SHRINK.get(name)
    if factor:
        inner = img.resize((round(SIZE * factor),) * 2, Image.LANCZOS)
        # Sample the edge midpoint: lobe avatars carry a faint border at the corners.
        canvas = Image.new('RGB', (SIZE, SIZE), img.getpixel((SIZE // 2, 2)))
        canvas.paste(inner, ((SIZE - inner.width) // 2, (SIZE - inner.height) // 2))
        img = canvas
    return img


def load_lobe_color(name: str, scale: float = 0.65) -> Image.Image:
    path = LOBE_PNG / f'{name}-color.png'
    if not path.exists():
        raise SystemExit(f'lobe-icons color icon not found: {path}')
    return place_mark(Image.open(path).convert('RGBA'), (255, 255, 255), scale)


def place_mark(mark: Image.Image, background: tuple[int, int, int], scale: float) -> Image.Image:
    """Center an RGBA mark on a solid background, fitting its bbox to `scale`."""
    bbox = mark.getchannel('A').getbbox()
    if bbox is None:
        raise SystemExit('mark is empty')
    mark = mark.crop(bbox)
    big = SIZE * SUPERSAMPLE
    target = big * scale
    ratio = target / max(mark.size)
    mark = mark.resize(
        (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio))), Image.LANCZOS
    )
    canvas = Image.new('RGBA', (big, big), background + (255,))
    canvas.alpha_composite(mark, ((big - mark.width) // 2, (big - mark.height) // 2))
    return canvas.convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)


def extract_mark(
    src: Image.Image, background: tuple[int, int, int], threshold: float = 60.0
) -> Image.Image:
    """Turn pixels that differ from `background` into an RGBA mark.

    Alpha is derived from the color distance to the background, so
    anti-aliased edges are preserved instead of hard-thresholded.
    """
    src = src.convert('RGB')
    out = Image.new('RGBA', src.size)
    px_in = src.load()
    px_out = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = px_in[x, y]
            dist = math.dist((r, g, b), background)
            alpha = max(0.0, min(1.0, dist / threshold))
            if alpha == 0:
                px_out[x, y] = (0, 0, 0, 0)
                continue
            # Un-premultiply against the background to recover the mark color.
            cr = round(min(255, max(0, (r - background[0] * (1 - alpha)) / alpha)))
            cg = round(min(255, max(0, (g - background[1] * (1 - alpha)) / alpha)))
            cb = round(min(255, max(0, (b - background[2] * (1 - alpha)) / alpha)))
            px_out[x, y] = (cr, cg, cb, round(alpha * 255))
    return out


def custom_galadriel() -> Image.Image:
    # Official app icon: white four-point star on Galadriel blue, already an avatar.
    return Image.open(SOURCES / 'galadriel.png').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)


def custom_mira() -> Image.Image:
    # Official apple-touch icon is 180px: rebuild the white mark at full size
    # on the brand's black background so edges stay crisp.
    src = Image.open(SOURCES / 'mira.png').convert('RGB')
    src = src.resize((src.width * SUPERSAMPLE, src.height * SUPERSAMPLE), Image.BICUBIC)
    mark = extract_mark(src, (0, 0, 0), threshold=255.0)
    return place_mark(mark, (0, 0, 0), 0.56)


def custom_gpustack() -> Image.Image:
    # Official org avatar has the gradient "G" mark on white.
    src = Image.open(SOURCES / 'gpustack.png').convert('RGBA')
    flat = Image.new('RGBA', src.size, (255, 255, 255, 255))
    flat.alpha_composite(src)
    mark = extract_mark(flat, (255, 255, 255), threshold=80.0)
    return place_mark(mark, (255, 255, 255), 0.62)


def custom_ovms() -> Image.Image:
    # OpenVINO Model Server: the OpenVINO "eye" mark (black ring, violet iris,
    # white highlight) redrawn as vector geometry from the official logo.
    big = SIZE * SUPERSAMPLE
    img = Image.new('RGB', (big, big), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    c = big / 2
    outer = big * 0.31
    ring = outer * 0.24
    draw.ellipse((c - outer, c - outer, c + outer, c + outer), fill=(0, 0, 0))
    inner = outer - ring
    draw.ellipse((c - inner, c - inner, c + inner, c + inner), fill=(255, 255, 255))
    iris = outer * 0.47
    draw.ellipse((c - iris, c - iris, c + iris, c + iris), fill=(108, 36, 240))
    hr = iris * 0.3
    hx, hy = c + iris * 0.5, c - iris * 0.5
    draw.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=(255, 255, 255))
    return img.resize((SIZE, SIZE), Image.LANCZOS)


CUSTOM = {
    'galadriel': custom_galadriel,
    'mira': custom_mira,
    'gpustack': custom_gpustack,
    'ovms': custom_ovms,
}


def render(source: str) -> Image.Image:
    if source.startswith('custom:'):
        return CUSTOM[source.removeprefix('custom:')]()
    if source.startswith('color:'):
        return load_lobe_color(source.removeprefix('color:'))
    return load_lobe(source)


def circle_overflow(img: Image.Image) -> float:
    """Return the farthest foreground distance from center, as a fraction of the radius.

    Foreground is anything that differs noticeably from the corner (background)
    color. Values above ~0.95 mean the mark gets clipped by a circular mask.
    Gradient backgrounds are skipped (returns 0) since they have no single
    background color to compare against.
    """
    small = img.resize((128, 128), Image.LANCZOS)
    edges = [small.getpixel(p) for p in ((64, 1), (64, 126), (1, 64), (126, 64))]
    bg = edges[0]
    if any(math.dist(bg, other) > 24 for other in edges):
        return 0.0
    c = 63.5
    worst = 0.0
    px = small.load()
    for y in range(128):
        for x in range(128):
            if math.dist(px[x, y], bg) > 48:
                worst = max(worst, math.hypot(x - c, y - c) / 64)
    return worst


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        path, optimize=True
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='only report circle overflow')
    args = parser.parse_args()

    rendered: dict[tuple[str, str], Image.Image] = {}
    for kind, table in (('providers', PROVIDERS), ('models', MODELS)):
        for name, source in table.items():
            rendered[(kind, name)] = render(source)

    flagged = []
    for (kind, name), img in rendered.items():
        ratio = circle_overflow(img)
        if ratio > 0.95:
            flagged.append(f'{kind}/{name}: {ratio:.2f}')
    if flagged:
        print('Marks reaching the circular edge:\n  ' + '\n  '.join(flagged))
    if args.check:
        return 1 if flagged else 0

    # Output folders are fully owned by this script: drop stale assets first.
    for folder in (DESKTOP / 'providers', DESKTOP / 'models', IOS / 'providers', IOS / 'models', ANDROID):
        for old in folder.glob('*.png'):
            old.unlink()

    for (kind, name), img in rendered.items():
        save(img, DESKTOP / kind / f'{name}.png')
        if kind == 'providers':
            save(img, IOS / 'providers' / f'{name}.png')
            save(img, ANDROID / f'{name}.png')
        else:
            mobile = f'{MOBILE_MODEL_PREFIX}{name}' if name in PROVIDERS else name
            save(img, IOS / 'models' / f'{mobile}.png')
            save(img, ANDROID / f'{mobile}.png')

    print(f'Generated {len(rendered)} avatars.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
