#!/usr/bin/env python3
"""One-shot deterministic repair for ci.yml secret conditionals.

GitHub Actions does not allow the `secrets` context directly in step `if:`
expressions. This script performs a narrow, fail-closed edit of the upstream
Frida Android job without reformatting the rest of the large workflow.
"""

from pathlib import Path

PATH = Path(".github/workflows/ci.yml")
text = PATH.read_text(encoding="utf-8")

job_anchor = """  frida-android:\n    needs: [sdk-linux, sdk-android-32, sdk-android-64]\n    strategy:\n      matrix:\n        arch: [x86, x86_64, arm, arm64]\n      fail-fast: false\n    runs-on: ubuntu-latest\n    steps:\n"""
job_replacement = """  frida-android:\n    needs: [sdk-linux, sdk-android-32, sdk-android-64]\n    strategy:\n      matrix:\n        arch: [x86, x86_64, arm, arm64]\n      fail-fast: false\n    runs-on: ubuntu-latest\n    env:\n      ANDROID_ARTIFACT_SIGNING_KEY: ${{ secrets.ANDROID_ARTIFACT_SIGNING_KEY }}\n      ANDROID_ARTIFACT_SIGNING_KEY_ID: ${{ secrets.ANDROID_ARTIFACT_SIGNING_KEY_ID }}\n    steps:\n"""

if text.count(job_anchor) != 1:
    raise SystemExit("FIX_FAIL frida-android job anchor drifted")
text = text.replace(job_anchor, job_replacement, 1)

bad_if = "if: ${{ secrets.ANDROID_ARTIFACT_SIGNING_KEY != '' && secrets.ANDROID_ARTIFACT_SIGNING_KEY_ID != '' }}"
good_if = "if: ${{ env.ANDROID_ARTIFACT_SIGNING_KEY != '' && env.ANDROID_ARTIFACT_SIGNING_KEY_ID != '' }}"
if text.count(bad_if) != 2:
    raise SystemExit(f"FIX_FAIL expected 2 invalid secret conditionals, observed {text.count(bad_if)}")
text = text.replace(bad_if, good_if)

secret_echo = 'echo "${{ secrets.ANDROID_ARTIFACT_SIGNING_KEY }}" | gpg --batch --import'
safer_echo = 'printf \'%s\\n\' "$ANDROID_ARTIFACT_SIGNING_KEY" | gpg --batch --import'
if text.count(secret_echo) != 1:
    raise SystemExit("FIX_FAIL signing-key import anchor drifted")
text = text.replace(secret_echo, safer_echo, 1)

secret_id = '--local-user "${{ secrets.ANDROID_ARTIFACT_SIGNING_KEY_ID }}"'
safer_id = '--local-user "$ANDROID_ARTIFACT_SIGNING_KEY_ID"'
if text.count(secret_id) != 1:
    raise SystemExit("FIX_FAIL signing-key id anchor drifted")
text = text.replace(secret_id, safer_id, 1)

# Avoid shell xtrace around secret-bearing steps.
block_anchor = """      - name: Import signing key\n        if: ${{ env.ANDROID_ARTIFACT_SIGNING_KEY != '' && env.ANDROID_ARTIFACT_SIGNING_KEY_ID != '' }}\n        run: |\n          set -euxo pipefail\n"""
block_replacement = """      - name: Import signing key\n        if: ${{ env.ANDROID_ARTIFACT_SIGNING_KEY != '' && env.ANDROID_ARTIFACT_SIGNING_KEY_ID != '' }}\n        run: |\n          set -euo pipefail\n"""
if text.count(block_anchor) != 1:
    raise SystemExit("FIX_FAIL signing import block drifted")
text = text.replace(block_anchor, block_replacement, 1)

PATH.write_text(text, encoding="utf-8")
print("FIX_OK ci.yml secret conditionals migrated to job env context")
