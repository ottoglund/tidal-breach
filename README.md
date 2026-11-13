# TIDAL BREACH — Operation Blacktide

**Version:** 0.3.0-dev (`game/`, in development, not accepted); `index.html` is the v0.1.1 classic baseline. Not a finished AAA title.

A standalone, offline-capable WebGL first-person action game in a fictional rainy Nordic harbour. This repository is prepared for quality-first development, with a visual goal, milestones and regression tests.

## Run
**v0.2 renderer (in development, `game/`):** serve the repository folder over HTTP and open `/game/`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/game/
```

On Windows without Python, run the bundled PowerShell server from the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

ES modules and textures cannot load from `file://`. Graphics presets: `?q=low|medium|high` (or the menu buttons). The `low` preset (default on touch devices) also uses simplified cloth / skin shading; `?lite=0|1` forces the shader tier for comparison. Press **F9** (or add `?perf=1`) for the FPS/draw-call overlay. If a shader fails to compile on your GPU the game falls back to the lite shaders, and to the procedural soldier body if the `.bin` models cannot be loaded.

**v0.1 classic (WebGL 1 fallback, `index.html`):** open `index.html` in a modern WebGL-capable browser; no build step needed. For iPhone, use a web browser in landscape orientation. Desktop: WASD move, mouse look, left-click fire, right-click aim, R reload, E interact, Shift sprint, C crouch, Esc pause, M map. On mobile: virtual joystick, touch-look, weapon and action buttons.

**Objective:** disable three signal nodes, survive the guards, return to extraction. In v0.2 you play a Swedish Home Guard (Hemvärnet) soldier with an Ak 4C, supported by two comrades.

## Development
- [Art direction](docs/VISION.md)
- [Milestone plan](docs/ROADMAP.md)
- [Changelog](docs/CHANGELOG.md)
- [Acceptance criteria](docs/ACCEPTANCE.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Agent instructions](AGENTS.md)
- [Asset provenance and licences](docs/ASSETS.md)

## QA
```bash
python -m unittest discover -s tests -p test_static.py -v
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python -m pytest tests/test_browser.py -v
python -m unittest discover -s tests -p "test_static*.py" -v
python -m pytest tests/test_game_v2.py -v
node tools/capture.js "http://127.0.0.1:8000/game/?qa=1&q=high" docs/renders/<name>   # fixed-camera renders
```

Mobile / shader checks and renders (all headless on a software GPU, not device measurements):
```bash
python3 -m pytest tests/ -q                      # all suites; test_full_mission_run plays a whole mission on q=low (~35 s)
NODE_PATH=<playwright node_modules> node tools/shader_audit.js "http://127.0.0.1:8000/game/?qa=1&q=low"   # varyings / uniforms per program (needs gcc for its preprocessor)
VIEWPORT=1600x900 node tools/capture.js "http://127.0.0.1:8000/game/?qa=1&q=high" out/ desktop              # desktop render, 4 fixed cameras
VIEWPORT=844x390 DSF=1 node tools/capture.js "http://127.0.0.1:8000/game/?qa=1&q=low" out/ mobile            # landscape mobile render
python3 tools/compare.py docs/renders/v0.2 docs/renders/v0.3 docs/renders/compare --prefix v0.2_vs_v0.3_      # before / after sheets
```
Renders: `docs/renders/baseline-v0.1/`, `v0.2/`, `v0.3/`, sheets in `docs/renders/compare/`. What to verify on real hardware before anything is called accepted: `docs/ACCEPTANCE.md` ("Real-hardware checklist").

Only `?qa=1` exposes deterministic test hooks. Normal gameplay contains no QA controls. A browser test does not substitute for manual verification on physical mobile/desktop GPUs.

**Release caution:** do not label a milestone complete or "photorealistic" without actual runtime screenshots and measured performance. Assets added in future must have verified commercial-use rights and attribution where required.