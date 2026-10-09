"""Exercise actual CUDA inference on synthetic art; this is not artwork QA."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
fixture_dir = ROOT / "input" / "_synthetic_test"
fixture_dir.mkdir(parents=True, exist_ok=True)
source = fixture_dir / "arion_pipeline_test.png"
if not source.exists():
    im = Image.new("RGBA", (193, 129), (250, 250, 255, 0))
    draw = ImageDraw.Draw(im)
    draw.rectangle((5, 5, 186, 122), fill=(224, 236, 250, 180), outline=(30, 42, 65, 255), width=1)
    draw.ellipse((12, 12, 75, 85), fill=(240, 200, 166, 255), outline=(65, 40, 45, 255), width=1)
    draw.polygon([(12, 44), (17, 9), (62, 10), (79, 41), (59, 32), (38, 40), (26, 26)], fill=(68, 52, 105, 255))
    draw.line((24, 47, 33, 45, 38, 48), fill=(22, 27, 40, 255), width=1)
    draw.line((49, 48, 55, 45, 63, 47), fill=(22, 27, 40, 255), width=1)
    draw.line((34, 69, 43, 72, 52, 68), fill=(113, 52, 65, 255), width=1)
    for x in range(85, 179, 5):
        draw.line((x, 18, x+7, 66), fill=(25, 64, 124, 255), width=1)
    draw.line((88, 77, 115, 69, 126, 92, 171, 74), fill=(83, 40, 137, 255), width=2)
    draw.rectangle((113, 65, 124, 77), fill=(196, 203, 225, 255), outline=(49, 62, 86, 255))
    font = ImageFont.truetype(r"C:\Windows\Fonts\malgun.ttf", 15)
    draw.text((14, 98), "아리온 한글 AI 2x", font=font, fill=(26, 28, 42, 255))
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    im.save(source, icc_profile=profile, dpi=(96, 96))
before_hash = hashlib.sha256(source.read_bytes()).hexdigest()
out = ROOT / "output" / "smoke-test"
existing = set(out.glob("*.json")) if out.exists() else set()
subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts" / "upscale.py"), "--input", str(fixture_dir), "--output", str(out), "--model", "both", "--tile", "128"], check=True)
records = [json.loads(p.read_text(encoding="utf-8")) for p in set(out.glob("*.json")) - existing]
assert len(records) == 2, records
assert hashlib.sha256(source.read_bytes()).hexdigest() == before_hash
checks = []
with Image.open(source) as src:
    baseline = np.asarray(src.convert("RGB").resize((386, 258), Image.Resampling.LANCZOS)).astype(np.float32)
    expected_alpha = np.asarray(src.getchannel("A").resize((386, 258), Image.Resampling.LANCZOS))
    for rec in records:
        assert rec["device"] == "cuda:0" and rec["cuda_forward_calls"] >= 4 and rec["cuda_event_ms"] > 0
        assert rec["output_size"] == [386, 258]
        assert rec["native_ai_size"] == [193 * rec["native_ai_scale"], 129 * rec["native_ai_scale"]]
        with Image.open(rec["output"]) as result:
            assert result.size == (386, 258) and result.format == "PNG" and result.mode == "RGBA"
            assert result.info.get("icc_profile") == src.info.get("icc_profile")
            assert np.array_equal(np.asarray(result.getchannel("A")), expected_alpha)
            rmse = float(np.sqrt(np.mean((np.asarray(result.convert("RGB")).astype(np.float32) - baseline)**2)))
            assert rmse > 0.1, "Output unexpectedly identical to interpolation-only baseline"
        checks.append({"model": rec["model"], "size_exact_2x": True, "cuda_forwards": rec["cuda_forward_calls"], "cuda_event_ms": rec["cuda_event_ms"], "elapsed_seconds": rec["elapsed_seconds"], "alpha_exact_lanczos": True, "icc_bytes_equal": True, "rmse_vs_lanczos_only": rmse, "output": rec["output"]})
report = {"fixture": str(source), "fixture_size": [193, 129], "synthetic_only": True, "real_artwork_quality_review": "NOT COMPLETED: no user artwork in input at installation", "source_unchanged": True, "checks": checks}
(ROOT / "docs" / "test-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
