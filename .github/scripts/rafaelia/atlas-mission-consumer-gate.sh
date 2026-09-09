#!/usr/bin/env bash
set -euo pipefail

# Repository-owned execution boundary for the ATLAS mission consumer contract.
# The Python validator remains the semantic implementation; this wrapper keeps
# GitHub Actions as orchestration rather than implementation authority.
python3 tools/validate_frida_atlas_mission_binding.py
