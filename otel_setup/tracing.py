"""OpenTelemetry tracing for the harness: one trace per task, one span per model call.

Spans follow the OpenTelemetry GenAI semantic conventions where a convention exists
(`gen_ai.*`) and use the `fib.*` namespace for experiment fields (lane, policy, variant,
priced cost). With no OTLP endpoint configured, every helper here runs against a no-op
tracer, so the harness never needs a collector to work.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter
from opentelemetry.trace import NoOpTracer, Span, SpanKind, Tracer, format_trace_id
from opentelemetry.util.types import AttributeValue

from harness.schema import CallRecord, Lane, TaskRecord

INSTRUMENTATION_SCOPE = "fork-in-the-bill"
TASK_SPAN_NAME = "fib.task"

# GenAI semantic convention attributes.
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_PROVIDER_NAME = "gen_ai.provider.name"
GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = "gen_ai.usage.cache_read.input_tokens"
GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS = "gen_ai.usage.cache_creation.input_tokens"
ERROR_TYPE = "error.type"

# Project attributes.
FIB_LANE = "fib.lane"
FIB_POLICY = "fib.policy"
FIB_VARIANT = "fib.variant"
FIB_EXPERIMENT = "fib.experiment"
FIB_TASK_IDENTITY = "fib.task_identity"
FIB_TURN = "fib.turn"
FIB_UNCACHED_INPUT_TOKENS = "fib.uncached_input_tokens"
FIB_CACHE_READ_TOKENS = "fib.cache_read_tokens"
FIB_CACHE_WRITE_TOKENS = "fib.cache_write_tokens"
FIB_USD = "fib.usd"
FIB_REQUEST_ID = "fib.request_id"
FIB_IDENTITY = "fib.identity"
FIB_INSTANCE_ID = "fib.instance_id"
FIB_OUTCOME = "fib.outcome"
FIB_SOLVED = "fib.solved"
FIB_USD_MAIN = "fib.usd_main"
FIB_USD_DELEGATE = "fib.usd_delegate"
FIB_TURNS = "fib.turns"
FIB_DELEGATE_CALLS = "fib.delegate_calls"
FIB_SECONDS = "fib.seconds"
FIB_FLAG_SOURCE = "fib.flag_source"
FIB_ATTEMPT = "fib.attempt"

_ENDPOINT_ENV_VARS = ("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT")

_providers: list[TracerProvider] = []


def _clean(attrs: Mapping[str, AttributeValue | None]) -> dict[str, AttributeValue]:
    """Drop unset values; OpenTelemetry rejects None attribute values."""
    return {k: v for k, v in attrs.items() if v is not None}


def _endpoint_from_env() -> str | None:
    for name in _ENDPOINT_ENV_VARS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def init_tracing(
    service_name: str,
    *,
    exporter: SpanExporter | None = None,
    endpoint: str | None = None,
) -> Tracer:
    """Return a tracer for `service_name`.

    - `exporter` given: spans go to it synchronously (tests use an InMemorySpanExporter).
    - `endpoint` given: OTLP/HTTP to `<endpoint>/v1/traces`, batched.
    - `OTEL_EXPORTER_OTLP_ENDPOINT` (or `..._TRACES_ENDPOINT`) set: OTLP/HTTP configured
      from the standard environment variables, batched.
    - otherwise: a no-op tracer; spans cost nothing and export nothing.

    The global tracer provider is left alone, so several tracers can coexist in one
    process. Call `shutdown_tracing()` before exit to flush batched spans.
    """
    processor: SpanProcessor
    if exporter is not None:
        processor = SimpleSpanProcessor(exporter)
    elif endpoint:
        url = f"{endpoint.rstrip('/')}/v1/traces"
        processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=url))
    elif _endpoint_from_env() is not None:
        processor = BatchSpanProcessor(OTLPSpanExporter())
    else:
        return NoOpTracer()

    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(processor)
    _providers.append(provider)
    return provider.get_tracer(INSTRUMENTATION_SCOPE)


def shutdown_tracing() -> None:
    """Flush and shut down every provider created by `init_tracing`."""
    while _providers:
        provider = _providers.pop()
        provider.force_flush()
        provider.shutdown()


@dataclass(slots=True)
class ModelCallSpan:
    """Handle yielded by `model_call_span`; record the response once it arrives."""

    span: Span

    def record_usage(
        self,
        *,
        input_tokens: int,
        output_tokens: int,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        usd: float | None = None,
        response_model: str | None = None,
        stop_reason: str | None = None,
        request_id: str | None = None,
    ) -> None:
        """Set usage attributes.

        `input_tokens` is the provider's uncached input count (the Anthropic usage
        field). Per the GenAI conventions `gen_ai.usage.input_tokens` counts every input
        token, cached or not, so it is reported as the sum; the uncached count is kept in
        `fib.uncached_input_tokens`.
        """
        total_input = input_tokens + cache_read_tokens + cache_write_tokens
        self.span.set_attributes(
            _clean(
                {
                    GEN_AI_RESPONSE_MODEL: response_model,
                    GEN_AI_USAGE_INPUT_TOKENS: total_input,
                    GEN_AI_USAGE_OUTPUT_TOKENS: output_tokens,
                    GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS: cache_read_tokens,
                    GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS: cache_write_tokens,
                    GEN_AI_RESPONSE_FINISH_REASONS: [stop_reason] if stop_reason else None,
                    FIB_UNCACHED_INPUT_TOKENS: input_tokens,
                    FIB_CACHE_READ_TOKENS: cache_read_tokens,
                    FIB_CACHE_WRITE_TOKENS: cache_write_tokens,
                    FIB_USD: usd,
                    FIB_REQUEST_ID: request_id,
                }
            )
        )

    def record_call(self, call: CallRecord, *, response_model: str | None = None) -> None:
        """Set usage attributes from a priced CallRecord."""
        self.record_usage(
            input_tokens=call.input_tokens,
            output_tokens=call.output_tokens,
            cache_read_tokens=call.cache_read_tokens,
            cache_write_tokens=call.cache_write_5m_tokens + call.cache_write_1h_tokens,
            usd=call.usd,
            response_model=response_model or call.model,
            stop_reason=call.stop_reason,
            request_id=call.request_id,
        )


@contextmanager
def model_call_span(
    tracer: Tracer,
    *,
    lane: Lane | str,
    policy: str,
    model: str,
    variant: str | None = None,
    experiment: str | None = None,
    task_identity: str | None = None,
    turn: int | None = None,
    max_tokens: int | None = None,
) -> Iterator[ModelCallSpan]:
    """Span one model call, named `chat <model>` as the GenAI conventions suggest.

    Exceptions propagate; the span records them, gets ERROR status and `error.type`.
    """
    attrs = _clean(
        {
            GEN_AI_SYSTEM: "anthropic",
            GEN_AI_PROVIDER_NAME: "anthropic",
            GEN_AI_OPERATION_NAME: "chat",
            GEN_AI_REQUEST_MODEL: model,
            GEN_AI_REQUEST_MAX_TOKENS: max_tokens,
            FIB_LANE: str(lane),
            FIB_POLICY: policy,
            FIB_VARIANT: variant,
            FIB_EXPERIMENT: experiment,
            FIB_TASK_IDENTITY: task_identity,
            FIB_TURN: turn,
        }
    )
    with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs) as span:
        try:
            yield ModelCallSpan(span)
        except Exception as exc:
            span.set_attribute(ERROR_TYPE, type(exc).__qualname__)
            raise


@dataclass(slots=True)
class TaskSpan:
    """Handle yielded by `task_span`; `trace_id` goes into TaskRecord and the ledger."""

    span: Span

    @property
    def trace_id(self) -> str:
        """32-hex-digit trace id, or "" when tracing is off."""
        ctx = self.span.get_span_context()
        return format_trace_id(ctx.trace_id) if ctx.is_valid else ""

    def record_result(
        self,
        *,
        outcome: str,
        solved: bool,
        usd: float,
        usd_main: float,
        usd_delegate: float,
        turns: int,
        seconds: float,
        delegate_calls: int | None = None,
        flag_source: str | None = None,
        attempt: int | None = None,
    ) -> None:
        self.span.set_attributes(
            _clean(
                {
                    FIB_OUTCOME: outcome,
                    FIB_SOLVED: solved,
                    FIB_USD: usd,
                    FIB_USD_MAIN: usd_main,
                    FIB_USD_DELEGATE: usd_delegate,
                    FIB_TURNS: turns,
                    FIB_SECONDS: seconds,
                    FIB_DELEGATE_CALLS: delegate_calls,
                    FIB_FLAG_SOURCE: flag_source,
                    FIB_ATTEMPT: attempt,
                }
            )
        )

    def record_task(self, task: TaskRecord) -> None:
        """Set result attributes from the finished TaskRecord."""
        self.record_result(
            outcome=str(task.outcome),
            solved=task.solved,
            usd=task.usd,
            usd_main=task.usd_main,
            usd_delegate=task.usd_delegate,
            turns=task.turns,
            seconds=task.seconds,
            delegate_calls=task.delegate_calls,
            flag_source=task.flag_source,
            attempt=task.attempt,
        )


@contextmanager
def task_span(
    tracer: Tracer,
    *,
    identity: str,
    instance_id: str,
    experiment: str,
    variant: str,
    policy: str,
) -> Iterator[TaskSpan]:
    """Root span for one task. Model-call spans opened inside it share its trace."""
    attrs: dict[str, AttributeValue] = {
        FIB_IDENTITY: identity,
        FIB_INSTANCE_ID: instance_id,
        FIB_EXPERIMENT: experiment,
        FIB_VARIANT: variant,
        FIB_POLICY: policy,
    }
    with tracer.start_as_current_span(TASK_SPAN_NAME, kind=SpanKind.INTERNAL, attributes=attrs) as span:
        try:
            yield TaskSpan(span)
        except Exception as exc:
            span.set_attribute(ERROR_TYPE, type(exc).__qualname__)
            raise
