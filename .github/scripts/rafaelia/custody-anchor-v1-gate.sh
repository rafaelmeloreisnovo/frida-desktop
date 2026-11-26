#!/usr/bin/env bash
# Tiny synthetic custody audit inside existing fail-closed provenance pipeline.
# Never uses private inputs, credentials, cloud services or real TSA certificates.
set -Eeuo pipefail
export LC_ALL=C
umask 077
ROOT="$(cd "$(dirname "$0")/../../.." && pwd -P)"
cd "$ROOT"
command -v python3 >/dev/null || { echo 'BLOCKED: python3 unavailable' >&2; exit 2; }
command -v openssl >/dev/null || { echo 'BLOCKED: openssl unavailable' >&2; exit 2; }
test -f tools/rafaelia/custody_anchor_v1.py
test -f tools/rafaelia/test_custody_anchor_v1.py
python3 -m unittest discover -s tools/rafaelia -p 'test_custody_anchor_v1.py' -v

# The evidence directory is synthetic, run-local, and never overwritten.
EVIDENCE="$ROOT/evidence/custody-anchor-v1"
test ! -e "$EVIDENCE" || { echo "BLOCKED: previous custody receipt exists" >&2; exit 2; }
mkdir -p "$EVIDENCE"
HEAD="$(git rev-parse HEAD)"
PRODUCER_HEAD="$(printf '%s' "$RAFAELIA_PRODUCER_HEAD")"
[[ "$HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED: checkout SHA unavailable" >&2; exit 2; }
[[ "$PRODUCER_HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo "BLOCKED: event producer SHA unavailable" >&2; exit 2; }
printf '{"kind":"PUBLIC_SYNTHETIC","zero":0,"empty":""}\n' > "$EVIDENCE/input.json"
printf '{"kind":"PUBLIC_SYNTHETIC","op":"XOR32","output":319}\n' > "$EVIDENCE/output.json"
python3 tools/rafaelia/custody_anchor_v1.py build \
  --source-commit "$HEAD" --genesis \
  --item "INPUT_JSON=$EVIDENCE/input.json" \
  --item "OUTPUT_JSON=$EVIDENCE/output.json" \
  --out "$EVIDENCE/manifest.json"
python3 tools/rafaelia/custody_anchor_v1.py query \
  --manifest "$EVIDENCE/manifest.json" \
  --out "$EVIDENCE/request.tsq"
openssl ts -query -in "$EVIDENCE/request.tsq" -text > "$EVIDENCE/request-inspection.txt"
(
  cd "$EVIDENCE"
  sha256sum input.json output.json manifest.json request.tsq > SHA256SUMS.txt
)
EVIDENCE="$EVIDENCE" TESTED_CHECKOUT="$HEAD" PRODUCER_HEAD="$PRODUCER_HEAD" python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
p=Path(os.environ['EVIDENCE'])
sha=lambda b: hashlib.sha256(b).hexdigest()
m=json.loads((p/'manifest.json').read_bytes())
r={
  'schema':'rafaelia.frida.anchor-host-ci-receipt/v1',
  'tested_checkout_sha':os.environ['TESTED_CHECKOUT'],
  'producer_event_head_sha':os.environ['PRODUCER_HEAD'],
  'checkout_is_producer_head':os.environ['TESTED_CHECKOUT']==os.environ['PRODUCER_HEAD'],
  'run_event_binding':'PR_MERGE_COMMIT_DISTINCT_FROM_HEAD' if os.environ['TESTED_CHECKOUT']!=os.environ['PRODUCER_HEAD'] else 'DIRECT_HEAD',
  'manifest_sha256':sha((p/'manifest.json').read_bytes()),
  'rfc3161_request_sha256':sha((p/'request.tsq').read_bytes()),
  'merkle_root_sha256':m['merkle_root_sha256'],
  'parent_state':'SYNTHETIC_EXPLICIT_GENESIS',
  'untrusted_time_state':'TOKEN_VAZIO_EXTERNAL_TSA_NOT_CALLED',
  'tsa_signature':'TOKEN_VAZIO_NO_EXTERNAL_RESPONSE',
  'device_execution':'TOKEN_VAZIO_NOT_RUN',
  'remote_commit':'HOLD_NOT_COMMITTED',
  'claim_allowed':False,
  'status':'PASS_SCOPED_SYNTHETIC_HOST'
}
with (p/'receipt.json').open('x',encoding='utf-8') as f:
  f.write(json.dumps(r,sort_keys=True,separators=(',',':'))+'\n')
with (p/'receipt.sha256').open('x',encoding='utf-8') as f:
  f.write(sha((p/'receipt.json').read_bytes())+'  receipt.json\n')
print('PASS_SCOPED_SYNTHETIC_HOST',r['tested_checkout_sha'],r['merkle_root_sha256'])
PY
