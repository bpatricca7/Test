import http.client
import json
import threading
import time
from urllib.parse import urlsplit

import pytest

from agentdos.client import ApiError, Client


def raw(url, method, path, body=None, headers=None):
    """Plain http.client request so tests control every header."""
    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=5)
    conn.request(method, path, body=body, headers=headers or {})
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, dict(resp.getheaders()), data


def test_full_agent_workflow(make_server):
    _, url = make_server()
    human = Client(url)
    bot = Client(url, agent="bot-1")

    t = human.create("Ship it", "do the thing", priority="high", tags=["code"])
    assert bot.next(tags=["writing"]) is None
    claimed = bot.next(tags=["code"])
    assert claimed["id"] == t["id"] and claimed["claimed_by"] == "bot-1"
    bot.log(t["id"], "halfway")
    bot.block(t["id"], "Which branch?")
    assert human.get(t["id"])["status"] == "blocked"
    human.reply(t["id"], "main")
    bot.claim(t["id"])
    done = bot.complete(t["id"], "Merged to main")
    assert done["status"] == "review"
    assert human.approve(t["id"])["status"] == "done"

    board = human.board()
    assert board["counts"]["done"] == 1
    assert [a["name"] for a in board["agents"]] == ["bot-1"]
    history = [e["kind"] for e in human.get(t["id"])["events"]]
    assert history == ["created", "claimed", "progress", "blocked", "replied", "claimed", "completed", "approved"]


def test_errors_map_to_status_codes(make_server):
    _, url = make_server()
    human = Client(url)
    with pytest.raises(ApiError) as exc:
        human.get(42)
    assert exc.value.status == 404
    t = human.create("x")
    Client(url, agent="a").claim(t["id"])
    with pytest.raises(ApiError) as exc:
        Client(url, agent="b").claim(t["id"])
    assert exc.value.status == 409
    with pytest.raises(ApiError) as exc:
        human.next()  # no agent name
    assert exc.value.status == 400
    status, _, _ = raw(url, "PUT", "/api/tasks")
    assert status == 405
    status, _, _ = raw(url, "GET", "/api/nope")
    assert status == 404


def test_writes_require_json_content_type(make_server):
    _, url = make_server()
    status, _, body = raw(url, "POST", "/api/tasks", body='{"title": "x"}', headers={"Content-Type": "text/plain"})
    assert status == 415
    assert Client(url).tasks() == []


def test_cross_origin_writes_refused(make_server):
    _, url = make_server()
    headers = {"Content-Type": "application/json", "Origin": "http://evil.example"}
    status, _, _ = raw(url, "POST", "/api/tasks", body='{"title": "x"}', headers=headers)
    assert status == 403
    host = urlsplit(url).netloc
    headers["Origin"] = f"http://{host}"
    status, _, _ = raw(url, "POST", "/api/tasks", body='{"title": "x"}', headers=headers)
    assert status == 201


def test_dns_rebinding_host_check(make_server):
    _, url = make_server()
    status, _, _ = raw(url, "GET", "/api/board", headers={"Host": "attacker.example:6400"})
    assert status == 403
    status, _, _ = raw(url, "GET", "/api/board", headers={"Host": "localhost:6400"})
    assert status == 200


def test_token_auth(make_server):
    _, url = make_server(token="s3cret")
    with pytest.raises(ApiError) as exc:
        Client(url).board()
    assert exc.value.status == 401
    assert Client(url, token="s3cret").board()["counts"]["todo"] == 0
    status, _, _ = raw(url, "GET", "/api/board?token=s3cret")
    assert status == 200
    status, _, _ = raw(url, "GET", "/api/health")
    assert status == 200  # health and the UI shell stay public so the UI can ask for the token
    status, _, _ = raw(url, "GET", "/")
    assert status == 200


def test_static_files_and_traversal(make_server):
    _, url = make_server()
    status, headers, body = raw(url, "GET", "/")
    assert status == 200 and b"AGENTDOS" in body
    assert "default-src 'self'" in headers["Content-Security-Policy"]
    status, headers, _ = raw(url, "GET", "/static/app.js")
    assert status == 200 and headers["Content-Type"].startswith("text/javascript")
    status, _, body = raw(url, "GET", "/AGENTS.md")
    assert status == 200 and b"agent protocol" in body
    for path in ("/static/../server.py", "/static/%2e%2e/server.py", "/static/../../dos.py"):
        status, _, _ = raw(url, "GET", path)
        assert status == 404, path


def test_config_reports_launcher(make_server):
    _, url = make_server()
    status, _, body = raw(url, "GET", "/api/config")
    cfg = json.loads(body)
    assert status == 200
    assert cfg["launcher"][-1].endswith("dos.py")
    assert cfg["url"].startswith("http://127.0.0.1:")


def test_event_stream_pushes_changes(make_server):
    _, url = make_server()
    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=5)
    conn.request("GET", "/api/stream")
    resp = conn.getresponse()
    assert resp.status == 200
    assert resp.getheader("Content-Type").startswith("text/event-stream")

    def read_event():
        lines = []
        while True:
            line = resp.fp.readline().decode().rstrip("\n")
            if line == "" and lines:
                return lines
            if line and not line.startswith(":"):
                lines.append(line)

    first = read_event()
    assert "event: change" in first
    threading.Timer(0.1, lambda: Client(url).create("ping")).start()
    started = time.time()
    second = read_event()
    assert "event: change" in second
    assert time.time() - started < 3
    conn.close()


def test_agent_seen_on_read(make_server):
    _, url = make_server()
    Client(url, agent="watcher").board()
    assert [a["name"] for a in Client(url).agents()] == ["watcher"]
