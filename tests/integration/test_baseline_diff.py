"""The agent's patch excludes what the image build left behind and includes files it creates."""

from __future__ import annotations

import os

import pytest

from runner.containers import Docker

IMAGE = os.environ.get("FIB_GIT_TEST_IMAGE", "fib-test-git:local")

SETUP = (
    "mkdir -p /testbed && cd /testbed && git init -q && "
    "git config user.email t@t && git config user.name t && "
    "printf 'a\\n' > src.py && printf 'doc\\n' > README && git add . && git commit -qm init && "
    "printf 'build edit\\n' >> README && mkdir -p reports && printf 'old\\n' > reports/out.json"
)


@pytest.mark.docker
async def test_patch_is_relative_to_container_start() -> None:
    docker = Docker()
    if not await docker.ping():
        pytest.skip("no Docker daemon")
    tc = await docker.create(IMAGE, network=False)
    try:
        assert (await tc.exec(SETUP, timeout=60)).ok
        base = await tc.snapshot_baseline()
        assert base.untracked == frozenset({"reports/out.json"})
        agent = (
            "cd /testbed && printf 'b\\n' >> src.py && printf 'new\\n' > helper.py"
            " && printf 'new run\\n' > reports/out.json"
        )
        assert (await tc.exec(agent, timeout=60)).ok
        diff = await tc.agent_diff(base)
    finally:
        await tc.remove()
        docker.close()
    files = sorted(line.split(" b/")[-1] for line in diff.splitlines() if line.startswith("diff --git "))
    assert files == ["helper.py", "src.py"]
    assert "build edit" not in diff
