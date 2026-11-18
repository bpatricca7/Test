"""Command line: run the server or MCP bridge, or drive the board from a shell.

Shell-based agents can use these commands directly, e.g.::

    AGENTDOS_AGENT=bot-1 python3 dos.py next --json
    AGENTDOS_AGENT=bot-1 python3 dos.py log 12 "tests pass"
    AGENTDOS_AGENT=bot-1 python3 dos.py done 12 "Fixed in commit abc123"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

from . import DEFAULT_PORT, __version__
from .client import ApiError, Client

COLUMN_NAMES = {"todo": "TODO", "doing": "DOING", "blocked": "NEEDS-YOU", "review": "REVIEW", "done": "DONE"}
PRIO_MARK = {"urgent": "!!", "high": "! ", "normal": "  ", "low": ". "}


def _ago(stamp: str | None) -> str:
    if not stamp:
        return ""
    then = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    secs = max(0, int((datetime.now(timezone.utc) - then).total_seconds()))
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if secs >= size:
            return f"{secs // size}{unit} ago"
    return f"{secs}s ago"


def _who(task: dict[str, Any]) -> str:
    if task["status"] in ("doing", "blocked", "review", "done") and task["claimed_by"]:
        return "by " + task["claimed_by"]
    if task["assignee"] is None:
        return "@any"
    return "@" + task["assignee"]


def print_dir(tasks: list[dict[str, Any]], status_filter: str | None) -> None:
    print(" Volume in drive C is AGENTDOS")
    print(f" Directory of C:\\BOARD{chr(92) + COLUMN_NAMES[status_filter] if status_filter else ''}\n")
    for task in tasks:
        title = task["title"] if len(task["title"]) <= 44 else task["title"][:43] + "…"
        tags = " ".join("#" + t for t in task["tags"])
        print(f"#{task['id']:04d} {PRIO_MARK[task['priority']]}{COLUMN_NAMES[task['status']]:<9} "
              f"{title:<45} {_who(task):<16} {_ago(task['updated_at']):>8}  {tags}".rstrip())
    print(f"{len(tasks):>9} task(s)")


def print_task(task: dict[str, Any]) -> None:
    print(f"#{task['id']:04d}  {task['title']}")
    print(f"  status   {COLUMN_NAMES[task['status']]}   priority {task['priority']}   "
          f"for {task['assignee'] or 'any agent'}   review {'on' if task['review'] else 'off'}")
    if task["tags"]:
        print("  tags     " + " ".join("#" + t for t in task["tags"]))
    if task["claimed_by"]:
        lease = f" (lease until {task['lease_expires']})" if task["lease_expires"] else ""
        print(f"  agent    {task['claimed_by']}{lease}")
    if task["description"]:
        print("\n" + "\n".join("  " + line for line in task["description"].splitlines()))
    if task.get("question") and task["status"] == "blocked":
        print(f"\n  QUESTION: {task['question']}")
    if task["result"]:
        print("\n  RESULT:\n" + "\n".join("    " + line for line in task["result"].splitlines()))
    if task.get("events"):
        print("\n  HISTORY")
        for e in task["events"]:
            print(f"    {e['ts'][11:19]}  {e['actor']:<14} {e['kind']:<9} {e['message']}".rstrip())


def _client(args: argparse.Namespace) -> Client:
    return Client(url=args.url, agent=args.agent, token=args.token)


def _out(args: argparse.Namespace, payload: Any, human: Any = None) -> None:
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    elif callable(human):
        human(payload)
    elif human is not None:
        print(human)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dos.py",
        description="AGENTDOS - an agentic to-do board with a retro-modern MS-DOS interface.",
        epilog="Environment: AGENTDOS_URL, AGENTDOS_AGENT, AGENTDOS_TOKEN, AGENTDOS_DB.",
    )
    p.add_argument("--version", action="version", version=f"AGENTDOS {__version__}")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--url", help="board URL (default: $AGENTDOS_URL or http://127.0.0.1:%d)" % DEFAULT_PORT)
    common.add_argument("--agent", help="act as this agent (default: $AGENTDOS_AGENT)")
    common.add_argument("--token", help="access token (default: $AGENTDOS_TOKEN)")
    common.add_argument("--json", action="store_true", help="print raw JSON")
    sub = p.add_subparsers(dest="cmd", metavar="COMMAND")

    s = sub.add_parser("serve", help="start the board server")
    s.add_argument("--host", default=os.environ.get("AGENTDOS_HOST", "127.0.0.1"))
    s.add_argument("--port", type=int, default=int(os.environ.get("AGENTDOS_PORT", DEFAULT_PORT)))
    s.add_argument("--db", default=os.environ.get("AGENTDOS_DB") or os.path.join(os.path.expanduser("~"), ".agentdos", "board.db"))
    s.add_argument("--token", default=os.environ.get("AGENTDOS_TOKEN"), help="require this access token")
    s.add_argument("--verbose", action="store_true", help="log every request")

    m = sub.add_parser("mcp", help="run the MCP server (stdio) for an AI agent")
    m.add_argument("--url")
    m.add_argument("--agent", help="this agent's name on the board (default: $AGENTDOS_AGENT or agent-<host>)")
    m.add_argument("--token")

    ls = sub.add_parser("ls", aliases=["dir"], parents=[common], help="list tasks")
    ls.add_argument("--status", choices=list(COLUMN_NAMES))
    ls.add_argument("--tag")
    ls.add_argument("--all", action="store_true", help="include done tasks")

    a = sub.add_parser("add", parents=[common], help="add a task")
    a.add_argument("title")
    a.add_argument("-d", "--description", default="")
    a.add_argument("-p", "--priority", choices=["low", "normal", "high", "urgent"])
    a.add_argument("-t", "--tag", action="append", dest="tags", help="repeatable")
    a.add_argument("--for", dest="assignee", help="agent name, 'human', or omit for any agent")
    a.add_argument("--no-review", action="store_true", help="agent completion goes straight to DONE")

    sh = sub.add_parser("show", aliases=["type"], parents=[common], help="show a task and its history")
    sh.add_argument("id", type=int)

    n = sub.add_parser("next", parents=[common], help="[agent] claim the next available task")
    n.add_argument("-t", "--tag", action="append", dest="tags")
    n.add_argument("--lease", type=int, help="lease in seconds (default 900)")

    c = sub.add_parser("claim", parents=[common], help="[agent] claim a task")
    c.add_argument("id", type=int)
    c.add_argument("--lease", type=int)

    for name, helptext, field in (
        ("log", "post a progress note / comment", "message"),
        ("done", "[agent] complete a task with a result", "result"),
        ("ask", "[agent] block a task with a question for the human", "question"),
        ("release", "[agent] give a task back to the queue", "reason"),
        ("reply", "answer a blocked task's question (requeues it)", "message"),
        ("approve", "approve a task in review", "message"),
        ("reject", "send a reviewed task back with feedback", "feedback"),
    ):
        x = sub.add_parser(name, parents=[common], help=helptext)
        x.add_argument("id", type=int)
        x.add_argument(field, nargs="?" if name in ("release", "approve") else None, default="")

    hb = sub.add_parser("heartbeat", parents=[common], help="[agent] renew your lease on a task")
    hb.add_argument("id", type=int)

    mv = sub.add_parser("move", parents=[common], help="move a task to a column")
    mv.add_argument("id", type=int)
    mv.add_argument("status", choices=list(COLUMN_NAMES))

    d = sub.add_parser("rm", aliases=["del"], parents=[common], help="delete a task")
    d.add_argument("id", type=int)

    sub.add_parser("agents", parents=[common], help="list agents that have checked in")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 0

    if args.cmd == "serve":
        from .server import App, serve
        from .store import Store
        serve(App(Store(args.db), host=args.host, port=args.port, token=args.token), verbose=args.verbose)
        return 0
    if args.cmd == "mcp":
        from .mcp_server import run
        run(args.url, args.agent, args.token)
        return 0

    client = _client(args)
    cmd = {"dir": "ls", "type": "show", "del": "rm"}.get(args.cmd, args.cmd)
    try:
        if cmd == "ls":
            tasks = client.tasks(status=args.status, tag=args.tag)
            if not args.all and not args.status:
                tasks = [t for t in tasks if t["status"] != "done"]
            _out(args, tasks, lambda ts: print_dir(ts, args.status))
        elif cmd == "add":
            t = client.create(args.title, args.description, priority=args.priority, tags=args.tags,
                              assignee=args.assignee, review=False if args.no_review else None)
            _out(args, t, f"Task #{t['id']:04d} created.")
        elif cmd == "show":
            _out(args, client.get(args.id), print_task)
        elif cmd == "next":
            t = client.next(tags=args.tags, lease_seconds=args.lease)
            if t is None:
                _out(args, None, "No tasks available.")
                return 3
            _out(args, t, print_task)
        elif cmd == "claim":
            _out(args, client.claim(args.id, lease_seconds=args.lease), print_task)
        elif cmd == "heartbeat":
            t = client.heartbeat(args.id)
            _out(args, t, f"Lease on #{t['id']:04d} renewed until {t['lease_expires']}.")
        elif cmd == "log":
            _out(args, client.log(args.id, args.message), f"Logged on #{args.id:04d}.")
        elif cmd == "done":
            t = client.complete(args.id, args.result)
            _out(args, t, f"#{t['id']:04d} -> {COLUMN_NAMES[t['status']]}.")
        elif cmd == "ask":
            _out(args, client.block(args.id, args.question), f"#{args.id:04d} -> NEEDS-YOU.")
        elif cmd == "release":
            _out(args, client.release(args.id, args.reason or ""), f"#{args.id:04d} released.")
        elif cmd == "reply":
            _out(args, client.reply(args.id, args.message), f"#{args.id:04d} answered and requeued.")
        elif cmd == "approve":
            _out(args, client.approve(args.id, args.message or ""), f"#{args.id:04d} approved.")
        elif cmd == "reject":
            _out(args, client.reject(args.id, args.feedback), f"#{args.id:04d} sent back to TODO.")
        elif cmd == "move":
            t = client.update(args.id, status=args.status)
            _out(args, t, f"#{t['id']:04d} -> {COLUMN_NAMES[t['status']]}.")
        elif cmd == "rm":
            _out(args, client.delete(args.id), f"#{args.id:04d} deleted.")
        elif cmd == "agents":
            agents = client.agents()

            def show(rows: list[dict[str, Any]]) -> None:
                for a in rows:
                    tasks = ",".join(f"#{i}" for i in a["tasks"]) or "-"
                    print(f"{a['name']:<24} {a['state'].upper():<8} {tasks:<12} seen {_ago(a['last_seen'])}")
                print(f"{len(rows):>9} agent(s)")
            _out(args, agents, show)
    except ApiError as exc:
        print(f"ERROR: {exc.message}", file=sys.stderr)
        return 1
    return 0
