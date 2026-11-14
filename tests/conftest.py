"""Shared Playwright browser for every browser suite.

Only one Playwright sync API instance may run per process, so test_browser.py (v0.1 classic) and test_game_v2.py (v0.2+
renderer) share one session-scoped Chromium instead of each starting its own (that clashed when both ran in one pytest
invocation: "Playwright Sync API inside the asyncio loop").
"""
import pytest
from playwright.sync_api import sync_playwright


@pytest.fixture(scope="session")
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
