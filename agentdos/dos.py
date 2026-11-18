#!/usr/bin/env python3
"""AGENTDOS launcher - run from a checkout with no install step.

    python3 dos.py serve            start the board at http://127.0.0.1:6400
    python3 dos.py mcp --agent NAME run the MCP server for an AI agent
    python3 dos.py --help           everything else (ls, add, next, done, ...)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agentdos.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
