#!/usr/bin/env python3
"""A pretend agent that works the AGENTDOS queue - for demos, and as a template.

It does no real work: it claims tasks, posts a few progress notes, and then
either hands in a placeholder result or asks the human a question. Run one or
two of these next to the board to watch the workflow end to end:

    python3 examples/demo_agent.py --agent demo-bot-1
    python3 examples/demo_agent.py --agent demo-bot-2 --tag code

To build a real agent, keep the loop and replace ``do_work``.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from agentdos.client import ApiError, Client  # noqa: E402

STEPS = [
    "Reading the task and its history",
    "Looking around for context",
    "Drafting an approach",
    "Working on it",
    "Checking the result",
]


def do_work(board: Client, task: dict, speed: float) -> tuple[str, str]:
    """Return ("done", result) or ("ask", question). Replace this with real work."""
    for step in random.sample(STEPS[1:-1], 2):
        time.sleep(random.uniform(1.5, 3.5) / speed)
        board.log(task["id"], step + "…")  # also renews the lease
    time.sleep(random.uniform(1.0, 2.5) / speed)

    replied = any(e["kind"] in ("replied", "rejected") for e in task.get("events", []))
    if not replied and random.random() < 0.3:
        return "ask", f"Before I continue with “{task['title']}”: should I keep it small, or do the thorough version?"
    feedback = [e["message"] for e in task.get("events", []) if e["kind"] in ("replied", "rejected")]
    note = f"\nTook your note into account: “{feedback[-1]}”" if feedback else ""
    return "done", (f"(demo) Pretended to do “{task['title']}”.{note}\n"
                    "A real agent would describe what it changed and where to find it.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent", default=os.environ.get("AGENTDOS_AGENT", "demo-bot"))
    ap.add_argument("--url", default=os.environ.get("AGENTDOS_URL"))
    ap.add_argument("--token", default=os.environ.get("AGENTDOS_TOKEN"))
    ap.add_argument("--tag", action="append", dest="tags", help="only take tasks with this tag (repeatable)")
    ap.add_argument("--speed", type=float, default=1.0, help="work faster (2 = twice as fast)")
    ap.add_argument("--once", action="store_true", help="take one task and exit")
    args = ap.parse_args()

    board = Client(url=args.url, agent=args.agent, token=args.token)
    print(f"[{args.agent}] watching {board.url}  (Ctrl+C to stop)")
    task = None
    while True:
        try:
            task = None
            task = board.next(tags=args.tags)
            if task is None:
                if args.once:
                    print(f"[{args.agent}] queue empty")
                    return 0
                time.sleep(3 / args.speed)
                continue
            print(f"[{args.agent}] claimed #{task['id']}: {task['title']}")
            board.log(task["id"], STEPS[0] + "…")
            outcome, text = do_work(board, task, args.speed)
            if outcome == "ask":
                board.block(task["id"], text)
                print(f"[{args.agent}] asked about #{task['id']}")
            else:
                board.complete(task["id"], text)
                print(f"[{args.agent}] finished #{task['id']}")
            if args.once:
                return 0
        except ApiError as exc:
            print(f"[{args.agent}] {exc.message}", file=sys.stderr)
            if exc.status == 0:
                time.sleep(5)
        except KeyboardInterrupt:
            if task is not None:
                try:  # hand the task back instead of letting the lease run out
                    board.release(task["id"], "agent stopped")
                except ApiError:
                    pass
            print(f"\n[{args.agent}] bye")
            return 0


if __name__ == "__main__":
    sys.exit(main())
