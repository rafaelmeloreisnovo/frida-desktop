#!/usr/bin/env python3
"""Load GitHub repository metadata into ChipQuantum sensor frames.

The script uses only the public GitHub REST API and Python's standard library.
It reports the requested ChipQuantum repository/expansions path when available
and always emits sensor frames for the owner's most recently created public
repositories so benchmarking can proceed without vendoring external code.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

FNV1A_OFFSET = 14695981039346656037
FNV1A_PRIME = 1099511628211
CRC32_POLY = 0xEDB88320
ATTRACTOR_STATES = 42
Q16_ONE = 65535


@dataclass(frozen=True)
class GitHubTarget:
    owner: str
    repo: str
    path: str


def parse_github_url(url: str) -> GitHubTarget:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.netloc != "github.com" or len(parts) < 2:
        raise ValueError(f"expected a github.com/OWNER/REPO URL, got {url!r}")

    owner = parts[0]
    repo = parts[1]
    path_parts = parts[2:]
    if path_parts[:2] == ["tree", "main"] or path_parts[:2] == ["tree", "master"]:
        path_parts = path_parts[2:]
    return GitHubTarget(owner=owner, repo=repo, path="/".join(path_parts))


def github_request(url: str, token: str | None) -> tuple[int, Any]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "frida-desktop-chipquantum-sensors",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else None
    except HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            payload: Any = json.loads(body)
        except json.JSONDecodeError:
            payload = {"message": body}
        return error.code, payload
    except URLError as error:
        return 0, {"message": str(error)}


def fnv1a64(data: bytes) -> int:
    value = FNV1A_OFFSET
    for byte in data:
        value ^= byte
        value = (value * FNV1A_PRIME) & 0xFFFFFFFFFFFFFFFF
    return value


def crc32_basic(data: bytes) -> int:
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            mask = -(crc & 1) & 0xFFFFFFFF
            crc = ((crc >> 1) ^ (CRC32_POLY & mask)) & 0xFFFFFFFF
    return (~crc) & 0xFFFFFFFF


def xor_accumulate(data: bytes) -> int:
    acc = 0
    for byte in data:
        acc ^= byte
    return acc


def entropy_milli(data: bytes) -> int:
    if not data:
        return 0
    unique = len(set(data))
    transitions = sum(1 for left, right in zip(data, data[1:]) if left != right)
    return (unique * 6000) // 256 + ((transitions * 2000) // (len(data) - 1) if len(data) > 1 else 0)


def fold16_from64(value: int) -> int:
    value ^= value >> 32
    value ^= value >> 16
    return value & 0xFFFF


def coherence_step_q16(current_q16: int, input_q16: int) -> int:
    return ((current_q16 * 3) + input_q16) // 4


def phi_q16(coherence_q16: int, entropy_q16: int) -> int:
    return ((Q16_ONE - entropy_q16) * coherence_q16) // Q16_ONE


def toroidal_map(payload: bytes, state: int) -> dict[str, Any]:
    hash_value = fnv1a64(payload)
    crc = crc32_basic(payload)
    entropy = entropy_milli(payload)
    orbit = (hash_value ^ (entropy << 32) ^ state) % ATTRACTOR_STATES
    entropy_q16 = (entropy * Q16_ONE) // 8000
    coherence_q16 = coherence_step_q16(fold16_from64(hash_value), crc & 0xFFFF)
    phi = phi_q16(coherence_q16, entropy_q16)
    lanes = [
        fold16_from64(hash_value),
        crc & 0xFFFF,
        ((crc >> 16) ^ (xor_accumulate(payload) << 8)) & 0xFFFF,
        entropy_q16,
        coherence_q16,
        phi,
        (((orbit * Q16_ONE) // ATTRACTOR_STATES) ^ (state & 0xFFFF)) & 0xFFFF,
    ]
    return {
        "payload_bytes": len(payload),
        "entropy_milli": entropy,
        "hash_fnv1a64": hash_value,
        "crc32": crc,
        "xor": xor_accumulate(payload),
        "orbit42": orbit,
        "torus7_q16": lanes,
    }


def repo_payload(repo: dict[str, Any]) -> bytes:
    fields = {
        "full_name": repo.get("full_name"),
        "description": repo.get("description"),
        "language": repo.get("language"),
        "created_at": repo.get("created_at"),
        "updated_at": repo.get("updated_at"),
        "pushed_at": repo.get("pushed_at"),
        "stargazers_count": repo.get("stargazers_count"),
        "forks_count": repo.get("forks_count"),
        "open_issues_count": repo.get("open_issues_count"),
        "size": repo.get("size"),
        "html_url": repo.get("html_url"),
    }
    return json.dumps(fields, sort_keys=True, separators=(",", ":")).encode("utf-8")


def repo_sensor(repo: dict[str, Any], index: int) -> dict[str, Any]:
    payload = repo_payload(repo)
    state = ((int(repo.get("id") or 0) & 0xFFFFFFFF) ^ ((index + 1) * 0x9E3779B9)) & 0xFFFFFFFF
    mapped = toroidal_map(payload, state)
    return {
        "index": index,
        "full_name": repo.get("full_name"),
        "html_url": repo.get("html_url"),
        "created_at": repo.get("created_at"),
        "pushed_at": repo.get("pushed_at"),
        "language": repo.get("language"),
        "state": state,
        "metrics": {
            "stars": repo.get("stargazers_count"),
            "forks": repo.get("forks_count"),
            "open_issues": repo.get("open_issues_count"),
            "size": repo.get("size"),
        },
        "chipquantum": mapped,
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    token = os.environ.get("GITHUB_TOKEN")
    target = parse_github_url(args.target_url)
    repo_api = f"https://api.github.com/repos/{target.owner}/{target.repo}"
    status, repo_payload_value = github_request(repo_api, token)

    expansions_status = None
    expansions_payload = None
    if target.path:
        expansions_api = f"{repo_api}/contents/{target.path}"
        expansions_status, expansions_payload = github_request(expansions_api, token)

    owner_api = f"https://api.github.com/users/{args.owner}/repos?sort=created&direction=desc&per_page={args.limit}"
    owner_status, owner_payload = github_request(owner_api, token)
    repos = owner_payload if owner_status == 200 and isinstance(owner_payload, list) else []

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target": {
            "url": args.target_url,
            "owner": target.owner,
            "repo": target.repo,
            "path": target.path,
            "repo_status": status,
            "repo_message": repo_payload_value.get("message") if isinstance(repo_payload_value, dict) else None,
            "path_status": expansions_status,
            "path_message": expansions_payload.get("message") if isinstance(expansions_payload, dict) else None,
        },
        "recent_owner_repositories": {
            "owner": args.owner,
            "status": owner_status,
            "limit": args.limit,
            "count": len(repos),
            "sensors": [repo_sensor(repo, index) for index, repo in enumerate(repos)],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target-url",
        default="https://github.com/rafaelmeloreisnovo/ChipQuantum/expansions",
        help="GitHub URL to verify before loading fallback/recent repository sensors.",
    )
    parser.add_argument("--owner", default="rafaelmeloreisnovo", help="GitHub owner whose newest public repos become sensors.")
    parser.add_argument("--limit", type=int, default=6, help="Number of recently created public repositories to load.")
    parser.add_argument("--output", help="Optional JSON output path.")
    args = parser.parse_args()

    if args.limit < 1 or args.limit > 100:
        parser.error("--limit must be between 1 and 100")

    report = build_report(args)
    text = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as output:
            output.write(text)
            output.write("\n")
    print(text)
    return 0 if report["recent_owner_repositories"]["status"] == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
