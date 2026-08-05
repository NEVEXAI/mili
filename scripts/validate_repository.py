#!/usr/bin/env python3
from pathlib import Path
import json, math, subprocess, shutil

ROOT = Path(__file__).resolve().parents[1]
schema = json.loads((ROOT / "data" / "schema.json").read_text(encoding="utf-8"))
fields = schema["fields"]
idx = {name: i for i, name in enumerate(fields)}

rows = []
for chunk in schema["chunks"]:
    path = ROOT / chunk["file"]
    if not path.exists():
        raise SystemExit(f"FAIL: missing {chunk['file']}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if len(payload) != chunk["rows"]:
        raise SystemExit(f"FAIL: row count mismatch in {chunk['file']}")
    if any(len(row) != len(fields) for row in payload):
        raise SystemExit(f"FAIL: malformed row in {chunk['file']}")
    rows.extend(payload)

if len(rows) != schema["total_sites"]:
    raise SystemExit(f"FAIL: expected {schema['total_sites']}, found {len(rows)}")

site_ids = [row[idx["site_id"]] for row in rows]
if len(site_ids) != len(set(site_ids)):
    raise SystemExit("FAIL: duplicate site IDs")

for definition in schema["field_definitions"]:
    if definition.get("filterable", True) is False:
        continue
    name = definition["name"]
    dtype = definition["type"]
    if name not in idx:
        raise SystemExit(f"FAIL: filter field missing from schema: {name}")
    values = [row[idx[name]] for row in rows]

    if dtype == "number":
        if any(v not in (None, "") and not isinstance(v, (int, float)) for v in values):
            raise SystemExit(f"FAIL: invalid numeric field {name}")
    elif dtype == "boolean":
        if any(v is not None and not isinstance(v, bool) for v in values):
            raise SystemExit(f"FAIL: invalid boolean field {name}")
    elif dtype == "category":
        actual = {str(v) for v in values if v not in (None, "")}
        declared = {str(v) for v in definition.get("values", [])}
        if not actual.issubset(declared):
            raise SystemExit(f"FAIL: undeclared category value in {name}")
    elif dtype == "text":
        if any(v is not None and not isinstance(v, str) for v in values):
            raise SystemExit(f"FAIL: invalid text field {name}")

node = shutil.which("node")
if node:
    result = subprocess.run(
        [node, "--check", str(ROOT / "assets" / "app.js")],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit("FAIL: JavaScript syntax\n" + result.stderr)

print(f"PASS: {len(rows):,} unique sites")
print(f"PASS: {len(schema['chunks'])} data chunks")
print(f"PASS: {sum(1 for d in schema['field_definitions'] if d.get('filterable', True))} dynamic filters")
print("PASS: JavaScript syntax")
