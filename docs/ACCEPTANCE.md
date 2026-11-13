# Acceptance and test matrix

| Area | Expected outcome | Verification |
|---|---|---|
| Startup | WebGL starts without uncaught JS errors | Automated browser test and manual |
| Movement | W forward, A left, D right; intuitive mouse and touch look | Manual desktop/mobile |
| Weapon | Shooting consumes ammo; pause blocks fire; reload uses reserve | Browser test |
| Objectives | Three nodes can be disabled; extraction requires all three | Browser test and walkthrough |
| Win/lose | Extraction wins, zero HP fails, restart resets everything | Browser test |
| AI | Guards react and navigate without phasing through geometry | Manual walkthrough |
| Mobile | Landscape joystick/look/fire/reload/interact/pause | Emulator and physical device |
| Graphics | Believable models/materials, lights, wet ground; no large clipping errors | Running-game screenshots |
| Performance | Hardware, resolution, FPS and memory measured | Recorded metrics |
| Licensing | Provenance and allowed-use rights documented | Asset audit |

**Status rules:** "Implemented" means code exists, "tested" means tests actually ran, and "accepted" means the milestone passed on target hardware.

## Current evidence (v0.2 renderer, `game/`)

| Area | Status | Evidence |
|---|---|---|
| Startup | tested (headless) | `test_game_v2.py::test_start_and_reset`, `test_renders_frames` |
| Movement / strafe direction / collision | tested (headless) | `test_strafe_direction`, `test_collision_blocks_containers` |
| Weapon, magazine, pause, auto-reload | tested (headless) | `test_weapon_magazine_and_pause`, `test_empty_magazine_auto_reload` |
| Objectives + extraction | tested (headless) | `test_three_nodes_and_extraction` |
| Win/lose/restart | tested (headless) | `test_three_nodes_and_extraction`, `test_damage_to_failure` |
| AI engages | tested (headless) | `test_enemies_engage_and_damage` |
| HV comrades follow | tested (headless) | `test_squad_follows_and_engages` |
| Soldier close-up look (2-6 m) | implemented; SwiftShader renders only | before/after at fixed cameras via `__TIDAL_QA__.soldier()` (QA-only hook); ~20.6k triangles per close soldier (was 17.7k), +2 draw calls per close soldier; not reviewed on real hardware or by the user |
| MakeHuman soldier body | implemented; tests run headless; SwiftShader renders only | CC0 MakeHuman body (`tools/mh/build_soldier.py`, provenance `docs/ASSETS.md`); 26.9 k (OPFOR) / 27.0 k (HV) / 26.6 k (HV helmet) triangles per close soldier (limit 30 k), draw calls per soldier unchanged (9 / 10 / 10 groups), far body 3.2 k triangles in one call; poses checked in renders: idle, walk, aim (`__TIDAL_QA__.soldier({walk, speed, aim})`); spawn view at medium, 1280x720, all passes (`perf()`, SwiftShader): 304 calls / 1.07 M triangles before -> 304 calls / 1.00 M after (far soldiers use the decimated body); `test_static_v2.py::test_models_documented`; not reviewed on real hardware or by the user |
| First-person MakeHuman arms | implemented; tests run headless; SwiftShader renders only | CC0 MakeHuman hands / forearms posed on the Ak 4C offline (`tools/mh/build_arms.py` -> `game/assets/models/viewmodel_arms.bin`, provenance `docs/ASSETS.md`), 10.4 k triangles for both arms (limit 15 k); hip / ADS / recoil / reload / sway code unchanged (arms are attached where the procedural hands were); ADS shows only the red dot (HUD crosshair hidden, unchanged); procedural hands still load if the file is missing (checked by rendering with the file removed); viewmodel draw calls 8 -> 4; inspection renders via the QA-only `__TIDAL_QA__.vmView()`; not reviewed on real hardware or by the user |
| Soldier heads (knit, skin, eyes, hair) | implemented; SwiftShader renders only | 5 mm balaclava stretched over lips / nose tip with procedural rib relief; Home Guard soldiers get a bare MakeHuman head with a short-hair shell and a knit neck gaiter (no glasses), the helmeted one keeps the helmet; skin / eyes / hair are one material (wrap lighting, redness, creases, brows, stubble, iris); close soldier 25.5 k (OPFOR) / 25.6 k (HV) / 25.2 k (HV helmet) triangles, draw calls per soldier unchanged (OPFOR) or one fewer (HV: no glasses); spawn view at medium (`perf()`, SwiftShader): 304 calls / 0.999 M triangles before -> 300 calls / 0.993 M after; not reviewed on real hardware or by the user |
| Mobile controls | implemented, not tested on device | same bindings as v0.1 |
| Graphics | implemented; renders captured | `docs/renders/v0.2/` (SwiftShader software GPU) |
| Performance | **not measured on real hardware** | overlay: `F9` or `?perf=1` |
| Licensing | documented | `docs/ASSETS.md` |

Nothing above is "accepted": acceptance needs a full mission played on real desktop and iPhone hardware with recorded FPS.

**Known gaps:** soldiers still read as game characters rather than photographs at 1-2 m (MakeHuman anatomy now, but clothing is an offset skin with displaced folds, not simulated or sculpted cloth; balaclava knit relief is procedural (shader), not modelled; boots still show faint toe lobes in mesh previews after extra smoothing; no wrist / forearm twist bones (the hand / forearm weight blend is only spread over ~9 cm), so extreme wrist rotation can still pinch; short hair is a shell with a cut-out hairline, not strands; first-person gloves read flat in the dark viewmodel lighting; lenses use a stylised not captured reflection); software-GPU screenshots only; no real-device FPS; soldiers are procedural skinned meshes (not scanned/photographic); AI navigation unchanged from v0.1; comrades are invulnerable and do not take part in objectives; heavy frame cost before the performance pass (641 calls / 5.1 M tris per frame at medium, all passes).
