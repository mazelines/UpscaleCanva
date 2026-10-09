"""Local Real-ESRGAN inference. RGB runs on CUDA; alpha uses explicit Lanczos."""
from __future__ import annotations

import argparse
import gc
import hashlib
import io
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageCms, ImageOps
from spandrel import ImageModelDescriptor, ModelLoader

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"RealESRGAN_x2plus": 2, "RealESRGAN_x4plus_anime_6B": 4}
EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_image(path):
    with Image.open(path) as original:
        if getattr(original, "n_frames", 1) != 1:
            raise ValueError("Multi-frame images are unsupported; export a single frame first.")
        if original.mode.startswith("I") or original.mode == "F":
            raise ValueError("High-bit-depth input is unsupported; export 8-bit RGB/RGBA first.")
        # Pillow otherwise silently reduces 16-bit RGB PNGs to 8-bit.
        if original.format == "PNG":
            with Path(path).open("rb") as stream:
                header = stream.read(25)
            if header[24] == 16:
                raise ValueError("16-bit PNG is unsupported; export 8-bit RGB/RGBA first.")
        im = ImageOps.exif_transpose(original)
        icc = im.info.get("icc_profile")
        dpi = im.info.get("dpi")
        alpha = im.convert("RGBA").getchannel("A") if "A" in im.getbands() or "transparency" in im.info else None
        color_note = "ICC copied without color-space conversion" if icc else "No embedded ICC; RGB values retained"
        if im.mode in {"RGB", "RGBA", "P"}:
            rgb = im.convert("RGB")
        elif icc:
            target = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
            source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            rgb = ImageCms.profileToProfile(im, source, target, outputMode="RGB")
            icc = target.tobytes()
            color_note = "Non-RGB ICC converted to sRGB"
        else:
            rgb = im.convert("RGB")
            color_note = f"Unprofiled {im.mode} converted to RGB"
        return rgb.copy(), alpha, icc, dpi, color_note


def infer_tiles(rgb, model, tile, pad, device):
    """Only input/output assembly is on CPU. Every network forward is on CUDA."""
    a = np.asarray(rgb, dtype=np.float32) / 255.0
    h, w = a.shape[:2]
    scale = model.scale
    result = np.empty((h * scale, w * scale, 3), dtype=np.uint8)
    count = 0
    kernel_ms = 0.0
    with torch.inference_mode():
        for y in range(0, h, tile):
            for x in range(0, w, tile):
                x1, y1 = min(x + tile, w), min(y + tile, h)
                left, top = max(0, x - pad), max(0, y - pad)
                right, bottom = min(w, x1 + pad), min(h, y1 + pad)
                patch = np.ascontiguousarray(a[top:bottom, left:right].transpose(2, 0, 1))
                tensor = torch.from_numpy(patch).unsqueeze(0).to(device=device, dtype=torch.float32)
                assert tensor.is_cuda and next(model.model.parameters()).is_cuda
                start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
                start.record()
                out = model(tensor)
                end.record()
                end.synchronize()
                if not out.is_cuda:
                    raise RuntimeError("Model produced a non-CUDA tensor; refusing CPU fallback.")
                kernel_ms += start.elapsed_time(end)
                ox, oy = (x - left) * scale, (y - top) * scale
                core = out[0, :, oy:oy + (y1-y)*scale, ox:ox + (x1-x)*scale]
                pixels = core.clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).cpu().numpy()
                result[y*scale:y1*scale, x*scale:x1*scale] = pixels
                count += 1
                del tensor, out, core, pixels
    return Image.fromarray(result), count, kernel_ms


def process(path, output_dir, name, model, model_hash, tile, pad, device):
    started = time.perf_counter()
    source_hash = sha256(path)
    rgb, alpha, icc, dpi, color_note = load_image(path)
    width, height = rgb.size
    requested_tile, retries = tile, []
    torch.cuda.reset_peak_memory_stats(device)
    while True:
        try:
            enlarged, forwards, kernel_ms = infer_tiles(rgb, model, tile, pad, device)
            break
        except torch.cuda.OutOfMemoryError:
            if tile <= 32:
                raise RuntimeError("CUDA out of memory at minimum tile 32. Free VRAM and retry. CPU fallback is disabled.") from None
            smaller = max(32, (tile // 2) // 2 * 2)
            retries.append({"from": tile, "to": smaller})
            print(f"CUDA OOM: retrying tile {tile} -> {smaller}", file=sys.stderr, flush=True)
            tile = smaller
        gc.collect()
        torch.cuda.empty_cache()
    native_size = enlarged.size
    target = (width * 2, height * 2)
    if model.scale == 4:
        enlarged = enlarged.resize(target, Image.Resampling.LANCZOS)
    if alpha is not None:
        enlarged.putalpha(alpha.resize(target, Image.Resampling.LANCZOS))
    assert enlarged.size == target
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-" + uuid.uuid4().hex[:6]
    output = output_dir / f"{path.stem}__{name}__2x__{stamp}.png"
    save_options = {"compress_level": 6}
    if icc:
        save_options["icc_profile"] = icc
    if dpi:
        save_options["dpi"] = dpi
    # Exclusive creation guarantees that existing versions are never overwritten.
    with output.open("xb") as stream:
        enlarged.save(stream, format="PNG", **save_options)
    with Image.open(output) as check:
        assert check.size == target and check.format == "PNG"
        assert check.info.get("icc_profile") == icc
        if alpha is not None:
            assert check.mode == "RGBA"
    if sha256(path) != source_hash:
        raise RuntimeError("Source changed while processing.")
    record = {
        "status": "success", "utc": datetime.now(timezone.utc).isoformat(),
        "input": str(path), "input_sha256": source_hash, "output": str(output),
        "input_size": [width, height], "native_ai_size": list(native_size), "output_size": list(target),
        "model": name, "model_sha256": model_hash, "native_ai_scale": model.scale, "output_scale": 2,
        "downsample": "Lanczos 4x -> 2x" if model.scale == 4 else None,
        "device": str(device), "gpu": torch.cuda.get_device_name(device),
        "torch": torch.__version__, "cuda_runtime": torch.version.cuda,
        "precision": "float32", "cuda_forward_calls": forwards, "cuda_event_ms": round(kernel_ms, 3),
        "tile_requested": requested_tile, "tile_used": tile, "tile_padding": pad, "oom_retries": retries,
        "peak_cuda_allocated_mib": round(torch.cuda.max_memory_allocated(device) / 2**20, 2),
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "alpha": "Lanczos 2x, separate from RGB AI" if alpha is not None else "none",
        "icc_preserved": bool(icc), "color_note": color_note,
        "output_bit_depth": 8, "face_restoration": False, "extra_sharpening": False,
    }
    output.with_suffix(".json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False), flush=True)
    return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, default=ROOT / "output")
    p.add_argument("--model", choices=[*MODELS, "both"], default="RealESRGAN_x2plus")
    p.add_argument("--tile", type=int, default=256)
    p.add_argument("--tile-pad", type=int, default=32)
    p.add_argument("--recursive", action="store_true")
    args = p.parse_args()
    if args.tile < 32 or args.tile % 2 or args.tile_pad < 0 or args.tile_pad % 2:
        p.error("tile must be even and >=32; tile-pad must be even and >=0")
    source, destination = args.input.resolve(), args.output.resolve()
    if not source.exists():
        p.error(f"Input does not exist: {source}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. CPU fallback is disabled.")
    device = torch.device("cuda:0")
    torch.cuda.set_device(device)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    if source.is_dir():
        if source == destination:
            p.error("Folder input and output must be different directories")
        files = sorted(source.rglob("*") if args.recursive else source.iterdir())
        files = [x for x in files if x.is_file() and x.suffix.lower() in EXTENSIONS and destination not in x.parents]
    else:
        files = [source]
    if not files:
        p.error("No supported images found")
    names = list(MODELS) if args.model == "both" else [args.model]
    records, failed = [], False
    for name in names:
        weights = ROOT / "models" / f"{name}.pth"
        model_hash = sha256(weights)
        model = ModelLoader().load_from_file(str(weights))
        if not isinstance(model, ImageModelDescriptor) or model.scale != MODELS[name]:
            raise RuntimeError(f"Unexpected model descriptor or native scale for {name}")
        model.to(device=device, dtype=torch.float32).eval()
        for path in files:
            relative = path.parent.relative_to(source) if source.is_dir() else Path()
            try:
                records.append(process(path, destination / relative, name, model, model_hash, args.tile, args.tile_pad, device))
            except Exception as error:
                failed = True
                record = {"status": "error", "input": str(path), "model": name, "error": str(error)}
                records.append(record)
                print(json.dumps(record, ensure_ascii=False), file=sys.stderr, flush=True)
        del model
        gc.collect()
        torch.cuda.empty_cache()
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    log = logs / f"run-{datetime.now():%Y%m%d-%H%M%S-%f}.json"
    log.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
