#!/usr/bin/env python3
"""Validate the top-level freestanding/debugger profile contract.

The check is intentionally textual so it can run in shallow CI jobs where Frida's
subprojects and Meson bootstrap are not available.  It guards the non-breaking
contract exposed by meson.options and meson.build.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MESON_BUILD = ROOT / "meson.build"
MESON_OPTIONS = ROOT / "meson.options"

REQUIRED_SNIPPETS = {
    MESON_OPTIONS: [
        "option('freestanding_profile'",
        "value: false",
        "option('debugger_class_a'",
        "FRIDA_DEBUGGER_CLASS_A=1",
    ],
    MESON_BUILD: [
        "freestanding_profile = get_option('freestanding_profile')",
        "debugger_class_a = get_option('debugger_class_a')",
        "-DFRIDA_FREESTANDING_PROFILE=1",
        "cc.has_argument(arg)",
        "-ffreestanding",
        "-fno-builtin",
        "-DFRIDA_DEBUGGER_CLASS_A=1",
        "gumjs_option = freestanding_profile ? 'disabled' : 'enabled'",
        "'gumjs=' + gumjs_option",
        "not freestanding_profile",
    ],
}

HOSTED_LAYERS = [
    "frida_clr",
    "frida_node",
    "frida_python",
    "frida_swift",
    "frida_qml",
    "frida_tools",
]


def main() -> int:
    failures: list[str] = []

    for path, snippets in REQUIRED_SNIPPETS.items():
        text = path.read_text(encoding="utf-8")
        for snippet in snippets:
            if snippet not in text:
                failures.append(f"{path.relative_to(ROOT)} missing: {snippet}")

    meson_text = MESON_BUILD.read_text(encoding="utf-8")
    for layer in HOSTED_LAYERS:
        guard = f"if not freestanding_profile and get_option('{layer}')"
        if guard not in meson_text:
            failures.append(f"meson.build does not gate {layer} behind freestanding_profile")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: freestanding profile keeps defaults opt-in and gates hosted layers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
