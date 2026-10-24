#!/usr/bin/env python3
"""Inspect packaged APK paths. Distinguish hosted shell from Gadget-bearing APK."""
import argparse
import json
import zipfile
from pathlib import Path


def inspect(path):
    with zipfile.ZipFile(path, "r") as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate ZIP entries")
        libs = sorted(x for x in names if x.startswith("lib/") and x.endswith(".so"))
        dex = sorted(x for x in names if x.startswith("classes") and x.endswith(".dex"))
        return {
            "schema": "rafaelia.frida.apk_contents.v1",
            "apk_name": Path(path).name,
            "has_manifest": "AndroidManifest.xml" in names,
            "has_dex": bool(dex),
            "native_lib_count": len(libs),
            "native_libraries": libs,
            "frida_runtime_present": bool(libs),
            "classification": "HOSTED_ANDROID_SHELL_NO_NATIVE_RUNTIME" if not libs else "NATIVE_LIBS_PRESENT_RUNTIME_UNVERIFIED",
            "physical_launch": "TOKEN_VAZIO_NOT_OBSERVED",
            "frida_attach": "TOKEN_VAZIO_NOT_OBSERVED",
            "claim_allowed": False,
        }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("apk")
    p.add_argument("--receipt")
    args = p.parse_args()
    try:
        result = inspect(args.apk)
        if not result["has_manifest"] or not result["has_dex"]:
            raise ValueError("missing manifest or dex")
    except (ValueError, OSError, zipfile.BadZipFile) as e:
        result = {"schema": "rafaelia.frida.apk_contents.v1",
                  "classification": "FAIL_INVALID_ARCHIVE", "reason": str(e),
                  "claim_allowed": False}
    payload = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if args.receipt:
        out = Path(args.receipt)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("x", encoding="utf-8") as f:
            f.write(payload)
    print(payload, end="")
    return 1 if result["classification"] == "FAIL_INVALID_ARCHIVE" else 0


if __name__ == "__main__":
    raise SystemExit(main())
