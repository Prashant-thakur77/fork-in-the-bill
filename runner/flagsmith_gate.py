"""A Flagsmith client wrapper that keeps one event in flight at a time across concurrent tasks.

With `max_buffer_items=1` the SDK drops the oldest buffered event when a second is tracked
before the first is sent. Workers run several tasks in one process, so every exposure and
every event is tracked and flushed under one lock.
"""

from __future__ import annotations

import threading
from typing import Any

from harness.policy import FlagLike, FlagsLike, FlagsmithLike


class SerialFlagsmith:
    def __init__(self, inner: FlagsmithLike) -> None:
        self._inner = inner
        self._lock = threading.Lock()

    def get_experiment_flag(
        self, feature_name: str, identifier: str, traits: dict[str, object] | None = None
    ) -> FlagLike:
        with self._lock:
            flag = self._inner.get_experiment_flag(feature_name, identifier=identifier, traits=traits)
            self._inner.flush_events()
            return flag

    def get_identity_flags(self, identifier: str, traits: dict[str, object] | None = None) -> FlagsLike:
        return self._inner.get_identity_flags(identifier, traits)

    def track_event(
        self, event: str, identifier: str | None = None, value: float | int | str | bool | None = None, **kw: Any
    ) -> None:
        with self._lock:
            self._inner.track_event(event, identifier=identifier, value=value, **kw)
            self._inner.flush_events()

    def flush_events(self) -> None:
        with self._lock:
            self._inner.flush_events()

    def close(self, timeout_seconds: float = 10.0) -> None:
        with self._lock:
            self._inner.close(timeout_seconds)
