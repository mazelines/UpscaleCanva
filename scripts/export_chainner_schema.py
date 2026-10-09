"""Export the installed chaiNNer registry using its own package loader (no guessed IDs)."""
import importlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
backend = root / "apps" / "chaiNNer" / "resources" / "src"
sys.path.insert(0, str(backend))
import api

for package in ("chaiNNer_standard", "chaiNNer_pytorch"):
    importlib.import_module("packages." + package)
errors = api.registry.load_nodes(str(backend / "server.py"))
nodes = []
for node, group in api.registry.nodes.values():
    nodes.append({"schemaId": node.schema_id, "name": node.name, "kind": node.kind,
                  "inputs": [x.to_dict() for x in node.inputs],
                  "outputs": [x.to_dict() for x in node.outputs]})
required = {"chainner:image:load", "chainner:pytorch:load_model", "chainner:pytorch:upscale_image",
            "chainner:image:resize", "chainner:image:view", "chainner:image:save",
            "chainner:utility:text_pattern", "chainner:utility:execution_number"}
missing = required - {n["schemaId"] for n in nodes}
report = {"version": "0.25.1", "backend_path": str(backend), "nodes": nodes,
          "load_errors": [{"module": e.module, "error": str(e.error)} for e in errors]}
(root / "docs" / "chainner-schema.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if missing:
    raise RuntimeError(f"Required chaiNNer nodes unavailable: {missing}; see docs/chainner-schema.json")
print(f"Exported {len(nodes)} installed node schemas; all required nodes present.")
