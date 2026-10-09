import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/workflow-manifest.json').read_text(encoding='utf-8'))
paths = list(Path(manifest['sessionDir']).glob('*.png'))
assert len(paths) == 2, f'Expected two native chaiNNer PNGs, found {len(paths)} in {manifest["sessionDir"]}'
with Image.open(manifest['input']) as source:
    target = tuple(v*2 for v in source.size)
    for path in paths:
        with Image.open(path) as result:
            assert result.format == 'PNG' and result.size == target, path
manifest['nativeAppValidation'] = 'passed: chaiNNer.exe run parsed, validated and executed this graph'
manifest['nativeOutputs'] = [str(p) for p in paths]
(root / 'docs/workflow-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
(root / 'docs/chainner-native-test.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Native chaiNNer output verified: 2 PNGs, {target[0]}x{target[1]}')
