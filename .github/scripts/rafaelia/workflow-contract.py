#!/usr/bin/env python3
"""Static contract for this repository's GitHub Actions topology.

This is a repository-level engineering gate, not an external compliance audit.
It protects local invariants directly observable from workflow sources.

External GitHub Actions used by the RAFAELIA workflows are deliberately treated
as bounded catalysts: checkout/bootstrap/transport helpers. Build semantics,
validation, receipts and claim boundaries stay in repository-owned scripts.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
EVIDENCE_DIR = ROOT / "evidence" / "workflow-contract"

CUSTOM_WORKFLOWS = {
    "android17-apk-elf-dex.yml",
    "android17-rfl-selftest.yml",
    "runtime-aided-debugger-hardening.yml",
    "workflow-contract.yml",
}
UPSTREAM_RELEASE_WORKFLOW = "ci.yml"

# Full commit pins make the external layer identity-stable for a given change.
# Versions are documentary labels for review; the SHA is the enforced identity.
CATALYST_PINS = {
    "actions/checkout": {
        "sha": "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        "version": "v6.0.2",
        "runtime": "node24",
        "role": "workspace-bootstrap",
    },
    "actions/setup-java": {
        "sha": "03ad4de0992f5dab5e18fcb136590ce7c4a0ac95",
        "version": "v5.6.0",
        "runtime": "node24",
        "role": "jdk-bootstrap",
    },
    "actions/upload-artifact": {
        "sha": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        "version": "v7.0.1",
        "runtime": "node24",
        "role": "evidence-transport",
    },
    "android-actions/setup-android": {
        "sha": "40fd30fb8d7440372e1316f5d1809ec01dcd3699",
        "version": "v4.0.1",
        "runtime": "node24",
        "role": "android-sdk-bootstrap",
    },
}

CUSTOM_ACTION_ALLOWLIST = {
    "android17-apk-elf-dex.yml": {
        "actions/checkout",
        "actions/setup-java",
        "actions/upload-artifact",
        "android-actions/setup-android",
    },
    "android17-rfl-selftest.yml": {
        "actions/checkout",
        "actions/upload-artifact",
    },
    "runtime-aided-debugger-hardening.yml": {
        "actions/checkout",
        "actions/upload-artifact",
    },
    "workflow-contract.yml": {
        "actions/checkout",
        "actions/upload-artifact",
    },
}

FORBIDDEN_RUNTIME_ESCAPE_HATCHES = (
    "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24",
    "ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION",
)


@dataclass
class Finding:
    level: str
    workflow: str
    rule: str
    detail: str


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def add(findings: list[Finding], level: str, path: Path, rule: str, detail: str) -> None:
    findings.append(Finding(level, path.name, rule, detail))


def has_top_level_key(text: str, key: str) -> bool:
    return re.search(rf"(?m)^{re.escape(key)}:\s*(?:$|[^ ])", text) is not None


def extract_actions(text: str) -> list[tuple[str, str]]:
    actions: list[tuple[str, str]] = []
    for match in re.finditer(r"(?m)^\s*uses:\s*([^\s#]+)", text):
        value = match.group(1)
        if value.startswith("./") or "@" not in value:
            continue
        action, ref = value.rsplit("@", 1)
        actions.append((action, ref))
    return actions


def catalyst_inventory(text: str) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for action, ref in extract_actions(text):
        policy = CATALYST_PINS.get(action)
        result.append(
            {
                "action": action,
                "ref": ref,
                "classified": policy is not None,
                "pin_match": bool(policy and ref == policy["sha"]),
                "declared_version": policy["version"] if policy else None,
                "runtime": policy["runtime"] if policy else None,
                "role": policy["role"] if policy else None,
            }
        )
    return result


def check_common(path: Path, text: str, findings: list[Finding]) -> None:
    if "\t" in text:
        add(findings, "ERROR", path, "YAML_NO_TABS", "tab characters are forbidden")
    if not text.endswith("\n"):
        add(findings, "ERROR", path, "TEXT_FINAL_NEWLINE", "missing final newline")
    if re.search(r"(?m)^\s*pull_request_target\s*:", text):
        add(findings, "ERROR", path, "NO_PULL_REQUEST_TARGET", "pull_request_target is forbidden")
    if re.search(r"(?m)^\s*permissions\s*:\s*write-all\s*$", text):
        add(findings, "ERROR", path, "NO_WRITE_ALL", "permissions: write-all is forbidden")
    for action, ref in extract_actions(text):
        if re.search(r"^(master|main|HEAD)$", ref):
            add(findings, "ERROR", path, "NO_FLOATING_ACTION_BRANCH", f"floating action ref: {action}@{ref}")


def check_custom(path: Path, text: str, findings: list[Finding]) -> None:
    required_tokens = {
        "permissions:": "explicit permissions block",
        "contents: read": "read-only contents permission",
        "concurrency:": "concurrency policy",
        "timeout-minutes:": "bounded job runtime",
    }
    for token, detail in required_tokens.items():
        if token not in text:
            add(findings, "ERROR", path, "CUSTOM_REQUIRED_CONTROL", f"missing {detail}: {token}")

    if "secrets." in text:
        add(findings, "ERROR", path, "CUSTOM_NO_REPOSITORY_SECRETS", "custom lab workflows must not depend on repository secrets")

    for token in FORBIDDEN_RUNTIME_ESCAPE_HATCHES:
        if token in text:
            add(
                findings,
                "ERROR",
                path,
                "NO_NODE_RUNTIME_ESCAPE_HATCH",
                f"runtime compatibility escape hatch is forbidden: {token}",
            )

    if "actions/upload-artifact" in text and "retention-days:" not in text:
        add(findings, "ERROR", path, "ARTIFACT_RETENTION_EXPLICIT", "artifact upload requires explicit retention-days")

    if path.name != "workflow-contract.yml" and ".github/scripts/rafaelia/" not in text:
        add(findings, "ERROR", path, "IMPLEMENTATION_OUTSIDE_YAML", "custom workflow must delegate executable logic to .github/scripts/rafaelia/")

    allowed = CUSTOM_ACTION_ALLOWLIST[path.name]
    observed = extract_actions(text)
    observed_names = {action for action, _ in observed}

    for action, ref in observed:
        if action not in allowed:
            add(
                findings,
                "ERROR",
                path,
                "CATALYST_ACTION_NOT_ALLOWED",
                f"external action is outside the bounded catalyst set for this workflow: {action}",
            )
            continue
        policy = CATALYST_PINS.get(action)
        if policy is None:
            add(findings, "ERROR", path, "CATALYST_ACTION_UNCLASSIFIED", f"missing catalyst policy for {action}")
            continue
        if ref != policy["sha"]:
            add(
                findings,
                "ERROR",
                path,
                "CATALYST_PIN_MISMATCH",
                f"{action} must be pinned to {policy['sha']} ({policy['version']}, {policy['runtime']}), observed {ref}",
            )

    # Checkout is a mandatory workspace catalyst for every custom workflow.
    if "actions/checkout" not in observed_names:
        add(findings, "ERROR", path, "CATALYST_CHECKOUT_REQUIRED", "pinned checkout catalyst is missing")

    if path.name == "android17-apk-elf-dex.yml":
        for required_action in (
            "actions/setup-java",
            "android-actions/setup-android",
            "actions/upload-artifact",
        ):
            if required_action not in observed_names:
                add(findings, "ERROR", path, "ANDROID_CATALYST_REQUIRED", f"missing Android bootstrap/transport catalyst: {required_action}")
        if 'packages: ""' not in text:
            add(
                findings,
                "ERROR",
                path,
                "ANDROID_SETUP_NO_DUPLICATE_PACKAGE_LOOP",
                "setup-android must expose tooling only; package resolution belongs to android-lab-ci.sh",
            )


def check_upstream_ci(path: Path, text: str, findings: list[Finding]) -> None:
    # This large workflow is retained as the upstream release/build graph.
    # We gate its sensitive trigger boundary instead of mixing RAFAELIA lab
    # implementation into it. Its dependency migration has a separate risk
    # surface and is not silently coupled to the custom lab workflows.
    required = [
        "name: CI",
        "on: push",
        "publish-prod:",
        "publish-dev:",
        "package-android:",
        "frida-android:",
        "sdk-android-32:",
        "sdk-android-64:",
    ]
    for token in required:
        if token not in text:
            add(findings, "ERROR", path, "UPSTREAM_RELEASE_GRAPH_IDENTITY", f"missing anchor: {token}")

    if re.search(r"(?m)^\s*pull_request\s*:", text):
        add(
            findings,
            "ERROR",
            path,
            "UPSTREAM_SECRET_BOUNDARY",
            "upstream release graph references deployment secrets and must not be opened to pull_request without a separate threat review",
        )

    if "secrets." not in text:
        add(findings, "WARNING", path, "UPSTREAM_SECRET_BOUNDARY", "expected release-secret references were not observed; review topology drift")

    if "permissions:\n      contents: write\n      id-token: write" not in text:
        add(findings, "ERROR", path, "PUBLISH_PROD_PERMISSIONS", "publish-prod least-required explicit write/id-token block changed or disappeared")

    if "permissions:\n      id-token: write" not in text:
        add(findings, "WARNING", path, "PUBLISH_DEV_PERMISSIONS", "publish-dev id-token permission anchor changed; inspect manually")

    if not has_top_level_key(text, "env"):
        add(findings, "ERROR", path, "UPSTREAM_ENV_CONTRACT", "top-level toolchain environment block missing")


def main() -> int:
    paths = sorted([*WORKFLOW_DIR.glob("*.yml"), *WORKFLOW_DIR.glob("*.yaml")])
    if not paths:
        print("WORKFLOW_CONTRACT_FAIL no workflow files found", file=sys.stderr)
        return 2

    findings: list[Finding] = []
    inventory = []
    observed_names = {p.name for p in paths}

    expected = CUSTOM_WORKFLOWS | {UPSTREAM_RELEASE_WORKFLOW}
    missing = sorted(expected - observed_names)
    for name in missing:
        findings.append(Finding("ERROR", name, "EXPECTED_WORKFLOW_PRESENT", "expected workflow is missing"))

    for path in paths:
        text = path.read_text(encoding="utf-8")
        actions = catalyst_inventory(text)
        inventory.append(
            {
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
                "lines": text.count("\n"),
                "role": (
                    "UPSTREAM_RELEASE_GRAPH"
                    if path.name == UPSTREAM_RELEASE_WORKFLOW
                    else "RAFAELIA_CUSTOM_ORCHESTRATION"
                    if path.name in CUSTOM_WORKFLOWS
                    else "UNCLASSIFIED_WORKFLOW"
                ),
                "external_actions": actions,
                "external_action_count": len(actions),
            }
        )
        check_common(path, text, findings)
        if path.name in CUSTOM_WORKFLOWS:
            check_custom(path, text, findings)
        elif path.name == UPSTREAM_RELEASE_WORKFLOW:
            check_upstream_ci(path, text, findings)
        else:
            add(findings, "WARNING", path, "WORKFLOW_CLASSIFICATION", "workflow is not yet classified by the local contract")

    errors = [f for f in findings if f.level == "ERROR"]
    warnings = [f for f in findings if f.level == "WARNING"]
    status = "PASS" if not errors else "FAIL"

    custom_catalysts = [
        action
        for item in inventory
        if item["role"] == "RAFAELIA_CUSTOM_ORCHESTRATION"
        for action in item["external_actions"]
    ]

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "schema": "rafaelia.github.workflow-contract.receipt.v2",
        "status": status,
        "scope": ".github/workflows",
        "workflow_count": len(paths),
        "external_dependency_model": "BOUNDED_CATALYST",
        "custom_catalyst_count": len(custom_catalysts),
        "custom_catalysts_all_classified": all(item["classified"] for item in custom_catalysts),
        "custom_catalysts_all_pinned": all(item["pin_match"] for item in custom_catalysts),
        "engineering_note": "repository-local best-practice gate; external actions are bounded bootstrap/transport catalysts, not implementation authority; not an external standards/compliance certification",
        "claim_allowed": False,
        "inventory": inventory,
        "findings": [asdict(f) for f in findings],
        "error_count": len(errors),
        "warning_count": len(warnings),
    }
    (EVIDENCE_DIR / "workflow-contract.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    md = [
        "# Workflow Contract Receipt",
        "",
        f"Status: **{status}**",
        f"Workflows: {len(paths)}",
        f"Errors: {len(errors)}",
        f"Warnings: {len(warnings)}",
        f"Custom external catalysts: {len(custom_catalysts)}",
        f"All custom catalysts classified: {report['custom_catalysts_all_classified']}",
        f"All custom catalysts pinned: {report['custom_catalysts_all_pinned']}",
        "",
        "> Repository-local engineering gate only. External actions are bounded catalysts; implementation authority remains in repository-owned scripts. This is not an external compliance certification.",
        "",
        "## Inventory",
        "",
    ]
    for item in inventory:
        md.append(f"- `{item['path']}` — {item['role']} — `{item['sha256']}` — external_actions={item['external_action_count']}")
        for action in item["external_actions"]:
            md.append(
                f"  - `{action['action']}@{action['ref']}` — role={action['role'] or 'UNCLASSIFIED'} — version={action['declared_version'] or 'TOKEN_VAZIO'} — runtime={action['runtime'] or 'TOKEN_VAZIO'} — pin_match={action['pin_match']}"
            )
    if findings:
        md += ["", "## Findings", ""]
        for finding in findings:
            md.append(f"- **{finding.level}** `{finding.workflow}` `{finding.rule}` — {finding.detail}")
    (EVIDENCE_DIR / "workflow-contract.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    print(
        f"WORKFLOW_CONTRACT_{status} workflows={len(paths)} catalysts={len(custom_catalysts)} errors={len(errors)} warnings={len(warnings)}"
    )
    for finding in findings:
        print(f"{finding.level} {finding.workflow} {finding.rule}: {finding.detail}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
