# Changelog

## v0.2.0-dev — realistic renderer (in `game/`, not yet accepted)
- Heroes are now the Swedish Home Guard (Hemvärnet): player with Ak 4C (7.62×51, 20-round magazines, 120 in reserve) and Aimpoint-style red dot; two HV comrades (M90, Ak 4C, one helmeted) follow the player and engage visible guards.
- Opposing force: Russian digital-flora camo, chest rigs after the user's reference photo, AK-74M / AKM; continuous skinned soldier bodies with planted-foot walk/run, aim, IK grip, flinch and death.
- Swedish port signage (HAMNTERMINAL 4, OBEHÖRIGA ÄGA EJ TILLTRÄDE, VARNING – KAJKANT, STOPP …), port set dressing, analytic lamp in-scattering in fog, eye adaptation.
- Audio: synthesized 7.62 battle-rifle report with environment slap-backs, 3D enemy fire, Russian barks and Swedish comrade barks via on-device speech only.
- New Three.js r170 (MIT, vendored) renderer; WebGL 2 with the v0.1 game as WebGL 1 fallback.
- Procedural PBR texture pipeline (`tools/texgen`): asphalt, concrete, container paint with rust runs, hull, steel, galvanised, wood, rubber, rope, camo textiles, AK furniture.
- Rain-wet shading: puddles from a world mask + height map, rain ripple rings, darkening, roughness response, planar reflections with vertical streaking; dark harbour water with lamp glints.
- Bevelled geometry (no blocky edges), real-scale containers with ID stencils, quay, ship, crane, masts, warehouse, contact shadows.
- Night lighting: physically based spot/point lights, PCF shadows, IBL sky, fog, light shafts, bloom, ACES tone mapping, grain/vignette/CA.
- Player kit after user reference: M90-style camo sleeves, green gloves, Ak 5C-style carbine with Aimpoint-style red dot; ADS shows only the red dot.
- Opposing force: digital flora camo, ratnik-green vests, goggles, AK-74M / AKM; IK hands, walk/aim/death animation.
- Procedural audio: rain, sea, machinery hum, ship horn, layered gunshots, positional enemy fire, bullet cracks, impacts, foley.
- Gameplay rules ported 1:1; new deterministic QA hooks; `tests/test_game_v2.py`, `tests/test_static_v2.py`; CI runs both suites.

## v0.1.1 — GitHub-ready project foundation
- Added repository guidance, architecture, art direction and quality gates.
- Added deterministic `?qa=1` game test hooks, static tests and a Playwright browser suite.
- Added GitHub Actions CI definition.
- Visuals remain v0.1 procedural graphics; no photorealistic models added.

## v0.1 — playable prototype
- Standalone WebGL FPS with rain/fog harbour, combat, guards, three sabotage targets and extraction.
- Desktop and mobile inputs.
