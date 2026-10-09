"""Test fail-closed CUDA and tile retry with an injected OOM, not VRAM exhaustion."""
import contextlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch
import torch
from spandrel import ModelLoader
import upscale

root = Path(__file__).resolve().parents[1]
source = root / 'input/_synthetic_test/arion_pipeline_test.png'
with patch.object(sys, 'argv', ['upscale.py', '--input', str(source)]), patch.object(torch.cuda, 'is_available', return_value=False):
    try:
        upscale.main()
    except RuntimeError as e:
        assert 'CPU fallback is disabled' in str(e)
    else:
        raise AssertionError('Missing-CUDA condition did not stop execution')

weights = root / 'models/RealESRGAN_x2plus.pth'
model = ModelLoader().load_from_file(str(weights)).cuda().float().eval()
real_infer = upscale.infer_tiles
attempts = []
def simulate_once(rgb, descriptor, tile, pad, device):
    attempts.append(tile)
    if len(attempts) == 1:
        raise torch.cuda.OutOfMemoryError('TEST ONLY: injected OOM')
    return real_infer(rgb, descriptor, tile, pad, device)
with patch.object(upscale, 'infer_tiles', side_effect=simulate_once), contextlib.redirect_stdout(io.StringIO()):
    record = upscale.process(source, root / 'output/fault-injection-test', 'RealESRGAN_x2plus', model, upscale.sha256(weights), 128, 32, torch.device('cuda:0'))
assert attempts == [128, 64] and record['device'] == 'cuda:0' and record['tile_used'] == 64
record['test_fault_injection'] = 'First OOM was simulated; subsequent CUDA inference was real. GPU was not deliberately exhausted.'
Path(record['output']).with_suffix('.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
report = {'cuda_unavailable_stops_execution': True, 'tile_retry': attempts, 'oom_was_simulated': True, 'retry_inference_was_real_cuda': True, 'cpu_fallback_used': False, 'output': record['output']}
(root / 'docs/failure-mode-test.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
