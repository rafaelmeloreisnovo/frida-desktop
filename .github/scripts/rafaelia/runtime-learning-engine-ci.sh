#!/usr/bin/env bash
# Build/test gate for modules/runtime-learning-engine.
# This proves only the hosted TypeScript build/test surface executed by this
# runner. It does not promote Android physical runtime or performance claims.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
MODULE="$ROOT/modules/runtime-learning-engine"
EVIDENCE="$ROOT/evidence/runtime-learning-engine"

rafaelia_need_cmd node
rafaelia_need_cmd npm
rafaelia_need_cmd python3
rafaelia_need_cmd sha256sum
rafaelia_need_dir "$MODULE"
rafaelia_need_file "$MODULE/package.json"
rafaelia_need_file "$MODULE/tsconfig.json"

rm -rf "$EVIDENCE"
mkdir -p "$EVIDENCE"

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
DEPENDENCY_LOCK="PRESENT"
if [[ ! -f "$MODULE/package-lock.json" ]]; then
  DEPENDENCY_LOCK="TOKEN_VAZIO"
fi

rafaelia_group_begin "Runtime Learning Engine dependency bootstrap"
(
  cd "$MODULE"
  if [[ -f package-lock.json ]]; then
    npm ci --ignore-scripts --no-audit --no-fund
  else
    # Explicitly avoid manufacturing a lockfile in CI. The receipt records the
    # missing lock as TOKEN_VAZIO instead of pretending dependency reproducibility.
    npm install --package-lock=false --ignore-scripts --no-audit --no-fund
  fi
) 2>&1 | tee "$EVIDENCE/npm-install.log"
rafaelia_group_end

rafaelia_group_begin "TypeScript build"
(
  cd "$MODULE"
  npm run build
) 2>&1 | tee "$EVIDENCE/build.log"
rafaelia_group_end

rafaelia_group_begin "Jest integration and regression tests"
(
  cd "$MODULE"
  npm test -- --runInBand
) 2>&1 | tee "$EVIDENCE/test.log"
rafaelia_group_end

GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
TREE_SHA="$(git -C "$ROOT" rev-parse HEAD^{tree})"

python3 - "$EVIDENCE/receipt.json" "$GIT_SHA" "$TREE_SHA" "$NODE_VERSION" "$NPM_VERSION" "$DEPENDENCY_LOCK" <<'PY'
import json
import sys
from datetime import datetime, timezone

out, git_sha, tree_sha, node_version, npm_version, dependency_lock = sys.argv[1:]
receipt = {
    "schema": "rafaelia.runtime-learning-engine.ci-receipt.v1",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "git_sha": git_sha,
    "tree_sha": tree_sha,
    "runner_surface": "HOSTED_TYPESCRIPT_NODE",
    "node_version": node_version,
    "npm_version": npm_version,
    "dependency_lock": dependency_lock,
    "build": "PASS",
    "tests": "PASS",
    "rollback_hook_restoration_gate": "EXECUTED_BY_JEST",
    "memory_rollback_without_frida_gate": "FAIL_CLOSED_TESTED",
    "corruption_quarantine_gate": "EXECUTED_BY_JEST",
    "observability_canonical_metric_gate": "EXECUTED_BY_JEST",
    "physical_device_smoke": "TOKEN_VAZIO",
    "android_frida_runtime_verified": False,
    "physical_performance_verified": False,
    "claim_allowed": False,
    "boundary": "CI PASS proves this hosted build/test run only; it is not Android physical evidence",
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(receipt, f, indent=2, sort_keys=True)
    f.write("\n")
PY

rafaelia_write_sha256_manifest \
  "$EVIDENCE/SHA256SUMS" \
  "$EVIDENCE/receipt.json" \
  "$EVIDENCE/npm-install.log" \
  "$EVIDENCE/build.log" \
  "$EVIDENCE/test.log"

rafaelia_notice "RUNTIME_LEARNING_ENGINE_GATE_PASS sha=$GIT_SHA dependency_lock=$DEPENDENCY_LOCK physical_device=TOKEN_VAZIO claim_allowed=false"
