#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE="${RAFAELIA_FRIDA_PACKAGE:-io.rafaelia.fridalab}"
ACTIVITY_CLASS="io.rafaelia.fridalab.MainActivity"
ENDPOINT="${FRIDA_ENDPOINT:-127.0.0.1:27042}"
RECEIPT_DIR="${RAFAELIA_FRIDA_RECEIPT_DIR:-${HOME}/.local/state/rafaelia/frida-lab/receipts}"
SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${SCRIPT_PATH}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
EXPECTED_RECEIPT="${RAFAELIA_FRIDA_EXPECTED_RECEIPT:-}"
EXACT_MODE=0
if [[ -n "${EXPECTED_RECEIPT}" ]]; then
  [[ -f "${EXPECTED_RECEIPT}" ]] || {
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=expected_receipt_missing path=${EXPECTED_RECEIPT}" >&2
    exit 64
  }
  EXPECTED_RECEIPT="$(cd -- "$(dirname -- "${EXPECTED_RECEIPT}")" && pwd -P)/$(basename -- "${EXPECTED_RECEIPT}")"
  EXACT_MODE=1
fi
PYTHON=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON="$(command -v python)"
else
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=python_missing" >&2
  exit 64
fi

if (( EXACT_MODE == 1 )); then
  expected_target="$("${PYTHON}" - "${EXPECTED_RECEIPT}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
receipt = json.loads(path.read_text(encoding="utf-8"))
if receipt.get("schema") != "rafaelia.frida.android-apk-lab.receipt.v4":
    raise SystemExit("unexpected receipt schema")
target = receipt.get("physical_target") or {}
package = str(target.get("package") or "")
endpoint = str(target.get("gadget_endpoint") or "")
if not package or not endpoint:
    raise SystemExit("missing physical_target package/endpoint")
print(package + "\t" + endpoint)
PY
  )" || {
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=expected_receipt_target_invalid" >&2
    exit 64
  }
  IFS=$'\t' read -r expected_package expected_endpoint <<< "$expected_target"

  if [[ -n "${RAFAELIA_FRIDA_PACKAGE:-}" && "${RAFAELIA_FRIDA_PACKAGE}" != "$expected_package" ]]; then
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=package_override_mismatch expected=$expected_package actual=${RAFAELIA_FRIDA_PACKAGE}" >&2
    exit 64
  fi
  if [[ -n "${FRIDA_ENDPOINT:-}" && "${FRIDA_ENDPOINT}" != "$expected_endpoint" ]]; then
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=endpoint_override_mismatch expected=$expected_endpoint actual=${FRIDA_ENDPOINT}" >&2
    exit 64
  fi

  PACKAGE="$expected_package"
  ENDPOINT="$expected_endpoint"
fi

ACTIVITY="${PACKAGE}/${ACTIVITY_CLASS}"

case "${ENDPOINT}" in
  127.0.0.1:*|localhost:*|'[::1]':*) ;;
  *)
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=non_local_endpoint endpoint=${ENDPOINT}" >&2
    exit 64
    ;;
esac

command -v frida-ps >/dev/null 2>&1 || {
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=frida_cli_missing" >&2
  exit 64
}

"${PYTHON}" -c 'import frida' >/dev/null 2>&1 || {
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=python_frida_missing" >&2
  exit 64
}

SOURCE_COMMIT="TOKEN_VAZIO"
SOURCE_TREE_SHA="TOKEN_VAZIO"
SOURCE_TREE_CLEAN="TOKEN_VAZIO"
if command -v git >/dev/null 2>&1 && git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf TOKEN_VAZIO)"
  SOURCE_TREE_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD^{tree} 2>/dev/null || printf TOKEN_VAZIO)"
  if [[ -z "$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=no 2>/dev/null || printf '?')" ]]; then
    SOURCE_TREE_CLEAN="true"
  else
    SOURCE_TREE_CLEAN="false"
  fi
fi

mkdir -p "${RECEIPT_DIR}"
chmod 700 "${RECEIPT_DIR}" 2>/dev/null || true

# Mobile-first: if the Gadget is not already reachable, try to launch the
# exported lab Activity locally. No adb, no USB, no host computer.
if ! frida-ps -H "${ENDPOINT}" >/dev/null 2>&1; then
  if command -v am >/dev/null 2>&1; then
    am start -n "${ACTIVITY}" >/dev/null 2>&1 || true
  elif [[ -x /system/bin/am ]]; then
    /system/bin/am start -n "${ACTIVITY}" >/dev/null 2>&1 || true
  fi

  ready=0
  for _ in 1 2 3 4 5 6 7 8; do
    if frida-ps -H "${ENDPOINT}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if (( ready == 0 )); then
    echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=gadget_unreachable endpoint=${ENDPOINT}" >&2
    exit 65
  fi
fi

ENDPOINT="${ENDPOINT}" \
RECEIPT_DIR="${RECEIPT_DIR}" \
PACKAGE="${PACKAGE}" \
SCRIPT_PATH="${SCRIPT_PATH}" \
SOURCE_COMMIT="${SOURCE_COMMIT}" \
SOURCE_TREE_SHA="${SOURCE_TREE_SHA}" \
SOURCE_TREE_CLEAN="${SOURCE_TREE_CLEAN}" \
EXPECTED_RECEIPT="${EXPECTED_RECEIPT}" \
EXACT_MODE="${EXACT_MODE}" \
"${PYTHON}" <<'PY'
import datetime as dt
import hashlib
import json
import os
import pathlib
import subprocess
import threading
import traceback

import frida

endpoint = os.environ["ENDPOINT"]
receipt_dir = pathlib.Path(os.environ["RECEIPT_DIR"])
package = os.environ["PACKAGE"]
script_path = pathlib.Path(os.environ["SCRIPT_PATH"]).resolve()
source_commit = os.environ.get("SOURCE_COMMIT", "TOKEN_VAZIO") or "TOKEN_VAZIO"
source_tree_sha = os.environ.get("SOURCE_TREE_SHA", "TOKEN_VAZIO") or "TOKEN_VAZIO"
source_tree_clean_raw = os.environ.get("SOURCE_TREE_CLEAN", "TOKEN_VAZIO")
source_tree_clean = (
    True if source_tree_clean_raw == "true"
    else False if source_tree_clean_raw == "false"
    else "TOKEN_VAZIO"
)
exact_mode = os.environ.get("EXACT_MODE") == "1"
expected_receipt_path_raw = os.environ.get("EXPECTED_RECEIPT", "")
expected_receipt_path = pathlib.Path(expected_receipt_path_raw).resolve() if expected_receipt_path_raw else None


def prop(name):
    try:
        return subprocess.check_output(
            ["getprop", name], stderr=subprocess.DEVNULL, text=True
        ).strip() or "TOKEN_VAZIO"
    except Exception:
        return "TOKEN_VAZIO"


def gate(value):
    return "PASS" if value else "FAIL"


def file_sha256(path):
    try:
        h = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return "TOKEN_VAZIO"


script_sha256 = file_sha256(script_path)
expected_receipt = {}
expected_receipt_sha256 = "TOKEN_VAZIO"
expected_source_head = "TOKEN_VAZIO"
expected_source_tree = "TOKEN_VAZIO"
if exact_mode:
    try:
        expected_receipt_sha256 = file_sha256(expected_receipt_path)
        expected_receipt = json.loads(expected_receipt_path.read_text(encoding="utf-8"))
        if expected_receipt.get("schema") != "rafaelia.frida.android-apk-lab.receipt.v4":
            raise ValueError(f"unexpected expected-receipt schema: {expected_receipt.get('schema')!r}")
        source_meta = expected_receipt.get("source") or {}
        expected_source_head = str(source_meta.get("head_sha") or "TOKEN_VAZIO")
        expected_source_tree = str(source_meta.get("checked_out_tree_sha") or "TOKEN_VAZIO")
    except Exception as exc:
        expected_receipt = {"load_error": f"{type(exc).__name__}: {exc}"}

receipt = {
    "schema": "rafaelia.frida.on_device_smoke.v3" if exact_mode else "rafaelia.frida.on_device_smoke.v2",
    "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "execution_scope": "ON_DEVICE_TERMUX_LOCALHOST",
    "endpoint": endpoint,
    "package": package,
    "source": {
        "repository": "rafaelmeloreisnovo/frida-desktop",
        "commit": source_commit,
        "tree_sha": source_tree_sha,
        "tracked_tree_clean": source_tree_clean,
        "script_path": str(script_path),
        "script_sha256": script_sha256,
    },
    "frida_python_version": getattr(frida, "__version__", "TOKEN_VAZIO"),
    "android": {
        "sdk": prop("ro.build.version.sdk"),
        "release": prop("ro.build.version.release"),
        "primary_abi": prop("ro.product.cpu.abi"),
        "abi_list": prop("ro.product.cpu.abilist"),
        "manufacturer": prop("ro.product.manufacturer"),
        "model": prop("ro.product.model"),
        "fingerprint": prop("ro.build.fingerprint"),
    },
    "checks": {
        "source_commit_bound": gate(source_commit != "TOKEN_VAZIO"),
        "source_tree_sha_bound": gate(source_tree_sha != "TOKEN_VAZIO"),
        "source_tree_clean": gate(source_tree_clean is True),
        "script_sha256_bound": gate(script_sha256 != "TOKEN_VAZIO"),
    },
    "learning": {
        "observation_injected": False,
        "store_mutated_by_smoke": False,
        "snapshot": "TOKEN_VAZIO",
        "snapshot_bridge": "TOKEN_VAZIO",
        "evidence_snapshot": "TOKEN_VAZIO",
        "evidence_snapshot_bridge": "TOKEN_VAZIO",
    },
    "custody": {
        "mode": "EXACT_BYTE_V3" if exact_mode else "LEGACY_RUNTIME_V2",
        "expected_receipt_path": str(expected_receipt_path) if expected_receipt_path else "TOKEN_VAZIO",
        "expected_receipt_sha256": expected_receipt_sha256,
        "expected_source_head": expected_source_head,
        "expected_source_tree": expected_source_tree,
        "package_source_dir": "TOKEN_VAZIO",
        "native_library_dir": "TOKEN_VAZIO",
        "installed_apk_sha256": "TOKEN_VAZIO",
        "librafaelia_probe_sha256": "TOKEN_VAZIO",
        "libfrida_gadget_sha256": "TOKEN_VAZIO",
        "signer_certificate_sha256": "TOKEN_VAZIO",
        "runtime_package": "TOKEN_VAZIO",
        "apk_to_source_exact_bind": "TOKEN_VAZIO",
    },
    "physical_execution": "TOKEN_VAZIO",
    "claim_allowed_physical_exact_scope": False,
    "claim_allowed": False,
}

session = None
script = None
try:
    manager = frida.get_device_manager()
    device = manager.add_remote_device(endpoint)
    processes = device.enumerate_processes()
    target = next((p for p in processes if p.name == "Gadget"), None)
    receipt["checks"]["gadget_enumerated"] = gate(target is not None)
    if target is None:
        raise RuntimeError("Gadget process not enumerated")

    receipt["pid"] = target.pid
    receipt["process_name"] = target.name

    session = device.attach(target.pid)
    receipt["checks"]["frida_attach"] = "PASS"

    done = threading.Event()
    result_holder = {}

    source = r'''
'use strict';
(function () {
  const exactMode = __RAFAELIA_EXACT_MODE__;
  const result = {
    java_available: false,
    main_activity_resolved: false,
    snapshot: 'TOKEN_VAZIO',
    snapshot_bridge: 'TOKEN_VAZIO',
    evidence_snapshot: 'TOKEN_VAZIO',
    evidence_snapshot_bridge: 'TOKEN_VAZIO',
    package_source_dir: 'TOKEN_VAZIO',
    native_library_dir: 'TOKEN_VAZIO',
    installed_apk_sha256: 'TOKEN_VAZIO',
    librafaelia_probe_sha256: 'TOKEN_VAZIO',
    libfrida_gadget_sha256: 'TOKEN_VAZIO',
    signer_certificate_sha256: 'TOKEN_VAZIO',
    runtime_package: 'TOKEN_VAZIO',
    custody_error: null,
    error: null
  };

  if (!Java.available) {
    result.error = 'Java.available=false';
    send({kind: 'rafaelia-on-device-result', result: result});
    return;
  }

  Java.perform(function () {
    result.java_available = true;

    function bytesToHex(bytes) {
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        let value = bytes[i];
        if (value < 0) value += 256;
        const h = value.toString(16);
        out += h.length === 1 ? '0' + h : h;
      }
      return out;
    }

    function sha256Bytes(bytes) {
      const MessageDigest = Java.use('java.security.MessageDigest');
      const md = MessageDigest.getInstance('SHA-256');
      md.update(bytes);
      return bytesToHex(md.digest());
    }

    function sha256File(path) {
      const MessageDigest = Java.use('java.security.MessageDigest');
      const FileInputStream = Java.use('java.io.FileInputStream');
      const md = MessageDigest.getInstance('SHA-256');
      const stream = FileInputStream.$new(path);
      const buffer = Java.array('byte', new Array(8192).fill(0));
      try {
        while (true) {
          const count = stream.read(buffer);
          if (count < 0) break;
          if (count > 0) md.update(buffer, 0, count);
        }
      } finally {
        stream.close();
      }
      return bytesToHex(md.digest());
    }

    if (exactMode) {
      try {
        const ActivityThread = Java.use('android.app.ActivityThread');
        const app = ActivityThread.currentApplication();
        const context = app.getApplicationContext();
        const appInfo = context.getApplicationInfo();
        const sourceDir = String(appInfo.sourceDir.value);
        const nativeDir = String(appInfo.nativeLibraryDir.value);
        result.package_source_dir = sourceDir;
        result.native_library_dir = nativeDir;
        result.installed_apk_sha256 = sha256File(sourceDir);
        result.librafaelia_probe_sha256 = sha256File(nativeDir + '/librafaelia-probe.so');
        result.libfrida_gadget_sha256 = sha256File(nativeDir + '/libfrida-gadget.so');

        const pm = context.getPackageManager();
        const packageName = String(context.getPackageName());
        result.runtime_package = packageName;
        let signatures = null;
        try {
          const packageInfo = pm.getPackageInfo(packageName, 0x08000000);
          const signingInfo = packageInfo.signingInfo.value;
          signatures = signingInfo.getApkContentsSigners();
        } catch (modernError) {
          const packageInfoLegacy = pm.getPackageInfo(packageName, 64);
          signatures = packageInfoLegacy.signatures.value;
        }
        if (signatures === null || signatures.length < 1) {
          throw new Error('no APK signer certificate');
        }
        result.signer_certificate_sha256 = sha256Bytes(signatures[0].toByteArray());
      } catch (e) {
        result.custody_error = String(e);
      }
    }

    try {
      const Lab = Java.use('io.rafaelia.fridalab.MainActivity');
      result.main_activity_resolved = true;
      try {
        result.snapshot = String(Lab.learningSnapshotForInstrumentation(true));
        result.snapshot_bridge = 'public_raw_instrumentation_bridge';
        result.evidence_snapshot = String(Lab.learningEvidenceSnapshotForInstrumentation(true));
        result.evidence_snapshot_bridge = 'public_v1_1_evidence_bridge';
      } catch (e) {
        result.error = 'public snapshot bridge: ' + e;
      }
    } catch (e) {
      result.error = 'MainActivity resolution: ' + e;
    }
    send({kind: 'rafaelia-on-device-result', result: result});
  });
})();
'''

    def on_message(message, data):
        if message.get("type") == "send":
            payload = message.get("payload") or {}
            if payload.get("kind") == "rafaelia-on-device-result":
                result_holder.update(payload.get("result") or {})
                done.set()
        elif message.get("type") == "error":
            result_holder["error"] = (
                message.get("stack") or message.get("description") or str(message)
            )
            done.set()

    source = source.replace(
        "__RAFAELIA_EXACT_MODE__",
        "true" if exact_mode else "false",
    )
    script = session.create_script(source)
    script.on("message", on_message)
    script.load()

    if not done.wait(8.0):
        raise RuntimeError("instrumentation result timeout")

    java_ok = bool(result_holder.get("java_available"))
    activity_ok = bool(result_holder.get("main_activity_resolved"))
    snapshot = str(result_holder.get("snapshot") or "TOKEN_VAZIO")
    bridge = str(result_holder.get("snapshot_bridge") or "TOKEN_VAZIO")
    evidence_snapshot = str(result_holder.get("evidence_snapshot") or "TOKEN_VAZIO")
    evidence_bridge = str(result_holder.get("evidence_snapshot_bridge") or "TOKEN_VAZIO")

    custody = receipt["custody"]
    custody["package_source_dir"] = str(result_holder.get("package_source_dir") or "TOKEN_VAZIO")
    custody["native_library_dir"] = str(result_holder.get("native_library_dir") or "TOKEN_VAZIO")
    custody["installed_apk_sha256"] = str(result_holder.get("installed_apk_sha256") or "TOKEN_VAZIO").lower()
    custody["librafaelia_probe_sha256"] = str(result_holder.get("librafaelia_probe_sha256") or "TOKEN_VAZIO").lower()
    custody["libfrida_gadget_sha256"] = str(result_holder.get("libfrida_gadget_sha256") or "TOKEN_VAZIO").lower()
    custody["signer_certificate_sha256"] = str(result_holder.get("signer_certificate_sha256") or "TOKEN_VAZIO").lower()
    custody["runtime_package"] = str(result_holder.get("runtime_package") or "TOKEN_VAZIO")
    if result_holder.get("custody_error"):
        custody["custody_error"] = str(result_holder.get("custody_error"))

    receipt["checks"]["java_available"] = gate(java_ok)
    receipt["checks"]["main_activity_resolution"] = gate(activity_ok)
    receipt["learning"]["snapshot"] = snapshot
    receipt["learning"]["snapshot_bridge"] = bridge
    receipt["learning"]["evidence_snapshot"] = evidence_snapshot
    receipt["learning"]["evidence_snapshot_bridge"] = evidence_bridge

    snapshot_present = snapshot != "TOKEN_VAZIO"
    evidence_snapshot_present = evidence_snapshot != "TOKEN_VAZIO"
    receipt["checks"]["learning_snapshot"] = gate(snapshot_present)
    receipt["checks"]["learning_evidence_snapshot"] = gate(evidence_snapshot_present)

    training_zero = (
        "training observations: 0" in snapshot
        and "training predictions: 0" in snapshot
    )
    validation_marker = snapshot.find("VALIDATE_SHADOW")
    validation_raw = snapshot[validation_marker:] if validation_marker >= 0 else ""
    validation_zero = (
        "  observations: 0" in validation_raw
        and "  predictions: 0" in validation_raw
    )

    training_semantics_ok = (
        not training_zero
        or (
            "training error: TOKEN_VAZIO / NO_SAMPLES" in evidence_snapshot
            and "learning overhead p50/p95/p99: TOKEN_VAZIO / NO_SAMPLES" in evidence_snapshot
        )
    )
    validation_semantics_ok = (
        not validation_zero
        or (
            "model state: NO_MODEL" in evidence_snapshot
            and "model frozen: TOKEN_VAZIO / NO_MODEL" in evidence_snapshot
            and "error: TOKEN_VAZIO / NO_SAMPLES" in evidence_snapshot[
                evidence_snapshot.find("VALIDATE_SHADOW"):
            ]
        )
    )
    receipt["checks"]["zero_sample_token_vazio_semantics"] = gate(
        training_semantics_ok and validation_semantics_ok
    )
    receipt["checks"]["neon4096_page_4096"] = gate(
        "observed OS page: 4096 B (MATCH_4096)" in snapshot
    )
    receipt["checks"]["simd_fold_selftest"] = gate(
        "SIMD fold selftest: PASS" in snapshot
    )
    receipt["checks"]["automatic_active_disabled"] = gate(
        "automatic ACTIVE policy: DISABLED" in snapshot
    )
    receipt["checks"]["gpu_unpromoted"] = gate(
        "GPU compute backend: TOKEN_VAZIO" in snapshot
    )
    receipt["checks"]["validation_persistence_explicit"] = gate(
        "validation persistence: TOKEN_VAZIO" in snapshot
    )

    if exact_mode:
        expected_by_abi = expected_receipt.get("expected_physical") or {}
        primary_abi = receipt["android"]["primary_abi"]
        expected = expected_by_abi.get(primary_abi) or {}
        receipt["custody"]["expected_abi"] = primary_abi
        receipt["custody"]["expected"] = expected
        receipt["checks"]["exact_receipt_schema"] = gate(
            expected_receipt.get("schema") == "rafaelia.frida.android-apk-lab.receipt.v4"
        )
        receipt["checks"]["exact_receipt_sha256_bound"] = gate(
            expected_receipt_sha256 != "TOKEN_VAZIO"
        )
        receipt["checks"]["expected_source_head_bound"] = gate(
            expected_source_head != "TOKEN_VAZIO"
        )
        receipt["checks"]["expected_source_tree_bound"] = gate(
            expected_source_tree != "TOKEN_VAZIO"
        )
        receipt["checks"]["verifier_source_matches_expected_head"] = gate(
            source_commit == expected_source_head
        )
        receipt["checks"]["verifier_source_matches_expected_tree"] = gate(
            source_tree_sha == expected_source_tree
        )
        receipt["checks"]["verifier_source_matches_expected_identity"] = gate(
            source_commit == expected_source_head or source_tree_sha == expected_source_tree
        )
        receipt["checks"]["expected_abi_present"] = gate(bool(expected))
        receipt["checks"]["target_package_match"] = gate(
            bool(expected)
            and receipt["custody"]["runtime_package"]
            == str(expected.get("package") or "")
            and package == str(expected.get("package") or "")
        )
        receipt["checks"]["target_endpoint_match"] = gate(
            bool(expected)
            and endpoint == str(expected.get("gadget_endpoint") or "")
        )
        receipt["checks"]["installed_apk_sha256_match"] = gate(
            bool(expected)
            and receipt["custody"]["installed_apk_sha256"]
            == str(expected.get("apk_sha256") or "").lower()
        )
        receipt["checks"]["source_built_probe_sha256_match"] = gate(
            bool(expected)
            and receipt["custody"]["librafaelia_probe_sha256"]
            == str(expected.get("source_built_probe_sha256") or "").lower()
        )
        receipt["checks"]["frida_gadget_sha256_match"] = gate(
            bool(expected)
            and receipt["custody"]["libfrida_gadget_sha256"]
            == str(expected.get("frida_gadget_sha256") or "").lower()
        )
        receipt["checks"]["signer_certificate_sha256_match"] = gate(
            bool(expected)
            and receipt["custody"]["signer_certificate_sha256"]
            == str(expected.get("signer_certificate_sha256") or "").lower()
        )
        receipt["checks"]["custody_observation_error_free"] = gate(
            not result_holder.get("custody_error")
        )

    if result_holder.get("error"):
        receipt["instrumentation_note"] = result_holder["error"]

except Exception as exc:
    receipt["fatal_error"] = f"{type(exc).__name__}: {exc}"
    receipt["traceback"] = traceback.format_exc()
finally:
    if script is not None:
        try:
            script.unload()
        except Exception:
            pass
    if session is not None:
        try:
            session.detach()
        except Exception:
            pass

required = [
    "source_commit_bound",
    "source_tree_sha_bound",
    "source_tree_clean",
    "script_sha256_bound",
    "gadget_enumerated",
    "frida_attach",
    "java_available",
    "main_activity_resolution",
    "learning_snapshot",
    "learning_evidence_snapshot",
    "zero_sample_token_vazio_semantics",
    "neon4096_page_4096",
    "simd_fold_selftest",
    "automatic_active_disabled",
    "gpu_unpromoted",
    "validation_persistence_explicit",
]
if exact_mode:
    required.extend([
        "exact_receipt_schema",
        "exact_receipt_sha256_bound",
        "expected_source_head_bound",
        "expected_source_tree_bound",
        "verifier_source_matches_expected_identity",
        "expected_abi_present",
        "target_package_match",
        "target_endpoint_match",
        "installed_apk_sha256_match",
        "source_built_probe_sha256_match",
        "frida_gadget_sha256_match",
        "signer_certificate_sha256_match",
        "custody_observation_error_free",
    ])
receipt["required_gates"] = list(required)
receipt["overall"] = (
    "PASS"
    if not receipt.get("fatal_error")
    and all(receipt["checks"].get(name) == "PASS" for name in required)
    else "FAIL"
)
if exact_mode:
    receipt["custody"]["apk_to_source_exact_bind"] = receipt["overall"]
    receipt["physical_execution"] = receipt["overall"]
    receipt["claim_allowed_physical_exact_scope"] = receipt["overall"] == "PASS"

# Append-only receipt: never overwrite an earlier device run.
stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
pid = receipt.get("pid", "TOKEN_VAZIO")
version = "v3" if exact_mode else "v2"
base = receipt_dir / f"frida-on-device-{version}-{stamp}-pid{pid}.json"
encoded = (json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
fd = os.open(base, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as handle:
    handle.write(encoded)
    handle.flush()
    os.fsync(handle.fileno())

digest = hashlib.sha256(encoded).hexdigest()
sha_path = pathlib.Path(str(base) + ".sha256")
sha_line = f"{digest}  {base.name}\n".encode("ascii")
fd = os.open(sha_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as handle:
    handle.write(sha_line)
    handle.flush()
    os.fsync(handle.fileno())

print(f"RAFAELIA_FRIDA_ON_DEVICE_{receipt['overall']}")
print(f"endpoint={endpoint}")
print(f"source_commit={source_commit}")
print(f"source_tree_sha={source_tree_sha}")
print(f"source_tree_clean={source_tree_clean}")
print(f"script_sha256={script_sha256}")
print(f"exact_mode={exact_mode}")
print(f"expected_receipt_sha256={expected_receipt_sha256}")
print(f"apk_to_source_exact_bind={receipt['custody']['apk_to_source_exact_bind']}")
print(f"pid={receipt.get('pid', 'TOKEN_VAZIO')}")
for name in required:
    print(f"{name}={receipt['checks'].get(name, 'TOKEN_VAZIO')}")
print("training_observation_injected=NO")
print("store_mutated_by_smoke=NO")
print("claim_allowed=false")
print(f"receipt={base}")
print(f"sha256={digest}")

raise SystemExit(0 if receipt["overall"] == "PASS" else 1)
PY
