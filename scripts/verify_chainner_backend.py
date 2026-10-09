"""Execute the actual .chn graph with chaiNNer's installed Python engine and CUDA hooks.

This checks backend execution, not Electron GUI rendering.
"""
import asyncio
import contextlib
import faulthandler
import importlib
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import torch
from PIL import Image
from spandrel import ImageModelDescriptor

ROOT = Path(__file__).resolve().parents[1]
faulthandler.dump_traceback_later(40, repeat=False)
BACKEND = ROOT / 'apps/chaiNNer/resources/src'
sys.path.insert(0, str(BACKEND))
import api
from chain.json import parse_json
from events import EventConsumer
from process import Executor, ExecutionId

assert torch.cuda.is_available(), 'CUDA is required; CPU fallback is disabled'
for package in ('chaiNNer_standard', 'chaiNNer_pytorch'):
    importlib.import_module('packages.' + package)
api.registry.load_nodes(str(BACKEND / 'server.py'))
manifest = json.loads((ROOT / 'docs/workflow-manifest.json').read_text(encoding='utf-8'))
graph = json.loads(Path(manifest['workflow']).read_text(encoding='utf-8'))['content']
by_id = {n['id']: n for n in graph['nodes']}
bindings = {}
for e in graph['edges']:
    source_id, output_id = e['sourceHandle'].rsplit('-', 1)
    target_id, input_id = e['targetHandle'].rsplit('-', 1)
    outputs = api.registry.get_node(by_id[source_id]['data']['schemaId']).outputs
    index = next(i for i, output in enumerate(outputs) if output.id == int(output_id))
    bindings[(target_id, int(input_id))] = {'type': 'edge', 'id': source_id, 'index': index}
data = []
# Use an isolated validation directory, without changing the GUI's configured paths.
validation_dir = ROOT / 'output' / 'chainner-backend-test' / str(time.time_ns())
validation_dir.mkdir(parents=True)
for n in graph['nodes']:
    schema = api.registry.get_node(n['data']['schemaId'])
    values = dict(n['data']['inputData'])
    if n['data']['schemaId'] == 'chainner:image:save':
        values['1'] = str(validation_dir)
    inputs = [bindings.get((n['id'], int(i.id)), {'type': 'value', 'value': values.get(str(i.id))}) for i in schema.inputs]
    data.append({'id': n['id'], 'schemaId': schema.schema_id, 'inputs': inputs, 'nodeType': schema.kind})
chain = parse_json(data)
events, forwards = [], []
original_call = ImageModelDescriptor.__call__

def observed_call(self, tensor):
    assert tensor.is_cuda and next(self.model.parameters()).is_cuda, 'Non-CUDA forward refused'
    start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
    start.record()
    result = original_call(self, tensor)
    end.record()
    end.synchronize()
    assert result.is_cuda
    forwards.append({'native_scale': self.scale, 'input': list(tensor.shape), 'output': list(result.shape), 'device': str(result.device), 'cuda_ms': start.elapsed_time(end)})
    return result

class RecordEvents(EventConsumer):
    def put(self, event):
        if event['event'] == 'node-start':
            print('chaiNNer node-start: ' + event['data']['nodeId'], flush=True)
        if event['event'] in {'node-finish', 'execution-error'}:
            events.append(event)

async def run():
    # The native server has periodic HTTP/SSE work. Its Lazy input helper queues
    # tasks from a worker thread; keep a corresponding event-loop tick in this
    # serverless test harness so Windows Proactor does not sleep indefinitely.
    async def tick():
        while True:
            await asyncio.sleep(0.01)
    heartbeat = asyncio.create_task(tick())
    with ThreadPoolExecutor(max_workers=4) as pool:
        engine = Executor(id=ExecutionId('ARION-verify'), chain=chain, send_broadcast_data=False,
            options=api.ExecutionOptions.parse({'chaiNNer_pytorch': {'use_cpu': False, 'use_fp16': False, 'gpu_index': '0', 'budget_limit': 8}}),
            loop=asyncio.get_running_loop(), queue=RecordEvents(), pool=pool, storage_dir=ROOT / 'runtime' / 'backend-storage')
        await engine.run()
    heartbeat.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await heartbeat

started = time.perf_counter()
ImageModelDescriptor.__call__ = observed_call
try:
    asyncio.run(run())
finally:
    ImageModelDescriptor.__call__ = original_call
outputs = []
with Image.open(manifest['input']) as source:
    target = tuple(x * 2 for x in source.size)
    for p in validation_dir.glob('*.png'):
        with Image.open(p) as result:
            assert result.size == target and result.format == 'PNG'
            outputs.append({'path': str(p), 'size': list(result.size), 'mode': result.mode, 'icc_present': bool(result.info.get('icc_profile'))})
assert len(outputs) == 2 and {f['native_scale'] for f in forwards} == {2, 4}
report = {'status': 'passed', 'engine': str(BACKEND / 'process.py'), 'workflow': manifest['workflow'], 'elapsed_seconds': time.perf_counter() - started,
          'gpu': torch.cuda.get_device_name(0), 'cuda_forwards': forwards, 'events': events, 'outputs': outputs,
          'gui_open_verification': 'pending; backend execution does not prove GUI rendering',
          'icc_note': 'Native chaiNNer image arrays/PNG writer discard ICC. Use the CLI for ICC-preserving production PNGs.'}
(ROOT / 'docs/chainner-backend-test.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
faulthandler.cancel_dump_traceback_later()
print(json.dumps(report, ensure_ascii=False, indent=2))
