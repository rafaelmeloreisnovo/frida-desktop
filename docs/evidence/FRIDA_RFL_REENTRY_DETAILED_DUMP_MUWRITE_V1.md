# FRIDA RFL Re-entry + Detailed Dump V2 — μWRITE V1

μID=MU-FRIDA-RFL-REENTRY-DUMPV2-20260926-001
timestamp=2026-09-26T22:35:11-03:00
source/ref=GitHub:rafaelmeloreisnovo/frida-desktop#74
parent=PR#73 merge ce99890c50edd21d8d576562eacb73a4e6d49a9c
kind=BUG_ROOT_CAUSE+FAIL_CLOSED_REENTRY+OBSERVATION_BOUNDARY
Δsummary=rc=-5 resolved as ERR_STATE from process-global native runtime re-entry; Java Activity now reuses existing core only after exact ERR_STATE plus successful read-only verbose native snapshot; native initializer remains strict; Detailed Runtime Stability Dump V2 is explicitly OBSERVATION_ONLY and capture remains TOKEN_VAZIO until executed
routes=L/P/C/R/I/E/A; T=Activity->JNI->RFL + FridaDumpV2->compare/delta; O=TOKEN_VAZIO
evidence=source readback: learning_store.h maps ERR_STATE=-5; learning_runtime.c returns ERR_STATE when g_runtime.initialized; MainActivity prior path mapped all nonzero init RCs to learningInitialized=false; successor source and static verifier contract materialized in PR#74
gap=EXACT_HEAD_CI_PENDING; PHYSICAL_ARMV7_RERUN=TOKEN_VAZIO; DETAILED_DUMP_V2_CAPTURE=TOKEN_VAZIO; DEVICE_RECEIPT_SUCCESSOR=TOKEN_VAZIO
next=exact-head CI -> authorized ARMv7 Activity re-entry receipt -> passive V2 detailed dump capture -> bind SHA/ledger -> compare successor
claim_allowed=false
rollback=close/revert PR#74; main remains PR#73 state until authorized integration

PV=SOURCE != ARTEFACT != EXECUTION != EVIDENCE != CLAIM
