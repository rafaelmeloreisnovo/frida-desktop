#!/usr/bin/env python3
"""
RFL Learning Test Harness — Deterministic Event-Driven Execution
Orchestrates test scenarios with fixture-based metrics and event polling (no sleep)
"""

import json
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import hashlib
import uuid

from deterministic_executor import DeterministicExecutor


@dataclass
class TestResult:
    """Single test run result"""
    test_id: str
    scenario_id: str
    timestamp: str
    device_abi: str
    device_sdk: int
    duration_ms: int
    metrics: Dict[str, float]
    gates_passed: Dict[str, bool]
    status: str  # PASS, FAIL, SKIPPED
    error_message: Optional[str] = None
    logs: List[str] = None

    def __post_init__(self):
        if self.logs is None:
            self.logs = []


@dataclass
class TestSuite:
    """Collection of test results"""
    suite_id: str
    created_at: str
    device_info: Dict
    results: List[TestResult]
    summary: Dict

    def calculate_summary(self):
        """Compute aggregate metrics"""
        passed = sum(1 for r in self.results if r.status == "PASS")
        failed = sum(1 for r in self.results if r.status == "FAIL")
        skipped = sum(1 for r in self.results if r.status == "SKIPPED")

        self.summary = {
            "total_tests": len(self.results),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "success_rate_percent": 100 * passed / len(self.results) if self.results else 0,
            "total_duration_ms": sum(r.duration_ms for r in self.results),
        }


class TestHarness:
    def __init__(self, ontology_path: str):
        self.ontology = self._load_ontology(ontology_path)
        self.results_dir = Path("tests/results")
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.suite_id = str(uuid.uuid4())[:12]

        # Initialize deterministic executor with fixture-based metrics
        fixtures_path = Path("tests/fixtures/metrics-deterministic-v1.json")
        self.executor = DeterministicExecutor(str(fixtures_path))

    def _load_ontology(self, path: str) -> dict:
        """Load semantic tree ontology"""
        with open(path) as f:
            return json.load(f)

    def _get_device_info(self) -> Dict:
        """Probe device via adb"""
        try:
            abi = subprocess.check_output(
                "adb shell getprop ro.product.cpu.abi",
                shell=True, text=True
            ).strip()
            sdk = int(subprocess.check_output(
                "adb shell getprop ro.build.version.sdk",
                shell=True, text=True
            ).strip())
            return {"abi": abi, "sdk": sdk}
        except Exception as e:
            return {"abi": "unknown", "sdk": 0, "error": str(e)}

    def run_scenario(self, scenario: dict) -> TestResult:
        """Execute a single test scenario with deterministic device validation marker"""
        scenario_id = scenario["id"]
        print(f"\n{'='*60}")
        print(f"Running: {scenario['name']}")
        print(f"{'='*60}")

        test_id = f"{self.suite_id}-{scenario_id}-{int(time.time())}"
        start_time = time.time()
        metrics = {}
        gates_passed = {}
        error_msg = None
        status = "SKIPPED"

        try:
            # Mark device validation: TOKEN_VAZIO (no physical device in this environment)
            # Production: Would set source to "adb-logcat", "frida-gadget", or "physical-android-device"
            self.executor.set_device_validated(source="TOKEN_VAZIO")

            # Phase 1: OBSERVE
            print(f"\n  Phase 1: OBSERVE ({scenario['phases'][0]['duration_ms']}ms)")
            self._run_phase(scenario_id, "OBSERVE")

            # Phase 2: LEARN_SHADOW
            print(f"  Phase 2: LEARN_SHADOW ({scenario['phases'][1]['duration_ms']}ms)")
            self._run_phase(scenario_id, "LEARN_SHADOW")

            # Phase 3: PREDICT_SHADOW
            print(f"  Phase 3: PREDICT_SHADOW ({scenario['phases'][2]['duration_ms']}ms)")
            self._run_phase(scenario_id, "PREDICT_SHADOW")

            # Collect metrics from fixture with device validation markers
            metrics = self._collect_metrics(scenario_id, scenario)

            # Validate gates with mandatory device validation gate
            gates_passed = self._validate_gates(scenario, metrics)

            # Determine status: PASS only if all gates pass AND device validation satisfied
            status = "PASS" if all(gates_passed.values()) else "FAIL"

            print(f"\n  Metrics collected: {len(metrics)} values")
            print(f"  Gates: {sum(1 for v in gates_passed.values() if v)}/{len(gates_passed)} passed")
            print(f"  Device validation: {metrics.get('device_validation_source', 'unknown')}")

        except Exception as e:
            status = "FAIL"
            error_msg = str(e)
            print(f"\n  ERROR: {error_msg}")

        finally:
            duration_ms = int((time.time() - start_time) * 1000)
            device_info = self._get_device_info()

            result = TestResult(
                test_id=test_id,
                scenario_id=scenario_id,
                timestamp=datetime.utcnow().isoformat(),
                device_abi=device_info.get("abi", "unknown"),
                device_sdk=device_info.get("sdk", 0),
                duration_ms=duration_ms,
                metrics=metrics,
                gates_passed=gates_passed,
                status=status,
                error_message=error_msg
            )

            print(f"\n  Status: {status} ({duration_ms}ms)")
            return result

    def _run_phase(self, scenario_id: str, phase_name: str, timeout_ms: int = 5000):
        """Execute a learning phase with deterministic event-driven polling"""
        success, message = self.executor.run_phase_deterministic(
            scenario_id=scenario_id,
            phase_name=phase_name,
            timeout_ms=timeout_ms
        )
        if success:
            print(f"    {message}")
        else:
            print(f"    {message}")
            raise RuntimeError(f"Phase {phase_name} failed or timed out")

    def _collect_metrics(self, scenario_id: str, scenario: dict) -> Dict[str, float]:
        """Collect deterministic metrics from fixture, not synthetic generation"""
        # Retrieve fixture-based metrics with device validation markers
        metrics = self.executor.collect_metrics_deterministic(scenario_id)

        # Map fixture metrics to scenario's metric names for backward compatibility
        result = {}
        fixture_metrics = {k: v for k, v in metrics.items()
                          if k not in ("device_validated", "device_validation_source")}

        for metric_name in scenario.get("metrics", []):
            if metric_name in fixture_metrics:
                result[metric_name] = fixture_metrics[metric_name]
            else:
                # Fallback: map by type (accuracy, overhead, latency, memory)
                for fixture_key, fixture_value in fixture_metrics.items():
                    if metric_name.lower() in fixture_key.lower():
                        result[metric_name] = fixture_value
                        break

        # Preserve device validation markers
        result["device_validated"] = metrics.get("device_validated", False)
        result["device_validation_source"] = metrics.get("device_validation_source", "TOKEN_VAZIO")

        return result

    def _validate_gates(self, scenario: dict, metrics: Dict) -> Dict[str, bool]:
        """Validate execution gates with critical device validation requirement"""
        scenario_id = scenario["id"]

        # Use executor's gate validator which enforces device_validated marker
        gates = self.executor.validate_gates_with_device_marker(
            scenario_id=scenario_id,
            metrics=metrics
        )

        # Falsifier: If ERROR key is present, test must fail
        if "ERROR" in gates:
            print(f"\n  FALSIFIER VIOLATION: {gates['ERROR']}")
            gates["device_validation"] = False

        return gates

    def run_all_scenarios(self) -> TestSuite:
        """Execute all scenarios in ontology"""
        device_info = self._get_device_info()
        print(f"\nDevice: {device_info['abi']} (SDK {device_info['sdk']})")

        results = []
        for scenario in self.ontology.get("test_scenarios", []):
            result = self.run_scenario(scenario)
            results.append(result)

        suite = TestSuite(
            suite_id=self.suite_id,
            created_at=datetime.utcnow().isoformat(),
            device_info=device_info,
            results=results,
            summary={}
        )
        suite.calculate_summary()

        return suite

    def save_results(self, suite: TestSuite) -> Path:
        """Persist results to disk with deterministic receipts"""
        run_dir = self.results_dir / suite.suite_id
        run_dir.mkdir(exist_ok=True)

        # Save individual results
        for result in suite.results:
            result_file = run_dir / f"{result.scenario_id}.json"
            with open(result_file, 'w') as f:
                json.dump(asdict(result), f, indent=2)

            # Generate deterministic receipt for each result
            if result.scenario_id in [s["id"] for s in self.ontology.get("test_scenarios", [])]:
                receipt = self.executor.generate_deterministic_receipt(
                    scenario_id=result.scenario_id,
                    metrics=result.metrics,
                    gates=result.gates_passed,
                    execution_time_ms=result.duration_ms
                )
                receipt_file = run_dir / f"{result.scenario_id}-receipt.json"
                with open(receipt_file, 'w') as f:
                    json.dump(receipt, f, indent=2)

        # Save suite summary
        summary_file = run_dir / "summary.json"
        suite_data = {
            "suite_id": suite.suite_id,
            "created_at": suite.created_at,
            "device_info": suite.device_info,
            "summary": suite.summary,
            "harness_deterministic": True,
            "fixture_version": "1.0",
        }
        with open(summary_file, 'w') as f:
            json.dump(suite_data, f, indent=2)

        # Generate index
        index_file = self.results_dir / "index.json"
        index = {"test_runs": []}
        if index_file.exists():
            with open(index_file) as f:
                index = json.load(f)

        index["test_runs"].append({
            "suite_id": suite.suite_id,
            "created_at": suite.created_at,
            "device_abi": suite.device_info.get("abi"),
            "summary": suite.summary,
            "harness_deterministic": True,
            "path": str(run_dir.relative_to(self.results_dir))
        })

        with open(index_file, 'w') as f:
            json.dump(index, f, indent=2)

        return run_dir

    def generate_report(self, suite: TestSuite) -> str:
        """Generate markdown report"""
        report = f"""# Test Execution Report

**Suite ID:** `{suite.suite_id}`
**Date:** {suite.created_at}
**Device:** {suite.device_info['abi']} (SDK {suite.device_info['sdk']})

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | {suite.summary['total_tests']} |
| Passed | {suite.summary['passed']} |
| Failed | {suite.summary['failed']} |
| Skipped | {suite.summary['skipped']} |
| Success Rate | {suite.summary['success_rate_percent']:.1f}% |
| Duration | {suite.summary['total_duration_ms']}ms |

## Results

"""
        for result in suite.results:
            status_emoji = "✅" if result.status == "PASS" else "❌" if result.status == "FAIL" else "⏭️"
            report += f"\n### {status_emoji} {result.scenario_id}\n"
            report += f"- **Status:** {result.status}\n"
            report += f"- **Duration:** {result.duration_ms}ms\n"
            report += f"- **Gates:** {sum(result.gates_passed.values())}/{len(result.gates_passed)} passed\n"

            if result.metrics:
                report += "- **Metrics:**\n"
                for name, value in result.metrics.items():
                    if isinstance(value, float):
                        report += f"  - `{name}`: {value:.2f}\n"
                    else:
                        report += f"  - `{name}`: {value}\n"

            if result.error_message:
                report += f"- **Error:** {result.error_message}\n"

        return report


def main():
    ontology_path = "ontology/learning-semantic-tree.v1.json"

    if not Path(ontology_path).exists():
        print(f"ERROR: Ontology not found at {ontology_path}")
        sys.exit(1)

    harness = TestHarness(ontology_path)
    suite = harness.run_all_scenarios()
    results_path = harness.save_results(suite)
    report = harness.generate_report(suite)

    # Print report
    print(f"\n{'='*60}")
    print(report)
    print(f"{'='*60}")
    print(f"\nResults saved to: {results_path}")

    # Exit with appropriate code
    sys.exit(0 if suite.summary["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
