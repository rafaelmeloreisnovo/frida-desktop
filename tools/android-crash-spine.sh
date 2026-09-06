#!/bin/sh
set -eu

OUT_ROOT="${FRIDA_CRASH_OUT:-./crash-evidence}"
MODE="live"
STACKS=0

usage() {
  printf '%s\n' \
    'usage: android-crash-spine.sh [--out DIR] [--snapshot] [--stacks]' \
    '  --snapshot  dump current matching buffers and exit' \
    '  --stacks    opt in to crash-buffer stacks; default is events metadata only'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      OUT_ROOT=$2
      shift 2
      ;;
    --snapshot)
      MODE="snapshot"
      shift
      ;;
    --stacks)
      STACKS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

command -v adb >/dev/null 2>&1 || {
  printf '%s\n' 'TOKEN_VAZIO[ADB]: adb executable not found' >&2
  exit 3
}

adb get-state >/dev/null 2>&1 || {
  printf '%s\n' 'TOKEN_VAZIO[DEVICE]: no authorized adb device' >&2
  exit 4
}

STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
SESSION="$OUT_ROOT/$STAMP"
umask 077
mkdir -p "$SESSION"

{
  printf 'schema=1\n'
  printf 'created_utc=%s\n' "$STAMP"
  printf 'mode=%s\n' "$MODE"
  printf 'stacks=%s\n' "$STACKS"
  printf 'privacy=metadata-only-by-default\n'
  printf 'claim_allowed=false\n'
  printf 'device_runtime=OBSERVING_NOT_PROVEN_UNTIL_RECEIPT\n'
} > "$SESSION/contract.txt"

adb shell getprop ro.build.version.sdk > "$SESSION/android-sdk.txt" 2>&1 || \
  printf '%s\n' 'TOKEN_VAZIO[SDK]' > "$SESSION/android-sdk.txt"
adb shell getprop ro.product.cpu.abilist > "$SESSION/abi-list.txt" 2>&1 || \
  printf '%s\n' 'TOKEN_VAZIO[ABI]' > "$SESSION/abi-list.txt"
adb shell settings get secure default_input_method > "$SESSION/default-ime.txt" 2>&1 || \
  printf '%s\n' 'TOKEN_VAZIO[DEFAULT_IME]' > "$SESSION/default-ime.txt"

# Discovery only. No keyboard content, UI text, clipboard, network payload,
# credentials, URLs or application databases are read.
adb shell pm list packages 2>/dev/null | \
  sed 's/^package://' | \
  grep -Ei '(openai|chatgpt|chrome|chromium|webview)' \
  > "$SESSION/discovered-browser-chat-targets.txt" || :

printf '%s\n' \
  'SYSTEM_SERVER_INTERNAL=TOKEN_VAZIO[PRIVILEGE_DEPENDENT]' \
  'KERNEL_PSTORE=TOKEN_VAZIO[PRIVILEGE_DEPENDENT]' \
  'TOMBSTONE_FILES=TOKEN_VAZIO[PRIVILEGE_DEPENDENT]' \
  'CROSS_PROCESS_INTERNAL_STACK=TOKEN_VAZIO[REQUIRES_AUTHORIZED_ATTACH_OR_STACK_MODE]' \
  > "$SESSION/token-vazio.txt"

LOG_ARGS="-v epoch -b events am_crash:I am_anr:I am_kill:I am_proc_died:I am_low_memory:I *:S"
if [ "$STACKS" -eq 1 ]; then
  LOG_ARGS="-v epoch -b events -b crash am_crash:I am_anr:I am_kill:I am_proc_died:I am_low_memory:I AndroidRuntime:E DEBUG:I libc:F *:S"
fi

printf 'session=%s\n' "$SESSION"
printf '%s\n' 'scope=crash/anr/process-death only; Ctrl-C stops live capture'

if [ "$MODE" = "snapshot" ]; then
  # shellcheck disable=SC2086
  adb logcat -d $LOG_ARGS > "$SESSION/crash-events.log" 2>&1 || {
    printf '%s\n' 'TOKEN_VAZIO[LOGCAT_READ]' >> "$SESSION/token-vazio.txt"
    exit 5
  }
else
  # shellcheck disable=SC2086
  adb logcat $LOG_ARGS >> "$SESSION/crash-events.log" 2>&1
fi
