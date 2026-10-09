"""Validate the installed runtime and an actual CUDA operation."""
import argparse
import importlib
import importlib.metadata as metadata
import json
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    try:
        import torch
        for module in ("torchvision", "numpy", "PIL.Image", "spandrel", "sanic", "chainner_ext", "pkg_resources"):
            importlib.import_module(module)
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. Install/update the NVIDIA graphics driver and restart Windows. CPU fallback is disabled.")
        # Detect unsupported GPU architectures/driver combinations before accepting uploads.
        with torch.inference_mode():
            layer = torch.nn.Conv2d(3, 3, 3, padding=1).cuda()
            result = layer(torch.zeros(1, 3, 8, 8, device="cuda"))
            torch.cuda.synchronize()
            assert result.is_cuda and result.shape == (1, 3, 8, 8)
        versions = {name: metadata.version(name) for name in
                    ("torch", "torchvision", "spandrel", "numpy", "Pillow", "PyYAML", "sanic", "setuptools", "chainner_ext")}
        for requirements in ("requirements.txt", "requirements-torch.txt", "docs/gui-requirements.txt"):
            for line in (ROOT / requirements).read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith(("#", "-")):
                    continue
                name, expected = line.split("==", 1)
                if metadata.version(name) != expected:
                    raise RuntimeError(f"{name} must be {expected}; run Setup.cmd to repair dependencies.")
        report = {
            "python": platform.python_version(), "python_executable": sys.executable,
            "torch": torch.__version__, "cuda_runtime": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0), "compute_capability": list(torch.cuda.get_device_capability(0)),
            "vram_bytes": torch.cuda.get_device_properties(0).total_memory,
            "cuda_available": True, "cuda_operation_verified": True,
            "packages": versions,
            "chainner": json.loads((ROOT / "apps/chaiNNer/resources/app/package.json").read_text())["version"],
            "electron": (ROOT / "apps/chaiNNer/version").read_text().strip(),
            "toolkit_installed_for_task": False,
        }
        (ROOT / "docs").mkdir(exist_ok=True)
        (ROOT / "docs/installed-environment.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if not args.quiet:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f"Environment check failed: {error}\nRun Setup.cmd again. Details: logs/setup.log", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
