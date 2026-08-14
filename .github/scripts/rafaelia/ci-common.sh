#!/usr/bin/env bash
# Shared helpers for RAFAELIA-specific CI scripts.
# Keep workflows declarative; keep executable behavior here so the same gates
# can be run locally or by GitHub Actions.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

rafaelia_die() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

rafaelia_notice() {
  printf '::notice::%s\n' "$*"
}

rafaelia_group_begin() {
  printf '::group::%s\n' "$*"
}

rafaelia_group_end() {
  printf '::endgroup::\n'
}

rafaelia_need_cmd() {
  command -v "$1" >/dev/null 2>&1 || rafaelia_die "required command not found: $1"
}

rafaelia_need_file() {
  [[ -f "$1" ]] || rafaelia_die "required file not found: $1"
}

rafaelia_need_dir() {
  [[ -d "$1" ]] || rafaelia_die "required directory not found: $1"
}

rafaelia_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

rafaelia_write_sha256_manifest() {
  local output="$1"
  shift
  : > "$output"
  local path
  for path in "$@"; do
    rafaelia_need_file "$path"
    sha256sum "$path" >> "$output"
  done
}

rafaelia_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

rafaelia_assert_clean_value() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || rafaelia_die "required environment variable is empty: $name"
  [[ "$value" != *$'\n'* ]] || rafaelia_die "environment variable contains newline: $name"
}
