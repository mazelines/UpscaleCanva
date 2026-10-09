"""Validate untrusted web uploads before they reach the existing CUDA CLI."""
import json
import io
import sys
import warnings
from pathlib import Path

from PIL import Image, ImageOps, ImageCms

Image.MAX_IMAGE_PIXELS = 16_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
source, preview = map(Path, sys.argv[1:3])
try:
    with Image.open(source) as im:
        if im.format not in {"PNG", "JPEG", "WEBP"}:
            raise ValueError("PNG, JPEG, WebP 이미지만 등록할 수 있습니다.")
        if im.width * im.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("이미지는 1,600만 픽셀 이하여야 합니다.")
        if getattr(im, "n_frames", 1) != 1:
            raise ValueError("움직이는 이미지는 지원하지 않습니다. 한 프레임을 저장해 주세요.")
        if im.mode.startswith("I") or im.mode == "F":
            raise ValueError("8비트 RGB/RGBA 이미지로 저장해 주세요.")
        if im.format == "PNG" and source.read_bytes()[:25][24] == 16:
            raise ValueError("16비트 PNG는 지원하지 않습니다. 8비트로 저장해 주세요.")
        im.verify()
    with Image.open(source) as original:
        im = ImageOps.exif_transpose(original)
        im.load()
        report = {"size": list(im.size), "format": original.format,
                  "hasAlpha": "A" in im.getbands() or "transparency" in im.info,
                  "hasICC": bool(im.info.get("icc_profile"))}
        icc = im.info.get("icc_profile")
        if icc and im.mode not in {"RGB", "RGBA", "P"}:
            target = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), target, outputMode="RGB")
            icc = target.tobytes()
        im = im.convert("RGBA")
        im.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        with preview.open("xb") as stream:
            im.save(stream, format="PNG", **({"icc_profile": icc} if icc else {}))
    print(json.dumps(report, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"error": str(exc)}, ensure_ascii=False))
    sys.exit(1)
