# Rollback and Recovery

## Objective

Rollback restores a known state while preserving evidence of what happened. It is not permission to erase history.

## Default strategy: revert through the lifecycle

1. identify the exact known-good target SHA;
2. inventory commits and diff from target to current head;
3. open a dedicated `fix/rollback-*` or `hotfix/rollback-*` change into `00-intake`;
4. revert the affected commit(s) without force-pushing protected history;
5. run the same gates required for normal code;
6. promote through `01-integration` and `02-beta` as urgency and risk permit;
7. merge to `main` only with exact-head evidence;
8. perform post-merge/provider readback and preserve the rollback receipt.

## Automated rollback-plan mode

`Frida Lifecycle Governance` exposes `rollback-plan` with an exact 40-hex target SHA. It generates:

- current lane and SHA;
- target SHA;
- `git log` / `git diff --stat` preflight commands;
- selected recovery strategy;
- explicit `provider_write_executed=false`;
- `revert_commit_selection=TOKEN_VAZIO` until a human or bounded automation selects the exact commits.

The mode intentionally **does not execute a revert**.

## Emergency boundary

Force-push, branch deletion and history rewrite are outside normal recovery. They require a separately authorized provider operation and full before/after snapshot. The desired branch-protection policy blocks these operations.

## Rollback receipt

Minimum fields:

- incident/change identifier;
- lane;
- pre-rollback SHA;
- known-good target SHA;
- exact reverted commits;
- reason and impact;
- actor/automation identity;
- gate run IDs and conclusions;
- artifact/provenance checksums;
- provider readback;
- device readback if a physical runtime claim is relevant;
- unresolved `TOKEN_VAZIO` states.

## Failure handling

A failed rollback gate means the rollback is **not promoted**. Do not call a rollback successful merely because a revert commit exists. `ROLLBACK_PLAN != ROLLBACK_EXECUTED != ROLLBACK_VERIFIED`.

## Recovery drills

Periodically rehearse rollback on non-production lifecycle lanes using harmless changes. Record mean recovery time, manual steps, missing permissions and ambiguous documentation. Drill results are engineering evidence, not production incident proof.
