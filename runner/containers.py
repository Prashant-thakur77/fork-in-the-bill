"""Async-friendly wrapper around the Docker SDK for task containers.

Every blocking SDK call runs in a worker thread (``asyncio.to_thread``), so many containers can
be driven from one event loop. Containers mirror the SWE-bench-Live runtime: started from the
instance image with ``/bin/bash`` on a TTY, ``TERM=xterm-mono``, working directory ``/testbed``.
Commands run through ``bash -ic`` so the image's ``~/.bashrc`` (PATH, toolchains) applies, as it
does in the official interactive session.

Networking: containers are created on the default bridge and, unless ``network=True``, are
disconnected right after start. ``set_network`` reconnects or disconnects later (grading uses it
to allow dependency downloads during the rebuild step only).
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import random
import re
import shlex
import tarfile
import threading
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import docker
import docker.errors
from docker.models.containers import Container

from runner.logparse import clean_terminal_output

LABEL = "fork-in-the-bill"
WORKDIR = "/testbed"
STATE_DIR = "/tmp/.fib"
TIMEOUT_EXIT_CODE = 124
DEFAULT_MAX_OUTPUT = 64 * 1024

# The SWE-bench-Live README's command for collecting a prediction patch (the repo is /testbed,
# or rarely a git checkout one level below it), plus `git add -N` so files the agent created are
# part of the patch. Untracked files would otherwise be dropped; .gitignore'd build output is not added.
GIT_DIFF_CMD = (
    "cd /testbed; "
    "[ -d .git ] || { g=$(find . -maxdepth 2 -mindepth 2 -type d -name .git -print -quit); "
    '[ -n "$g" ] && cd "${g%/.git}"; } ; '
    "git add -N -- . >/dev/null 2>&1; "
    "git --no-pager diff HEAD --text"
)
REPO_ROOT_CMD = (
    "cd /testbed; "
    "[ -d .git ] || { g=$(find . -maxdepth 2 -mindepth 2 -type d -name .git -print -quit); "
    '[ -n "$g" ] && cd "${g%/.git}"; } ; pwd'
)


@dataclass(frozen=True)
class Limits:
    cpus: float = 4.0
    mem: str = "12g"
    pids: int | None = 4096


@dataclass(frozen=True)
class ExecResult:
    exit_code: int | None
    output: str
    timed_out: bool
    truncated: bool
    seconds: float
    total_bytes: int

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


@dataclass(frozen=True)
class PullResult:
    image: str
    digest: str | None  # repo digest, e.g. "starryzhang/...@sha256:..."
    image_id: str
    size_bytes: int
    pulled: bool  # False when the image was already present
    attempts: int
    seconds: float


@dataclass
class PullStats:
    pulls: int = 0
    cached: int = 0
    rate_limited: int = 0
    failures: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def bump(self, name: str) -> None:
        with self._lock:
            setattr(self, name, getattr(self, name) + 1)

    def as_dict(self) -> dict[str, int]:
        return {
            "pulls": self.pulls,
            "cached": self.cached,
            "rate_limited": self.rate_limited,
            "failures": self.failures,
        }


class PullError(RuntimeError):
    pass


def split_image_ref(ref: str) -> tuple[str, str | None]:
    """``repo[:tag][@digest]`` -> (repo, tag or digest)."""
    if "@" in ref:
        repo, digest = ref.split("@", 1)
        return repo, digest
    last = ref.rsplit("/", 1)[-1]
    if ":" in last:
        repo, tag = ref.rsplit(":", 1)
        return repo, tag
    return ref, "latest"


def _is_rate_limit(err: Exception) -> bool:
    text = str(err).lower()
    return "toomanyrequests" in text or "429" in text or "rate limit" in text


class _HeadTail:
    """Keeps the first and last ``limit // 2`` bytes of a stream."""

    def __init__(self, limit: int | None) -> None:
        self.limit = limit
        self.head = bytearray()
        self.tail = bytearray()
        self.total = 0

    def add(self, chunk: bytes) -> None:
        self.total += len(chunk)
        if self.limit is None:
            self.head += chunk
            return
        half = self.limit // 2
        room = half - len(self.head)
        if room > 0:
            self.head += chunk[:room]
            chunk = chunk[room:]
        if chunk:
            self.tail += chunk
            if len(self.tail) > half:
                del self.tail[: len(self.tail) - half]

    @property
    def truncated(self) -> bool:
        return self.limit is not None and self.total > len(self.head) + len(self.tail)

    def text(self) -> str:
        head = self.head.decode("utf-8", errors="replace")
        if not self.truncated:
            return head + self.tail.decode("utf-8", errors="replace")
        dropped = self.total - len(self.head) - len(self.tail)
        tail = self.tail.decode("utf-8", errors="replace")
        return f"{head}\n... [{dropped} bytes truncated] ...\n{tail}"


def _wrap_command(cmd: str, workdir: str, token: str, keep_state: bool) -> str:
    """Script run under ``bash -ic``.

    Records the shell's PID (for timeout kills). With ``keep_state`` the working directory and
    exported variables persist between calls, like consecutive commands in one interactive
    session (the official harness sends rebuild, test and print commands to a single shell).
    """
    state = f"{STATE_DIR}/state.sh"
    lines = [
        f"mkdir -p {STATE_DIR}; echo $$ > {STATE_DIR}/{token}.pid",
        f"cd {shlex.quote(workdir)}",
    ]
    if keep_state:
        lines += [
            f"[ -f {state} ] && . {state} >/dev/null 2>&1",
            f'__fib_save() {{ {{ echo "cd $(printf %q "$PWD")"; export -p; }} > {state}.tmp '
            f"2>/dev/null && mv -f {state}.tmp {state}; }}",
            "trap __fib_save EXIT",
        ]
    lines.append(cmd)
    return "\n".join(lines)


def _kill_session_script(token: str) -> str:
    pid_file = f"{STATE_DIR}/{token}.pid"
    return (
        f"sid=$(cat {pid_file} 2>/dev/null) || exit 0; "
        "kill -9 $sid 2>/dev/null; "
        "for d in /proc/[0-9]*; do "
        's=$(sed "s/.*) //" "$d/stat" 2>/dev/null | cut -d" " -f4); '
        '[ "$s" = "$sid" ] && kill -9 "${d#/proc/}" 2>/dev/null; '
        "done; true"
    )


class TaskContainer:
    def __init__(self, docker_: Docker, container: Container, image: str, workdir: str) -> None:
        self._docker = docker_
        self._c = container
        self.image = image
        self.workdir = workdir
        self.id: str = container.id or ""
        self.name: str = container.name or ""
        self._removed = False

    # -- exec -------------------------------------------------------------------------------

    def exec_sync(
        self,
        cmd: str,
        *,
        timeout: float,
        workdir: str | None = None,
        max_output: int | None = DEFAULT_MAX_OUTPUT,
        keep_state: bool = False,
        env: Mapping[str, str] | None = None,
    ) -> ExecResult:
        api = self._docker.client.api
        token = uuid.uuid4().hex[:12]
        script = _wrap_command(cmd, workdir or self.workdir, token, keep_state)
        exec_id = api.exec_create(
            self.id,
            ["bash", "-ic", script],
            tty=True,
            stdin=False,
            environment=dict(env) if env else None,
            workdir=workdir or self.workdir,
        )["Id"]
        buf = _HeadTail(max_output)
        timed_out = threading.Event()
        finished = threading.Event()

        def last_resort() -> None:
            # The in-container kill did not end the stream: stop the whole container.
            if not finished.is_set():
                with contextlib.suppress(docker.errors.DockerException):
                    self._c.kill()

        backstop = threading.Timer(60, last_resort)

        def on_timeout() -> None:
            timed_out.set()
            backstop.start()
            try:
                kill_id = api.exec_create(self.id, ["sh", "-c", _kill_session_script(token)])
                api.exec_start(kill_id["Id"])
            except docker.errors.DockerException:
                pass

        timer = threading.Timer(timeout, on_timeout)
        started = time.monotonic()
        timer.start()
        try:
            stream: Any = api.exec_start(exec_id, stream=True, tty=True)
            for chunk in stream:
                buf.add(chunk)
        finally:
            finished.set()
            timer.cancel()
            backstop.cancel()
        info = api.exec_inspect(exec_id)
        code = info.get("ExitCode")
        if info.get("Running"):
            code = None
        if timed_out.is_set():
            code = TIMEOUT_EXIT_CODE
        return ExecResult(
            exit_code=code,
            output=clean_terminal_output(buf.text()),
            timed_out=timed_out.is_set(),
            truncated=buf.truncated,
            seconds=time.monotonic() - started,
            total_bytes=buf.total,
        )

    async def exec(
        self,
        cmd: str,
        *,
        timeout: float,
        workdir: str | None = None,
        max_output: int | None = DEFAULT_MAX_OUTPUT,
        keep_state: bool = False,
        env: Mapping[str, str] | None = None,
    ) -> ExecResult:
        """Run ``cmd`` with bash in the container; output is head+tail truncated to ``max_output``
        bytes (``None`` keeps everything). On timeout every process of the command is killed and
        ``exit_code`` is 124."""
        return await asyncio.to_thread(
            self.exec_sync,
            cmd,
            timeout=timeout,
            workdir=workdir,
            max_output=max_output,
            keep_state=keep_state,
            env=env,
        )

    # -- files ------------------------------------------------------------------------------

    def _write_file_sync(self, path: str, content: str | bytes, mode: int) -> None:
        if not path.startswith("/"):
            raise ValueError("container path must be absolute")
        data = content.encode("utf-8") if isinstance(content, str) else content
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            info = tarfile.TarInfo(name=path.lstrip("/"))
            info.size = len(data)
            info.mode = mode
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
        self._c.put_archive("/", stream.getvalue())

    async def write_file(self, path: str, content: str | bytes, mode: int = 0o644) -> None:
        await asyncio.to_thread(self._write_file_sync, path, content, mode)

    def _read_file_sync(self, path: str) -> bytes:
        bits, _ = self._c.get_archive(path)
        raw = b"".join(bits)
        with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
            member = tar.next()
            if member is None or not member.isfile():
                raise FileNotFoundError(path)
            f = tar.extractfile(member)
            if f is None:
                raise FileNotFoundError(path)
            return f.read()

    async def read_file(self, path: str) -> bytes:
        return await asyncio.to_thread(self._read_file_sync, path)

    # -- git --------------------------------------------------------------------------------

    async def git_diff(self, timeout: float = 120.0) -> str:
        """The agent's patch, collected exactly as the SWE-bench-Live README specifies."""
        res = await self.exec(GIT_DIFF_CMD, timeout=timeout, max_output=None, workdir=WORKDIR)
        if not res.ok:
            raise RuntimeError(f"git diff failed ({res.exit_code}): {res.output[-2000:]}")
        diff = res.output
        start = diff.find("diff --git ")
        return diff[start:] if start >= 0 else ""

    async def repo_root(self) -> str:
        res = await self.exec(REPO_ROOT_CMD, timeout=60, workdir=WORKDIR)
        lines = [ln.strip() for ln in res.output.splitlines() if ln.strip().startswith("/")]
        return lines[-1] if lines else WORKDIR

    # -- network ----------------------------------------------------------------------------

    def _set_network_sync(self, enabled: bool) -> None:
        net = self._docker.client.networks.get(self._docker.network_name)
        self._c.reload()
        attached = self._docker.network_name in (self._c.attrs.get("NetworkSettings", {}).get("Networks") or {})
        if enabled and not attached:
            net.connect(self._c)
        elif not enabled and attached:
            net.disconnect(self._c, force=True)

    async def set_network(self, enabled: bool) -> None:
        await asyncio.to_thread(self._set_network_sync, enabled)

    # -- lifecycle --------------------------------------------------------------------------

    def remove_sync(self) -> None:
        if self._removed:
            return
        with contextlib.suppress(docker.errors.NotFound):
            self._c.remove(force=True, v=True)
        self._removed = True

    async def remove(self) -> None:
        await asyncio.to_thread(self.remove_sync)

    async def __aenter__(self) -> TaskContainer:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.remove()


class Docker:
    """Thin async facade over ``docker.DockerClient``."""

    def __init__(
        self,
        client: docker.DockerClient | None = None,
        *,
        network_name: str = "bridge",
        timeout: int = 3600,
    ) -> None:
        self.client = client or docker.from_env(timeout=timeout)
        self.network_name = network_name
        self.pull_stats = PullStats()
        self._pull_locks: dict[str, asyncio.Lock] = {}

    # -- images -----------------------------------------------------------------------------

    def _image_info(self, ref: str) -> tuple[str | None, str, int]:
        img = self.client.images.get(ref)
        digests: list[str] = img.attrs.get("RepoDigests") or []
        repo = split_image_ref(ref)[0]
        digest = next((d for d in digests if d.split("@")[0] == repo), None)
        if digest is None and digests:
            digest = digests[0]
        return digest, img.id or "", int(img.attrs.get("Size") or 0)

    def _pull_sync(self, ref: str, max_attempts: int, base_delay: float, max_delay: float) -> PullResult:
        started = time.monotonic()
        try:
            digest, image_id, size = self._image_info(ref)
            self.pull_stats.bump("cached")
            return PullResult(ref, digest, image_id, size, False, 0, 0.0)
        except docker.errors.ImageNotFound:
            pass
        repo, tag = split_image_ref(ref)
        attempt = 0
        while True:
            attempt += 1
            try:
                for _ in self.client.api.pull(repo, tag=tag, stream=True, decode=True):
                    pass
                self.pull_stats.bump("pulls")
                digest, image_id, size = self._image_info(ref)
                return PullResult(ref, digest, image_id, size, True, attempt, time.monotonic() - started)
            except (docker.errors.APIError, docker.errors.ImageNotFound) as e:
                limited = _is_rate_limit(e)
                if limited:
                    self.pull_stats.bump("rate_limited")
                not_found = isinstance(e, docker.errors.NotFound) and not limited
                if not_found or attempt >= max_attempts:
                    self.pull_stats.bump("failures")
                    raise PullError(f"pull {ref} failed after {attempt} attempt(s): {e}") from e
                delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
                if not limited:
                    delay = min(delay, 30.0)
                time.sleep(delay * (0.8 + 0.4 * random.random()))

    async def pull(
        self,
        ref: str,
        *,
        max_attempts: int = 6,
        base_delay: float = 60.0,
        max_delay: float = 1800.0,
    ) -> PullResult:
        """Pull ``ref`` unless present; retry with exponential backoff (long on HTTP 429)."""
        lock = self._pull_locks.setdefault(ref, asyncio.Lock())
        async with lock:
            return await asyncio.to_thread(self._pull_sync, ref, max_attempts, base_delay, max_delay)

    async def remove_image(self, ref: str) -> bool:
        def run() -> bool:
            try:
                self.client.images.remove(ref, force=True)
                return True
            except docker.errors.ImageNotFound:
                return False

        return await asyncio.to_thread(run)

    # -- containers -------------------------------------------------------------------------

    def _create_sync(
        self,
        image: str,
        name: str | None,
        limits: Limits,
        network: bool,
        workdir: str,
        env: Mapping[str, str] | None,
        labels: Mapping[str, str] | None,
    ) -> TaskContainer:
        safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", name or "task")[:80]
        container = self.client.containers.run(
            image,
            command="bash",
            name=f"fib-{safe}-{uuid.uuid4().hex[:6]}",
            detach=True,
            tty=True,
            stdin_open=True,
            working_dir=workdir,
            environment={"TERM": "xterm-mono", **(env or {})},
            labels={LABEL: "1", **(labels or {})},
            nano_cpus=int(limits.cpus * 1e9),
            mem_limit=limits.mem,
            memswap_limit=limits.mem,
            pids_limit=limits.pids,
            network=self.network_name,
        )
        tc = TaskContainer(self, container, image, workdir)
        try:
            container.reload()
            if container.status != "running":
                logs = container.logs(tail=20).decode("utf-8", errors="replace")
                raise RuntimeError(f"container exited on start ({container.status}): {logs}")
            if not network:
                tc._set_network_sync(False)
        except Exception:
            tc.remove_sync()
            raise
        return tc

    async def create(
        self,
        image: str,
        *,
        name: str | None = None,
        limits: Limits = Limits(),
        network: bool = False,
        workdir: str = WORKDIR,
        env: Mapping[str, str] | None = None,
        labels: Mapping[str, str] | None = None,
    ) -> TaskContainer:
        return await asyncio.to_thread(self._create_sync, image, name, limits, network, workdir, env, labels)

    async def ping(self) -> bool:
        try:
            return bool(await asyncio.to_thread(self.client.ping))
        except docker.errors.DockerException:
            return False

    def close(self) -> None:
        self.client.close()
