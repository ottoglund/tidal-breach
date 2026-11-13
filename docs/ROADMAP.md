# Roadmap — quality gates

## M0 — playable baseline and regression protection
- [x] Preserve the dependency-free playable FPS in `index.html`.
- [x] Add project docs, coding-agent guidance and automated test scripts.
- [x] Set up private GitHub repository.
- [ ] Validate the Chromium test suite in GitHub Actions (do not mark passed until its workflow reports success). *Local headless Chromium (SwiftShader): v0.1 suite 4/4 and v0.2 suite 9/9 passed; CI not yet confirmed.*
- [ ] Test a full mission manually on desktop and iPhone landscape.
- [ ] Record measured baseline frame rates. *Only software-GPU numbers exist (SwiftShader, not representative); in-game overlay (`F9` / `?perf=1`) added for real hardware.*

## M1 — realistic graphical vertical slice
Status: **implemented, partly tested, not accepted** (needs real-device review and FPS evidence).
- [x] Reference cameras locked in `tools/cameras.json`; vertical slice = pier head to Node A (z ≈ +36 … −14, ~50 m), the rest of the route uses the same assets.
- [x] Original procedural assets: ISO 40 ft containers (corrugation, doors, locking gear, ID stencils), quay walls, fenders, bollards, high masts, RTG crane, lofted feeder hull with accommodation, warehouse facade (see `docs/ASSETS.md`). Generated in code rather than glTF files.
- [x] PBR textures (procedural, `tools/texgen`), wet surfaces with puddles, rain ripples and planar reflections, fog, light shafts, floodlight shadows, rain streaks and splashes.
- [x] Bevelled/filleted geometry everywhere (no hard voxel edges), adaptive detail and background LODs.
- [ ] Benchmark WebGL2 compatibility, fallback, frame rate and memory on desktop/iOS Safari. *WebGL1 classic kept as fallback; device benchmarks outstanding.*
- [x] Real renderer screenshots before/after at the same viewpoints: `docs/renders/baseline-v0.1/` vs `docs/renders/v0.2/` (SwiftShader).

**Gate:** visually and measurably improved in-engine scene—not a prerendered illustration.

## M2 — FPS feel and adversaries
- [~] Weapon: Ak 5C-style carbine with see-through Aimpoint-style red dot (no HUD crosshair in ADS), recoil spring, sway, bob, sprint pose, magazine-change reload, muzzle flash light, tracers, impacts/decals, synthesized layered audio with reverb. *Implemented; needs hands-on feel review.*
- [~] Guards: EMR-style digital camo, AK-74M / AKM, two-bone IK grip, walk/aim/flinch/death animation. AI logic unchanged from v0.1 (sight lines and pathing still basic).
- [~] Close-range soldier realism pass (2-6 m): balaclava with a real eye slot and skin head, glasses frame and stylised lens reflection, hem / seams / stronger fold bunching, bloused trouser hems, thicker rig with metal and polymer hardware (two extra material groups: `skin`, `metal`), wet-shoulder and mud shading in rest-pose space, richer idle (breathing, weight shift, glances, aim sway). *Implemented; software-GPU renders only, not accepted; see docs/ACCEPTANCE.md.*
- [~] MakeHuman soldier body: the lofted body is replaced by a clothed human body built offline from the CC0 MakeHuman base mesh (`tools/mh/build_soldier.py` -> `game/assets/models/soldier_body.bin`): real anatomy and proportions, curled gloved hands, balaclava over a real face shape, bloused trousers and boots, skeleton proportions taken from MakeHuman, A-pose bind with the existing pose / IK code, decimated far LOD. Procedural body kept as load-failure fallback. *Implemented; SwiftShader renders only, not accepted; see docs/ACCEPTANCE.md.*
- [~] MakeHuman first-person arms and soldier heads: the viewmodel's procedural hands are replaced by MakeHuman hands / forearms posed on the Ak 4C offline (`tools/mh/build_arms.py` -> `game/assets/models/viewmodel_arms.bin`: fingers closed against a signed-distance model of the rifle, cordura glove with seams and knuckle strip, M90 sleeve with cuff, tab and folds, baked occlusion); thicker ribbed balaclava; bare-headed Home Guard soldiers with short hair and a neck gaiter; MakeHuman eyeballs behind see-through tinted glasses; wrap-lit skin with redness, creases, brows and stubble; smoother boot toes and a softer wrist weight blend. *Implemented; SwiftShader renders only, not accepted; see docs/ACCEPTANCE.md.*
- [~] People realism pass: skin with a measured light-skin albedo (four looks: skin tone, hair, iris), F0 0.028 specular with an oily T-zone, tiled pore / furrow micro-normal (`skin_detail` texture, texgen) and procedural fine creases, subtler wrap; short hair whose density fades over the scalp (no dotted hairline seam), clipped sides, strand texture and anisotropic highlights; a new helmet shell built on the bare head with a Y-strap / chin strap laid on the face; slimmer gloved fingers, the left index wrapped round the handguard, cordura weave / leather palm / stitches / fabric sheen, a weak scene-driven viewmodel fill; boot toe caps reshaped. *Implemented; SwiftShader renders only, not accepted; see docs/ACCEPTANCE.md.*
- [~] Natural soldier motion (procedural, `game/src/characters/anim.js` + `enemies.js`): world-locked foot planting with Raibert-style landing prediction (no skating at walk / jog / 5.5 m/s / strafe / backpedal / turning), speed-driven cadence and duty factor (walk -> tactical jog with flight phase), hip turn toward the travel direction while the upper body stays on target, idle stepper (turn-in-place shuffles, squaring into the bladed stance, stop steps), heel-strike -> toe-off roll, pelvis bob / sway / twist with counter-rotating shoulders, lean into speed and turns, lagging rifle bounce; spring layers for eased aim raise / lower, per-shot recoil (fire events), directional hit flinch with a stagger step, magazine change (comrades: their 2.4 s reload; guards: a cosmetic 1.0 s change inside the fire cooldown, every 4-7 shots); deaths fall away from the shooter (knees buckle with planted feet -> seat / knees -> lying, ground-probed, no floating at rest); comrades follow with arrival steering + hysteresis (no stutter). Neck gaiter top cut along a smooth contour with a rolled hem (asset rebuilt), softer, wider hairline fade. *Implemented; automated tests pass; SwiftShader contact sheets + numeric skate / ground / formation metrics only; not reviewed on real hardware or by the user; not accepted.*
- [x] Projectile hits, collisions and damage covered by `tests/test_game_v2.py` (deterministic `step()` hook).

**Gate:** playable combat and no regression in three-node objective chain.

## M3 — full level and mobile
- [ ] Apply verified asset/art pipeline across mission route.
- [ ] Add level-of-detail, compressed textures and graphics quality presets.
- [ ] Test on real Windows desktop GPU, iOS Safari and Android Chrome.

**Gate:** full mission completion on tested devices with recorded hardware/FPS.

## M4 — release polish
- [ ] Soundscape, tutorial, accessibility, credits and license audit.
- [ ] Final QA and deployment strategy approved by user.

No milestone is "accepted" until its evidence exists.
