import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from agentdos.server import App, start_background, stop  # noqa: E402
from agentdos.store import Store  # noqa: E402


@pytest.fixture
def make_server(tmp_path):
    """Start a real HTTP server on a free port. Returns a factory taking App kwargs."""
    started = []

    def factory(**kwargs):
        app = App(Store(str(tmp_path / f"board{len(started)}.db")), host="127.0.0.1", port=0, **kwargs)
        server, _ = start_background(app)
        started.append((app, server))
        return app, f"http://127.0.0.1:{app.port}"

    yield factory
    for app, server in started:
        stop(app, server)
        app.store.close()
