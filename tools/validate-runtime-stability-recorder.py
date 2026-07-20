#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = ROOT / "tools" / "frida-runtime-stability-recorder.h"
SOURCE = ROOT / "tools" / "frida-runtime-stability-recorder.c"
SELFTEST = ROOT / "tools" / "frida-runtime-stability-recorder-selftest.c"
PROFILE = ROOT / "profiles" / "runtime-stability-recorder.json"
DOC = ROOT / "docs" / "runtime-stability-recorder.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> None:
    for path in (HEADER, SOURCE, SELFTEST, PROFILE, DOC):
        require(path.is_file(), f"missing {path.relative_to(ROOT)}")

    header = HEADER.read_text(encoding="utf-8")
    source = SOURCE.read_text(encoding="utf-8")
    selftest = SELFTEST.read_text(encoding="utf-8")
    doc = DOC.read_text(encoding="utf-8")
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))

    require(profile.get("extends") == "runtime-debugger-arm-safety",
            "profile must extend the ARM safety contract")
    require(profile.get("claim_allowed") is False,
            "claim_allowed must remain false")
    require(profile["privacy"]["payload_bytes"] == "forbidden",
            "payload bytes must be forbidden")
    require(profile["stability"]["default_delta_trigger"] == 11796,
            "Q16 delta trigger must remain approximately 0.18")
    require(profile["stability"]["stable_events_persisted"] is False,
            "stable events must not be persisted")
    require(profile["runtime_execution"] == "TOKEN_VAZIO",
            "runtime execution must remain TOKEN_VAZIO")

    for forbidden in ("malloc(", "calloc(", "realloc(", "free(", "fopen(",
                      "open(", "write(", "send(", "recv(", "sqlite3_"):
        require(forbidden not in source,
                f"hot-path source contains forbidden hosted call: {forbidden}")

    lowered_header = header.lower()
    for forbidden_field in ("payload", "plaintext", "credential", "password",
                            "token_bytes", "body_bytes"):
        require(forbidden_field not in lowered_header,
                f"record contract exposes forbidden field: {forbidden_field}")

    required_symbols = (
        "frida_rs_silicon_tag",
        "frida_rs_init",
        "frida_rs_observe",
        "frida_rs_drain",
        "frida_rs_make_dca_signal",
        "frida_rs_reset_epoch",
    )
    for symbol in required_symbols:
        require(symbol in header and symbol in source,
                f"missing implementation for {symbol}")

    require("FRIDA_RS_DEFAULT_DELTA_TRIGGER_Q16 11796u" in header,
            "header trigger constant drifted")
    require("FRIDA_RS_EVENT_CAPACITY 256u" in header,
            "fixed event capacity drifted")
    require("FRIDA_RS_DECISION_DUMP" in selftest,
            "self-test must assert triggered dumps")
    require("expected_silicon_tag" in selftest,
            "self-test must cover silicon mismatch fail-safe")
    require(re.search(r"TCP.*byte stream", doc, flags=re.IGNORECASE | re.DOTALL),
            "documentation must preserve TCP operation/packet distinction")
    require("does not decrypt" in doc.lower(),
            "documentation must prohibit decryption")

    print("PASS: runtime stability recorder contract is structurally consistent")


if __name__ == "__main__":
    main()
