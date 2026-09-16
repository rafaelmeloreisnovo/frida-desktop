#!/usr/bin/env python3
"""Fail-closed static contract for the repository's GitHub Actions topology.

SOURCE != EXECUTION != EVIDENCE != CLAIM. External actions are bounded
catalysts; repository-owned scripts carry implementation semantics.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
EVIDENCE_DIR = ROOT / "evidence" / "workflow-contract"
UPSTREAM_RELEASE_WORKFLOW = "ci.yml"

CUSTOM_WORKFLOWS = {
    "01.yml",
    "android-crash-observability.yml",
    "android17-apk-elf-dex.yml",
    "android17-rfl-selftest.yml",
    "arm32-neon4096-freestanding.yml",
    "arm32-neon4096-physical-bench-adapter.yml",
    "atlas-mission-consumer-gate.yml",
    "hash-bitexact-backend.yml",
    "hash-bitexact-streaming-neon.yml",
    "hash-math-plugin-freestanding.yml",
    "rafaelia-provenance-gate.yml",
    "runtime-aided-debugger-hardening.yml",
    "runtime-learning-engine.yml",
    "rafaelia-matrix-compose-observer-v1.yml",
    "rafaelia-sustento-t-observer-v1.yml",
    "workflow-contract.yml",
}

CONTROL_WORKFLOWS = {
    "0000-omega-integrator.yml",
    "0001-foundation-policy.yml",
    "0002-dependency-supply-chain.yml",
    "0003-codeql-security.yml",
    "0004-core-execution.yml",
    "0005-provenance-attestation.yml",
    "0006-openssf-scorecard.yml",
    "0007-final-verdict.yml",
}

CATALYST_PINS = {
    "actions/checkout": {
        "de0fac2e4500dabe0009e67214ff5f5447ce83dd",  # v6.0.2
        "3d3c42e5aac5ba805825da76410c181273ba90b1",  # v7.0.1
    },
    "actions/setup-python": {"a26af69be951a213d495a4c3e4e4022e16d87065"},
    "actions/setup-java": {"03ad4de0992f5dab5e18fcb136590ce7c4a0ac95"},
    "actions/upload-artifact": {
        "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        "330a01c490aca151604b8cf639adc76d48f6c5d4",  # v5.0.0
    },
    "actions/download-artifact": {"634f93cb2916e3fdff6788551b99b062d0335ce0"},  # v5.0.0
    "actions/dependency-review-action": {"a1d282b36b6f3519aa1f3fc636f609c47dddb294"},  # v5.0.0
    "github/codeql-action/init": {"b96794f015dfd88f77b49b1c93e0fa7110f94c63"},  # v4.38.0
    "github/codeql-action/analyze": {"b96794f015dfd88f77b49b1c93e0fa7110f94c63"},  # v4.38.0
    "github/codeql-action/upload-sarif": {"b96794f015dfd88f77b49b1c93e0fa7110f94c63"},  # v4.38.0
    "actions/attest": {"c32b4b8b198b65d0bd9d63490e847ff7b53989d4"},  # v4.0.0
    "ossf/scorecard-action": {"2d1146689b8cda280b9bc96326124645441f03bc"},  # v2.4.4
    "android-actions/setup-android": {"40fd30fb8d7440372e1316f5d1809ec01dcd3699"},
}
DEFAULT_ACTIONS = {"actions/checkout", "actions/upload-artifact"}
ACTION_ALLOWLIST = {name: set(DEFAULT_ACTIONS) for name in CUSTOM_WORKFLOWS}
ACTION_ALLOWLIST["atlas-mission-consumer-gate.yml"] = {"actions/checkout"}
ACTION_ALLOWLIST["rafaelia-matrix-compose-observer-v1.yml"] = {"actions/checkout", "actions/setup-python"}
ACTION_ALLOWLIST["rafaelia-sustento-t-observer-v1.yml"] = {"actions/checkout", "actions/setup-python"}
ACTION_ALLOWLIST["android17-apk-elf-dex.yml"] = {
    "actions/checkout", "actions/setup-java", "actions/upload-artifact", "android-actions/setup-android"
}
ACTION_ALLOWLIST["01.yml"] = set(ACTION_ALLOWLIST["android17-apk-elf-dex.yml"])

@dataclass
class Finding:
    level: str
    workflow: str
    rule: str
    detail: str


def add(findings, level, path, rule, detail):
    findings.append(Finding(level, path.name, rule, detail))


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_actions(text):
    out = []
    for match in re.finditer(r"(?m)^\s*(?:-\s*)?uses:\s*([^\s#]+)", text):
        value = match.group(1)
        if value.startswith("./") or "@" not in value:
            continue
        out.append(tuple(value.rsplit("@", 1)))
    return out


def check_common(path, text, findings):
    if "\t" in text:
        add(findings, "ERROR", path, "YAML_NO_TABS", "tab characters are forbidden")
    if not text.endswith("\n"):
        add(findings, "ERROR", path, "TEXT_FINAL_NEWLINE", "missing final newline")
    if re.search(r"(?m)^\s*pull_request_target\s*:", text):
        add(findings, "ERROR", path, "NO_PULL_REQUEST_TARGET", "pull_request_target is forbidden")
    if re.search(r"(?m)^\s*permissions\s*:\s*write-all\s*$", text):
        add(findings, "ERROR", path, "NO_WRITE_ALL", "permissions: write-all is forbidden")
    for action, ref in extract_actions(text):
        if ref in {"main", "master", "HEAD"}:
            add(findings, "ERROR", path, "NO_FLOATING_ACTION_BRANCH", f"floating action ref: {action}@{ref}")


def check_custom(path, text, findings):
    for token in ("permissions:", "contents: read", "concurrency:", "timeout-minutes:"):
        if token not in text:
            add(findings, "ERROR", path, "CUSTOM_REQUIRED_CONTROL", f"missing required control: {token}")
    if "secrets." in text:
        add(findings, "ERROR", path, "CUSTOM_NO_REPOSITORY_SECRETS", "custom orchestration must not depend on repository secrets")
    if "actions/upload-artifact" in text and "retention-days:" not in text:
        add(findings, "ERROR", path, "ARTIFACT_RETENTION_EXPLICIT", "artifact upload requires retention-days")
    if path.name != "workflow-contract.yml" and ".github/scripts/rafaelia/" not in text:
        add(findings, "ERROR", path, "IMPLEMENTATION_OUTSIDE_YAML", "workflow must delegate executable semantics to repository-owned scripts")

    allowed = ACTION_ALLOWLIST[path.name]
    actions = extract_actions(text)
    names = {action for action, _ in actions}
    for action, ref in actions:
        if action not in allowed:
            add(findings, "ERROR", path, "CATALYST_ACTION_NOT_ALLOWED", f"external action outside bounded set: {action}")
            continue
        expected = CATALYST_PINS.get(action)
        if expected is None or ref not in expected:
            allowed_refs = sorted(expected) if expected else []
            add(findings, "ERROR", path, "CATALYST_PIN_MISMATCH", f"{action} expected one of {allowed_refs}, observed {ref}")
    if "actions/checkout" not in names:
        add(findings, "ERROR", path, "CATALYST_CHECKOUT_REQUIRED", "pinned checkout is required")

    if path.name in {"android17-apk-elf-dex.yml", "01.yml"}:
        for action in ("actions/setup-java", "android-actions/setup-android", "actions/upload-artifact"):
            if action not in names:
                add(findings, "ERROR", path, "ANDROID_CATALYST_REQUIRED", f"missing Android catalyst {action}")
        if 'packages: ""' not in text:
            add(findings, "ERROR", path, "ANDROID_SETUP_BOUNDARY", "setup-android must expose tools only")

    if path.name == "01.yml":
        for token in ("final-verdict:", "needs:", "arm32-strict:", "hash-backend:", "runtime-hardening:", "android17:", "rafaelia.pipeline.orchestrator.receipt.v1"):
            if token not in text:
                add(findings, "ERROR", path, "ORCHESTRATOR_GRAPH_CONTRACT", f"missing graph/receipt anchor: {token}")

    if path.name == "atlas-mission-consumer-gate.yml":
        if ".github/scripts/rafaelia/atlas-mission-consumer-gate.sh" not in text:
            add(findings, "ERROR", path, "ATLAS_GATE_CONTRACT", "missing repository-owned ATLAS gate wrapper")


def check_control(path, text, findings):
    for token in ("permissions:", "concurrency:"):
        if token not in text:
            add(findings, "ERROR", path, "CONTROL_REQUIRED_CONTROL", f"missing required control: {token}")
    if "secrets." in text:
        add(findings, "ERROR", path, "CONTROL_NO_REPOSITORY_SECRETS", "control-plane workflow must not depend on repository secrets")
    if "pull_request_target:" in text:
        add(findings, "ERROR", path, "CONTROL_NO_PULL_REQUEST_TARGET", "pull_request_target is forbidden")
    for action, ref in extract_actions(text):
        expected = CATALYST_PINS.get(action)
        if expected is None:
            add(findings, "ERROR", path, "CONTROL_ACTION_NOT_ALLOWED", f"unclassified external action: {action}")
        elif ref not in expected:
            add(findings, "ERROR", path, "CONTROL_PIN_MISMATCH", f"{action} expected one of {sorted(expected)}, observed {ref}")
    if "actions/upload-artifact" in text and "retention-days:" not in text:
        add(findings, "ERROR", path, "ARTIFACT_RETENTION_EXPLICIT", "artifact upload requires retention-days")


def check_upstream_ci(path, text, findings):
    for token in ("name: CI", "on: push", "publish-prod:", "publish-dev:", "package-android:", "frida-android:", "sdk-android-32:", "sdk-android-64:"):
        if token not in text:
            add(findings, "ERROR", path, "UPSTREAM_RELEASE_GRAPH_IDENTITY", f"missing anchor: {token}")
    if re.search(r"(?m)^\s*pull_request\s*:", text):
        add(findings, "ERROR", path, "UPSTREAM_SECRET_BOUNDARY", "release graph must not run on pull_request")
    for line_no, line in enumerate(text.splitlines(), 1):
        if re.search(r"^\s*if:\s*\$\{\{.*\bsecrets\.", line):
            add(findings, "ERROR", path, "NO_SECRETS_IN_IF", f"line {line_no}: project secret to env before conditional evaluation")
    if "permissions:\n      contents: write\n      id-token: write" not in text:
        add(findings, "ERROR", path, "PUBLISH_PROD_PERMISSIONS", "publish-prod write/id-token block changed")


def main():
    paths = sorted([*WORKFLOW_DIR.glob("*.yml"), *WORKFLOW_DIR.glob("*.yaml")])
    if not paths:
        print("WORKFLOW_CONTRACT_FAIL no workflow files found", file=sys.stderr)
        return 2
    findings = []
    observed = {p.name for p in paths}
    expected = CUSTOM_WORKFLOWS | CONTROL_WORKFLOWS | {UPSTREAM_RELEASE_WORKFLOW}
    for name in sorted(expected - observed):
        findings.append(Finding("ERROR", name, "EXPECTED_WORKFLOW_PRESENT", "expected workflow is missing"))

    inventory = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        role = "UPSTREAM_RELEASE_GRAPH" if path.name == UPSTREAM_RELEASE_WORKFLOW else "RAFAELIA_CUSTOM_ORCHESTRATION" if path.name in CUSTOM_WORKFLOWS else "RAFAELIA_CONTROL_PLANE" if path.name in CONTROL_WORKFLOWS else "UNCLASSIFIED_WORKFLOW"
        inventory.append({"path": str(path.relative_to(ROOT)), "sha256": sha256(path), "bytes": path.stat().st_size, "role": role, "external_actions": [{"action": a, "ref": r} for a, r in extract_actions(text)]})
        check_common(path, text, findings)
        if path.name in CUSTOM_WORKFLOWS:
            check_custom(path, text, findings)
        elif path.name in CONTROL_WORKFLOWS:
            check_control(path, text, findings)
        elif path.name == UPSTREAM_RELEASE_WORKFLOW:
            check_upstream_ci(path, text, findings)
        else:
            add(findings, "ERROR", path, "WORKFLOW_CLASSIFICATION", "workflow is not classified by the local contract")

    errors = [f for f in findings if f.level == "ERROR"]
    warnings = [f for f in findings if f.level == "WARNING"]
    status = "PASS" if not errors else "FAIL"
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    report = {"schema": "rafaelia.github.workflow-contract.receipt.v3", "status": status, "workflow_count": len(paths), "expected_workflow_count": len(expected), "external_dependency_model": "BOUNDED_CATALYST", "claim_allowed": False, "inventory": inventory, "findings": [asdict(f) for f in findings], "error_count": len(errors), "warning_count": len(warnings)}
    receipt = EVIDENCE_DIR / "workflow-contract.receipt.v3.json"
    receipt.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for finding in findings:
        print(f"{finding.level} {finding.workflow} {finding.rule}: {finding.detail}")
    print(f"WORKFLOW_CONTRACT_{status} workflows={len(paths)} errors={len(errors)} warnings={len(warnings)}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
