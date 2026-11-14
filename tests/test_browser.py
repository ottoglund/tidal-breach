"""Playwright regressions exercise production gameplay via opt-in deterministic QA hooks.

The QA interface only moves the player and invokes original gameplay actions;
this is not a replacement for manual desktop/mobile playthroughs.
"""
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def serve():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/?qa=1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.fixture
def game(browser):
    with serve() as url:
        # A touch-enabled headless context avoids pointer-lock permissions.
        context = browser.new_context(
            viewport={"width": 1280, "height": 720},
            has_touch=True
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        page.wait_for_function("window.__TIDAL_QA__ !== undefined", timeout=30000)
        assert not page.locator("#startBtn").is_disabled(), "WebGL unsupported"
        page.locator("#startBtn").click()
        page.wait_for_function(
            'window.__TIDAL_QA__.state().mode === "play"', timeout=10000
        )
        yield page, errors
        context.close()


def state(page):
    return page.evaluate("window.__TIDAL_QA__.state()")


def test_start_and_reset(game):
    page, errors = game
    s = state(page)
    assert s["hp"] == 100 and s["armor"] == 75 and s["ammo"] == 30
    assert len(s["targets"]) == 3
    assert not any(n["done"] for n in s["targets"])
    page.evaluate("window.__TIDAL_QA__.damage(40)")
    assert state(page)["armor"] < 75
    page.evaluate("window.__TIDAL_QA__.restart()")
    assert state(page)["hp"] == 100 and state(page)["armor"] == 75
    assert not errors


def test_weapon_and_pause(game):
    page, errors = game
    page.evaluate("window.__TIDAL_QA__.fire()")
    assert state(page)["ammo"] == 29
    page.evaluate("window.__TIDAL_QA__.pause()")
    page.evaluate("window.__TIDAL_QA__.fire()")
    assert state(page)["ammo"] == 29
    page.evaluate("window.__TIDAL_QA__.resume()")
    page.evaluate("window.__TIDAL_QA__.reload()")
    page.wait_for_function(
        "window.__TIDAL_QA__.state().ammo === 30", timeout=45000
    )
    assert state(page)["reserve"] == 149
    assert not errors


def test_three_nodes_and_extraction(game):
    page, errors = game
    page.evaluate("window.__TIDAL_QA__.position(2,25)")
    page.evaluate("window.__TIDAL_QA__.interact()")
    assert state(page)["mode"] == "play"  # Extraction must not work early
    for i in range(3):
        page.evaluate('''i => {
            const n=window.__TIDAL_QA__.state().targets[i];
            window.__TIDAL_QA__.position(n.x,n.z+2.7);
            window.__TIDAL_QA__.interact();
        }''', i)
        assert state(page)["targets"][i]["done"] is True
    page.wait_for_function(
        'document.getElementById("objectiveTitle").textContent.includes("evakueringspunkten")'
    )
    page.evaluate("window.__TIDAL_QA__.position(2,25)")
    page.evaluate("window.__TIDAL_QA__.interact()")
    assert state(page)["mode"] == "end"
    assert "CLEAR" in page.locator("#endTitle").inner_text()
    assert not errors


def test_damage_to_failure(game):
    page, errors = game
    page.evaluate("window.__TIDAL_QA__.damage(1000)")
    assert state(page)["mode"] == "end"
    assert "FAILED" in page.locator("#endTitle").inner_text()
    assert not errors
