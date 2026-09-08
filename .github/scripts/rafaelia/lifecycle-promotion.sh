#!/usr/bin/env bash
set -euo pipefail

from_lane="${1:?from lane required}"
to_lane="${2:?to lane required}"
expected_sha="${3:?expected SHA required}"

case "${from_lane}:${to_lane}" in
  00-intake:01-integration|01-integration:02-beta|02-beta:main) ;;
  *)
    echo "FAIL: forbidden lifecycle transition ${from_lane} -> ${to_lane}" >&2
    exit 2
    ;;
esac

if [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FAIL: expected SHA must be lowercase 40-hex" >&2
  exit 2
fi

git fetch --no-tags origin \
  "+refs/heads/${from_lane}:refs/remotes/origin/${from_lane}" \
  "+refs/heads/${to_lane}:refs/remotes/origin/${to_lane}"

actual_sha="$(git rev-parse "refs/remotes/origin/${from_lane}")"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "FAIL: ${from_lane} drifted: expected ${expected_sha}, observed ${actual_sha}" >&2
  exit 3
fi

if git merge-base --is-ancestor "refs/remotes/origin/${from_lane}" "refs/remotes/origin/${to_lane}"; then
  echo "NOOP: ${to_lane} already contains ${from_lane} at ${actual_sha}"
  exit 0
fi

existing="$(
  gh pr list \
    --state open \
    --head "$from_lane" \
    --base "$to_lane" \
    --json number \
    --jq '.[0].number // empty'
)"
if [[ -n "$existing" ]]; then
  echo "NOOP: promotion PR already open: #${existing}"
  exit 0
fi

mkdir -p evidence/lifecycle
body="evidence/lifecycle/promotion-pr.md"
cat > "$body" <<EOF
## Lifecycle promotion

\`${from_lane}\` → \`${to_lane}\`

Expected source SHA: \`${expected_sha}\`

### Required evidence

- Lifecycle Governance: PASS for this exact head
- Workflow Architecture Contract: PASS
- RAFAELIA Provenance Non-Regression Gate: PASS
- Subsystem-specific gates: PASS when applicable
- Provider protection/readback: must not be inferred from CI

### Boundaries

- automatic merge: **disabled**
- production publish: **not requested**
- physical-device evidence: **not inferred**
- \`TOKEN_VAZIO != PASS\`
- rollback: revert PR through the same lifecycle

This PR was opened by the bounded lifecycle promotion automation. It does not grant merge or release authority.
EOF

gh pr create \
  --base "$to_lane" \
  --head "$from_lane" \
  --title "promote(lifecycle): ${from_lane} -> ${to_lane}" \
  --body-file "$body"

echo "PROMOTION_PR=OPENED"
