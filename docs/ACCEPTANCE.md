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

**Known gap:** browser test suite and real-device test coverage must be rerun after import. Current scene uses basic procedural models; it is not photorealistic.
