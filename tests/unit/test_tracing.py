from __future__ import annotations

from collections.abc import Iterator

import pytest
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import NoOpTracer, SpanKind, StatusCode, Tracer

from harness.schema import CallRecord, Lane
from otel_setup import init_tracing, model_call_span, shutdown_tracing, task_span, tracing


@pytest.fixture
def exporter() -> Iterator[InMemorySpanExporter]:
    exp = InMemorySpanExporter()
    yield exp
    shutdown_tracing()


@pytest.fixture
def tracer(exporter: InMemorySpanExporter) -> Tracer:
    return init_tracing("fib-test", exporter=exporter)


def _only(exporter: InMemorySpanExporter, name: str) -> ReadableSpan:
    spans = [s for s in exporter.get_finished_spans() if s.name == name]
    assert len(spans) == 1, [s.name for s in exporter.get_finished_spans()]
    return spans[0]


def test_no_endpoint_gives_noop_tracer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    tracer = init_tracing("fib-test")
    assert isinstance(tracer, NoOpTracer)
    with task_span(
        tracer,
        identity="swelive:a",
        instance_id="a",
        experiment="dryrun",
        variant="control",
        policy="p",
    ) as task:
        assert task.trace_id == ""
        with model_call_span(tracer, lane=Lane.main, policy="p", model="m") as call:
            call.record_usage(input_tokens=1, output_tokens=1)


def test_blank_endpoint_env_is_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "  ")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    assert isinstance(init_tracing("fib-test"), NoOpTracer)


def test_endpoint_env_gives_exporting_tracer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    try:
        tracer = init_tracing("fib-test")
        assert not isinstance(tracer, NoOpTracer)
        assert len(tracing._providers) == 1
    finally:
        tracing._providers.clear()  # nothing was recorded, so skip the flush to port 9


def test_model_call_span_sets_genai_and_fib_attributes(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    with model_call_span(
        tracer,
        lane=Lane.delegate,
        policy="lanes_v1",
        model="claude-haiku-4-5",
        variant="lanes_v1",
        experiment="exp1",
        task_identity="swelive:org__repo-1",
        turn=3,
        max_tokens=4096,
    ) as call:
        call.record_usage(
            input_tokens=120,
            output_tokens=45,
            cache_read_tokens=1000,
            cache_write_tokens=200,
            usd=0.0123,
            response_model="claude-haiku-4-5-20251001",
            stop_reason="end_turn",
            request_id="req_1",
        )

    span = _only(exporter, "chat claude-haiku-4-5")
    assert span.kind is SpanKind.CLIENT
    attrs = dict(span.attributes or {})
    assert attrs["gen_ai.system"] == "anthropic"
    assert attrs["gen_ai.operation.name"] == "chat"
    assert attrs["gen_ai.request.model"] == "claude-haiku-4-5"
    assert attrs["gen_ai.request.max_tokens"] == 4096
    assert attrs["gen_ai.response.model"] == "claude-haiku-4-5-20251001"
    assert attrs["gen_ai.usage.input_tokens"] == 120 + 1000 + 200
    assert attrs["gen_ai.usage.output_tokens"] == 45
    assert attrs["gen_ai.response.finish_reasons"] == ("end_turn",)
    assert attrs["fib.uncached_input_tokens"] == 120
    assert attrs["fib.cache_read_tokens"] == 1000
    assert attrs["fib.cache_write_tokens"] == 200
    assert attrs["fib.usd"] == pytest.approx(0.0123)
    assert attrs["fib.lane"] == "delegate"
    assert attrs["fib.policy"] == "lanes_v1"
    assert attrs["fib.variant"] == "lanes_v1"
    assert attrs["fib.experiment"] == "exp1"
    assert attrs["fib.task_identity"] == "swelive:org__repo-1"
    assert attrs["fib.turn"] == 3
    assert attrs["fib.request_id"] == "req_1"


def test_unset_optional_attributes_are_omitted(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    with model_call_span(tracer, lane="main", policy="control", model="m") as call:
        call.record_usage(input_tokens=1, output_tokens=2)
    attrs = dict(_only(exporter, "chat m").attributes or {})
    for key in ("fib.variant", "gen_ai.response.model", "fib.usd", "gen_ai.request.max_tokens"):
        assert key not in attrs
    assert attrs["fib.lane"] == "main"


def test_record_call_from_call_record(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    rec = CallRecord(
        task_identity="swelive:x",
        lane=Lane.main,
        model="claude-sonnet-4-5",
        turn=1,
        input_tokens=10,
        cache_write_5m_tokens=100,
        cache_write_1h_tokens=50,
        cache_read_tokens=500,
        output_tokens=20,
        usd=0.5,
        latency_s=1.2,
        stop_reason="tool_use",
        request_id="req_2",
    )
    with model_call_span(tracer, lane=rec.lane, policy="control", model=rec.model) as call:
        call.record_call(rec)
    attrs = dict(_only(exporter, "chat claude-sonnet-4-5").attributes or {})
    assert attrs["fib.cache_write_tokens"] == 150
    assert attrs["fib.cache_read_tokens"] == 500
    assert attrs["gen_ai.usage.input_tokens"] == 660
    assert attrs["gen_ai.response.model"] == "claude-sonnet-4-5"
    assert attrs["fib.usd"] == 0.5


def test_task_span_parents_model_calls(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    with task_span(
        tracer,
        identity="swelive:org__repo-1",
        instance_id="org__repo-1",
        experiment="exp1",
        variant="control",
        policy="control",
    ) as task:
        with model_call_span(tracer, lane=Lane.main, policy="control", model="m1"):
            pass
        with model_call_span(tracer, lane=Lane.delegate, policy="control", model="m2"):
            pass
        task.record_result(
            outcome="solved",
            solved=True,
            usd=1.5,
            usd_main=1.2,
            usd_delegate=0.3,
            turns=7,
            seconds=88.0,
            delegate_calls=1,
        )
        trace_id = task.trace_id

    root = _only(exporter, "fib.task")
    assert len(trace_id) == 32
    assert root.context is not None
    assert format(root.context.trace_id, "032x") == trace_id
    for name in ("chat m1", "chat m2"):
        child = _only(exporter, name)
        assert child.parent is not None
        assert child.parent.span_id == root.context.span_id
        assert child.context is not None and child.context.trace_id == root.context.trace_id

    attrs = dict(root.attributes or {})
    assert attrs["fib.identity"] == "swelive:org__repo-1"
    assert attrs["fib.variant"] == "control"
    assert attrs["fib.solved"] is True
    assert attrs["fib.usd_delegate"] == pytest.approx(0.3)
    assert attrs["fib.turns"] == 7


def test_exception_marks_span_error_and_propagates(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    with pytest.raises(TimeoutError), model_call_span(tracer, lane=Lane.main, policy="control", model="m"):
        raise TimeoutError("provider timed out")
    span = _only(exporter, "chat m")
    assert span.status.status_code is StatusCode.ERROR
    assert dict(span.attributes or {})["error.type"] == "TimeoutError"
    assert any(e.name == "exception" for e in span.events)


def test_resource_carries_service_name(tracer: Tracer, exporter: InMemorySpanExporter) -> None:
    with model_call_span(tracer, lane=Lane.main, policy="p", model="m"):
        pass
    assert _only(exporter, "chat m").resource.attributes["service.name"] == "fib-test"
