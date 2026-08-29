#!/usr/bin/env python3
"""Collect direct Node dependency version/license observations without overclaiming.

This inspects only package metadata installed by the current CI run. It does not
prove transitive license compatibility, legal sufficiency, supply-chain identity,
or reproducibility when a repository lockfile is absent.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def die(message: str) -> None:
    raise SystemExit(f'FAIL: {message}')


def license_value(value: Any) -> str | list[str] | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        candidate = value.get('type') or value.get('name')
        return str(candidate) if candidate else None
    if isinstance(value, list):
        values: list[str] = []
        for item in value:
            normalized = license_value(item)
            if isinstance(normalized, str):
                values.append(normalized)
            elif isinstance(normalized, list):
                values.extend(normalized)
        return values or None
    return None


def collect(module: Path, output: Path) -> None:
    package_path = module / 'package.json'
    if not package_path.is_file():
        die(f'missing package.json: {package_path}')

    package = json.loads(package_path.read_text(encoding='utf-8'))
    declared: dict[str, str] = {}
    for section in ('dependencies', 'devDependencies', 'optionalDependencies'):
        values = package.get(section, {})
        if isinstance(values, dict):
            for name, version_range in values.items():
                declared[name] = str(version_range)

    entries: list[dict[str, Any]] = []
    unresolved = 0
    for name in sorted(declared):
        installed = module / 'node_modules' / name / 'package.json'
        if not installed.is_file():
            unresolved += 1
            entries.append({
                'name': name,
                'declared_range': declared[name],
                'state': 'TOKEN_VAZIO_INSTALLED_PACKAGE_METADATA_MISSING',
                'installed_version': None,
                'license': None,
            })
            continue

        metadata = json.loads(installed.read_text(encoding='utf-8'))
        observed_license = license_value(metadata.get('license', metadata.get('licenses')))
        state = 'OBSERVED_INSTALLED_PACKAGE_METADATA'
        if observed_license is None:
            state = 'TOKEN_VAZIO_LICENSE_FIELD_MISSING'
            unresolved += 1

        entries.append({
            'name': name,
            'declared_range': declared[name],
            'state': state,
            'installed_version': metadata.get('version'),
            'license': observed_license,
            'package_name_matches': metadata.get('name') == name,
        })

    lockfile = module / 'package-lock.json'
    evidence = {
        'schema': 'rafaelia.node-direct-dependency-evidence.v1',
        'module': str(module),
        'package_name': package.get('name'),
        'scope': 'DIRECT_DECLARED_DEPENDENCIES_ONLY',
        'dependency_lock_state': 'PRESENT' if lockfile.is_file() else 'TOKEN_VAZIO_NO_REPOSITORY_LOCKFILE',
        'direct_dependency_count': len(entries),
        'unresolved_direct_dependency_count': unresolved,
        'direct_dependency_metadata_state': 'OBSERVED' if unresolved == 0 else 'PARTIAL_TOKEN_VAZIO',
        'transitive_dependency_license_reconciliation': 'TOKEN_VAZIO_NOT_PROVEN_BY_THIS_EVIDENCE',
        'supply_chain_identity_verified': False,
        'license_compatibility_proven': False,
        'claim_allowed': False,
        'entries': entries,
        'interpretation_boundary': (
            'Observed installed package.json metadata is useful provenance evidence but is not a legal opinion, '
            'does not prove transitive license compatibility, and does not replace a committed lockfile.'
        ),
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(
        'PASS: direct dependency evidence collected; '
        f"count={len(entries)} unresolved={unresolved} lock={evidence['dependency_lock_state']}"
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--module', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    collect(args.module.resolve(), args.output.resolve())
