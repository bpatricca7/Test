import asyncio
import io
import json
import os
import subprocess
import sys

import pytest

from agentdos.client import Client
from agentdos.mcp_server import TOOLS, run

DOS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dos.py")


def rpc_session(url, messages, agent="mcp-bot"):
    """Feed JSON-RPC lines through the stdio loop in-process; return parsed replies."""
    stdin = io.StringIO("".join(json.dumps(m) + "\n" for m in messages))
    stdout = io.StringIO()
    run(url, agent, None, stdin=stdin, stdout=stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def call(i, name, args=None):
    return {"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": name, "arguments": args or {}}}


def test_protocol_handshake_and_tools(make_server):
    _, url = make_server()
    replies = rpc_session(url, [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        {"jsonrpc": "2.0", "id": 4, "method": "resources/list"},
    ])
    assert [r["id"] for r in replies] == [1, 2, 3, 4]  # the notification gets no reply
    init = replies[0]["result"]
    assert init["protocolVersion"] == "2025-06-18"
    assert init["serverInfo"]["name"] == "agentdos"
    assert "mcp-bot" in init["instructions"]
    names = {t["name"] for t in replies[1]["result"]["tools"]}
    assert {"board", "claim_next_task", "complete_task", "ask_human"} <= names
    assert replies[2]["result"] == {}
    assert replies[3]["error"]["code"] == -32601


def test_unknown_protocol_version_falls_back(make_server):
    _, url = make_server()
    [reply] = rpc_session(url, [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}}])
    assert reply["result"]["protocolVersion"] == "2025-11-25"


def test_tool_workflow(make_server):
    _, url = make_server()
    human = Client(url)
    t = human.create("Write the README", "Explain setup", tags=["docs"])
    human.create("For the human", assignee="human")
    replies = rpc_session(url, [
        call(1, "board"),
        call(2, "claim_next_task", {"tags": ["docs"], "lease_minutes": 5}),
        call(3, "log_progress", {"task_id": t["id"], "message": "outlined"}),
        call(4, "complete_task", {"task_id": t["id"], "result": "README.md written"}),
        call(5, "claim_next_task"),
        call(6, "create_task", {"title": "Follow-up: add screenshots", "priority": "low", "tags": ["docs"]}),
        call(7, "claim_task", {"task_id": 999}),
        call(8, "get_task", {"task_id": "abc"}),
        call(9, "no_such_tool"),
    ])
    text = {r["id"]: r["result"]["content"][0]["text"] for r in replies}
    err = {r["id"]: r["result"]["isError"] for r in replies}
    assert "Write the README" in text[1] and "human only" in text[1]
    assert text[2].startswith(f"Claimed task #{t['id']}")
    assert "Lease now expires" in text[3]
    assert "review" in text[4]
    assert "No tasks available" in text[5] and not err[5]
    assert text[6].startswith("Created task #")
    assert err[7] and "not found" in text[7]
    assert err[8] and "task number" in text[8]
    assert err[9]
    task = human.get(t["id"])
    assert task["status"] == "review" and task["claimed_by"] == "mcp-bot"


def test_server_down_is_a_tool_error_not_a_crash():
    [reply] = rpc_session("http://127.0.0.1:9", [call(1, "board")])
    assert reply["result"]["isError"]
    assert "cannot reach AGENTDOS" in reply["result"]["content"][0]["text"]


def test_bad_json_line():
    stdout = io.StringIO()
    run("http://127.0.0.1:9", "x", None, stdin=io.StringIO("{not json\n"), stdout=stdout)
    assert json.loads(stdout.getvalue())["error"]["code"] == -32700


def test_tool_schemas_are_objects():
    for tool in TOOLS:
        assert tool["inputSchema"]["type"] == "object"
        assert tool["description"]


def test_official_sdk_client_over_stdio(make_server):
    """Conformance check with the official MCP Python SDK, when it is installed."""
    pytest.importorskip("mcp")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    _, url = make_server()
    Client(url).create("SDK task")

    async def session():
        params = StdioServerParameters(command=sys.executable, args=[DOS, "mcp", "--url", url, "--agent", "sdk-bot"])
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as s:
                await s.initialize()
                tools = await s.list_tools()
                result = await s.call_tool("claim_next_task", {})
                return [t.name for t in tools.tools], result

    names, result = asyncio.run(session())
    assert "claim_next_task" in names
    is_error = getattr(result, "is_error", None)  # SDK 2.x name
    if is_error is None:
        is_error = result.isError  # SDK 1.x name
    assert not is_error
    assert "SDK task" in result.content[0].text
    assert Client(url).board()["agents"][0]["name"] == "sdk-bot"


def test_cli_roundtrip(make_server):
    _, url = make_server()
    env = dict(os.environ, AGENTDOS_URL=url, AGENTDOS_AGENT="cli-bot")

    def dos(*args):
        return subprocess.run([sys.executable, DOS, *args], env=env, capture_output=True, text=True, timeout=20)

    assert dos("add", "From the CLI", "-p", "urgent", "-t", "ops").returncode == 0
    out = dos("next", "--json")
    assert out.returncode == 0 and json.loads(out.stdout)["claimed_by"] == "cli-bot"
    assert dos("done", "1", "did it").returncode == 0
    assert dos("next").returncode == 3  # empty queue
    listing = dos("ls", "--all").stdout
    assert "From the CLI" in listing and "REVIEW" in listing
    bad = dos("claim", "99")
    assert bad.returncode == 1 and "not found" in bad.stderr
