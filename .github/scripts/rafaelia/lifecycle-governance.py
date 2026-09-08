#!/usr/bin/env python3
"""Fail-closed lifecycle and promotion topology gate for Frida Desktop.

The script owns repository-local lifecycle semantics. GitHub Actions only supplies
event context and transports the generated evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "frida_lifecycle.v1.json"
DEFAULT_OUTPUT = ROOT / "evidence" / "lifecycle"
EXPECTED_SCHEMA = "rafaelia.frida.lifecycle/v1"
EXPECTED_CHAIN = ["00-intake", "01-integration", "02-beta", "main"]
EXPECTED_PROMOTIONS = {
    "01-integration": "00-intake",
    "02-beta": "01-integration",
    "main": "02-beta",
}
REQUIRED_PRINCIPLES = {
    "SOURCE!=DERIVED_INDEX!=EXECUTION!=EVIDENCE!=CLAIM",
    "TOKEN_VAZIO!=0",
    "GREEN_GATE_PROMOTES_ONLY_MEASURED_SCOPE",
    "PR_PASS!=SERVER_SIDE_PROTECTION",
    "HOSTED_CI!=PHYSICAL_DEVICE_EVIDENCE",
    "ARTIFACT!=RELEASE_AUTHORITY",
    "ROLLBACK_PLAN!=ROLLBACK_EXECUTED",
}
SEMVER_STABLE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SEMVER_PRE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+-(?:alpha|beta|rc)\.[0-9]+$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")


class GateError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_contract() -> dict:
    try:
        return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GateError(f"cannot load lifecycle contract: {exc}") from exc


def validate_contract(contract: dict) -> None:
    if contract.get("schema") != EXPECTED_SCHEMA:
        raise GateError("unexpected lifecycle schema")
    if contract.get("source_first") is not True:
        raise GateError("source_first must remain true")
    if contract.get("claim_allowed") is not False:
        raise GateError("claim_allowed must remain false")
    if contract.get("automatic_merge") is not False:
        raise GateError("automatic_merge must remain false")
    if contract.get("automatic_stable_release") is not False:
        raise GateError("automatic_stable_release must remain false")

    principles = set(contract.get("principles", []))
    missing = sorted(REQUIRED_PRINCIPLES - principles)
    if missing:
        raise GateError(f"missing lifecycle principles: {missing}")

    lanes = contract.get("lanes", [])
    observed = [lane.get("branch") for lane in lanes]
    if observed != EXPECTED_CHAIN:
        raise GateError(f"lane order drift: {observed}")

    by_branch = {lane["branch"]: lane for lane in lanes}
    for target, source in EXPECTED_PROMOTIONS.items():
        if by_branch[target].get("accepts_from") != [source]:
            raise GateError(f"{target} must accept only {source}")
        if by_branch[source].get("promotes_to") != target:
            raise GateError(f"{source} must promote only to {target}")

    for lane in lanes:
        if lane.get("direct_push_desired") is not False:
            raise GateError(f"{lane['branch']} direct_push_desired must remain false")
        if not isinstance(lane.get("provider_protection_state"), str):
            raise GateError(f"{lane['branch']} missing provider protection state")

    rollback = contract.get("rollback", {})
    if rollback.get("automatic_force_push") is not False:
        raise GateError("automatic force-push rollback is forbidden")
    if rollback.get("automatic_history_rewrite") is not False:
        raise GateError("automatic history rewrite is forbidden")


def event_context() -> dict:
    return {
        "event_name": os.getenv("GITHUB_EVENT_NAME", "LOCAL"),
        "base_ref": os.getenv("GITHUB_BASE_REF", ""),
        "head_ref": os.getenv("GITHUB_HEAD_REF", ""),
        "ref_name": os.getenv("GITHUB_REF_NAME", ""),
        "ref": os.getenv("GITHUB_REF", ""),
        "sha": os.getenv("GITHUB_SHA", ""),
        "run_id": os.getenv("GITHUB_RUN_ID", "LOCAL"),
        "run_attempt": os.getenv("GITHUB_RUN_ATTEMPT", "0"),
        "actor": os.getenv("GITHUB_ACTOR", "LOCAL"),
        "repository": os.getenv("GITHUB_REPOSITORY", "LOCAL"),
    }


def validate_promotion(context: dict) -> dict:
    event = context["event_name"]
    base = context["base_ref"]
    head = context["head_ref"]
    result = {
        "applicable": event == "pull_request",
        "base": base or "TOKEN_VAZIO",
        "head": head or "TOKEN_VAZIO",
        "state": "NOT_APPLICABLE",
        "reason": "non-PR event",
    }
    if event != "pull_request":
        return result

    if base not in EXPECTED_CHAIN:
        raise GateError(f"PR base {base!r} is outside lifecycle lanes")

    if base == "00-intake":
        forbidden = {"00-intake", "01-integration", "02-beta", "main"}
        if head in forbidden:
            raise GateError(f"00-intake cannot accept lifecycle/backflow source {head!r}")
        result.update(state="PASS", reason="source/external contribution enters through 00-intake")
        return result

    expected = EXPECTED_PROMOTIONS[base]
    if head != expected:
        raise GateError(f"promotion to {base} requires head {expected}; observed {head}")
    result.update(state="PASS", reason=f"ordered promotion {head} -> {base}")
    return result


def lane_from_context(context: dict) -> str:
    candidate = context.get("base_ref") if context.get("event_name") == "pull_request" else context.get("ref_name")
    return candidate if candidate in EXPECTED_CHAIN else "TOKEN_VAZIO"


def inventory_workflows() -> list[dict]:
    result = []
    for path in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        result.append({
            "path": str(path.relative_to(ROOT)),
            "sha256": sha256(path),
            "bytes": path.stat().st_size,
            "lines": path.read_text(encoding="utf-8").count("\n"),
        })
    return result


def release_readiness(lane: str, version: str) -> dict:
    if lane not in {"02-beta", "main"}:
        raise GateError("release-readiness is allowed only from 02-beta or main")
    if not version:
        raise GateError("release version is required")
    if lane == "02-beta" and not SEMVER_PRE.fullmatch(version):
        raise GateError("02-beta requires X.Y.Z-{alpha|beta|rc}.N version syntax")
    if lane == "main" and not SEMVER_STABLE.fullmatch(version):
        raise GateError("main requires X.Y.Z stable version syntax")
    return {
        "state": "PLAN_READY_NOT_RELEASED",
        "lane": lane,
        "version": version,
        "tag_creation_allowed": False,
        "production_publish_allowed": False,
        "blocker": "TOKEN_VAZIO_RELEASE_GRAPH_ISOLATION_REQUIRED",
        "note": "This gate prepares evidence only; it does not create a tag or publish a release.",
    }


def rollback_plan(lane: str, target_sha: str) -> dict:
    if lane not in EXPECTED_CHAIN:
        raise GateError("rollback-plan must run from a lifecycle lane")
    if not SHA40.fullmatch(target_sha):
        raise GateError("rollback target must be a lowercase 40-hex commit SHA")
    return {
        "state": "PLAN_READY_NOT_EXECUTED",
        "lane": lane,
        "target_sha": target_sha,
        "strategy": "REVERT_PR_THROUGH_SAME_LIFECYCLE",
        "provider_write_executed": False,
        "history_rewrite_allowed": False,
        "preflight_commands": [
            f"git log --oneline {target_sha}..HEAD",
            f"git diff --stat {target_sha}..HEAD",
        ],
        "revert_commit_selection": "TOKEN_VAZIO_OPERATOR_OR_AUTOMATION_SELECTION",
        "postcondition": "A separate PR must pass the same lifecycle gates and provider readback.",
    }


def render_markdown(receipt: dict) -> str:
    lines = [
        "# Frida Lifecycle Gate Receipt", "",
        f"- Status: **{receipt['status']}**",
        f"- Mode: `{receipt['mode']}`",
        f"- Lane: `{receipt['lane']}`",
        f"- Event: `{receipt['context']['event_name']}`",
        f"- SHA: `{receipt['context']['sha'] or 'TOKEN_VAZIO'}`",
        f"- Run: `{receipt['context']['run_id']}` / attempt `{receipt['context']['run_attempt']}`",
        f"- Promotion: `{receipt['promotion']['state']}` — {receipt['promotion']['reason']}",
        f"- Provider protection: `{receipt['provider_protection']}`",
        "- Claim allowed: `false`", "", "## Lifecycle", "",
        "`feature/external -> 00-intake -> 01-integration -> 02-beta -> main`", "",
        "## Lanes", "", "| Order | Branch | Channel | Role | Protection |",
        "|---:|---|---|---|---|",
    ]
    for lane in receipt["lanes"]:
        lines.append(f"| {lane['order']} | `{lane['branch']}` | `{lane['channel']}` | {lane['role']} | `{lane['provider_protection_state']}` |")
    lines += ["", "## Evidence boundaries", ""]
    for item in receipt["boundaries"]:
        lines.append(f"- `{item}`")
    if receipt.get("release_readiness"):
        rr = receipt["release_readiness"]
        lines += ["", "## Release readiness", "", f"- State: `{rr['state']}`", f"- Version: `{rr['version']}`", f"- Tag creation allowed: `{str(rr['tag_creation_allowed']).lower()}`", f"- Blocker: `{rr['blocker']}`"]
    if receipt.get("rollback_plan"):
        rb = receipt["rollback_plan"]
        lines += ["", "## Rollback plan", "", f"- State: `{rb['state']}`", f"- Target SHA: `{rb['target_sha']}`", f"- Strategy: `{rb['strategy']}`", "- Provider write executed: `false`"]
    lines += ["", "## Workflow inventory", "", f"Inventoried workflows: **{len(receipt['workflow_inventory'])}**", ""]
    for wf in receipt["workflow_inventory"]:
        lines.append(f"- `{wf['path']}` — `{wf['sha256']}` — {wf['bytes']} bytes")
    return "\n".join(lines) + "\n"


def render_html(receipt: dict) -> str:
    cards = []
    for lane in receipt["lanes"]:
        cards.append(
            "<section class='lane'>"
            f"<div class='order'>{lane['order']:02d}</div>"
            f"<h2>{html.escape(lane['branch'])}</h2>"
            f"<p class='channel'>{html.escape(lane['channel'])}</p>"
            f"<p>{html.escape(lane['purpose'])}</p>"
            f"<code>{html.escape(lane['provider_protection_state'])}</code>"
            "</section>"
        )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frida Lifecycle Evidence</title><style>
body{{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#eef1f5}}main{{max-width:1180px;margin:auto;padding:32px}}
.meta,.lane,.boundary{{background:#171b22;border:1px solid #2a3140;border-radius:14px;padding:18px}}.meta{{margin-bottom:24px}}
.flow{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}}.order{{font-size:12px;opacity:.7}}
.channel{{font-weight:700;text-transform:uppercase;letter-spacing:.08em}}code{{word-break:break-all;color:#c7d6ff}}h1,h2{{margin-top:0}}
.boundary{{margin-top:24px;border-left:4px solid #7e8aa2}}
</style></head><body><main><h1>Frida lifecycle control plane</h1><div class="meta">
<strong>Status:</strong> {html.escape(receipt['status'])}<br><strong>Mode:</strong> {html.escape(receipt['mode'])}<br>
<strong>Lane:</strong> {html.escape(receipt['lane'])}<br><strong>SHA:</strong> <code>{html.escape(receipt['context']['sha'] or 'TOKEN_VAZIO')}</code><br>
<strong>Run:</strong> {html.escape(str(receipt['context']['run_id']))}</div><div class="flow">{''.join(cards)}</div>
<div class="boundary"><strong>Evidence boundary:</strong> hosted CI and artifacts do not prove physical-device execution, provider protection, release authority, or model training.</div>
</main></body></html>"""


def write_evidence(output: Path, receipt: dict) -> None:
    output.mkdir(parents=True, exist_ok=True)
    json_path = output / "lifecycle-state.v1.json"
    md_path = output / "lifecycle-state.v1.md"
    html_path = output / "index.html"
    json_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(receipt), encoding="utf-8")
    html_path.write_text(render_html(receipt), encoding="utf-8")
    (output / "SHA256SUMS").write_text(
        "".join(f"{sha256(path)}  {path.name}\n" for path in (json_path, md_path, html_path)),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("validate", "snapshot", "release-readiness", "rollback-plan"), default="validate")
    parser.add_argument("--target-sha", default="")
    parser.add_argument("--release-version", default="")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    try:
        contract = load_contract()
        validate_contract(contract)
        context = event_context()
        promotion = validate_promotion(context)
        lane = lane_from_context(context)
        receipt = {
            "schema": "rafaelia.frida.lifecycle.receipt/v1",
            "status": "PASS",
            "mode": args.mode,
            "claim_allowed": False,
            "source_first": True,
            "context": context,
            "lane": lane,
            "promotion": promotion,
            "provider_protection": contract["desired_branch_protection"]["apply_state"],
            "lanes": contract["lanes"],
            "workflow_inventory": inventory_workflows(),
            "release_readiness": None,
            "rollback_plan": None,
            "boundaries": ["PASS!=SERVER_SIDE_PROTECTION", "ARTIFACT!=RELEASE_AUTHORITY", "HOSTED_CI!=PHYSICAL_DEVICE_EVIDENCE", "TOKEN_VAZIO!=PASS", "ROLLBACK_PLAN!=ROLLBACK_EXECUTED"],
        }
        if args.mode == "release-readiness":
            receipt["release_readiness"] = release_readiness(lane, args.release_version)
        elif args.mode == "rollback-plan":
            receipt["rollback_plan"] = rollback_plan(lane, args.target_sha)
        write_evidence(Path(args.output_dir), receipt)
        print("FRIDA_LIFECYCLE_GATE=PASS")
        print(f"lane={lane}")
        print(f"promotion={promotion['state']}")
        print(f"provider_protection={receipt['provider_protection']}")
        print("claim_allowed=false")
        return 0
    except GateError as exc:
        print(f"FRIDA_LIFECYCLE_GATE=FAIL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
