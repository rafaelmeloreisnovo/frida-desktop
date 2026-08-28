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

INSTALL_STATUS="SKIPPED"
BUILD_STATUS="SKIPPED"
TEST_STATUS="SKIPPED"
INSTALL_RC=0
BUILD_RC=0
TEST_RC=0

rafaelia_group_begin "Runtime Learning Engine dependency bootstrap"
set +e
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
INSTALL_RC=${PIPESTATUS[0]}
set -e
INSTALL_STATUS="$([[ $INSTALL_RC -eq 0 ]] && printf PASS || printf FAIL)"
rafaelia_group_end

if [[ $INSTALL_RC -eq 0 ]]; then
  rafaelia_group_begin "TypeScript build"
  set +e
  (
    cd "$MODULE"
    npm run build
  ) 2>&1 | tee "$EVIDENCE/build.log"
  BUILD_RC=${PIPESTATUS[0]}
  set -e
  BUILD_STATUS="$([[ $BUILD_RC -eq 0 ]] && printf PASS || printf FAIL)"
  rafaelia_group_end
else
  printf 'SKIPPED: dependency bootstrap failed with rc=%s\n' "$INSTALL_RC" > "$EVIDENCE/build.log"
fi

if [[ $INSTALL_RC -eq 0 && $BUILD_RC -eq 0 ]]; then
  rafaelia_group_begin "Jest integration and regression tests"
  set +e
  (
    cd "$MODULE"
    npm test -- --runInBand --json --outputFile="$EVIDENCE/jest-results.json"
  ) 2>&1 | tee "$EVIDENCE/test.log"
  TEST_RC=${PIPESTATUS[0]}
  set -e
  TEST_STATUS="$([[ $TEST_RC -eq 0 ]] && printf PASS || printf FAIL)"
  rafaelia_group_end
else
  printf 'SKIPPED: dependency/build gate not PASS (install=%s build=%s)\n' \
    "$INSTALL_STATUS" "$BUILD_STATUS" > "$EVIDENCE/test.log"
fi

GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
TREE_SHA="$(git -C "$ROOT" rev-parse HEAD^{tree})"

python3 - \
  "$EVIDENCE/receipt.json" \
  "$EVIDENCE/jest-results.json" \
  "$GIT_SHA" \
  "$TREE_SHA" \
  "$NODE_VERSION" \
  "$NPM_VERSION" \
  "$DEPENDENCY_LOCK" \
  "$INSTALL_STATUS" \
  "$BUILD_STATUS" \
  "$TEST_STATUS" \
  "$INSTALL_RC" \
  "$BUILD_RC" \
  "$TEST_RC" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

(
    out,
    jest_path,
    git_sha,
    tree_sha,
    node_version,
    npm_version,
    dependency_lock,
    install_status,
    build_status,
    test_status,
    install_rc,
    build_rc,
    test_rc,
) = sys.argv[1:]

jest = {}
if os.path.exists(jest_path):
    try:
        with open(jest_path, "r", encoding="utf-8") as f:
            jest = json.load(f)
    except Exception as exc:
        jest = {"parse_error": str(exc)}

failed_tests = []
for suite in jest.get("testResults", []) if isinstance(jest, dict) else []:
    for assertion in suite.get("assertionResults", []):
        if assertion.get("status") == "failed":
            failed_tests.append({
                "suite": suite.get("name"),
                "full_name": assertion.get("fullName"),
                "failure_messages": assertion.get("failureMessages", []),
            })

receipt = {
    "schema": "rafaelia.runtime-learning-engine.ci-receipt.v2",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "git_sha": git_sha,
    "tree_sha": tree_sha,
    "runner_surface": "HOSTED_TYPESCRIPT_NODE",
    "node_version": node_version,
    "npm_version": npm_version,
    "dependency_lock": dependency_lock,
    "dependency_install": install_status,
    "build": build_status,
    "tests": test_status,
    "return_codes": {
        "dependency_install": int(install_rc),
        "build": int(build_rc),
        "tests": int(test_rc),
    },
    "jest_summary": {
        "success": jest.get("success") if isinstance(jest, dict) else None,
        "num_total_test_suites": jest.get("numTotalTestSuites") if isinstance(jest, dict) else None,
        "num_failed_test_suites": jest.get("numFailedTestSuites") if isinstance(jest, dict) else None,
        "num_total_tests": jest.get("numTotalTests") if isinstance(jest, dict) else None,
        "num_failed_tests": jest.get("numFailedTests") if isinstance(jest, dict) else None,
        "num_passed_tests": jest.get("numPassedTests") if isinstance(jest, dict) else None,
        "failed_tests": failed_tests,
    },
    "rollback_hook_restoration_gate": "EXECUTED_BY_JEST" if test_status == "PASS" else "UNRESOLVED_BY_FAILED_JEST_RUN",
    "memory_rollback_without_frida_gate": "FAIL_CLOSED_TESTED" if test_status == "PASS" else "UNRESOLVED_BY_FAILED_JEST_RUN",
    "corruption_quarantine_gate": "EXECUTED_BY_JEST" if test_status == "PASS" else "UNRESOLVED_BY_FAILED_JEST_RUN",
    "observability_canonical_metric_gate": "EXECUTED_BY_JEST" if test_status == "PASS" else "UNRESOLVED_BY_FAILED_JEST_RUN",
    "physical_device_smoke": "TOKEN_VAZIO",
    "android_frida_runtime_verified": False,
    "physical_performance_verified": False,
    "claim_allowed": False,
    "boundary": "CI PASS proves this hosted build/test run only; FAIL is retained as evidence. Neither state is Android physical evidence.",
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(receipt, f, indent=2, sort_keys=True)
    f.write("\n")
PY

manifest_inputs=(
  "$EVIDENCE/receipt.json"
  "$EVIDENCE/npm-install.log"
  "$EVIDENCE/build.log"
  "$EVIDENCE/test.log"
)
if [[ -f "$EVIDENCE/jest-results.json" ]]; then
  manifest_inputs+=("$EVIDENCE/jest-results.json")
fi
rafaelia_write_sha256_manifest "$EVIDENCE/SHA256SUMS" "${manifest_inputs[@]}"

if [[ $INSTALL_RC -eq 0 && $BUILD_RC -eq 0 && $TEST_RC -eq 0 ]]; then
  rafaelia_notice "RUNTIME_LEARNING_ENGINE_GATE_PASS sha=$GIT_SHA dependency_lock=$DEPENDENCY_LOCK physical_device=TOKEN_VAZIO claim_allowed=false"
  exit 0
fi

rafaelia_error \
  "RUNTIME_LEARNING_ENGINE_GATE_FAIL sha=$GIT_SHA install=$INSTALL_STATUS build=$BUILD_STATUS tests=$TEST_STATUS evidence=$EVIDENCE physical_device=TOKEN_VAZIO claim_allowed=false"
exit 1
