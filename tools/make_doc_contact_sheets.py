from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser(description="Create labelled contact sheets from rendered document pages.")
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--pages-per-sheet", type=int, default=4)
    args = parser.parse_args()

    pages = sorted(args.input_dir.glob("*.png"))
    if not pages:
        raise SystemExit(f"No PNG pages found in {args.input_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    columns = 2
    rows = math.ceil(args.pages_per_sheet / columns)
    thumb_width = 700
    label_height = 34
    gap = 18
    font = ImageFont.load_default()

    for sheet_index, start in enumerate(range(0, len(pages), args.pages_per_sheet), 1):
        selected = pages[start : start + args.pages_per_sheet]
        rendered: list[tuple[Path, Image.Image]] = []
        max_height = 0
        for page in selected:
            image = Image.open(page).convert("RGB")
            height = round(image.height * thumb_width / image.width)
            image = image.resize((thumb_width, height), Image.Resampling.LANCZOS)
            rendered.append((page, image))
            max_height = max(max_height, height)

        canvas = Image.new(
            "RGB",
            (
                columns * thumb_width + (columns + 1) * gap,
                rows * (max_height + label_height) + (rows + 1) * gap,
            ),
            "#d8d8d8",
        )
        draw = ImageDraw.Draw(canvas)
        for position, (page, image) in enumerate(rendered):
            row, column = divmod(position, columns)
            x = gap + column * (thumb_width + gap)
            y = gap + row * (max_height + label_height + gap)
            draw.text((x, y), page.stem, fill="black", font=font)
            canvas.paste(image, (x, y + label_height))

        canvas.save(args.output_dir / f"sheet-{sheet_index:02d}.jpg", quality=88, optimize=True)


if __name__ == "__main__":
    main()
