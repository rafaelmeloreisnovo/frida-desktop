# Runtime-Aided Debugger — TOKEN_VAZIO Ledger

Status: `HARDENING_ACTIVE / claim_allowed=false`

This ledger distinguishes implementation gaps from evidence gaps. A TOKEN_VAZIO is not silently closed: it moves to CLOSED only when code, test, or target receipt exists.

## 30 tracked gaps

| ID | Gap | Class | Priority | State |
|---|---|---|---|---|
| TV-01 | IPC read/write semantics were collapsed | implementation | P0 | CLOSED in hardening branch |
| TV-02 | GC begin/end/pressure were collapsed | implementation | P0 | CLOSED in hardening branch |
| TV-03 | Web enter/exit were collapsed | implementation | P0 | CLOSED in hardening branch |
| TV-04 | peer_tag incorrectly reused stream_tag | implementation/privacy | P0 | CLOSED in hardening branch |
| TV-05 | negative descriptors accepted for I/O | validation | P0 | CLOSED in hardening branch |
| TV-06 | zero monotonic timestamp accepted | validation | P1 | CLOSED in hardening branch |
| TV-07 | adapter error values lacked named ABI constants | maintainability | P1 | CLOSED in hardening branch |
| TV-08 | pressure Q16 saturation lacked regression assertion | test | P1 | CLOSED in hardening branch |
| TV-09 | IPC boundary flag lacked regression assertion | test | P1 | CLOSED in hardening branch |
| TV-10 | unsupported operation fail-closed path lacked named contract | test/API | P1 | CLOSED in hardening branch |
| TV-11 | latency microsecond-to-nanosecond saturation edge test | test | P1 | TOKEN_VAZIO |
| TV-12 | all normalized operation variants exhaustively tested | test | P1 | TOKEN_VAZIO |
| TV-13 | status flag allow-mask / reserved-bit policy | implementation | P1 | TOKEN_VAZIO |
| TV-14 | PID/TID zero-value policy | contract | P2 | TOKEN_VAZIO |
| TV-15 | stream_tag zero-value policy | contract | P2 | TOKEN_VAZIO |
| TV-16 | peer_tag derivation API/keyed-digest boundary | privacy | P0 | TOKEN_VAZIO |
| TV-17 | recorder allowed_event_mask compatibility gate | integration | P0 | TOKEN_VAZIO |
| TV-18 | adapter -> frida_rs_observe integration self-test | integration | P0 | TOKEN_VAZIO |
| TV-19 | recorder -> frida_dca_signal integration self-test | integration | P0 | TOKEN_VAZIO |
| TV-20 | DCA FAILSAFE induced-instability test | integration | P0 | TOKEN_VAZIO |
| TV-21 | DCA FAILOVER induced-instability test | integration | P0 | TOKEN_VAZIO |
| TV-22 | DCA ROLLBACK deterministic token test | integration | P0 | TOKEN_VAZIO |
| TV-23 | hosted clean C11 build receipt on current head | evidence | P0 | TOKEN_VAZIO |
| TV-24 | freestanding object build receipt on current head | evidence | P0 | TOKEN_VAZIO |
| TV-25 | sanitizer execution receipt where supported | evidence | P1 | TOKEN_VAZIO |
| TV-26 | ARM32 cross-build receipt | evidence | P0 | TOKEN_VAZIO |
| TV-27 | ARM64 cross-build receipt | evidence | P1 | TOKEN_VAZIO |
| TV-28 | authorized Android Frida attachment adapter | target runtime | P0 | TOKEN_VAZIO |
| TV-29 | physical Android ARM32 runtime receipt | target runtime | P0 | TOKEN_VAZIO |
| TV-30 | overhead/stability measurement with bounded benchmark | performance evidence | P1 | TOKEN_VAZIO |

## Claim gate

Structural closures TV-01..TV-10 do not prove target execution. Until TV-23/24/26/28/29 have receipts, target-runtime claims remain forbidden.

`claim_allowed=false`
