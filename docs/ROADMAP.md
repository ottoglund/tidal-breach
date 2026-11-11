# Roadmap — quality gates

## M0 — playable baseline and regression protection
- [x] Preserve the dependency-free playable FPS in `index.html`.
- [x] Add project docs, coding-agent guidance and automated test scripts.
- [x] Set up private GitHub repository.
- [ ] Validate the Chromium test suite in GitHub Actions (do not mark passed until its workflow reports success).
- [ ] Test a full mission manually on desktop and iPhone landscape.
- [ ] Record measured baseline frame rates.

## M1 — realistic graphical vertical slice
- [ ] Choose a 40–60 metre harbour segment and lock a reference camera position.
- [ ] Model or legally source original modular container, crane, warehouse, quay and vessel assets.
- [ ] Introduce glTF 2.0 models and PBR textures, water/wet surfaces, atmospheric fog, floodlights and believable shadows.
- [ ] Benchmark WebGL2 compatibility, fallback, frame rate and memory on desktop/iOS Safari.
- [ ] Produce real renderer screenshots comparing before/after at the same viewpoint.

**Gate:** visually and measurably improved in-engine scene—not a prerendered illustration.

## M2 — FPS feel and adversaries
- [ ] Improve weapon animation, recoil, aiming, reload and sound.
- [ ] Improve guards' sight lines, patrol navigation and obstacle avoidance.
- [ ] Verify projectile hits, collisions and damage.

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
