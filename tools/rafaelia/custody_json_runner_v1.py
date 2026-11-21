#!/usr/bin/env python3
"""RAFAELIA project-specific JSON custody runner, Python stdlib adapter.
Reads local input JSON (possibly selected from Drive by user), never executes
JSON as commands. Writes local append-only receipts; never commits to cloud.
"""
import argparse
import hashlib
import json
import os
import re
import socket
import struct
import time
from pathlib import Path

SCHEMA = "rafaelia.frida.custody-plan/v1"
MASK = 0xffffffff
_ORGANS = ("PULSAR", "SENTINEL", "MEMORY", "ACTION")


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def u32(obj, key):
    v = obj.get(key)
    if type(v) is not int or v < 0 or v > MASK:
        raise ValueError("invalid_u32:" + key)
    return v


def parse_plan(raw):
    if len(raw) > 65536:
        raise ValueError("JSON_TOO_LARGE")
    def no_dupes(pairs):
        d = {}
        for k, v in pairs:
            if k in d:
                raise ValueError("DUPLICATE_KEY:" + k)
            d[k] = v
        return d
    x = json.loads(raw, object_pairs_hook=no_dupes)
    if not isinstance(x, dict) or set(x) != {"schema", "run_id", "input", "anchor_mesh", "source"}:
        raise ValueError("TOP_LEVEL_SCHEMA")
    if x["schema"] != SCHEMA or not isinstance(x["run_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", x["run_id"]):
        raise ValueError("SCHEMA_OR_RUN_ID")
    source = x["source"]
    if not isinstance(source, dict) or set(source) != {"producer_commit", "privacy_class"}:
        raise ValueError("SOURCE_SCHEMA")
    if not re.fullmatch(r"[0-9a-f]{40}", str(source["producer_commit"])) or source["privacy_class"] != "PUBLIC_SYNTHETIC":
        raise ValueError("SOURCE_NOT_APPROVED_FOR_DEMO")
    w = x["input"]
    if not isinstance(w, dict) or set(w) != {"word", "xor_mask", "rotate_left", "addition", "expected_word", "max_operations"}:
        raise ValueError("INPUT_SCHEMA")
    for k in w: u32(w, k)
    if w["rotate_left"] > 31 or w["max_operations"] < 3 or w["max_operations"] > 1024:
        raise ValueError("OP_BOUNDS")
    a = x["anchor_mesh"]
    if not isinstance(a, dict) or set(a) != {"signatures", "counters_before", "counters_after"}:
        raise ValueError("ANCHOR_SCHEMA")
    for k in a:
        if not isinstance(a[k], list) or len(a[k]) != 4 or any(type(z) is not int or z < 0 or z >= 1 << 64 for z in a[k]):
            raise ValueError("ANCHOR_ARRAY:" + k)
    return x


def ntp_observation(host, timeout=1.0):
    """Unauthenticated NTP observation, NEVER timestamp attestation."""
    if not host or not re.fullmatch(r"[A-Za-z0-9.-]{1,200}", host):
        return {"status": "TOKEN_VAZIO_NTP"}
    packet = b"\x1b" + b"\0" * 47
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(timeout)
        t1 = time.time()
        sock.sendto(packet, (host, 123))
        data, addr = sock.recvfrom(512)
        t4 = time.time()
        if addr[0] != socket.gethostbyname(host) or len(data) < 48 or (data[0] & 7) not in (4, 5) or data[1] == 0:
            raise ValueError("NTP_INVALID_RESPONSE")
        def stamp(off):
            sec, fract = struct.unpack_from("!II", data, off)
            return sec - 2208988800 + fract / 4294967296.0
        t2, t3 = stamp(32), stamp(40)
        return {"status": "UNAUTHENTICATED_NTP", "server": host,
                "offset_ms": round(((t2-t1)+(t3-t4))*500, 3),
                "roundtrip_ms": round(((t4-t1)-(t3-t2))*1000, 3)}
    except (OSError, ValueError) as exc:
        return {"status": "TOKEN_VAZIO_NTP", "error_kind": exc.__class__.__name__}
    finally:
        sock.close()


def execute(x, raw_sha, ntp=None):
    w = x["input"]; a = x["anchor_mesh"]
    before = a["counters_before"]; after = a["counters_after"]; sig = a["signatures"]
    self_gates = [after[i] > before[i] and sig[i] != 0 for i in range(4)]
    peer_gates = [sig[i] != 0 and sig[i] == sig[(i+1)%4] for i in range(4)]
    gates = [{"organ": _ORGANS[i], "self": self_gates[i], "peer": peer_gates[i]} for i in range(4)]
    started = time.perf_counter_ns()
    events = []; parent = "GENESIS"
    def record(organ, before_word, after_word, op):
        nonlocal parent
        bit_edges = []
        for bit in range(32):
            if op == "INPUT":
                parents = []  # external source bit, not a transformation
            elif op == "ROL32":
                parents = [((bit - w["rotate_left"]) & 31)]
            elif op == "ADD_MOD_2_32":
                parents = list(range(bit + 1))  # potential carry cone, not proof all bits toggled
            else:
                parents = [bit]
            edge = {"bit":bit, "out":(after_word >> bit) & 1,
                    "source_bits_potential":parents,
                    "changed":((before_word ^ after_word) >> bit) & 1}
            if op == "ADD_MOD_2_32":
                edge["carry_in"] = ((before_word & ((1<<bit)-1)) + (w["addition"] & ((1<<bit)-1))) >> bit
            bit_edges.append(edge)
        item = {"seq":len(events), "organ":organ,"op":op,"word_before":before_word,
                "word_after":after_word,"xor_delta": before_word ^ after_word,
                "bit_edges":bit_edges, "parent_sha256":parent}
        item["record_sha256"] = sha(canonical(item))
        parent = item["record_sha256"]
        events.append(item)
    v = w["word"]
    record("PULSAR", 0, v, "INPUT")
    valid = all(self_gates) and all(peer_gates)
    if valid:
        prev=v;v ^= w["xor_mask"];record("SENTINEL",prev,v,"XOR")
        prev=v;r=w["rotate_left"];v=((v<<r)|(v>>(32-r))) & MASK if r else v
        record("MEMORY",prev,v,"ROL32")
        prev=v;v=(v+w["addition"]) & MASK;record("ACTION",prev,v,"ADD_MOD_2_32")
    matched = valid and v==w["expected_word"]
    elapsed = time.perf_counter_ns()-started
    payload={"schema":"rafaelia.frida.custody-receipt/v1", "run_id":x["run_id"],
             "source_plan_sha256":raw_sha,"source_commit_ref":x["source"]["producer_commit"],
             "phase":"RETURN_NOT_REMOTE_COMMIT", "local_approved":True,
             "anchor_mesh_gates":gates,"derived_fifth_local":bool(matched),
             "output_word":v if valid else None,"expected_match":bool(matched),
             "software_operation_count":3 if valid else 0,
             "elapsed_runner_ns":elapsed,"hardware_cycle_count":"TOKEN_VAZIO_NOT_MEASURED",
             "energy_joules":"TOKEN_VAZIO_NOT_MEASURED",
             "ntp":ntp or {"status":"TOKEN_VAZIO_NTP"},
             "drive_receipt_ref":"TOKEN_VAZIO_UNWRITTEN", "supabase_receipt_ref":"TOKEN_VAZIO_UNWRITTEN",
             "github_exact_head_runtime":"TOKEN_VAZIO", "claim_allowed":False,
             "events":events, "chain_tip_sha256":parent,
             "result":"PASS_SCOPED_LOCAL" if matched else "BLOCKED_VALIDATION"}
    payload["receipt_sha256"]=sha(canonical(payload))
    return payload


def write_exclusive(dest, payload):
    dest=Path(dest)
    if not dest.parent.is_dir(): raise ValueError("DEST_PARENT_NOT_DIRECTORY")
    # Exclusive creation protects previous receipts; never overwrite.
    with open(dest,"xb") as fp:
        fp.write(canonical(payload)+b"\n");fp.flush();os.fsync(fp.fileno())
    return dest


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("plan",help="local JSON file selected/exported by user")
    ap.add_argument("--approve-local",action="store_true",help="explicit approval for local synthetic run; never cloud commit")
    ap.add_argument("--receipt",help="new append-only local receipt pathname")
    ap.add_argument("--ntp-host",help="optional unauthenticated NTP diagnostic only")
    args=ap.parse_args(argv)
    raw=Path(args.plan).read_bytes()
    try:
        plan=parse_plan(raw)
        if not args.approve_local:
            raise ValueError("BLOCKED_PENDING_LOCAL_APPROVAL")
        t=ntp_observation(args.ntp_host) if args.ntp_host else None
        report=execute(plan,sha(raw),t)
        if args.receipt: write_exclusive(args.receipt,report)
        print(json.dumps({k:report[k] for k in ("run_id","result","receipt_sha256","chain_tip_sha256","elapsed_runner_ns")},sort_keys=True))
        return 0 if report["expected_match"] else 2
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"result":"BLOCKED","reason_type":str(exc),"claim_allowed":False}))
        return 2

if __name__=="__main__": raise SystemExit(main())
