#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE="io.rafaelia.fridalab"
ACTIVITY="${PACKAGE}/.MainActivity"
ENDPOINT="${FRIDA_ENDPOINT:-127.0.0.1:27042}"
RECEIPT_DIR="${RAFAELIA_FRIDA_RECEIPT_DIR:-${HOME}/.local/state/rafaelia/frida-lab/receipts}"

PYTHON=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON="$(command -v python)"
else
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=python_missing" >&2
  exit 64
fi

command -v frida-ps >/dev/null 2>&1 || {
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=frida_cli_missing" >&2
  exit 64
}

"${PYTHON}" -c 'import frida' >/dev/null 2>&1 || {
  echo "RAFAELIA_FRIDA_ON_DEVICE_FAIL reason=python_frida_missing" >&2
  exit 64
}

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

ENDPOINT="${ENDPOINT}" RECEIPT_DIR="${RECEIPT_DIR}" PACKAGE="${PACKAGE}" "${PYTHON}" <<'PY'
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


def prop(name):
    try:
        return subprocess.check_output(
            ["getprop", name], stderr=subprocess.DEVNULL, text=True
        ).strip() or "TOKEN_VAZIO"
    except Exception:
        return "TOKEN_VAZIO"


def gate(value):
    return "PASS" if value else "FAIL"


receipt = {
    "schema": "rafaelia.frida.on_device_smoke.v1",
    "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "execution_scope": "ON_DEVICE_TERMUX_LOCALHOST",
    "endpoint": endpoint,
    "package": package,
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
    "checks": {},
    "learning": {
        "observation_injected": False,
        "store_mutated_by_smoke": False,
        "snapshot": "TOKEN_VAZIO",
        "snapshot_bridge": "TOKEN_VAZIO",
    },
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
  const result = {
    java_available: false,
    main_activity_resolved: false,
    snapshot: 'TOKEN_VAZIO',
    snapshot_bridge: 'TOKEN_VAZIO',
    error: null
  };

  if (!Java.available) {
    result.error = 'Java.available=false';
    send({kind: 'rafaelia-on-device-result', result: result});
    return;
  }

  Java.perform(function () {
    result.java_available = true;
    try {
      const Lab = Java.use('io.rafaelia.fridalab.MainActivity');
      result.main_activity_resolved = true;

      try {
        if (typeof Lab.learningSnapshotForInstrumentation !== 'undefined') {
          result.snapshot = String(Lab.learningSnapshotForInstrumentation(true));
          result.snapshot_bridge = 'public_instrumentation_bridge';
        }
      } catch (e) {
        result.error = 'public snapshot bridge: ' + e;
      }

      if (result.snapshot === 'TOKEN_VAZIO') {
        try {
          result.snapshot = String(Lab.nativeLearningSnapshot(true));
          result.snapshot_bridge = 'native_snapshot_via_frida';
          result.error = null;
        } catch (e) {
          result.error = 'native snapshot bridge: ' + e;
        }
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
            result_holder["error"] = message.get("stack") or message.get("description") or str(message)
            done.set()

    script = session.create_script(source)
    script.on("message", on_message)
    script.load()

    if not done.wait(8.0):
        raise RuntimeError("instrumentation result timeout")

    java_ok = bool(result_holder.get("java_available"))
    activity_ok = bool(result_holder.get("main_activity_resolved"))
    snapshot = str(result_holder.get("snapshot") or "TOKEN_VAZIO")
    bridge = str(result_holder.get("snapshot_bridge") or "TOKEN_VAZIO")

    receipt["checks"]["java_available"] = gate(java_ok)
    receipt["checks"]["main_activity_resolution"] = gate(activity_ok)
    receipt["learning"]["snapshot"] = snapshot
    receipt["learning"]["snapshot_bridge"] = bridge

    snapshot_present = snapshot != "TOKEN_VAZIO"
    receipt["checks"]["learning_snapshot"] = gate(snapshot_present)
    receipt["checks"]["neon4096_page_4096"] = gate(
        "observed OS page: 4096 B (MATCH_4096)" in snapshot
        or "NEON4096=" in snapshot and "/4096B" in snapshot.replace(" ", "")
    )
    receipt["checks"]["simd_fold_selftest"] = gate("SIMD fold selftest: PASS" in snapshot)
    receipt["checks"]["automatic_active_disabled"] = gate(
        "automatic ACTIVE policy: DISABLED" in snapshot
        or "Automatic ACTIVE policy: DISABLED" in snapshot
    )
    receipt["checks"]["gpu_unpromoted"] = gate("GPU compute backend: TOKEN_VAZIO" in snapshot)
    receipt["checks"]["validation_persistence_explicit"] = gate(
        "validation persistence: TOKEN_VAZIO" in snapshot
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

required = (
    "gadget_enumerated",
    "frida_attach",
    "java_available",
    "main_activity_resolution",
    "learning_snapshot",
    "neon4096_page_4096",
    "simd_fold_selftest",
    "automatic_active_disabled",
    "gpu_unpromoted",
    "validation_persistence_explicit",
)
receipt["required_gates"] = list(required)
receipt["overall"] = (
    "PASS"
    if not receipt.get("fatal_error")
    and all(receipt["checks"].get(name) == "PASS" for name in required)
    else "FAIL"
)

# Append-only receipt: never overwrite an earlier device run.
stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
pid = receipt.get("pid", "TOKEN_VAZIO")
base = receipt_dir / f"frida-on-device-{stamp}-pid{pid}.json"
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
