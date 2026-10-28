"""Export the canonical training instruction without importing Modal."""
import ast
import json
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
source = root / "research/local-extractor"
tree = ast.parse((source / "probe_modal.py").read_text(encoding="utf-8"))
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "instruction")
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source / "probe_modal.py"), "exec"), namespace)
contract = json.loads((source / "contract.json").read_text(encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({"instruction": namespace["instruction"](contract), "contract": contract}, ensure_ascii=False))
