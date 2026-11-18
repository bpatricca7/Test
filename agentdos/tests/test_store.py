import threading

import pytest

from agentdos.store import Conflict, NotFound, Store, StoreError


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store(clock):
    s = Store(":memory:", clock=clock)
    yield s
    s.close()


def kinds(task):
    return [e["kind"] for e in task["events"]]


def test_create_defaults_and_normalization(store):
    t = store.create_task({"title": "  Write docs  ", "tags": "#Docs, writing docs", "priority": "HI"})
    assert t["title"] == "Write docs"
    assert t["status"] == "todo"
    assert t["priority"] == "high"
    assert t["tags"] == ["docs", "writing"]
    assert t["assignee"] is None
    assert t["review"] is True
    assert kinds(t) == ["created"]


@pytest.mark.parametrize("data, message", [
    ({"title": ""}, "title is required"),
    ({"title": "x", "priority": "someday"}, "priority"),
    ({"title": "x", "tags": ["bad tag!"]}, "invalid tag"),
    ({"title": "x", "assignee": "no spaces allowed"}, "invalid assignee"),
    ({"title": "x" * 201}, "too long"),
])
def test_create_validation(store, data, message):
    with pytest.raises(StoreError, match=message):
        store.create_task(data)


def test_assignee_aliases(store):
    assert store.create_task({"title": "a", "assignee": "@me"})["assignee"] == "human"
    assert store.create_task({"title": "b", "assignee": "any"})["assignee"] is None
    assert store.create_task({"title": "c", "assignee": "@claude-1"})["assignee"] == "claude-1"


def test_claim_next_order_and_eligibility(store):
    low = store.create_task({"title": "low", "priority": "low"})
    human = store.create_task({"title": "mine", "priority": "urgent", "assignee": "human"})
    other = store.create_task({"title": "for bot-2", "priority": "urgent", "assignee": "bot-2"})
    normal = store.create_task({"title": "normal"})
    high = store.create_task({"title": "high", "priority": "high"})

    got = [store.claim_next("bot-1")["id"] for _ in range(3)]
    assert got == [high["id"], normal["id"], low["id"]]
    assert store.claim_next("bot-1") is None  # human-only and bot-2 tasks are skipped
    assert store.claim_next("bot-2")["id"] == other["id"]
    assert store.get_task(human["id"])["status"] == "todo"


def test_claim_next_tag_filter(store):
    store.create_task({"title": "write", "tags": ["writing"]})
    code = store.create_task({"title": "code", "tags": ["code", "py"]})
    assert store.claim_next("bot", tags=["code"])["id"] == code["id"]
    assert store.claim_next("bot", tags="code") is None


def test_agents_cannot_be_human(store):
    store.create_task({"title": "x"})
    with pytest.raises(StoreError, match="reserved"):
        store.claim_next("human")


def test_claim_conflicts(store):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1")
    store.claim(t["id"], "bot-1")  # re-claiming your own task just renews the lease
    with pytest.raises(Conflict, match="bot-1"):
        store.claim(t["id"], "bot-2")
    reserved = store.create_task({"title": "y", "assignee": "human"})
    with pytest.raises(Conflict, match="reserved for the human"):
        store.claim(reserved["id"], "bot-2")
    with pytest.raises(NotFound):
        store.claim(999, "bot-2")


def test_concurrent_claims_never_double_assign(tmp_path):
    store = Store(str(tmp_path / "board.db"))
    for i in range(20):
        store.create_task({"title": f"task {i}"})
    claimed, lock = [], threading.Lock()

    def worker(name):
        while True:
            task = store.claim_next(name)
            if task is None:
                return
            with lock:
                claimed.append(task["id"])

    threads = [threading.Thread(target=worker, args=(f"bot-{i}",)) for i in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert sorted(claimed) == list(range(1, 21))
    store.close()


def test_lease_expiry_and_renewal(store, clock):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1", lease_seconds=60)
    clock.t += 50
    store.comment(t["id"], "still going", actor="bot-1")  # progress renews the 60s lease
    clock.t += 50
    assert store.get_task(t["id"])["status"] == "doing"
    clock.t += 11
    task = store.get_task(t["id"])
    assert task["status"] == "todo"
    assert task["claimed_by"] is None
    assert kinds(task)[-1] == "expired"
    assert [e["kind"] for e in task["events"]].count("progress") == 1


def test_heartbeat_requires_ownership(store, clock):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1", lease_seconds=60)
    clock.t += 59
    store.heartbeat(t["id"], "bot-1")
    clock.t += 59
    assert store.get_task(t["id"])["status"] == "doing"
    with pytest.raises(Conflict):
        store.heartbeat(t["id"], "bot-2")


def test_complete_review_approve(store):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1")
    t = store.complete(t["id"], "bot-1", "All done\nmore detail")
    assert t["status"] == "review"
    assert t["result"].startswith("All done")
    assert t["lease_expires"] is None
    t = store.approve(t["id"], "great")
    assert t["status"] == "done"
    assert t["completed_at"] is not None
    with pytest.raises(Conflict):
        store.approve(t["id"])


def test_complete_without_review_goes_to_done(store):
    t = store.create_task({"title": "x", "review": False})
    store.claim(t["id"], "bot-1")
    assert store.complete(t["id"], "bot-1", "ok")["status"] == "done"


def test_reject_sends_back_with_feedback(store):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1")
    store.complete(t["id"], "bot-1", "draft")
    with pytest.raises(StoreError):
        store.reject(t["id"], "")
    t = store.reject(t["id"], "needs tests")
    assert t["status"] == "todo"
    assert t["claimed_by"] is None
    assert t["events"][-1]["message"] == "needs tests"
    assert store.claim_next("bot-2")["id"] == t["id"]


def test_block_and_reply(store):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1")
    t = store.block(t["id"], "bot-1", "Which branch?")
    assert t["status"] == "blocked"
    assert t["question"] == "Which branch?"
    assert store.claim_next("bot-2") is None
    t = store.reply(t["id"], "main")
    assert t["status"] == "todo"
    t = store.claim_next("bot-2")
    assert t["question"] is None
    assert "replied" in kinds(t)


def test_release(store):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1")
    with pytest.raises(Conflict):
        store.release(t["id"], "bot-2")
    t = store.release(t["id"], "bot-1", "no access")
    assert t["status"] == "todo"
    assert t["events"][-1]["message"] == "no access"


def test_late_completion_after_expiry(store, clock):
    t = store.create_task({"title": "x"})
    store.claim(t["id"], "bot-1", lease_seconds=60)
    clock.t += 120
    # Lease lapsed and nobody else took it: the work is still accepted.
    assert store.complete(t["id"], "bot-1", "finished anyway")["status"] == "review"

    t2 = store.create_task({"title": "y"})
    store.claim(t2["id"], "bot-1", lease_seconds=60)
    clock.t += 120
    store.claim(t2["id"], "bot-2")
    with pytest.raises(Conflict, match="held by bot-2"):
        store.complete(t2["id"], "bot-1", "too late")


def test_update_task_and_status_moves(store):
    t = store.create_task({"title": "x"})
    t = store.update_task(t["id"], {"title": "y", "priority": "urgent", "tags": ["a"]})
    assert (t["title"], t["priority"], t["tags"]) == ("y", "urgent", ["a"])
    assert t["events"][-1]["kind"] == "edited"
    t = store.update_task(t["id"], {"status": "doing"})
    assert t["claimed_by"] == "human" and t["lease_expires"] is None
    t = store.update_task(t["id"], {"status": "done"})
    assert t["completed_at"] is not None
    t = store.update_task(t["id"], {"status": "todo"})
    assert t["completed_at"] is None and t["claimed_by"] is None
    with pytest.raises(StoreError, match="unknown field"):
        store.update_task(t["id"], {"colour": "red"})


def test_delete(store):
    t = store.create_task({"title": "bye"})
    store.delete_task(t["id"])
    with pytest.raises(NotFound):
        store.get_task(t["id"])
    last = store.events()[-1]
    assert last["kind"] == "deleted" and "bye" in last["message"]


def test_board_counts_and_agents(store, clock):
    a = store.create_task({"title": "a"})
    store.create_task({"title": "b"})
    store.claim(a["id"], "bot-1")
    store.seen("bot-2")
    board = store.board()
    assert board["counts"]["todo"] == 1 and board["counts"]["doing"] == 1
    agents = {x["name"]: x for x in board["agents"]}
    assert agents["bot-1"]["state"] == "working" and agents["bot-1"]["tasks"] == [a["id"]]
    assert agents["bot-2"]["state"] == "idle"
    clock.t += 3600
    agents = {x["name"]: x for x in store.agents()}
    assert agents["bot-2"]["state"] == "offline"


def test_version_bumps_wake_waiters(store):
    v = store.version
    threading.Timer(0.05, lambda: store.create_task({"title": "x"})).start()
    assert store.wait_for_change(v, timeout=2) > v
