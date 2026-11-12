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
| Mobile controls | implemented, not tested on device | same bindings as v0.1 |
| Graphics | implemented; renders captured | `docs/renders/v0.2/` (SwiftShader software GPU) |
| Performance | **not measured on real hardware** | overlay: `F9` or `?perf=1` |
| Licensing | documented | `docs/ASSETS.md` |

Nothing above is "accepted": acceptance needs a full mission played on real desktop and iPhone hardware with recorded FPS.

**Known gaps:** software-GPU screenshots only; no real-device FPS; guards are procedural (no skinned/rigged mesh); AI navigation unchanged from v0.1.
