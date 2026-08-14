#!/usr/bin/env python3
"""Static contract for this repository's GitHub Actions topology.

This is a repository-level engineering gate, not an external compliance audit.
It protects local invariants that are directly observable from the workflow
sources and emits evidence for each run.
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


def check_common(path: Path, text: str, findings: list[Finding]) -> None:
    if "\t" in text:
        add(findings, "ERROR", path, "YAML_NO_TABS", "tab characters are forbidden")
    if not text.endswith("\n"):
        add(findings, "ERROR", path, "TEXT_FINAL_NEWLINE", "missing final newline")
    if re.search(r"(?m)^\s*pull_request_target\s*:", text):
        add(findings, "ERROR", path, "NO_PULL_REQUEST_TARGET", "pull_request_target is forbidden")
    if re.search(r"(?m)^\s*permissions\s*:\s*write-all\s*$", text):
        add(findings, "ERROR", path, "NO_WRITE_ALL", "permissions: write-all is forbidden")
    for match in re.finditer(r"(?m)^\s*uses:\s*([^\s#]+)", text):
        ref = match.group(1)
        if ref.startswith("./"):
            continue
        if re.search(r"@(master|main|HEAD)$", ref):
            add(findings, "ERROR", path, "NO_FLOATING_ACTION_BRANCH", f"floating action ref: {ref}")


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

    if "actions/upload-artifact" in text and "retention-days:" not in text:
        add(findings, "ERROR", path, "ARTIFACT_RETENTION_EXPLICIT", "artifact upload requires explicit retention-days")

    if path.name != "workflow-contract.yml" and ".github/scripts/rafaelia/" not in text:
        add(findings, "ERROR", path, "IMPLEMENTATION_OUTSIDE_YAML", "custom workflow must delegate executable logic to .github/scripts/rafaelia/")


def check_upstream_ci(path: Path, text: str, findings: list[Finding]) -> None:
    # This large workflow is retained as the upstream release/build graph.
    # We gate its sensitive trigger boundary instead of mixing RAFAELIA lab
    # implementation into it.
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

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "schema": "rafaelia.github.workflow-contract.receipt.v1",
        "status": status,
        "scope": ".github/workflows",
        "workflow_count": len(paths),
        "engineering_note": "repository-local best-practice gate; not an external standards/compliance certification",
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
        "",
        "> Repository-local engineering gate only. This is not an external compliance certification.",
        "",
        "## Inventory",
        "",
    ]
    for item in inventory:
        md.append(f"- `{item['path']}` — {item['role']} — `{item['sha256']}`")
    if findings:
        md += ["", "## Findings", ""]
        for finding in findings:
            md.append(f"- **{finding.level}** `{finding.workflow}` `{finding.rule}` — {finding.detail}")
    (EVIDENCE_DIR / "workflow-contract.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    print(
        f"WORKFLOW_CONTRACT_{status} workflows={len(paths)} errors={len(errors)} warnings={len(warnings)}"
    )
    for finding in findings:
        print(f"{finding.level} {finding.workflow} {finding.rule}: {finding.detail}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
