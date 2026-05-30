#!/usr/bin/env python3
"""Validate the runtime-debugger ARM safety profile.

This check is intentionally dependency-free so it can run in shallow CI jobs. It
verifies that the profile keeps safety, failover, rollback, and ARM32/ARM64
requirements explicit instead of relying on prose-only intent.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "profiles" / "runtime-debugger-arm-safety.json"
DOC = ROOT / "docs" / "runtime-debugger-arm-safety.md"

REQUIRED_MODULES = {
    "learn",
    "setup",
    "probe",
    "patch",
    "watchdog",
    "failover",
    "rollback",
    "evidence",
}

REQUIRED_GUARDS = {
    "fixed_capacity_tables",
    "no_heap_on_probe_path",
    "bounded_stack_frames",
    "atomic_snapshot_commit",
    "rollback_journal_before_patch",
}

REQUIRED_ROLLBACK_ORDER = [
    "stop_new_mutations",
    "quiesce_watchdog_epoch",
    "restore_original_bytes",
    "restore_page_permissions",
    "flush_instruction_cache",
    "verify_snapshot",
    "emit_evidence",
]

TRI_STATE = ["PASS", "FAIL", "SKIPPED"]


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def main() -> int:
    failures: list[str] = []

    try:
        profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FAIL: {PROFILE.relative_to(ROOT)} is not valid JSON: {e}")
        return 1

    require(profile.get("schema") == 1, "schema must be 1", failures)
    require(profile.get("profile") == "runtime-debugger-arm-safety", "unexpected profile name", failures)

    architectures = as_list(profile.get("architectures"))
    arch_by_name = {arch.get("name"): arch for arch in architectures if isinstance(arch, dict)}
    require(set(arch_by_name) == {"arm32", "arm64"}, "profile must define exactly arm32 and arm64", failures)

    expected_arch = {
        "arm32": ("arm", 32),
        "arm64": ("aarch64", 64),
    }
    for name, (cpu_family, pointer_bits) in expected_arch.items():
        arch = arch_by_name.get(name, {})
        require(cpu_family in as_list(arch.get("meson_cpu_families")), f"{name} missing Meson CPU family {cpu_family}", failures)
        require(arch.get("pointer_bits") == pointer_bits, f"{name} pointer width must be {pointer_bits}", failures)
        guards = set(as_list(arch.get("required_guards")))
        missing_guards = REQUIRED_GUARDS - guards
        require(not missing_guards, f"{name} missing guards: {sorted(missing_guards)}", failures)

    modules = as_list(profile.get("modules"))
    module_by_name = {module.get("name"): module for module in modules if isinstance(module, dict)}
    missing_modules = REQUIRED_MODULES - set(module_by_name)
    require(not missing_modules, f"missing modules: {sorted(missing_modules)}", failures)

    for module_name in REQUIRED_MODULES:
        module = module_by_name.get(module_name, {})
        require(bool(module.get("purpose")), f"{module_name} missing purpose", failures)
        require(bool(module.get("fail_safe")), f"{module_name} missing fail_safe", failures)
        require(bool(as_list(module.get("tests"))), f"{module_name} missing tests", failures)

    seed_policy = profile.get("seed_policy", {})
    require("cryptographic key generation without platform CSPRNG" in as_list(seed_policy.get("forbidden_uses")), "seed policy must forbid non-CSPRNG key generation", failures)
    require("merkle_root" in as_list(seed_policy.get("integrity")), "seed policy must include Merkle evidence integrity", failures)

    require(profile.get("test_result_states") == TRI_STATE, "test states must be PASS/FAIL/SKIPPED", failures)
    require(profile.get("rollback_order") == REQUIRED_ROLLBACK_ORDER, "rollback order changed or incomplete", failures)

    doc_text = DOC.read_text(encoding="utf-8")
    for phrase in ["missing evidence is `SKIPPED`", "Failover is not escalation", "A result from one architecture does not certify the other architecture"]:
        require(phrase in doc_text, f"documentation missing phrase: {phrase}", failures)

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: runtime debugger ARM safety profile covers modules, failover, rollback, and tri-state evidence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
