# TIDAL BREACH — Operation Blacktide

**Version:** 0.1.1 — playable FPS baseline, not a finished AAA title.

A standalone, offline-capable WebGL first-person action game in a fictional rainy Nordic harbour. This repository is prepared for quality-first development, with a visual goal, milestones and regression tests.

## Run
Open `index.html` in a modern WebGL-capable browser; no build step needed. For iPhone, use a web browser in landscape orientation. Desktop: WASD move, mouse look, left-click fire, right-click aim, R reload, E interact, Shift sprint, C crouch, Esc pause, M map. On mobile: virtual joystick, touch-look, weapon and action buttons.

**Objective:** disable three signal nodes, survive the guards, return to extraction.

## Development
- [Art direction](docs/VISION.md)
- [Milestone plan](docs/ROADMAP.md)
- [Acceptance criteria](docs/ACCEPTANCE.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Agent instructions](AGENTS.md)

## QA
```bash
python -m unittest discover -s tests -p test_static.py -v
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python -m pytest tests/test_browser.py -v
```

Only `?qa=1` exposes deterministic test hooks. Normal gameplay contains no QA controls. A browser test does not substitute for manual verification on physical mobile/desktop GPUs.

**Release caution:** do not label a milestone complete or "photorealistic" without actual runtime screenshots and measured performance. Assets added in future must have verified commercial-use rights and attribution where required.