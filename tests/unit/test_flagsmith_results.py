import json
from pathlib import Path

from analysis.pull_results import extract_flagsmith_shape

NAMES = {737: "task_cost", 738: "task_solved"}


def payload(cost_inf, solved_inf, srm):
    return {
        "results": {
            "payload": {
                "srm_p_value": srm,
                "metrics": [
                    {
                        "metric_id": 737,
                        "variants": {
                            "control": {"n": 60, "sum": 30.0, "sum_squares": 20.0},
                            "lanes_v1": {"n": 58, "sum": 17.4, "sum_squares": 7.0},
                        },
                        "inference": {"lanes_v1": cost_inf},
                    },
                    {
                        "metric_id": 738,
                        "variants": {
                            "control": {"n": 60, "sum": 24.0, "sum_squares": 24.0},
                            "lanes_v1": {"n": 58, "sum": 22.0, "sum_squares": 22.0},
                        },
                        "inference": {"lanes_v1": solved_inf},
                    },
                ],
            }
        }
    }


def test_real_shape():
    s = extract_flagsmith_shape(
        payload(
            {"lift": -0.4, "ci_low": -0.5, "ci_high": -0.3, "chance_to_win": 0.999},
            {"lift": -0.05, "ci_low": -0.3, "ci_high": 0.2, "chance_to_win": 0.35},
            0.6,
        ),
        "control",
        "lanes_v1",
        NAMES,
    )
    assert s is not None
    assert s.chance_to_beat_control_cost == 0.999 and s.ci_cost == [-0.5, -0.3]
    assert s.cost_mean_by_variant == {"control": 0.5, "lanes_v1": 0.3}
    assert abs(s.solve_rate_by_variant["lanes_v1"] - 22 / 58) < 1e-12
    assert s.guardrail_loss is False and s.solve_rate_status == "inconclusive"
    assert s.srm_flag is False


def test_losing_guardrail_and_srm():
    s = extract_flagsmith_shape(
        payload(None, {"lift": -0.4, "ci_low": -0.6, "ci_high": -0.2, "chance_to_win": 0.01}, 1e-5),
        "control",
        "lanes_v1",
        NAMES,
    )
    assert s is not None and s.guardrail_loss is True and s.srm_flag is True
    assert s.chance_to_beat_control_cost is None


def test_smoke_capture_parses():
    f = sorted(Path("analysis/flagsmith/smoke").glob("results-*.json"))[-1]
    s = extract_flagsmith_shape(json.loads(f.read_text()), "control", "treat", {720: "task_solved"})
    assert s is not None and s.solve_rate_by_variant == {"treat": 1.0, "control": 1.0}
