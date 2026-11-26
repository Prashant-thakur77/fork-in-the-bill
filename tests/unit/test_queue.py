import fakeredis

from runner.queue import TaskQueue


def test_enqueue_is_idempotent_and_complete_once():
    r = fakeredis.FakeRedis()
    q = TaskQueue(r, "t", consumer="c1")
    assert q.enqueue(["a", "b"]) == 2
    assert q.enqueue(["a"]) == 0
    lease = q.lease(block_ms=10)
    assert lease is not None and lease.instance_id == "a" and lease.attempt == 1
    assert q.complete(lease, "swelive:a") is True
    assert q.complete(lease, "swelive:a") is False
    assert q.is_done("swelive:a")


def test_requeue_counts_attempts():
    r = fakeredis.FakeRedis()
    q = TaskQueue(r, "t", consumer="c1")
    q.enqueue(["a"])
    lease = q.lease(block_ms=10)
    assert lease is not None
    q.requeue(lease)
    again = q.lease(block_ms=10)
    assert again is not None and again.instance_id == "a" and again.attempt == 2
