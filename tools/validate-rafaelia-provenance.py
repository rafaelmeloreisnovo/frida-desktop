#!/usr/bin/env python3
import json
from pathlib import Path

P = Path("profiles/rafaelia-provenance-scope.v1.json")

def die(msg):
    raise SystemExit(f"FAIL: {msg}")

m = json.loads(P.read_text(encoding="utf-8"))
if m.get("schema") != "rafaelia.upstream-delta-provenance.v1":
    die("schema")
if m.get("claim_allowed") is not False:
    die("claim_allowed must remain false")
lic = m.get("upstream_license", {})
if not lic.get("preserved"):
    die("upstream license not preserved")
copying = Path(lic.get("path", ""))
if not copying.is_file():
    die("COPYING missing")
if m["authorial_delta"].get("ownership_claimed_by_this_manifest") is not False:
    die("manifest must not claim ownership before upstream diff")
if "TOKEN_VAZIO" not in m["authorial_delta"].get("state", ""):
    die("delta boundary may not be promoted without separate evidence")
for p in m["authorial_delta"].get("candidate_paths_observed_from_readme", []):
    if not Path(p).exists():
        die(f"candidate path missing: {p}")
if m["third_party"].get("flatten_to_single_license") is not False:
    die("third-party licensing must not be flattened")
if not m["rollback"].get("available"):
    die("rollback required")
print("PASS: upstream license preserved; authorial delta remains fail-closed")
