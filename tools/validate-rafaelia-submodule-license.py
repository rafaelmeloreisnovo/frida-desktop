#!/usr/bin/env python3
"""Validate first-level submodule identity/license-source evidence fail-closed.

This validator proves only the local superproject structure: .gitmodules URL/path
bindings, HEAD gitlink commits, and conservative registry semantics. It does not
fetch remote repositories during CI and therefore does not independently
re-prove remote license text. Compatibility and transitive reconciliation remain
explicitly false/TOKEN_VAZIO.
"""

from __future__ import annotations

import argparse
import configparser
import json
import subprocess
from pathlib import Path
from typing import Any

DEFAULT_REGISTRY = Path('profiles/rafaelia-submodule-license-scope.v1.json')
DEFAULT_OUTPUT = Path('evidence/provenance/submodule-license-inventory.v1.json')


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


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        die(f'missing registry: {path}')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        die('registry root must be an object')
    return value


def normalize_url(url: str) -> str:
    value = url.strip().rstrip('/')
    return value[:-4] if value.endswith('.git') else value


def parse_gitmodules(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        die('.gitmodules is missing')
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(path, encoding='utf-8')
    result: dict[str, dict[str, str]] = {}
    for section in parser.sections():
        if not section.startswith('submodule '):
            continue
        name = section[len('submodule '):].strip().strip('"')
        sub_path = parser.get(section, 'path', fallback='').strip()
        url = parser.get(section, 'url', fallback='').strip()
        if not sub_path or not url:
            die(f'incomplete .gitmodules entry: {name}')
        result[name] = {'name': name, 'path': sub_path, 'url': url}
    if not result:
        die('no first-level submodules found in .gitmodules')
    return result


def gitlink_for(path: str) -> str:
    row = git('ls-tree', 'HEAD', '--', path)
    if not row:
        die(f'missing gitlink in HEAD: {path}')
    meta, observed_path = row.split('\t', 1)
    mode, obj_type, sha = meta.split()
    if observed_path != path:
        die(f'gitlink path mismatch: expected={path} observed={observed_path}')
    if mode != '160000' or obj_type != 'commit':
        die(f'path is not a submodule gitlink: {path} mode={mode} type={obj_type}')
    return sha


def validate(registry_path: Path, output_path: Path) -> None:
    registry = load_json(registry_path)
    if registry.get('schema') != 'rafaelia.first-level-submodule-license-scope.v1':
        die('unexpected registry schema')
    if registry.get('claim_allowed') is not False:
        die('claim_allowed must remain false')
    if registry.get('license_compatibility_proven') is not False:
        die('license compatibility may not be promoted by this registry')
    if registry.get('single_license_flattening_allowed') is not False:
        die('single-license flattening must remain false')
    if 'TOKEN_VAZIO' not in str(registry.get('transitive_submodule_and_dependency_reconciliation', '')):
        die('transitive reconciliation must remain TOKEN_VAZIO')

    gitmodules = parse_gitmodules(Path('.gitmodules'))
    entries = registry.get('entries')
    if not isinstance(entries, list) or not entries:
        die('registry entries missing')

    registry_by_name: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            die('registry entry must be an object')
        name = str(entry.get('name', '')).strip()
        if not name or name in registry_by_name:
            die(f'duplicate or missing registry name: {name!r}')
        registry_by_name[name] = entry

    if set(registry_by_name) != set(gitmodules):
        missing = sorted(set(gitmodules) - set(registry_by_name))
        extra = sorted(set(registry_by_name) - set(gitmodules))
        die(f'registry/.gitmodules mismatch missing={missing} extra={extra}')

    observed_entries: list[dict[str, Any]] = []
    observed_license_sources = 0
    unresolved_license_sources = 0
    distinct_summaries: set[str] = set()

    for name in sorted(gitmodules):
        declared = gitmodules[name]
        registered = registry_by_name[name]
        path = str(registered.get('path', ''))
        url = str(registered.get('url', ''))
        if path != declared['path']:
            die(f'path drift for {name}: registry={path} gitmodules={declared["path"]}')
        if normalize_url(url) != normalize_url(declared['url']):
            die(f'URL drift for {name}: registry={url} gitmodules={declared["url"]}')

        gitlink = gitlink_for(path)
        if gitlink != str(registered.get('gitlink_commit', '')):
            die(f'gitlink drift for {name}: registry={registered.get("gitlink_commit")} HEAD={gitlink}')
        if registered.get('compatibility_proven') is not False:
            die(f'compatibility_proven must remain false for {name}')

        source_state = str(registered.get('license_source_state', ''))
        summary = registered.get('license_summary')
        source_path = registered.get('license_source_path')
        if source_state == 'OBSERVED_AT_PINNED_REVISION':
            if not source_path or not summary:
                die(f'observed license source incomplete for {name}')
            observed_license_sources += 1
            distinct_summaries.add(str(summary))
        elif 'TOKEN_VAZIO' in source_state:
            unresolved_license_sources += 1
            if summary is not None:
                die(f'unresolved license source must not invent summary for {name}')
        else:
            die(f'unrecognized license source state for {name}: {source_state}')

        observed_entries.append({
            'name': name,
            'path': path,
            'url': declared['url'],
            'gitlink_commit': gitlink,
            'gitlink_state': 'OBSERVED_FROM_HEAD',
            'license_source_path': source_path,
            'license_source_state': source_state,
            'license_summary': summary,
            'notice_complexity': registered.get('notice_complexity'),
            'compatibility_proven': False,
        })

    expected_count = len(gitmodules)
    if registry.get('first_level_submodule_count') != expected_count:
        die('first_level_submodule_count is stale')
    if registry.get('observed_license_source_count') != observed_license_sources:
        die('observed_license_source_count is stale')
    if registry.get('unresolved_license_source_count') != unresolved_license_sources:
        die('unresolved_license_source_count is stale')

    evidence = {
        'schema': 'rafaelia.first-level-submodule-license-evidence.v1',
        'head_commit': git('rev-parse', 'HEAD'),
        'scope': 'FIRST_LEVEL_GIT_SUBMODULES_ONLY',
        'first_level_submodule_count': expected_count,
        'observed_license_source_count': observed_license_sources,
        'unresolved_license_source_count': unresolved_license_sources,
        'all_gitlinks_match_registry': True,
        'all_gitmodule_urls_match_registry': True,
        'distinct_license_summary_count': len(distinct_summaries),
        'single_license_flattening_allowed': False,
        'license_compatibility_proven': False,
        'transitive_reconciliation': 'TOKEN_VAZIO_NOT_PROVEN',
        'claim_allowed': False,
        'entries': observed_entries,
        'interpretation_boundary': (
            'PASS proves the superproject first-level submodule topology and registry binding at this HEAD. '
            'Remote license-source observations are pinned declarations from prior review, not re-fetched in this gate. '
            'Nested submodules, vendored code, dependency trees, legal compatibility, and ownership remain outside this proof.'
        ),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(
        'PASS: first-level submodule license inventory; '
        f'count={expected_count} observed_license_sources={observed_license_sources} '
        f'unresolved={unresolved_license_sources} compatibility=false'
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--registry', type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    validate(args.registry, args.output)


if __name__ == '__main__':
    main()
