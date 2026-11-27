"""Build the Flagsmith client for one of the kit's evaluation modes.

| mode         | flags come from                                  | key            |
|--------------|--------------------------------------------------|----------------|
| `remote`     | the core API, one `POST /identities/` per read  | any SDK key    |
| `local`      | the environment document, evaluated in process   | server-side    |
| `edge`       | an Edge Proxy, one `POST /identities/` per read  | any proxy key  |
| `edge-local` | the environment document served by an Edge Proxy | server-side    |

Every mode sends exposures and task events to the core API's events endpoint
(`events_api_url`), and flag analytics, when enabled, to the core API (`analytics_url`): the
Edge Proxy serves flags only.

What each mode records, as checked against the SDK and the Edge Proxy source:

- `local` (Python SDK 6.5.0 and later; 6.7.0 here): the environment document carries
  `metadata.experiment` on each feature state, the SDK copies it onto identity flags, so
  `get_experiment_flag` sees `experiment.in_experiment` and records the exposure as it does
  remotely. SDK 6.3.0 does not copy it, so it records no exposure under local evaluation.
- `edge` (Edge Proxy 2.24.0): `POST /api/v1/identities/` returns `feature`, `enabled`,
  `feature_state_value` and `reason` only, with no `variant` and no `metadata`. The value served
  is the variant's value, but the SDK cannot tell that the identity is in an experiment, so
  `get_experiment_flag` records no exposure and the kit sends no task events by default.
- `edge-local`: the proxy also serves `GET /api/v1/environment-document` to a server-side key,
  so the SDK evaluates locally from the proxy's copy and records exposures as in `local`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, get_args

if TYPE_CHECKING:
    from flagsmith import Flagsmith

Mode = Literal["remote", "local", "edge", "edge-local"]
MODES: tuple[Mode, ...] = get_args(Mode)

LOCAL_MODES: frozenset[Mode] = frozenset({"local", "edge-local"})
EDGE_MODES: frozenset[Mode] = frozenset({"edge", "edge-local"})


def _slash(url: str) -> str:
    return url if url.endswith("/") else f"{url}/"


def client_kwargs(
    mode: Mode,
    *,
    environment_key: str,
    api_url: str | None = None,
    events_api_url: str | None = None,
    edge_url: str | None = None,
    refresh_seconds: float = 60,
    max_buffer_items: int | None = None,
) -> dict[str, object]:
    """Keyword arguments for `flagsmith.Flagsmith` in `mode` (without the event config object).

    `api_url` is the core API (`.../api/v1/`), `events_api_url` the events base (`.../api/`),
    `edge_url` the Edge Proxy's SDK base (`.../api/v1/`). Raises ValueError for a combination the
    SDK would refuse or that would send events to the proxy.
    """
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}; expected one of {', '.join(MODES)}")
    if mode in LOCAL_MODES and not environment_key.startswith("ser."):
        raise ValueError(f"mode {mode!r} evaluates locally and needs a server-side key (ser.*)")
    if mode in EDGE_MODES and not edge_url:
        raise ValueError(f"mode {mode!r} needs edge_url, the Edge Proxy's /api/v1/ URL")
    flags_url = edge_url if mode in EDGE_MODES else api_url
    kwargs: dict[str, object] = {
        "environment_key": environment_key,
        "api_url": _slash(flags_url) if flags_url else None,
        "enable_events": True,
        "enable_local_evaluation": mode in LOCAL_MODES,
    }
    if mode in LOCAL_MODES:
        kwargs["environment_refresh_interval_seconds"] = refresh_seconds
    if mode in EDGE_MODES and api_url:
        # Analytics (if a caller turns them on) belong to the core API, not the proxy.
        kwargs["analytics_url"] = _slash(api_url) + "analytics/flags/"
    events: dict[str, object] = {}
    if events_api_url:
        events["events_api_url"] = _slash(events_api_url)
    elif mode in EDGE_MODES:
        raise ValueError(f"mode {mode!r} needs events_api_url: the Edge Proxy does not accept events")
    if max_buffer_items is not None:
        events["max_buffer_items"] = max_buffer_items
    kwargs["event_processor"] = events
    return kwargs


def make_client(
    mode: Mode,
    *,
    environment_key: str,
    api_url: str | None = None,
    events_api_url: str | None = None,
    edge_url: str | None = None,
    refresh_seconds: float = 60,
    max_buffer_items: int | None = None,
) -> Flagsmith:
    """A `flagsmith.Flagsmith` client with events on, configured for `mode`.

    In the local modes the constructor fetches the environment document before it returns.
    """
    from flagsmith.analytics import EventProcessorConfig

    from flagsmith import Flagsmith

    kwargs = client_kwargs(
        mode,
        environment_key=environment_key,
        api_url=api_url,
        events_api_url=events_api_url,
        edge_url=edge_url,
        refresh_seconds=refresh_seconds,
        max_buffer_items=max_buffer_items,
    )
    events = kwargs.pop("event_processor")
    assert isinstance(events, dict)
    return Flagsmith(**kwargs, event_processor_config=EventProcessorConfig(**events))  # type: ignore[arg-type]
