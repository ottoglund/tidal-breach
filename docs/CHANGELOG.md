# Changelog

## v0.3.0-dev — people, audio, Windows server, mobile shader safety (in `game/`, implemented / tested headless, not accepted)
Nothing here has run on a real GPU, iPhone or Windows PC yet; every number below is from headless Chromium on SwiftShader (a software GPU) or from reading the compiled GLSL.

**People (implemented; SwiftShader renders only)**
- Soldiers rebuilt on the CC0 MakeHuman body (`game/assets/models/soldier_body.bin`, first-person arms `viewmodel_arms.bin`; provenance in `docs/ASSETS.md`), bare-headed Home Guard soldiers with hair, eyes and wrap-lit skin (`characters/skin.js`), a fabric layer with ripstop / twill relief, joint-flexion folds, seams and wear (`characters/cloth.js`), and procedural locomotion / combat animation (`characters/anim.js`).
- Procedural body / hands remain as fallback when the `.bin` files cannot be loaded (now covered by tests: missing and corrupt files).

**Soldiers at gameplay range (implemented; SwiftShader renders only; not accepted)**
- Deaths avoid obstacles: the fall direction is turned (or reversed) until the final pose and the dropped rifle are clear of the collision boxes; a soldier backed against a container slumps sitting against it. Arms are laid on the ground by IK (no more arms raised off the ground), three final-pose variants per direction (`enemies.js` `startDeath`, `setWorldProbe` wired to `Game.blocked`).
- Soldier rifles at real proportions (front end ~10 cm shorter; AK gas block at the end of the gas tube); two-point sling over the left shoulder skinned to six extra bones in the existing nylon material group; muzzle flash is now flame / side-jet planes and an end-on star (canvas texture drawn in code, one draw call) instead of a sphere.
- Wet weather: cloth water film and run-off streaks (`cloth.js`), rain bursts on the nearest soldiers' shoulders / heads inside the existing splash draw call (`atmosphere.js`), soft contact shadows under all soldiers in one instanced draw call (`characters/contact.js`).
- First-person grip: contact step in `tools/mh/build_arms.py` (glove surface facing the rifle within 13 / 9 mm drawn onto it), reachable right-thumb target, `viewmodel_arms.bin` rebuilt.
- Rifle lag spring starts at rest (no swing on a soldier's first frame). QA: `soldier()` settles pose springs over 1.5 s of simulated frames, takes `add`, `flash`, `fallDir`, `hitX` / `hitZ`; `blockers(x, z, r)`; new `tools/range_shots.js` survey (5-25 m, medium / high, obstacle scene).

**Audio (implemented; needs listening on real hardware)**
- Rain-loop ambience removed (reported as synthetic); Swedish comrade barks use on-device speech at a faster rate with a squelch click, static bed and squelch tail to read as group radio. Browser speech cannot be filtered through Web Audio, so the voices themselves are not band-limited.

**Windows**
- `serve.ps1`: dependency-free localhost web server (PowerShell + `HttpListener`, serves only the repo folder, no external calls) for machines without Python or Node.

**Mobile / iOS shader safety (implemented; tested headless; no device run)**
- New shader tier (`SHADER.lite` in `game/src/quality.js`): the `low` preset (default on touch devices) uses simplified cloth / skin / arm shading: no yarn relief, drape, folds, seams, wear, edge wear, boot creases or knit rib on cloth; no pore normal map, face creases or bump on skin; no cordura weave / pebble loop on gloves and no yarn relief on sleeves. Mud, wet soak, roughness variation, sheen, redness, brows, stubble, hair and eyes stay. `medium` / `high` are unchanged (checked by before / after renders at medium: differences are within run-to-run noise). Override with `?lite=1|0`.
- Fewer varyings without any visual change: `vFogDepth` is derived from `vFogView` in the fog chunk, and materials whose map / normal / roughness / AO / metalness slots share one UV transform (all PBR sets) now read the albedo's `vMapUv` instead of three extra `vec2` varyings (`shareMapUv` in `materials.js`).
- Shader failure guard: if a program fails to compile / link while full shading is active, `renderer.debug.onShaderError` switches every material to the lite variants and recompiles once (`main.js`); simulated in a test.
- Weapon scene is now pre-compiled at boot as well (no first-shot compile hitch).
- `tools/shader_audit.js`: compiles every program at a preset and reports varying / uniform / sampler counts per program (see README, numbers in `docs/ACCEPTANCE.md`).
- QA hooks (only with `?qa=1`): `enemyList()`, `route(x, z)` (grid path planner), `shaderTier()`.

**Tests**
- `tests/test_game_v2.py`: `test_full_mission_run` (q=low, squad on, guards alive; spawn -> restart mid-run -> Node A -> B (pause / resume) -> C -> extraction; asserts win, no page errors, no NaN / inf positions; ~35 s), `test_missing_model_files_fall_back_to_procedural` (missing and corrupt `.bin`), `test_shader_failure_falls_back_to_lite_shading`. `tests/test_static_v2.py`: preset tiers, no `mediump` / non-constant loop bounds in the injections. `tests/conftest.py`: one shared Playwright browser (running `pytest tests/` used to fail 10 browser tests because two suites each started their own sync Playwright). Whole run: 33 passed, ~5 min.

**Renders**
- `docs/renders/v0.3/` (desktop high 1600x900, landscape mobile low 844x390, JPEG q85) at the four fixed cameras; before / after sheets in `docs/renders/compare/` (`v0.2_vs_v0.3_*`, `v0.1_vs_v0.3_*`, plus `tier_low_lite_vs_full_*` for the shader tiers). Caution: `docs/renders/v0.2/` was rendered before the Ak 4C / HUD / people work, so the v0.2 -> v0.3 sheets show all of that, not just this release's changes. The four fixed cameras do not frame soldiers up close.
- `tools/capture.js` accepts `VIEWPORT=WxH` / `DSF=n`; `tools/compare.py` takes `--prefix` and any image type; `tools/soldier_shots.js` renders soldier close-ups.

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
