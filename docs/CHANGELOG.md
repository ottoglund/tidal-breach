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

### MakeHuman soldier body (implemented, SwiftShader renders only, not accepted)
- Soldiers (OPFOR and HV) now use a clothed human body built offline from the CC0 MakeHuman base mesh, skeleton weights and macro targets (`tools/mh/build_soldier.py` -> `game/assets/models/soldier_body.bin`, sources and hashes in `tools/mh/sources/SOURCES.md`, provenance in `docs/ASSETS.md`).
- Real anatomy: face shape under the balaclava (eye opening with skin and eyeballs behind the glasses), gloved hands with fingers curled around the grip, bloused trousers, boots with toe box and rubber sole, jacket hem and collar, fabric folds at elbows / knees / waist.
- Skeleton proportions from MakeHuman (1.79 m); the mesh is bound in its A pose and the existing pose / IK / death code runs unchanged on the identity rest pose (body-dependent constants in `soldier.js` `RIG`). Gear is refitted to the new torso and head.
- Same draw calls per soldier; ~26.9 k triangles per close soldier (was ~20.6 k); a decimated ~3.2 k far body is used beyond 42 m, in puddle reflections and for shadows beyond 12 m.
- The procedural lofted body remains as fallback if the asset cannot be loaded.

### Performance pass (implemented, measured headless only)
- New `game/src/world/props/lod.js`: static parts merged per material/zone, small props on a main-view-only DETAIL layer, container field with 4 distance LODs, shadow-pass stand-ins, shadow freeze for far masts, instanced drums/glows/light shafts, soldier LOD.
- Draw calls / triangles per frame (all passes, SwiftShader, `perf()`): medium spawn 641 / 5.1 M → 302 / 1.04 M; low spawn 243 / 1.42 M → 148 / 565 k; high spawn 1524 / 13.6 M → 656 / 2.4 M.
- Trade-offs: small props no longer mirrored in puddles, no shadows from parts under 1.7 m (drums kept), far soldiers simplified. Not timed on a real GPU; iOS Safari check pending.

### Audio feedback round 1 (from user listening test on Windows)
- Rain ambience loops (roar, hiss, drops, drips) removed: reported as synthetic ("like shells").
- Swedish comrade barks: faster (rate 1.55), fixed radio level, squelch-open click + band-limited static bed + squelch tail so they read as group radio. Browser speech cannot be filtered through Web Audio, so the voice itself is not band-limited.
