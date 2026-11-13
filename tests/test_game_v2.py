"""Browser regressions for the v0.2 Three.js renderer in game/.

Uses the opt-in ?qa=1 hooks. Simulation time is advanced with the
deterministic step() hook, so results do not depend on how fast the
(software) GPU renders. Rendering is held to keep CI fast; one test renders
real frames to make sure the full pipeline runs without errors.
"""
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from playwright.sync_api import sync_playwright

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
        yield f"http://127.0.0.1:{server.server_port}/game/?qa=1&q=low"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=[
            "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"
        ])
        try:
            yield b
        finally:
            b.close()


@pytest.fixture
def game(browser):
    with serve() as url:
        context = browser.new_context(viewport={"width": 960, "height": 540}, has_touch=True)
        page = context.new_page()
        page.set_default_timeout(240000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        page.wait_for_function("window.__TIDAL_QA__ !== undefined", timeout=240000)
        page.wait_for_function('!document.getElementById("startBtn").disabled', timeout=240000)
        page.evaluate("window.__TIDAL_QA__.hold(true)")
        page.locator("#startBtn").click()
        page.wait_for_function('window.__TIDAL_QA__.state().mode === "play"', timeout=10000)
        yield page, errors
        context.close()


def qa(page, expr):
    return page.evaluate(f"window.__TIDAL_QA__.{expr}")


def state(page):
    return qa(page, "state()")


def test_start_and_reset(game):
    page, errors = game
    s = state(page)
    assert s["hp"] == 100 and s["armor"] == 75 and s["ammo"] == 20 and s["reserve"] == 120
    assert len(s["targets"]) == 3 and not any(n["done"] for n in s["targets"])
    assert s["enemies"] == 7
    qa(page, "damage(40)")
    assert state(page)["armor"] < 75
    qa(page, "restart()")
    s = state(page)
    assert s["hp"] == 100 and s["armor"] == 75 and s["enemies"] == 7
    assert not errors


def test_weapon_magazine_and_pause(game):
    page, errors = game
    qa(page, "fire()")
    assert state(page)["ammo"] == 19
    qa(page, "pause()")
    page.wait_for_timeout(150)
    qa(page, "fire()")
    assert state(page)["ammo"] == 19, "pause must block fire"
    qa(page, "resume()")
    qa(page, "reload()")
    assert state(page)["reloading"] > 0
    qa(page, "peaceful()")
    qa(page, "step(1.0)")
    assert state(page)["ammo"] == 19, "magazine not refilled before reload ends"
    qa(page, "step(1.0)")
    s = state(page)
    assert s["ammo"] == 20 and s["reserve"] == 119
    assert not errors


def test_empty_magazine_auto_reload(game):
    page, errors = game
    qa(page, "peaceful()")
    for _ in range(20):
        page.wait_for_timeout(110)  # fire-rate limit is 0.105 s of wall time
        qa(page, "fire()")
    s = state(page)
    assert s["ammo"] == 0 and s["reloading"] > 0
    qa(page, "step(2.0)")
    s = state(page)
    assert s["ammo"] == 20 and s["reserve"] == 100
    assert not errors


def test_three_nodes_and_extraction(game):
    page, errors = game
    qa(page, "peaceful()")
    qa(page, "position(2,25)")
    qa(page, "interact()")
    assert state(page)["mode"] == "play"  # extraction must not work early
    for i in range(3):
        page.evaluate('''i => {
            const n = window.__TIDAL_QA__.state().targets[i];
            window.__TIDAL_QA__.position(n.x, n.z + 2.7);
            window.__TIDAL_QA__.interact();
        }''', i)
        assert state(page)["targets"][i]["done"] is True
    assert state(page)["enemies"] == 2, "two reinforcements spawn after the last node"
    qa(page, "step(0.1)")
    assert "evakueringspunkten" in page.locator("#objectiveTitle").inner_text()
    qa(page, "position(2,25)")
    qa(page, "interact()")
    assert state(page)["mode"] == "end"
    assert "CLEAR" in page.locator("#endTitle").inner_text()
    assert not errors


def test_damage_to_failure(game):
    page, errors = game
    qa(page, "damage(1000)")
    assert state(page)["mode"] == "end"
    assert "FAILED" in page.locator("#endTitle").inner_text()
    assert not errors


def test_collision_blocks_containers(game):
    page, errors = game
    qa(page, "peaceful()")
    # walk forward (-Z) from z=12 toward the cross-placed container at (10,7) (spans z 5.8..8.2)
    qa(page, "view(10, 12, 0, 0)")
    page.keyboard.down("KeyW")
    qa(page, "step(3)")
    page.keyboard.up("KeyW")
    z = state(page)["z"]
    assert z < 11.0, f"forward input should move the player toward -Z (z={z})"
    assert z > 8.2, f"player walked into a container (z={z})"
    assert not errors


def test_strafe_direction(game):
    page, errors = game
    qa(page, "peaceful()")
    qa(page, "view(0, 20, 0, 0)")
    page.keyboard.down("KeyD")
    qa(page, "step(0.6)")
    page.keyboard.up("KeyD")
    assert state(page)["x"] > 0.5, "D must strafe right (+X when facing -Z)"
    assert not errors


def test_enemies_engage_and_damage(game):
    page, errors = game
    qa(page, "squad(false)")  # comrades would otherwise take the fight off the player
    qa(page, "view(15, -2, 3.14, 0)")  # near guard at (15,-9)
    qa(page, "step(12)")
    s = state(page)
    assert s["hp"] + s["armor"] < 175, "guards should detect and shoot the player"
    assert not errors


def test_renders_frames(game):
    page, errors = game
    ms = qa(page, "renderFrame(5)")
    assert ms >= 0
    qa(page, "renderFrame(5.1)")
    assert not errors


def test_squad_follows_and_engages(game):
    page, errors = game
    sq = qa(page, "squadState()")
    assert len(sq) == 2
    s = state(page)
    assert all(abs(m["x"] - s["x"]) < 6 and abs(m["z"] - s["z"]) < 6 for m in sq), "comrades start next to the player"
    # walk the player toward Node A; comrades must follow in formation
    qa(page, "view(1, 0, 0, 0)")
    qa(page, "step(8)")
    sq = qa(page, "squadState()")
    assert all(abs(m["x"] - 1) < 9 and abs(m["z"] - 0) < 9 for m in sq), f"comrades did not follow: {sq}"
    assert not errors
