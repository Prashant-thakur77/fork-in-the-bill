import fakeredis
import pytest

from harness.budget import BudgetExceeded, FileBudget, RedisBudget, TaskBudget


@pytest.fixture(params=["redis", "file"])
def budget(request, tmp_path):
    if request.param == "redis":
        return RedisBudget(fakeredis.FakeRedis(), 1.0)
    return FileBudget(tmp_path / "b.json", 1.0)


def test_reserve_settle_and_cap(budget):
    r1 = budget.reserve(0.6)
    with pytest.raises(BudgetExceeded):
        budget.reserve(0.5)  # 0.6 reserved + 0.5 > 1.0
    budget.settle(r1, 0.2)
    assert budget.spent() == pytest.approx(0.2)
    r2 = budget.reserve(0.7)
    budget.settle(r2, 0.7)
    with pytest.raises(BudgetExceeded):
        budget.reserve(0.2)


def test_settle_is_idempotent(budget):
    r = budget.reserve(0.1)
    budget.settle(r, 0.1)
    budget.settle(r, 0.1)
    assert budget.spent() == pytest.approx(0.1)


def test_unsettled_reservation_keeps_cap_strict(budget):
    budget.reserve(0.9)  # worker crashed mid-call
    with pytest.raises(BudgetExceeded):
        budget.reserve(0.2)


def test_task_budget():
    t = TaskBudget(3.0)
    t.add(2.5)
    assert not t.exhausted
    t.add(0.5)
    assert t.exhausted


def test_from_env_requires_cap(monkeypatch):
    from harness import budget as b

    monkeypatch.delenv("BUDGET_USD_TOTAL", raising=False)
    with pytest.raises(RuntimeError):
        b.from_env()
