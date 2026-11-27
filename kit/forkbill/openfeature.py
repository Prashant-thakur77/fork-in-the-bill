"""Read the routing policy and send task events through OpenFeature.

`OpenFeatureFlagsmith` gives `RoutedLanes` the client interface it expects (`FlagsmithLike`), backed
by an OpenFeature client whose provider is the official Flagsmith provider
(`openfeature-provider-flagsmith` 1.0, `openfeature_flagsmith.FlagsmithProvider`). Install the
extra: `pip install fork-in-the-bill[openfeature]`.

    from flagsmith import Flagsmith
    from forkbill.openfeature import OpenFeatureFlagsmith

    flagsmith = Flagsmith(environment_key=..., enable_events=True)
    lanes = RoutedLanes(flagsmith=OpenFeatureFlagsmith.from_flagsmith(flagsmith), identity=..., ...)

How each call maps, as read in the provider's 1.0.0 source:

- the routing flag: `client.get_string_details(flag, "", ctx)`; the provider resolves it with
  `get_identity_flags(targeting_key)` and returns the value, the variant key and the engine's
  reason. The kill switch is a boolean resolution, the control policy an evaluation with no
  targeting key (environment flags). None of these records an exposure by itself.
- the exposure, by default (`exposure="variant"`): when the routing flag resolved to a variant,
  `client.track("feature_flag.exposure", ctx, {"flag_key", "variant"})`, which the provider sends
  as the SDK's `$flag_exposure` event with the variant key as the value (its documented
  "explicit track()" path).
- with `exposure="hook"`, the provider's `FlagsmithExposureHook` is attached to the evaluation
  instead. The hook only fires for reason `SPLIT`. In a Flagsmith experiment the control arm
  resolves with variant `control` and reason `TARGETING_MATCH; segment=experiment-N-rollout`
  (the engine only gives `SPLIT` to a named variant), so the hook exposes the treatment arms and
  never the control. Checked on self-hosted Flagsmith 2.295.2: see `selfhost/README.md`.
- task events: `client.track(event, ctx, TrackingEventDetails(value=...))`. The provider sends a
  plain Flagsmith event with `identifier = ctx.targeting_key`. It drops non-numeric values; the
  kit's values are numbers.
- flushing: OpenFeature has no flush and the provider leaves buffering to the Flagsmith client, so
  `flush_events` calls the client's `flush_events`.

Every evaluation and event uses `EvaluationContext(targeting_key=identity)`, which takes
precedence over a targeting key in the global or client context, so the exposure and the events
carry the same identifier.

Limits of the OpenFeature path compared with `get_experiment_flag`: the provider's details carry
no `experiment.in_experiment`, and the engine gives every identity of a multivariate flag a
variant (`control` when no named variant matches), even outside an experiment's rollout. So this
adapter treats "resolved to a variant" as enrolled. That is right for an experiment at 100%
rollout, as the kit's experiments are, and over-counts the control arm for a partial rollout. Pass
`experiment_id` to send it as exposure metadata, as the native path does; Flagsmith 2.295.2
counted exposures without it too.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

try:
    from openfeature import api
    from openfeature.evaluation_context import EvaluationContext
    from openfeature.exception import ErrorCode
    from openfeature.flag_evaluation import FlagEvaluationDetails, FlagEvaluationOptions
    from openfeature.track import TrackingEventDetails, TrackingValue
    from openfeature_flagsmith import EXPOSURE_TRACKING_EVENT, FlagsmithExposureHook, FlagsmithProvider
except ImportError as exc:  # pragma: no cover - depends on the optional extra
    raise ImportError("install the 'openfeature' extra to use forkbill.openfeature") from exc

if TYPE_CHECKING:
    from openfeature.client import OpenFeatureClient

    from flagsmith import Flagsmith

DOMAIN = "forkbill"
ExposureMode = Literal["variant", "hook"]


@dataclass(frozen=True)
class OpenFeatureExperiment:
    """Stands in for the SDK's experiment metadata: set when the adapter recorded an exposure."""

    in_experiment: bool
    id: int | None = None
    name: str | None = None


@dataclass(frozen=True)
class OpenFeatureFlag:
    """The parts of a Flagsmith flag the kit reads, built from OpenFeature evaluation details."""

    feature_name: str
    enabled: bool
    value: Any
    is_default: bool = False
    variant: str | None = None
    reason: str | None = None
    experiment: OpenFeatureExperiment | None = None
    error: str | None = None


def _is_split(reason: object) -> bool:
    return reason is not None and str(reason).split(";", 1)[0].strip() == "SPLIT"


def _reason(details: FlagEvaluationDetails[Any]) -> str | None:
    return None if details.reason is None else str(details.reason)


def _error(details: FlagEvaluationDetails[Any]) -> str | None:
    if details.error_code is None:
        return None
    return f"{details.error_code}: {details.error_message or ''}".strip()


class _Flags:
    """`get_flag` by name, resolved through OpenFeature for one evaluation context."""

    def __init__(self, owner: OpenFeatureFlagsmith, context: EvaluationContext) -> None:
        self._owner = owner
        self._context = context

    def get_flag(self, feature_name: str) -> OpenFeatureFlag:
        return self._owner.resolve(feature_name, self._context)


class OpenFeatureFlagsmith:
    """`FlagsmithLike` over an OpenFeature client backed by `FlagsmithProvider`."""

    def __init__(
        self,
        client: OpenFeatureClient,
        provider: FlagsmithProvider,
        *,
        flush: Callable[[], None],
        close: Callable[[float], None] | None = None,
        exposure: ExposureMode = "variant",
        experiment_id: int | None = None,
    ) -> None:
        if exposure not in ("variant", "hook"):
            raise ValueError(f"exposure must be 'variant' or 'hook', not {exposure!r}")
        self.client = client
        self.provider = provider
        self.exposure: ExposureMode = exposure
        self.experiment_id = experiment_id
        self._flush = flush
        self._close = close
        self._exposure_hook = FlagsmithExposureHook(provider)

    @classmethod
    def from_flagsmith(
        cls,
        flagsmith: Flagsmith | Any,
        *,
        domain: str = DOMAIN,
        exposure: ExposureMode = "variant",
        experiment_id: int | None = None,
    ) -> OpenFeatureFlagsmith:
        """Register `FlagsmithProvider(client=flagsmith)` for `domain` and wrap that domain's client.

        `flagsmith` needs `enable_events=True`: the provider drops every tracking call otherwise.
        """
        provider = FlagsmithProvider(client=flagsmith)
        api.set_provider(provider, domain)
        return cls(
            api.get_client(domain),
            provider,
            flush=flagsmith.flush_events,
            close=flagsmith.close,
            exposure=exposure,
            experiment_id=experiment_id,
        )

    @staticmethod
    def context(identifier: str | None, traits: Mapping[str, Any] | None = None) -> EvaluationContext:
        attributes: dict[str, Any] = {"traits": dict(traits)} if traits else {}
        return EvaluationContext(targeting_key=identifier, attributes=attributes)

    # ----------------------------------------------------------------- flags

    def resolve(self, feature_name: str, context: EvaluationContext, *, expose: bool = False) -> OpenFeatureFlag:
        """Resolve one flag; with `expose`, record the exposure as configured by `exposure`."""
        if not expose:
            # The boolean resolution is the flag's enabled state and works for value-less flags
            # (the kill switch); the value is only read for an enabled flag.
            state = self.client.get_boolean_details(feature_name, False, context)
            if state.error_code == ErrorCode.FLAG_NOT_FOUND:
                return OpenFeatureFlag(feature_name, False, None, is_default=True, error=_error(state))
            if state.error_code is not None or not state.value:
                return OpenFeatureFlag(feature_name, False, None, reason=_reason(state), error=_error(state))
        hook = expose and self.exposure == "hook"
        options = FlagEvaluationOptions(hooks=[self._exposure_hook]) if hook else None
        details = self.client.get_string_details(feature_name, "", context, options)
        if details.error_code == ErrorCode.FLAG_NOT_FOUND:
            return OpenFeatureFlag(feature_name, False, None, is_default=True, error=_error(details))
        if details.error_code == ErrorCode.TYPE_MISMATCH:
            # Enabled, but the value is not a string: the kit reports it as an invalid policy.
            return OpenFeatureFlag(feature_name, True, None, reason=_reason(details), error=_error(details))
        if details.error_code is not None:
            # The provider raises a GENERAL error for a disabled flag (and for client failures).
            return OpenFeatureFlag(feature_name, False, None, reason=_reason(details), error=_error(details))
        variant = details.variant if isinstance(details.variant, str) else None
        exposed = False
        if expose and variant is not None:
            if hook:
                exposed = _is_split(details.reason)  # what the hook required before it tracked
            else:
                self._track_exposure(feature_name, variant, context)
                exposed = True
        return OpenFeatureFlag(
            feature_name,
            True,
            details.value,
            variant=variant,
            reason=_reason(details),
            experiment=OpenFeatureExperiment(in_experiment=True, id=self.experiment_id) if exposed else None,
        )

    def _track_exposure(self, feature_name: str, variant: str, context: EvaluationContext) -> None:
        attributes: dict[str, TrackingValue] = {"flag_key": feature_name, "variant": variant}
        if self.experiment_id is not None:
            attributes["experiment_id"] = self.experiment_id
        self.client.track(EXPOSURE_TRACKING_EVENT, context, TrackingEventDetails(attributes=attributes))

    def get_experiment_flag(
        self, feature_name: str, identifier: str, traits: Mapping[str, Any] | None = None
    ) -> OpenFeatureFlag:
        return self.resolve(feature_name, self.context(identifier, traits), expose=True)

    def get_identity_flags(self, identifier: str, traits: Mapping[str, Any] | None = None) -> _Flags:
        return _Flags(self, self.context(identifier, traits))

    def get_environment_flags(self) -> _Flags:
        return _Flags(self, EvaluationContext())

    # ----------------------------------------------------------------- events

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: str | int | float | bool | None = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if not identifier:
            raise ValueError("an OpenFeature tracking event needs the task's identity as targeting key")
        numeric = float(value) if isinstance(value, int | float) else None
        details = TrackingEventDetails(value=numeric, attributes=dict(metadata or {}))
        self.client.track(event, self.context(identifier, traits), details)

    def flush_events(self) -> None:
        self._flush()

    def close(self, timeout_seconds: float = 5.0) -> None:
        if self._close is not None:
            self._close(timeout_seconds)
