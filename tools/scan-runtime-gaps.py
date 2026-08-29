#!/usr/bin/env python3
"""Static gap inventory for the Runtime Learning Engine.

The scanner has two classes of findings:
- BLOCKING: executable tests whose bodies contain no executable statement;
- DECLARED_GAP: textual markers such as TODO/FIXME/placeholder/not implemented.

Declared gaps are evidence, not automatic failures. They remain visible for
follow-up instead of being silently equated with complete implementation.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

MARKERS = {
    'TODO': re.compile(r'\bTODO\b', re.IGNORECASE),
    'FIXME': re.compile(r'\bFIXME\b', re.IGNORECASE),
    'PLACEHOLDER': re.compile(r'\bplaceholder\b', re.IGNORECASE),
    'NOT_IMPLEMENTED': re.compile(r'\bnot\s+implemented\b', re.IGNORECASE),
    'PSEUDO': re.compile(r'\bpseudo(?:code)?\b', re.IGNORECASE),
    'SIMULATION': re.compile(r'\bsimulat(?:e|ed|ion|ing)\b', re.IGNORECASE),
}

# Conservative pattern intentionally targets only a complete test()/it() call
# whose arrow-function body contains whitespace/comments and no statements.
NOOP_TEST = re.compile(
    r'''(?P<kind>test|it)\s*\(\s*(?P<quote>['\"])(?P<name>.*?)(?P=quote)\s*,\s*'''
    r'''(?:async\s*)?\([^)]*\)\s*=>\s*\{'''
    r'''(?P<body>(?:\s|//[^\n]*(?:\n|$)|/\*.*?\*/)*)'''
    r'''\}\s*(?:,\s*\d+\s*)?\)''',
    re.DOTALL,
)


def line_number(text: str, offset: int) -> int:
    return text.count('\n', 0, offset) + 1


def scan(root: Path) -> dict:
    files = sorted(
        p for p in root.rglob('*')
        if p.is_file() and p.suffix in {'.ts', '.tsx', '.js', '.jsx', '.json', '.md'}
        and 'node_modules' not in p.parts and 'dist' not in p.parts
    )

    marker_findings = []
    blocking_findings = []

    for path in files:
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue

        relative = str(path.relative_to(root))
        for marker, pattern in MARKERS.items():
            for match in pattern.finditer(text):
                marker_findings.append({
                    'class': 'DECLARED_GAP',
                    'marker': marker,
                    'path': relative,
                    'line': line_number(text, match.start()),
                })

        if '/tests/' in f'/{relative}' or relative.startswith('tests/') or relative.endswith('.test.ts'):
            for match in NOOP_TEST.finditer(text):
                blocking_findings.append({
                    'class': 'BLOCKING_ZOMBIE_TEST',
                    'path': relative,
                    'line': line_number(text, match.start()),
                    'test_name': match.group('name'),
                })

    counts = {}
    for finding in marker_findings:
        counts[finding['marker']] = counts.get(finding['marker'], 0) + 1

    return {
        'schema': 'rafaelia.runtime-static-gap-inventory.v1',
        'root': str(root),
        'scanned_file_count': len(files),
        'blocking_zombie_test_count': len(blocking_findings),
        'declared_gap_marker_count': len(marker_findings),
        'marker_counts': dict(sorted(counts.items())),
        'blocking_findings': blocking_findings,
        'declared_gap_findings': marker_findings,
        'zombie_test_gate': 'PASS' if not blocking_findings else 'FAIL',
        'declared_gap_state': 'OBSERVED_INVENTORIED' if marker_findings else 'NONE_OBSERVED',
        'claim_allowed': False,
        'boundary': (
            'Text markers are an inventory signal, not proof that a behavior is missing. '
            'Comment-only executable tests are blocking because they create false positive coverage.'
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f'FAIL: root is not a directory: {root}')

    evidence = scan(root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + '\n', encoding='utf-8')

    print(
        'STATIC_GAP_SCAN '
        f"files={evidence['scanned_file_count']} "
        f"zombie_tests={evidence['blocking_zombie_test_count']} "
        f"declared_markers={evidence['declared_gap_marker_count']}"
    )
    if evidence['blocking_zombie_test_count']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
