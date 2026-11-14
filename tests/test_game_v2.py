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


# ---------------------------------------------------------------------------------------------------------------------
# Full mission run (q=low, simulation stepped, squad enabled, guards alive): see tools/ docs in README "QA".

import math

MISSION_SCRIPT = r"""
() => {
  const Q = window.__TIDAL_QA__;
  return { s: Q.state(), e: Q.enemyList(), q: Q.squadState() };
}
"""


def _finite(snap):
    s = snap["s"]
    vals = [s["x"], s["z"], s["hp"], s["armor"]] + [v for m in snap["q"] for v in (m["x"], m["z"])] + [v for e in snap["e"] for v in (e["x"], e["z"])]
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals)


def _aim(page, tx, tz, tol_pitch=True):
    page.evaluate("""([tx, tz]) => { const Q = window.__TIDAL_QA__, s = Q.state();
        const dx = tx - s.x, dz = tz - s.z; Q.view(s.x, s.z, Math.atan2(dx, -dz), Math.atan2(1.2 - 1.7, Math.hypot(dx, dz))); }""", [tx, tz])


def _fight(page, budget_s=25.0):
    """Shoot guards that have a line of sight within 30 m (aimed bursts; the fire rate is limited by wall time)."""
    used = 0.0
    while used < budget_s:
        snap = page.evaluate(MISSION_SCRIPT)
        s = snap["s"]
        if s["mode"] != "play":
            return
        threats = [e for e in snap["e"] if e["los"] and math.hypot(e["x"] - s["x"], e["z"] - s["z"]) < 30]
        if not threats:
            return
        t = min(threats, key=lambda e: math.hypot(e["x"] - s["x"], e["z"] - s["z"]))
        _aim(page, t["x"], t["z"])
        for _ in range(3):
            page.wait_for_timeout(108)
            qa(page, "fire()")
            qa(page, "step(0.11)")
            used += 0.11
        if state(page)["reloading"] > 0:
            qa(page, "step(0.5)")
            used += 0.5


def _walk_to(page, tx, tz, tol=2.4, max_s=90.0):
    """Hold W along the route (QA route(): grid A* round containers / walls) in 0.4 s steps; stop and fight when a
    guard has a line of sight within 24 m; steer round obstacles the planner cannot see (comrades, moving guards)."""
    t = 0.0
    page.keyboard.down("KeyW")
    try:
        route = qa(page, f"route({tx}, {tz})")
        assert route, f"no route to ({tx}, {tz})"
        wp = 0
        while t < max_s:
            snap = page.evaluate(MISSION_SCRIPT)
            s = snap["s"]
            assert _finite(snap), f"NaN / inf in simulation state: {snap}"
            assert s["mode"] == "play", f"mission ended early: {s}"
            if math.hypot(tx - s["x"], tz - s["z"]) < tol:
                return t
            if any(e["los"] and math.hypot(e["x"] - s["x"], e["z"] - s["z"]) < 24 for e in snap["e"]):
                page.keyboard.up("KeyW")
                _fight(page)
                page.keyboard.down("KeyW")
                continue
            while wp < len(route) - 1 and math.hypot(route[wp][0] - s["x"], route[wp][1] - s["z"]) < 1.6:
                wp += 1
            wx, wz = route[wp]
            heading = math.atan2(wx - s["x"], -(wz - s["z"]))
            page.evaluate("([x, z, y]) => window.__TIDAL_QA__.view(x, z, y, 0)", [s["x"], s["z"], heading])
            qa(page, "step(0.4)")
            t += 0.4
    finally:
        page.keyboard.up("KeyW")
    raise AssertionError(f"did not reach ({tx}, {tz}) within {max_s}s: {state(page)}")


NODE_APPROACH = 2.0   # metres in front of a node (interaction range is 3.15 m)


def _disable_node(page, i):
    n = state(page)["targets"][i]
    _walk_to(page, n["x"], n["z"] + NODE_APPROACH, tol=0.8)
    qa(page, "interact()")
    assert state(page)["targets"][i]["done"] is True, f"node {i} not disabled: {state(page)}"


def test_full_mission_run(game):
    """Spawn -> restart mid-run -> Node A -> B (pause / resume) -> C -> extraction; q=low, squad on, guards alive.

    Asserts the win state, no console errors and no NaN / inf in the player, guard and comrade positions."""
    page, errors = game
    assert len(qa(page, "squadState()")) == 2, "squad is enabled by default"
    s0 = state(page)
    assert s0["enemies"] == 7

    # mid-run restart: disable node A, then restart -> everything is back to the initial state
    _disable_node(page, 0)
    assert state(page)["shots"] > 0 or state(page)["enemies"] == 7
    qa(page, "restart()")
    r = state(page)
    assert r["mode"] == "play" and r["hp"] == 100 and r["armor"] == 75 and r["ammo"] == 20 and r["enemies"] == 7, r
    assert not any(t["done"] for t in r["targets"]), r
    assert abs(r["x"] - s0["x"]) < 0.01 and abs(r["z"] - s0["z"]) < 0.01

    # the real run
    for i in range(3):
        _disable_node(page, i)
        if i == 1:  # pause mid-run: fire is blocked, simulation state kept, resume continues
            qa(page, "pause()")
            page.wait_for_timeout(150)
            before = state(page)
            qa(page, "fire()")
            qa(page, "step(1.0)")
            after = state(page)
            assert after["mode"] == "pause" and after["ammo"] == before["ammo"] and after["x"] == before["x"], (before, after)
            qa(page, "resume()")
            assert state(page)["mode"] == "play"
    assert all(t["done"] for t in state(page)["targets"])
    _walk_to(page, 2.0, 24.0, tol=2.0)  # extraction range is 4.4 m around (2, 25)
    qa(page, "interact()")
    s = state(page)
    assert s["mode"] == "end" and "CLEAR" in page.locator("#endTitle").inner_text(), f"mission not won: {s}"
    assert s["hp"] > 0 and math.isfinite(s["x"]) and math.isfinite(s["z"])
    assert not errors, errors


# ---------------------------------------------------------------------------------------------------------------------
# Graceful fallbacks

def _boot(browser, url, init_script=None, route=None):
    context = browser.new_context(viewport={"width": 844, "height": 390}, has_touch=True)
    if init_script:
        context.add_init_script(init_script)
    page = context.new_page()
    page.set_default_timeout(240000)
    errors, console = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda m: console.append((m.type, m.text)))
    if route:
        page.route("**/*.bin", route)
    page.goto(url)
    page.wait_for_function("window.__TIDAL_QA__ !== undefined", timeout=240000)
    page.wait_for_function('!document.getElementById("startBtn").disabled', timeout=240000)
    page.evaluate("window.__TIDAL_QA__.hold(true)")
    page.locator("#startBtn").click()
    page.wait_for_function('window.__TIDAL_QA__.state().mode === "play"', timeout=10000)
    return context, page, errors, console


@pytest.mark.parametrize("mode", ["missing", "corrupt"])
def test_missing_model_files_fall_back_to_procedural(browser, mode):
    """soldier_body.bin / viewmodel_arms.bin missing (404 / network error) or corrupt: procedural body and hands, no crash."""
    def route(r):
        if mode == "missing":
            r.abort()
        else:
            r.fulfill(status=200, body=b"not a TBMH file")
    with serve() as url:
        context, page, errors, console = _boot(browser, url, route=route)
        try:
            assert any("procedural fallback" in t for _, t in console), console
            assert any("procedural hands" in t for _, t in console), console
            # a posed soldier (procedural body) and the viewmodel render; the mission simulation runs
            assert qa(page, "soldier({side: 'hv', x: 0, z: 22, yaw: Math.PI, aim: 0.5})") > 0
            qa(page, "view(0, 24, 0, -0.1)")
            assert qa(page, "renderFrame(10)") >= 0
            qa(page, "step(3)")
            assert state(page)["mode"] == "play"
            assert not errors, errors
        finally:
            context.close()


# Fail every program that has the full body-cloth path (FAB_BODY) the way a driver limit would (link failure), to check
# the lite fallback: link status false -> three calls renderer.debug.onShaderError -> main.js switches to lite shading.
FAIL_FULL_CLOTH = """
(() => {
  const P = WebGL2RenderingContext.prototype, get = P.getProgramParameter;
  P.getProgramParameter = function (prog, pname) {
    const v = get.call(this, prog, pname);
    if (pname === this.LINK_STATUS && v && this.getAttachedShaders(prog).some(s => /#define FAB_BODY/.test(this.getShaderSource(s)))) return false;
    return v;
  };
})();
"""


def test_shader_failure_falls_back_to_lite_shading(browser):
    with serve() as url:
        context, page, errors, console = _boot(browser, url.replace("q=low", "q=low&lite=0"), init_script=FAIL_FULL_CLOTH)
        try:
            tier = qa(page, "shaderTier()")
            assert tier["failures"] > 0 and tier["lite"] is True, f"expected the lite fallback to engage: {tier} {console[-3:]}"
            # soldiers (lite cloth) and the first-person arms render after the fallback, the mission runs
            qa(page, "soldier({side: 'opfor', x: 0, z: 22, yaw: Math.PI})")
            qa(page, "view(0, 24, 0, -0.1)")
            assert qa(page, "renderFrame(10)") >= 0
            assert qa(page, "renderFrame(10.02)") >= 0
            qa(page, "step(2)")
            assert state(page)["mode"] == "play"
            assert not errors, errors
        finally:
            context.close()
