"""Docker-backed tests for runner.containers. Skipped when no Docker daemon is reachable.

The image (default ``bash:5.2``, override with ``FIB_TEST_IMAGE``) is pulled once if missing.
"""

from __future__ import annotations

import os

import pytest

docker = pytest.importorskip("docker")


def _docker_available() -> bool:
    try:
        client = docker.from_env(timeout=5)
        client.ping()
        client.close()
        return True
    except Exception:
        return False


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not _docker_available(), reason="Docker daemon not available"),
]

from runner.containers import TIMEOUT_EXIT_CODE, Docker, Limits  # noqa: E402

IMAGE = os.environ.get("FIB_TEST_IMAGE", "bash:5.2")
LIMITS = Limits(cpus=1, mem="256m", pids=256)


@pytest.fixture
async def dk() -> Docker:
    d = Docker()
    await d.pull(IMAGE, max_attempts=2, base_delay=5)
    return d


async def test_pull_records_digest(dk: Docker) -> None:
    res = await dk.pull(IMAGE)
    assert res.pulled is False
    assert res.digest is None or "@sha256:" in res.digest
    assert res.size_bytes > 0


async def test_exec_files_state_and_network(dk: Docker) -> None:
    tc = await dk.create(IMAGE, name="it-exec", limits=LIMITS, workdir="/tmp")
    try:
        r = await tc.exec("echo hello; exit 3", timeout=30)
        assert r.exit_code == 3
        assert "hello" in r.output
        assert not r.timed_out

        await tc.write_file("/work/a/b.txt", "payload\n")
        assert await tc.read_file("/work/a/b.txt") == b"payload\n"
        r = await tc.exec("cat b.txt", timeout=30, workdir="/work/a")
        assert r.output.strip() == "payload"

        # cwd and exported variables persist across keep_state calls
        await tc.exec("cd /work; export FIB_X=42", timeout=30, keep_state=True)
        r = await tc.exec('echo "$PWD $FIB_X"', timeout=30, keep_state=True)
        assert r.output.strip() == "/work 42"

        # network is disabled by default: only loopback exists
        r = await tc.exec("ls /sys/class/net", timeout=30)
        assert r.output.split() == ["lo"]
        await tc.set_network(True)
        r = await tc.exec("ls /sys/class/net", timeout=30)
        assert "eth0" in r.output.split()
        await tc.set_network(False)
        r = await tc.exec("ls /sys/class/net", timeout=30)
        assert r.output.split() == ["lo"]
    finally:
        await tc.remove()


async def test_exec_timeout_kills_process_tree(dk: Docker) -> None:
    tc = await dk.create(IMAGE, name="it-timeout", limits=LIMITS, workdir="/tmp")
    try:
        r = await tc.exec("sleep 300 & sleep 300; echo never", timeout=2)
        assert r.timed_out
        assert r.exit_code == TIMEOUT_EXIT_CODE
        assert r.seconds < 30
        assert "never" not in r.output
        ps = await tc.exec("ps -o comm | grep -c '^sleep' || true", timeout=30)
        assert ps.output.strip() == "0"
    finally:
        await tc.remove()


async def test_output_truncation(dk: Docker) -> None:
    tc = await dk.create(IMAGE, name="it-trunc", limits=LIMITS, workdir="/tmp")
    try:
        r = await tc.exec("seq 1 100000", timeout=30, max_output=2000)
        assert r.truncated
        assert r.output.startswith("1\n2\n")
        assert r.output.rstrip().endswith("100000")
        assert "bytes truncated" in r.output
    finally:
        await tc.remove()


async def test_git_diff(dk: Docker) -> None:
    tc = await dk.create(IMAGE, name="it-git", limits=LIMITS, network=True, workdir="/")
    try:
        r = await tc.exec("command -v git || apk add --no-cache git >/dev/null", timeout=180)
        if r.exit_code != 0:
            pytest.skip("git not available in test image")
        setup = (
            "mkdir -p /testbed && cd /testbed && git init -q && "
            "git config user.email t@t && git config user.name t && "
            "echo one > f.txt && git add . && git commit -qm init && echo two >> f.txt"
        )
        assert (await tc.exec(setup, timeout=60, workdir="/")).ok
        diff = await tc.git_diff()
        assert diff.startswith("diff --git a/f.txt b/f.txt")
        assert "+two" in diff
    finally:
        await tc.remove()
