"""Circuit breaker per (route, backend) (AI-GW-01 fallbacks, AI-GW-07 self-hosted pool).

CLOSED     calls flow; `failure_threshold` consecutive failures open the circuit.
OPEN       calls are refused (the router falls back) until `cooldown_s` has passed.
HALF_OPEN  exactly one trial call is let through; success closes, failure re-opens (timer restarts).

The clock is injectable so tests can walk the state machine without sleeping.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

CLOSED, OPEN, HALF_OPEN = "CLOSED", "OPEN", "HALF_OPEN"


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, cooldown_s: float = 15.0, clock: Callable[[], float] = time.monotonic):
        self.failure_threshold = max(1, int(failure_threshold))
        self.cooldown_s = float(cooldown_s)
        self.clock = clock
        self.state = CLOSED
        self.failures = 0
        self.opened_at: float | None = None
        self.trial_in_flight = False
        self.transitions: list[tuple[str, float]] = []
        self._lock = threading.Lock()

    def configure(self, failure_threshold: int, cooldown_s: float) -> None:
        with self._lock:
            self.failure_threshold = max(1, int(failure_threshold))
            self.cooldown_s = float(cooldown_s)

    def _to(self, state: str) -> None:
        if state != self.state:
            self.state = state
            self.transitions.append((state, self.clock()))
            del self.transitions[:-20]

    def current(self) -> str:
        """State as a caller would see it now (OPEN turns HALF_OPEN once the cooldown is over)."""
        with self._lock:
            if self.state == OPEN and self.opened_at is not None and self.clock() - self.opened_at >= self.cooldown_s:
                self._to(HALF_OPEN)
                self.trial_in_flight = False
            return self.state

    def allow(self) -> bool:
        state = self.current()
        with self._lock:
            if state == CLOSED:
                return True
            if state == HALF_OPEN and not self.trial_in_flight:
                self.trial_in_flight = True
                return True
            return False

    def success(self) -> None:
        with self._lock:
            self.failures = 0
            self.trial_in_flight = False
            self.opened_at = None
            self._to(CLOSED)

    def failure(self) -> None:
        with self._lock:
            self.trial_in_flight = False
            if self.state == HALF_OPEN:
                self.opened_at = self.clock()
                self._to(OPEN)
                return
            self.failures += 1
            if self.failures >= self.failure_threshold:
                self.opened_at = self.clock()
                self._to(OPEN)

    def reset(self) -> None:
        with self._lock:
            self.failures = 0
            self.opened_at = None
            self.trial_in_flight = False
            self._to(CLOSED)

    def snapshot(self) -> dict:
        state = self.current()
        retry_in = None
        if state == OPEN and self.opened_at is not None:
            retry_in = max(0.0, round(self.cooldown_s - (self.clock() - self.opened_at), 1))
        return {"state": state, "consecutive_failures": self.failures, "retry_in_s": retry_in}
