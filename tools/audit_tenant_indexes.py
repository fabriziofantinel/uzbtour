from __future__ import annotations

import importlib.util
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ddl_path = ROOT / "database" / "schema-v3-review.sql"
builder_path = ROOT / "tools" / "build_data_model_docs.py"

spec = importlib.util.spec_from_file_location("model_docs", builder_path)
assert spec and spec.loader
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

ddl = ddl_path.read_text(encoding="utf-8")
tables = {
    name: "\n".join([*(f"{col} {definition}" for col, definition in columns), *constraints])
    for name, columns, constraints in builder.parse_tables(ddl)
}
rls_block = re.search(
    r"-- Tenant isolation\..*?FOREACH q IN ARRAY ARRAY\[(.*?)\]\s+LOOP\s+"
    r"EXECUTE format\('ALTER TABLE %s ENABLE ROW LEVEL SECURITY'",
    ddl,
    re.S,
)
assert rls_block, "Tenant RLS table list not found"
tenant_tables = re.findall(r"'([^']+)'", rls_block.group(1))

missing: list[str] = []
for table in tenant_tables:
    body = tables[table]
    has_leading_constraint = bool(
        re.search(r"(?:PRIMARY KEY|UNIQUE)\s*\(\s*agency_id\b", body, re.I)
    )
    has_leading_index = bool(
        re.search(
            r"CREATE(?:\s+UNIQUE)?\s+INDEX[^;]+ON\s+"
            + re.escape(table)
            + r"\s*\(\s*agency_id\b",
            ddl,
            re.I,
        )
    )
    if not (has_leading_constraint or has_leading_index):
        missing.append(table)

if missing:
    print("Tenant tables without an agency_id-leading index:")
    print("\n".join(missing))
    raise SystemExit(1)

print(f"OK: {len(tenant_tables)} tenant tables have an agency_id-leading index")
