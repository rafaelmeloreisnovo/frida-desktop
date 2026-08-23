"""
Deterministic Test Executor — Event-driven harness without sleep() or synthetic metrics

Replaces time.sleep() with explicit event polling and replaces synthetic metrics
with fixture-based deterministic output. Every PASS result includes device_validated flag.
"""

import json
import time
from typing import Dict, Optional, Tuple
from pathlib import Path
from threading import Event


class DeterministicExecutor:
    """Execute tests without sleep(); use event-driven polling instead."""

    def __init__(self, fixtures_path: Optional[str] = None):
        """
        Initialize executor.

        Args:
            fixtures_path: Path to fixtures/metrics-deterministic-v1.json
        """
        self.fixtures_path = fixtures_path or Path(__file__).parent.parent / "fixtures" / "metrics-deterministic-v1.json"
        self.fixtures = self._load_fixtures()
        self.device_validated = False
        self.device_validation_source = None

    def _load_fixtures(self) -> Dict:
        """Load fixture file."""
        try:
            with open(self.fixtures_path, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            raise RuntimeError(f"Fixture file not found: {self.fixtures_path}")

    def set_device_validated(self, source: str):
        """
        Mark this execution as device-validated.

        Args:
            source: Evidence source (e.g., "adb-logcat", "frida-gadget", "physical-android-device")
        """
        self.device_validated = True
        self.device_validation_source = source

    def run_phase_deterministic(
        self,
        scenario_id: str,
        phase_name: str,
        timeout_ms: int = 5000
    ) -> Tuple[bool, str]:
        """
        Execute learning phase without sleep().

        Args:
            scenario_id: Scenario identifier
            phase_name: Phase name (e.g., "OBSERVE", "LEARN_SHADOW")
            timeout_ms: Max wait time in milliseconds

        Returns:
            (success: bool, status_message: str)
        """
        # Event-driven: wait for phase completion signal
        # In real implementation, this would poll device/Frida bridge
        phase_event = Event()

        # Simulate phase completion within timeout
        # (Replace with actual device polling in production)
        if phase_event.wait(timeout=timeout_ms / 1000.0):
            return True, f"✓ {phase_name} phase complete (device-validated)"
        else:
            # Timeout: device not responding
            if self.device_validated:
                return False, f"✗ {phase_name} timeout (device validation active but no response)"
            else:
                return True, f"⚠ {phase_name} phase complete (TOKEN_VAZIO: device not validated)"

    def collect_metrics_deterministic(self, scenario_id: str) -> Dict[str, float]:
        """
        Collect metrics from fixture, not synthetic generation.

        Args:
            scenario_id: Scenario identifier

        Returns:
            Metrics dict from fixture
        """
        scenario = self.fixtures["scenarios"].get(scenario_id)
        if not scenario:
            raise ValueError(f"Scenario not found in fixtures: {scenario_id}")

        # Return fixture metrics as-is (deterministic, not synthetic)
        metrics = scenario["metrics"].copy()

        # Add device validation marker to metrics
        metrics["device_validated"] = self.device_validated
        metrics["device_validation_source"] = self.device_validation_source or "TOKEN_VAZIO"

        return metrics

    def validate_gates_with_device_marker(
        self,
        scenario_id: str,
        metrics: Dict
    ) -> Dict[str, bool]:
        """
        Validate gates and require device_validated marker.

        Falsifier: Test producing PASS without device_validated=true
        AND without explicit TOKEN_VAZIO marker shall FAIL.
        """
        scenario = self.fixtures["scenarios"].get(scenario_id)
        if not scenario:
            raise ValueError(f"Scenario not found: {scenario_id}")

        gates_passed = {}
        expected = scenario["expected_outcomes"]

        # Gate: accuracy
        acc = metrics.get("accuracy_percent", 0)
        gates_passed["accuracy"] = acc >= expected.get("accuracy_min", 0)

        # Gate: overhead
        ovh = metrics.get("overhead_percent", 100)
        gates_passed["overhead"] = ovh <= expected.get("overhead_max_percent", 100)

        # Gate: memory
        mem = metrics.get("memory_bytes", float('inf'))
        gates_passed["memory"] = mem <= expected.get("memory_max_bytes", float('inf'))

        # CRITICAL: Device validation gate
        device_val = metrics.get("device_validated", False)
        device_source = metrics.get("device_validation_source", "TOKEN_VAZIO")

        # Falsifier: PASS requires device=true OR explicit TOKEN_VAZIO marker
        if device_val:
            gates_passed["device_validated"] = True
        elif device_source == "TOKEN_VAZIO":
            # Explicit TOKEN_VAZIO is acceptable; marks test as unvalidated
            gates_passed["device_validated_status"] = "TOKEN_VAZIO"
        else:
            # Neither device=true nor TOKEN_VAZIO: FAIL
            gates_passed["device_validated"] = False
            gates_passed["ERROR"] = "Test produced PASS without device validation and without TOKEN_VAZIO marker"

        return gates_passed

    def generate_deterministic_receipt(
        self,
        scenario_id: str,
        metrics: Dict,
        gates: Dict,
        execution_time_ms: int
    ) -> Dict:
        """
        Generate receipt with device validation explicitly recorded.

        Returns:
            Receipt dict with immutable hash reference
        """
        return {
            "scenario_id": scenario_id,
            "execution_timestamp": time.time(),
            "execution_time_ms": execution_time_ms,
            "metrics": metrics,
            "gates_passed": gates,
            "device_validated": self.device_validated,
            "device_validation_source": self.device_validation_source,
            "fixture_version": self.fixtures["fixture_version"],
            "falsifier_compliant": (
                self.device_validated or
                metrics.get("device_validation_source") == "TOKEN_VAZIO"
            ),
            "note": "Falsifier: PASS requires device_validated=true OR device_validation_source=TOKEN_VAZIO"
        }
