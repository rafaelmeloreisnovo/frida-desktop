#!/usr/bin/env python3
"""Validate the ChipQuantum basic-command diagnostic contract.

This textual check is intentionally independent of Meson and submodules.  It
protects the low-level source from accidentally gaining heap allocation,
recursion, generated tables, or hosted Frida layer dependencies.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "chipquantum-basic-commands.c"
BENCHMARK = ROOT / "tools" / "chipquantum-benchmark.c"
SENSORS = ROOT / "tools" / "chipquantum-repo-sensors.py"

REQUIRED_SNIPPETS = [
    "#define CQ_TORUS_DIMENSIONS 7u",
    "#define CQ_ATTRACTOR_STATES 42u",
    "#define CQ_ALPHA_NUMERATOR 1u",
    "#define CQ_ALPHA_DENOMINATOR 4u",
    "#define CQ_FNV1A_PRIME 1099511628211ull",
    "#define CQ_CRC32_POLY 0xedb88320u",
    "#define CQ_SPIRAL_RATIO_MILLI 866u",
    "struct cq_torus7",
    "struct cq_frame",
    "cq_xor_accumulate",
    "cq_fnv1a64",
    "cq_crc32_basic",
    "cq_entropy_milli",
    "cq_coherence_step_q16",
    "cq_phi_q16",
    "cq_orbit42",
    "cq_spiral_milli",
    "cq_toroidal_map",
]

FORBIDDEN_SNIPPETS = [
    "malloc(",
    "calloc(",
    "realloc(",
    "free(",
    "new ",
    "delete ",
    "pthread_",
    "GObject",
    "JSContext",
    "gumjs",
    "frida_node",
    "frida_python",
]

BENCHMARK_REQUIRED_SNIPPETS = [
    "CQ_BENCH_REPEAT",
    "cq_fill_sensor_payload",
    "cq_elapsed_ms",
    "size,repeat,entropy_milli,xor_ms,fnv1a_ms,crc32_ms,toroidal_ms,guard",
    "cq_toroidal_map",
]

SENSOR_REQUIRED_SNIPPETS = [
    "parse_github_url",
    "github_request",
    "repo_sensor",
    "toroidal_map",
    "recent_owner_repositories",
    "https://api.github.com/users/{args.owner}/repos?sort=created&direction=desc&per_page={args.limit}",
]

FUNCTION_NAMES = [
    "cq_xor_accumulate",
    "cq_fnv1a64",
    "cq_crc32_basic",
    "cq_entropy_milli",
    "cq_coherence_step_q16",
    "cq_phi_q16",
    "cq_orbit42",
    "cq_spiral_milli",
    "cq_toroidal_map",
]


def main() -> int:
    text = SOURCE.read_text(encoding="utf-8")
    benchmark_text = BENCHMARK.read_text(encoding="utf-8")
    sensor_text = SENSORS.read_text(encoding="utf-8")
    failures: list[str] = []

    for snippet in REQUIRED_SNIPPETS:
        if snippet not in text:
            failures.append(f"missing required primitive or constant: {snippet}")

    for snippet in FORBIDDEN_SNIPPETS:
        if snippet in text:
            failures.append(f"forbidden hosted or heap dependency present: {snippet}")

    for snippet in BENCHMARK_REQUIRED_SNIPPETS:
        if snippet not in benchmark_text:
            failures.append(f"benchmark missing required source path: {snippet}")

    for snippet in SENSOR_REQUIRED_SNIPPETS:
        if snippet not in sensor_text:
            failures.append(f"repo sensor missing required source path: {snippet}")

    for name in FUNCTION_NAMES:
        if text.count(f"\n{name}(") != 1:
            failures.append(f"{name} must have exactly one external definition")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: ChipQuantum basic commands, benchmark, and repo sensors keep the 7-lane/42-state contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
