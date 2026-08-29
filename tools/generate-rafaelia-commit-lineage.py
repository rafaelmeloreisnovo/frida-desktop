#!/usr/bin/env python3
"""Generate conservative commit-lineage evidence for the RAFAELIA Frida fork.

Commit metadata is evidence about repository history, not proof of hunk authorship,
copyright ownership, originality, or license entitlement. The output therefore
keeps ownership and hunk-origin claims fail-closed while shrinking the unknown
space between a path-level delta and a future hunk-level review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

DEFAULT_MANIFEST = Path('profiles/rafaelia-provenance-scope.v1.json')
DEFAULT_DELTA = Path('evidence/provenance/delta-inventory.v1.json')
DEFAULT_OUTPUT = Path('evidence/provenance/commit-lineage.v1.json')


def die(message: str) -> None:
    raise SystemExit(f'FAIL: {message}')


def git(*args: str) -> str:
    try:
        result = subprocess.run(
            ['git', *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or 'git command failed'
        die(f"git {' '.join(args)}: {detail}")
    return result.stdout.rstrip('\n')


def author_signal(name: str, email: str) -> str:
    identity = f'{name} {email}'.lower()
    if 'claude' in identity or 'anthropic' in identity:
        return 'AI_NAMED_COMMIT_AUTHOR_OBSERVED'
    if 'rafaelmeloreisnovo' in identity or name.strip().lower() in {'rafael mreis', 'rafaelmeloreisnovo'}:
        return 'PROJECT_IDENTITY_COMMIT_AUTHOR_OBSERVED'
    return 'OTHER_OR_UNKNOWN_COMMIT_AUTHOR_OBSERVED'


def body_flags(body: str) -> dict[str, bool]:
    ai = bool(re.search(r'(?im)^co-authored-by:\s*.*(?:claude|anthropic)', body))
    project = bool(re.search(r'(?im)^co-authored-by:\s*.*rafael', body))
    return {
        'declared_ai_coauthor_trailer': ai,
        'declared_project_coauthor_trailer': project,
    }


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        die(f'missing input: {path}')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        die(f'expected object: {path}')
    return value


def path_commits(base: str, head: str, path: str, limit: int, body_cache: dict[str, dict[str, bool]]) -> list[dict[str, Any]]:
    raw = git(
        'log',
        f'--max-count={limit}',
        '--date=iso-strict',
        '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s',
        f'{base}..{head}',
        '--',
        path,
    )
    if not raw:
        return []

    records: list[dict[str, Any]] = []
    for line in raw.splitlines():
        parts = line.split('\x1f')
        if len(parts) != 6:
            die(f'malformed git log record for {path}')
        sha, parents, name, email, authored_at, subject = parts
        if sha not in body_cache:
            body_cache[sha] = body_flags(git('show', '-s', '--format=%B', sha))
        flags = body_cache[sha]
        parent_list = [value for value in parents.split() if value]
        records.append({
            'commit': sha,
            'parents': parent_list,
            'merge_commit': len(parent_list) > 1,
            'author_name': name,
            'author_email': email,
            'authored_at': authored_at,
            'subject': subject,
            'author_signal': author_signal(name, email),
            **flags,
            'hunk_authorship_proven': False,
            'copyright_ownership_proven': False,
        })
    return records


def generate(manifest_path: Path, delta_path: Path, output_path: Path, limit: int) -> None:
    manifest = load_json(manifest_path)
    delta = load_json(delta_path)

    if manifest.get('claim_allowed') is not False:
        die('manifest claim_allowed must remain false')
    if delta.get('ownership_claimed') is not False:
        die('delta inventory ownership_claimed must remain false')

    baseline = manifest.get('baseline') or {}
    base = str(baseline.get('commit', ''))
    head = git('rev-parse', 'HEAD')
    if base != str(delta.get('baseline_commit', '')):
        die('manifest and delta baseline differ')
    if head != str(delta.get('head_commit', '')):
        die('delta inventory is stale relative to HEAD')

    entries = delta.get('entries')
    if not isinstance(entries, list) or not entries:
        die('delta inventory entries missing')

    body_cache: dict[str, dict[str, bool]] = {}
    signal_counts: Counter[str] = Counter()
    unique_commits: set[str] = set()
    paths: list[dict[str, Any]] = []

    for delta_entry in entries:
        path = str(delta_entry.get('path', ''))
        if not path:
            die('delta entry missing path')
        commits = path_commits(base, head, path, limit, body_cache)
        for commit in commits:
            unique_commits.add(commit['commit'])
            signal_counts[commit['author_signal']] += 1
            if commit['declared_ai_coauthor_trailer']:
                signal_counts['DECLARED_AI_COAUTHOR_TRAILER'] += 1
            if commit['merge_commit']:
                signal_counts['MERGE_COMMIT'] += 1

        paths.append({
            'path': path,
            'git_status': delta_entry.get('git_status'),
            'path_relation': delta_entry.get('path_relation'),
            'lineage_state': 'OBSERVED_PATH_TOUCH_HISTORY_NOT_HUNK_AUTHORSHIP',
            'touch_commits': commits,
            'touch_commit_count_in_evidence_window': len(commits),
            'authorship_claimed': False,
            'hunk_origin_state': 'TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW',
        })

    output = {
        'schema': 'rafaelia.commit-lineage-evidence.v1',
        'repository': manifest.get('repository'),
        'baseline_repository': baseline.get('repository'),
        'baseline_commit': base,
        'head_commit': head,
        'max_commits_per_path': limit,
        'path_count': len(paths),
        'unique_touch_commits_observed': len(unique_commits),
        'signal_counts': dict(sorted(signal_counts.items())),
        'paths': paths,
        'hunk_origin_state': 'TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW',
        'ownership_claimed': False,
        'copyright_ownership_proven': False,
        'claim_allowed': False,
        'interpretation_boundary': (
            'Git commit author/co-author metadata proves only observed repository history. '
            'It does not prove line-level origin, originality, copyright ownership, exclusive authorship, '
            'or license entitlement. Hunk review remains required before any ownership promotion.'
        ),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(
        'PASS: commit lineage generated; '
        f"paths={len(paths)} unique_touch_commits={len(unique_commits)} hunk_origin=TOKEN_VAZIO"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument('--delta', type=Path, default=DEFAULT_DELTA)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--max-commits-per-path', type=int, default=12)
    args = parser.parse_args()
    if args.max_commits_per_path < 1 or args.max_commits_per_path > 100:
        die('max commits per path must be between 1 and 100')
    generate(args.manifest, args.delta, args.output, args.max_commits_per_path)


if __name__ == '__main__':
    main()
