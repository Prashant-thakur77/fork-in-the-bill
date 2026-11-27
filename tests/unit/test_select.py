from __future__ import annotations

import json
import random
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from tasks import select_tasks
from tasks.model import TaskInstance
from tasks.select_tasks import PoolSizes, Stratum, select_pools
from tasks.sources import (
    ParquetFile,
    multilang_instance,
    normalize_created_at,
    read_pool,
    rebench_instance,
)


def _patch(files: int, lines: int) -> str:
    out: list[str] = []
    for f in range(files):
        out += [f"diff --git a/f{f} b/f{f}", f"--- a/f{f}", f"+++ b/f{f}", "@@ -1 +1 @@"]
        out += ["+x"] * (lines // files)
    return "\n".join(out) + "\n"


def make(
    iid: str,
    lang: str = "rust",
    date: str = "2026-04-01",
    *,
    files: int = 1,
    lines: int = 4,
    problem: str = "bug",
) -> TaskInstance:
    return TaskInstance(
        instance_id=iid,
        source=f"SWE-bench-Live/MultiLang:{lang}",
        language=lang,
        repo="o/r",
        base_commit="abc",
        created_at=f"{date}T00:00:00Z",
        problem_statement=problem,
        patch=_patch(files, lines),
        test_patch="",
        fail_to_pass=["t1"],
        pass_to_pass=["t2"],
        docker_image="img",
        rebuild_cmds=[],
        test_cmds=["true"],
        print_cmds=["true"],
        log_parser="def parser(log):\n    return {}\n",
    )


def corpus() -> list[TaskInstance]:
    pre = [make(f"o__pre-{i:03d}", ("rust", "java", "c")[i % 3], "2026-04-15") for i in range(60)]
    fresh = [make(f"o__fresh-{i:03d}", "java", "2026-08-01") for i in range(20)]
    old = [make(f"o__old-{i:03d}", "go", "2025-12-01") for i in range(5)]
    return pre + fresh + old


SIZES = PoolSizes(pilot=5, rollout=7, exp2=30, exp1=None)


def ids(sel: select_tasks.Selection) -> dict[str, list[str]]:
    return {k: [i.instance_id for i in v] for k, v in sel.pools.items()}


def test_deterministic_and_input_order_independent() -> None:
    insts = corpus()
    a = ids(select_pools(insts, seed=7, sizes=SIZES))
    shuffled = insts[:]
    random.Random(1).shuffle(shuffled)
    b = ids(select_pools(shuffled, seed=7, sizes=SIZES))
    assert a == b
    c = ids(select_pools(insts, seed=8, sizes=SIZES))
    assert a != c


def test_pools_are_disjoint_and_sized() -> None:
    sel = select_pools(corpus(), seed=1, sizes=SIZES)
    p = ids(sel)
    assert len(p["pilot"]) == 5
    assert len(p["rollout"]) == 7
    assert len(p["exp2"]) == 30
    assert len(p["exp1"]) == 20
    all_ids = [i for v in p.values() for i in v]
    assert len(all_ids) == len(set(all_ids))
    assert all(i.startswith("o__fresh") for i in p["exp1"])
    assert all(i.startswith("o__pre") for k in ("pilot", "rollout", "exp2") for i in p[k])
    assert sel.excluded["older_than_pre_tier"] == 5


def test_exp2_takes_the_remainder_and_exp1_cap() -> None:
    sel = select_pools(corpus(), seed=1, sizes=PoolSizes(pilot=10, rollout=10, exp2=999, exp1=4))
    assert len(sel.pools["exp2"]) == 40
    assert len(sel.pools["exp1"]) == 4


def test_language_filter() -> None:
    sel = select_pools(corpus(), seed=1, sizes=SIZES, languages=frozenset({"java"}))
    assert {i.language for v in sel.pools.values() for i in v} == {"java"}
    assert sel.excluded["language:rust"] == 20


def test_stratum_filter() -> None:
    insts = [
        make("a__ok-1", files=1, lines=10),
        make("a__ok-2", files=2, lines=40),
        make("a__files-3", files=3, lines=6),
        make("a__lines-4", files=1, lines=41),
        make("a__text-5", problem="x" * 12_001),
    ]
    sel = select_pools(insts, seed=1, sizes=PoolSizes(pilot=10, rollout=0, exp2=0))
    assert sorted(i.instance_id for i in sel.pools["pilot"]) == ["a__ok-1", "a__ok-2"]
    assert sel.excluded["stratum:gold_files"] == 1
    assert sel.excluded["stratum:gold_lines"] == 1
    assert sel.excluded["stratum:problem_chars"] == 1
    loose = select_pools(insts, seed=1, sizes=PoolSizes(pilot=10, rollout=0, exp2=0), stratum=None)
    assert len(loose.pools["pilot"]) == 5
    assert Stratum().to_json()["max_gold_lines"] == 40


def test_duplicate_ids_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        select_pools([make("a__x-1"), make("a__x-1")], seed=1)


def test_reserve_pool_is_separate() -> None:
    reserve = [make(f"r__py-{i}", "python", "2026-03-10") for i in range(6)]
    sel = select_pools(corpus(), seed=1, sizes=SIZES, reserve=reserve)
    assert len(sel.pools["reserve"]) == 6
    assert sel.tiers["reserve"] == 6


def test_normalize_created_at() -> None:
    assert normalize_created_at("2026-07-09T12:49:42Z") == "2026-07-09T12:49:42Z"
    assert normalize_created_at("2026-03-22 09:18:02") == "2026-03-22T09:18:02Z"
    assert normalize_created_at("2026-03-22T09:18:02+00:00") == "2026-03-22T09:18:02Z"
    assert normalize_created_at("2026-03-22") == "2026-03-22T00:00:00Z"


MULTILANG_ROW = {
    "repo": "o/r",
    "pull_number": "1",
    "instance_id": "o__r-1",
    "base_commit": "abc",
    "patch": _patch(1, 2),
    "test_patch": "tp",
    "problem_statement": "ps",
    "created_at": "2026-07-03T01:02:03Z",
    "rebuild_cmds": ["cargo build"],
    "test_cmds": ["cargo test"],
    "print_cmds": ["cat log"],
    "log_parser": "def parser(log):\n    return {}\n",
    "FAIL_TO_PASS": ["a"],
    "PASS_TO_PASS": ["b", "c"],
    "docker_image": "starryzhang/sweb.eval.x86_64.o_1776_r-1",
}


def test_multilang_adapter() -> None:
    inst = multilang_instance(MULTILANG_ROW, "rust")
    assert inst.language == "rust"
    assert inst.source == "SWE-bench-Live/MultiLang:rust"
    assert inst.print_cmds == ["cat log"]
    assert inst.pass_to_pass == ["b", "c"]


def test_rebench_adapter_json_strings() -> None:
    row = {
        "repo": "p/q",
        "instance_id": "p__q-9",
        "base_commit": "def",
        "patch": "x",
        "test_patch": "y",
        "problem_statement": "z",
        "created_at": "2026-03-22 09:18:02",
        "install_config": {"log_parser": "parse_log_pytest", "test_cmd": "pytest -rA t.py"},
        "FAIL_TO_PASS": '["t.py::a"]',
        "PASS_TO_PASS": "[]",
        "docker_image": None,
        "image_name": "swerebench/sweb.eval.x86_64.p_1776_q-9:latest",
    }
    inst = rebench_instance(row, "2026_03")
    assert inst.fail_to_pass == ["t.py::a"]
    assert inst.pass_to_pass == []
    assert inst.log_parser == "pytest"
    assert inst.test_cmds == ["pytest -rA t.py"]
    assert inst.print_cmds == []
    assert inst.docker_image.startswith("swerebench/")
    with pytest.raises(ValueError):
        rebench_instance({**row, "install_config": {"log_parser": "parse_log_other"}}, "s")


def test_main_writes_pools_and_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    rows = []
    for i in range(30):
        date = "2026-08-01T00:00:00Z" if i < 10 else "2026-04-01T00:00:00Z"
        rows.append({**MULTILANG_ROW, "instance_id": f"o__r-{i}", "created_at": date})
    pq_path = tmp_path / "rust.parquet"
    pq.write_table(pa.Table.from_pylist(rows), pq_path)

    def fake_fetch(dataset: str, split: str, cache_dir: Path, *, refresh: bool = False) -> ParquetFile:
        return ParquetFile(dataset, split, "u", "pu", "rev123", "etag", "sha", str(pq_path), 1)

    monkeypatch.setattr(select_tasks, "fetch_parquet", fake_fetch)
    out = tmp_path / "pools"
    argv = ["--seed", "3", "--languages", "rust", "--no-reserve", "--out-dir", str(out)]
    argv += ["--pilot", "4", "--rollout", "5", "--exp2", "100"]
    assert select_tasks.main(argv) == 0
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["seed"] == 3
    assert manifest["sources"][0]["revision"] == "rev123"
    assert manifest["params"]["stratum"]["max_gold_lines"] == 40
    assert manifest["pools"]["exp1"]["count"] == 10
    assert manifest["pools"]["exp2"]["count"] == 11
    assert len(read_pool(out / "pilot.jsonl.gz")) == 4
    assert (out / "pilot.txt").read_text().count("\n") == 4
    first = (out / "exp2.jsonl.gz").read_bytes()
    assert select_tasks.main(argv) == 0
    assert (out / "exp2.jsonl.gz").read_bytes() == first


def test_apply_drops_invalid_and_logs(tmp_path: Path) -> None:
    from tasks.sources import write_pool
    from tasks.validate import apply_report, merge_entry

    pools = tmp_path / "pools"
    write_pool(pools / "pilot.jsonl.gz", [make("a__1"), make("a__2"), make("a__3")])
    (pools / "manifest.json").write_text(json.dumps({"seed": 1, "pools": {"pilot": {"count": 3}}}))
    report = tmp_path / "report.json"
    merge_entry(report, "a__1", {"valid": True, "reason": None})
    merge_entry(report, "a__2", {"valid": False, "reason": "gold:p2p_broken:1fail/0missing"})
    assert apply_report(["pilot"], report, pools) == 0
    assert [i.instance_id for i in read_pool(pools / "pilot.jsonl.gz")] == ["a__1", "a__3"]
    assert (pools / "pilot.txt").read_text() == "a__1\na__3\n"
    dropped = [json.loads(x) for x in (pools / "dropped.jsonl").read_text().splitlines()]
    assert dropped[0]["instance_id"] == "a__2"
    assert dropped[0]["reason"].startswith("gold:")
    manifest = json.loads((pools / "manifest.json").read_text())
    assert manifest["pools"]["pilot"]["count"] == 2
    assert manifest["pools"]["pilot"]["unvalidated"] == 1


def test_f2p_passing_before_gold_is_not_disqualifying() -> None:
    from tasks.validate import is_valid

    assert is_valid({"valid": False, "reason": "f2p_pass_before_gold:1"})
    assert not is_valid({"valid": False, "reason": "f2p_pass_before_gold:1;gold:f2p_not_passing:0fail/2missing"})
    assert not is_valid({"valid": False, "reason": "gold:p2p_broken:5fail/0missing"})
    assert is_valid({"valid": True, "reason": None})


def test_exp1b_extension_leaves_other_pools_unchanged() -> None:
    insts = corpus()
    base = select_pools(insts, seed=7, sizes=PoolSizes(pilot=2, rollout=2, exp2=3, exp1=None))
    ext = select_pools(insts, seed=7, sizes=PoolSizes(pilot=2, rollout=2, exp2=3, exp1=None, exp1b=2))
    for name in ("pilot", "rollout", "exp2", "exp1"):
        assert [i.instance_id for i in ext.pools[name]] == [i.instance_id for i in base.pools[name]]
    taken = {i.instance_id for n, p in ext.pools.items() if n != "exp1b" for i in p}
    assert ext.pools["exp1b"] and not taken & {i.instance_id for i in ext.pools["exp1b"]}


def test_exp2b_extension_leaves_other_pools_unchanged() -> None:
    insts = corpus()
    sizes = {"pilot": 2, "rollout": 2, "exp2": 3, "exp1": None, "exp1b": 2}
    base = select_pools(insts, seed=7, sizes=PoolSizes(**sizes))
    ext = select_pools(insts, seed=7, sizes=PoolSizes(**sizes, exp2b=50))
    for name in ("pilot", "rollout", "exp2", "exp1", "exp1b"):
        assert [i.instance_id for i in ext.pools[name]] == [i.instance_id for i in base.pools[name]]
    taken = {i.instance_id for n, p in ext.pools.items() if n not in ("exp2b", "reserve") for i in p}
    assert ext.pools["exp2b"] and not taken & {i.instance_id for i in ext.pools["exp2b"]}


def test_pool_lengths_read_gzip_and_lists(tmp_path: Path) -> None:

    from analysis.analyse import load_pool_lengths
    from tasks.sources import write_pool

    write_pool(tmp_path / "a.jsonl.gz", [make("x1", problem="abc")])
    write_pool(tmp_path / "b.jsonl.gz", [make("x2", problem="abcdef")])
    run = tmp_path / "run"
    run.mkdir()
    both = [str(tmp_path / "a.jsonl.gz"), str(tmp_path / "b.jsonl.gz")]
    (run / "meta.json").write_text(json.dumps({"pool_file": both}))
    assert load_pool_lengths(run, tmp_path) == {"x1": 3, "x2": 6}
    (run / "meta.json").write_text(json.dumps({"pool_file": str(tmp_path / "a.jsonl.gz")}))
    assert load_pool_lengths(run, tmp_path) == {"x1": 3}
