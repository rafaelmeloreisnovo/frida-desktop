#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MANIFEST='profiles/rafaelia-provenance-scope.v1.json'
EVIDENCE='evidence/provenance/delta-inventory.v1.json'

validate_evidence_contract() {
  python3 - <<'PY'
import json
from pathlib import Path

p = Path('evidence/provenance/delta-inventory.v1.json')
d = json.loads(p.read_text())
assert d['schema'] == 'rafaelia.delta-inventory-evidence.v1'
assert d['claim_allowed'] is False
assert d['ownership_claimed'] is False
assert d['governance_required_checks_enforced'] is False
assert d['total_changed_paths'] > 0
assert 'TOKEN_VAZIO' in d['hunk_origin_state']
assert len(d['entries']) == d['total_changed_paths']
print(f"PASS: evidence contract; paths={d['total_changed_paths']}")
PY
}

validate() {
  python3 -m py_compile tools/validate-rafaelia-provenance.py
  python3 tools/validate-rafaelia-provenance.py --manifest "$MANIFEST" --evidence "$EVIDENCE"
  validate_evidence_contract
}

expect_fail() {
  local label="$1"
  local file="$2"
  if python3 tools/validate-rafaelia-provenance.py --manifest "$file" --evidence "/tmp/${label}.evidence.json"; then
    echo "FAIL: negative fixture unexpectedly passed: $label" >&2
    exit 1
  fi
  echo "PASS: negative fixture rejected: $label"
}

negative() {
  python3 - <<'PY'
import json
from copy import deepcopy
from pathlib import Path

source = json.loads(Path('profiles/rafaelia-provenance-scope.v1.json').read_text())
cases = {}

d = deepcopy(source)
d['claim_allowed'] = True
d['authorial_delta']['ownership_claimed_by_this_manifest'] = True
cases['premature-ownership'] = d

d = deepcopy(source)
d['upstream_license']['blob'] = '0' * 40
cases['license-blob-drift'] = d

d = deepcopy(source)
d['baseline']['commit'] = '0' * 40
cases['invalid-baseline'] = d

d = deepcopy(source)
d['authorial_delta']['hunk_origin']['state'] = 'PASS'
d['authorial_delta']['hunk_origin']['ownership_claimed'] = True
cases['premature-hunk-promotion'] = d

d = deepcopy(source)
d['governance']['main_branch_protection']['state'] = 'OBSERVED_ENFORCED'
d['governance']['main_branch_protection']['observed_protected'] = True
d['governance']['main_branch_protection']['observed_ruleset_count'] = 1
d['governance']['main_branch_protection']['required_checks_enforced'] = True
cases['premature-governance-promotion'] = d

for name, payload in cases.items():
    Path(f'/tmp/{name}.json').write_text(json.dumps(payload, indent=2) + '\n')
PY

  expect_fail premature-ownership /tmp/premature-ownership.json
  expect_fail license-blob-drift /tmp/license-blob-drift.json
  expect_fail invalid-baseline /tmp/invalid-baseline.json
  expect_fail premature-hunk-promotion /tmp/premature-hunk-promotion.json
  expect_fail premature-governance-promotion /tmp/premature-governance-promotion.json

  # Re-run the canonical manifest last. Negative fixtures may never mutate it.
  python3 tools/validate-rafaelia-provenance.py --manifest "$MANIFEST" --evidence /tmp/final.evidence.json
}

case "${1:-all}" in
  validate)
    validate
    ;;
  negative)
    negative
    ;;
  all)
    validate
    negative
    ;;
  *)
    echo "usage: provenance-ci.sh [validate|negative|all]" >&2
    exit 64
    ;;
esac
