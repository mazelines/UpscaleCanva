import importlib.metadata as metadata
import json
import platform
import sys
from pathlib import Path
import torch

root = Path(__file__).resolve().parents[1]
if not torch.cuda.is_available():
    raise SystemExit('CUDA unavailable. CPU fallback is disabled.')
report = {
    'python': platform.python_version(), 'python_executable': sys.executable,
    'torch': torch.__version__, 'cuda_runtime': torch.version.cuda,
    'gpu': torch.cuda.get_device_name(0), 'compute_capability': list(torch.cuda.get_device_capability(0)),
    'vram_bytes': torch.cuda.get_device_properties(0).total_memory,
    'cuda_available': True,
    'packages': {x: metadata.version(x) for x in ['spandrel', 'torchvision', 'numpy', 'Pillow', 'sanic', 'setuptools', 'chainner_ext']},
    'chainner': json.loads((root / 'apps/chaiNNer/resources/app/package.json').read_text())['version'],
    'electron': (root / 'apps/chaiNNer/version').read_text().strip(),
    'toolkit_installed_for_task': False,
}
(root / 'docs/installed-environment.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
