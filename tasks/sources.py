"""Dataset loaders: Hugging Face parquet exports -> TaskInstance.

Two sources are supported:

* ``SWE-bench-Live/MultiLang`` (primary). One split per language; every row carries its own
  rebuild/test/print commands and a Python ``parser`` function as source text.
* ``nebius/SWE-rebench-leaderboard`` (reserve). Python repositories graded with the standard
  SWE-bench pytest parser; the test command lives in ``install_config.test_cmd``.

Parquet files are downloaded from the dataset's ``refs/convert/parquet`` branch, pinned to the
commit that branch resolves to at download time, and cached under ``work/hf/``.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import IO, Any
from urllib.parse import quote

import httpx
import pyarrow.parquet as pq

from tasks.model import TaskInstance

HF_BASE = "https://huggingface.co/datasets"
PARQUET_REF = "refs/convert/parquet"
DEFAULT_CACHE = Path("work/hf")

MULTILANG = "SWE-bench-Live/MultiLang"
MULTILANG_SPLITS: tuple[str, ...] = ("c", "cpp", "go", "js", "rust", "java", "ts", "cs")

REBENCH = "nebius/SWE-rebench-leaderboard"
REBENCH_SPLIT = "2026_03"

# Marker understood by runner.logparse: grade with the built-in SWE-bench pytest parser.
PYTEST_PARSER = "pytest"


@dataclass(frozen=True)
class ParquetFile:
    """A downloaded parquet shard and the provenance needed to re-fetch exactly it."""

    dataset: str
    split: str
    url: str  # URL on the moving parquet branch
    pinned_url: str  # same file at the resolved commit
    revision: str | None  # commit of refs/convert/parquet
    etag: str | None
    sha256: str
    path: str
    size: int

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def parquet_url(dataset: str, split: str, revision: str = PARQUET_REF) -> str:
    return f"{HF_BASE}/{dataset}/resolve/{quote(revision, safe='')}/default/{split}/0000.parquet"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _strip_quotes(value: str | None) -> str | None:
    return value.strip('"') if value else value


def fetch_parquet(
    dataset: str,
    split: str,
    cache_dir: Path = DEFAULT_CACHE,
    *,
    refresh: bool = False,
    timeout: float = 300.0,
) -> ParquetFile:
    """Download one parquet shard (or reuse the cached copy) and return its provenance."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{dataset.replace('/', '__')}__{split}"
    data_path = cache_dir / f"{stem}.parquet"
    meta_path = cache_dir / f"{stem}.meta.json"
    url = parquet_url(dataset, split)

    if not refresh and data_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("sha256") == _sha256_file(data_path):
            return ParquetFile(**meta)

    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        head = client.head(url)
        if head.status_code not in (200, 301, 302, 307, 308):
            head.raise_for_status()
        revision = head.headers.get("x-repo-commit")
        etag = _strip_quotes(head.headers.get("x-linked-etag") or head.headers.get("etag"))

    pinned = parquet_url(dataset, split, revision) if revision else url
    tmp = data_path.with_suffix(".part")
    with (
        httpx.Client(timeout=timeout, follow_redirects=True) as client,
        client.stream("GET", pinned) as resp,
    ):
        resp.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in resp.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.replace(data_path)

    pf = ParquetFile(
        dataset=dataset,
        split=split,
        url=url,
        pinned_url=pinned,
        revision=revision,
        etag=etag,
        sha256=_sha256_file(data_path),
        path=str(data_path),
        size=data_path.stat().st_size,
    )
    meta_path.write_text(json.dumps(pf.to_json(), indent=2) + "\n")
    return pf


def read_rows(path: str | Path) -> list[dict[str, Any]]:
    return pq.read_table(str(path)).to_pylist()


_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_created_at(value: str) -> str:
    """Return an ISO 8601 UTC timestamp (``YYYY-MM-DDTHH:MM:SSZ``) for the common source formats."""
    v = value.strip()
    if _DATE_ONLY.match(v):
        return v + "T00:00:00Z"
    v = v.replace(" ", "T", 1)
    if v.endswith("+00:00"):
        v = v[: -len("+00:00")] + "Z"
    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$", v):
        v += "Z"
    return v


def _str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            raise ValueError(f"expected a JSON list, got {type(parsed).__name__}")
        return [str(x) for x in parsed]
    return [str(x) for x in value]


def multilang_instance(row: Mapping[str, Any], split: str) -> TaskInstance:
    return TaskInstance(
        instance_id=row["instance_id"],
        source=f"{MULTILANG}:{split}",
        language=split,
        repo=row["repo"],
        base_commit=row["base_commit"],
        created_at=normalize_created_at(row["created_at"]),
        problem_statement=row["problem_statement"],
        patch=row["patch"],
        test_patch=row["test_patch"],
        fail_to_pass=_str_list(row["FAIL_TO_PASS"]),
        pass_to_pass=_str_list(row["PASS_TO_PASS"]),
        docker_image=row["docker_image"],
        rebuild_cmds=_str_list(row.get("rebuild_cmds")),
        test_cmds=_str_list(row.get("test_cmds")),
        print_cmds=_str_list(row.get("print_cmds")),
        log_parser=row["log_parser"],
    )


def rebench_instance(row: Mapping[str, Any], split: str) -> TaskInstance:
    cfg: Mapping[str, Any] = row.get("install_config") or {}
    parser_name = str(cfg.get("log_parser") or "")
    if parser_name != "parse_log_pytest":
        raise ValueError(f"unsupported SWE-rebench log parser {parser_name!r}")
    test_cmd = str(cfg.get("test_cmd") or "").strip()
    if not test_cmd:
        raise ValueError("missing install_config.test_cmd")
    image = row.get("docker_image") or row.get("image_name")
    if not image:
        raise ValueError("missing docker image")
    return TaskInstance(
        instance_id=row["instance_id"],
        source=f"{REBENCH}:{split}",
        language="python",
        repo=row["repo"],
        base_commit=row["base_commit"],
        created_at=normalize_created_at(row["created_at"]),
        problem_statement=row["problem_statement"],
        patch=row["patch"],
        test_patch=row["test_patch"],
        fail_to_pass=_str_list(row["FAIL_TO_PASS"]),
        pass_to_pass=_str_list(row["PASS_TO_PASS"]),
        docker_image=str(image),
        rebuild_cmds=[],
        test_cmds=[test_cmd],
        print_cmds=[],
        log_parser=PYTEST_PARSER,
    )


def load_multilang(path: str | Path, split: str) -> list[TaskInstance]:
    return [multilang_instance(r, split) for r in read_rows(path)]


def load_rebench(path: str | Path, split: str) -> tuple[list[TaskInstance], list[tuple[str, str]]]:
    """Return converted instances and ``(instance_id, reason)`` for rows that were skipped."""
    out: list[TaskInstance] = []
    skipped: list[tuple[str, str]] = []
    for r in read_rows(path):
        try:
            out.append(rebench_instance(r, split))
        except (ValueError, KeyError) as e:
            skipped.append((str(r.get("instance_id")), str(e)))
    return out, skipped


POOL_SUFFIX = ".jsonl.gz"


def pool_path(pools_dir: Path, name: str) -> Path:
    return pools_dir / f"{name}{POOL_SUFFIX}"


def pool_name(path: Path) -> str:
    return path.name.removesuffix(POOL_SUFFIX).removesuffix(".jsonl")


def _open_text(path: Path, mode: str) -> IO[str]:
    if path.suffix == ".gz":
        if "w" in mode:
            # mtime=0 and no file name keep the compressed bytes identical across runs
            raw = gzip.GzipFile(filename="", mode="wb", compresslevel=9, mtime=0, fileobj=path.open("wb"))
            return io.TextIOWrapper(raw, encoding="utf-8", newline="\n")
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8")
    return path.open(mode, encoding="utf-8")


def read_pool(path: str | Path) -> list[TaskInstance]:
    with _open_text(Path(path), "r") as f:
        return [TaskInstance.model_validate_json(line) for line in f if line.strip()]


def write_pool(path: str | Path, instances: Iterable[TaskInstance]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _open_text(p, "w") as f:
        for inst in instances:
            f.write(inst.model_dump_json() + "\n")
