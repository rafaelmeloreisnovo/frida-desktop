#!/usr/bin/env python3
"""Validate Debugger Class A heuristic-autotune source constraints."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "frida-debugger-class-a-autotune.c"
HEADER = ROOT / "tools" / "frida-debugger-class-a-autotune.h"
DOC = ROOT / "docs" / "debugger-class-a-autotune.md"

REQUIRED_SOURCE = [
    "frida_dca_coherence_q16",
    "frida_dca_plan",
    "frida_dca_failover",
    "frida_dca_rollback",
    "frida_dca_mitigate",
    "frida_dca_known_good_route",
    "FRIDA_DCA_AUTOTUNE_SELFTEST",
    "frida_dca_route_score_generic",
    "frida_dca_route_score_arm32_neon",
    "frida_dca_route_score_cache_local",
    "frida_dca_route_score_rollback",
]

REQUIRED_HEADER = [
    "FRIDA_DCA_ROUTE_GENERIC",
    "FRIDA_DCA_ROUTE_ARM32_NEON",
    "FRIDA_DCA_ROUTE_CACHE_LOCAL",
    "FRIDA_DCA_ROUTE_ROLLBACK",
    "FRIDA_DCA_FAULT_UNSTABLE",
    "FRIDA_DCA_DECISION_FAILSAFE",
    "FRIDA_DCA_FAULT_ENTROPY",
    "FRIDA_DCA_FAULT_LOW_CONFIDENCE",
    "FRIDA_DCA_FAULT_DISALLOWED_ROUTE",
    "struct frida_dca_risk_policy",
    "struct frida_dca_mitigation",
    "struct frida_dca_signal",
    "struct frida_dca_decision",
]

FORBIDDEN_CORE = [
    "malloc(",
    "calloc(",
    "realloc(",
    "free(",
    "pthread_",
    "syscall(",
    "g_malloc",
    "GObject",
    "JSContext",
    "while (",
    "for (",
    "goto ",
]

REQUIRED_DOC = [
    "FAILSAFE",
    "FAILOVER",
    "ROLLBACK",
    "no heap",
    "branchless",
    "morph-on-runtime",
    "risk policy",
    "known-good route",
]


def main() -> int:
    source = SOURCE.read_text(encoding="utf-8")
    header = HEADER.read_text(encoding="utf-8")
    doc = DOC.read_text(encoding="utf-8")
    core = source.split("#ifdef FRIDA_DCA_AUTOTUNE_SELFTEST", 1)[0]
    failures: list[str] = []

    for snippet in REQUIRED_SOURCE:
        if snippet not in source:
            failures.append(f"source missing: {snippet}")

    for snippet in REQUIRED_HEADER:
        if snippet not in header:
            failures.append(f"header missing: {snippet}")

    for snippet in FORBIDDEN_CORE:
        if snippet in core:
            failures.append(f"core contains forbidden construct: {snippet}")

    for snippet in REQUIRED_DOC:
        if snippet not in doc:
            failures.append(f"doc missing: {snippet}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: Debugger Class A autotune keeps branchless no-heap failover contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
