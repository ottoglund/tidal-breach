# Asset provenance and licences

Every file the game loads is listed here. No photographs, scanned textures,
music or sound samples are used. The only imported third-party model data is
the CC0 MakeHuman base mesh, skeleton weights and targets the soldier body is
built from (section "Models" below).

## Third-party code

| Asset | Author | Licence | Source | Notes |
|---|---|---|---|---|
| `game/vendor/three/three.module.min.js` | three.js authors | MIT (`game/vendor/three/LICENSE`) | https://github.com/mrdoob/three.js, npm `three@0.170.0` | Unmodified build file |
| `game/vendor/three/addons/**` (EffectComposer, RenderPass, ShaderPass, MaskPass, Pass, UnrealBloomPass, OutputPass, SMAAPass, GTAOPass, shaders, BufferGeometryUtils, SimplexNoise, RoundedBoxGeometry) | three.js authors | MIT | same package, `examples/jsm/` | Unmodified copies |

## Textures (original work)

All textures in `game/assets/textures/` are synthesised by
`tools/texgen/make_textures.py` and its modules `ground.py` (asphalt, concrete,
yard mask), `paint.py` (containers, painted steel, hull, cladding, galvanised),
`textiles.py` (camouflage, knit, webbing, cordura, leather) and `noise.py`
(spectral noise, Worley/sized scatter, polyline distance fields, domain warping).
They are original works of this project, contain no photographs or third-party
imagery and can be regenerated bit-for-bit from the scripts (fixed seeds).
Normal maps of the reworked sets are derived from height fields in metres at
the set's real tile size (physically scaled slopes).

| Set | Maps | Use |
|---|---|---|
| asphalt | albedo, normal, orm (AO/rough/height) | yard surface, 4 m tile, 2048 px: multi-size granite/gneiss aggregate (8-16, 4-8, 2-4 mm) in an oxidised binder with sand fines, stones exposed and planed where worn, ravelling pits, hairline cracks, oil drips |
| yardmask | albedo only (lossless RGB mask) | world-scale 64 m mask for the asphalt: R = repair-patch distance field, G = tone (fresh/aged patches, oil and tyre stains, wheel paths, ghosted markings), B = crack-seal / patch-edge sealant distance field |
| concrete | albedo, normal, orm (AO/rough/height) | quay aprons, quay walls; 3 m slab with sawcut joints, broom finish, exposed fines, pop-outs, efflorescence, rust stains, tyre marks |
| container_rust, container_blue, container_green, container_grey, container_orange, container_white | albedo, normal, orm (AO/rough/metal) | ISO containers (3 m x 2.6 m side); chalking, repaint patches, top-rail runs and drips, rust blooming under paint around scratches/dents, forklift/spreader scrapes, road-spray dirt |
| crane_yellow, steel_dark, steel_red | albedo, normal, orm | crane, machinery, drums, funnel; clustered chips through primer to steel, rust runs |
| castiron | albedo, normal, orm | mooring bollards |
| galvanized | albedo, normal, orm | masts, rails, door gear, ladders; spangle, zinc patina, white rust |
| hull | albedo, normal, orm | ship hull; welded plates, plate distortion, rust runs, fender scrapes, touch-ups |
| cladding | albedo, normal, orm | warehouse facade; chalky coat, fixing streaks, cut-edge corrosion |
| wood | albedo, normal, orm | pallets, crates |
| rubber | albedo, normal, orm | fenders, tyres, cables |
| rope | albedo, normal, orm | mooring lines |
| gunmetal, polymer | albedo, normal, orm | weapon |
| fabric_uniform, fabric_vest, fabric_glove | albedo, normal, orm | spare plain textiles |
| camo_m90 | albedo, normal, orm | player-side uniform; procedural splinter pattern in the colours of the Swedish M90 (no image copied), 6.5 mm ripstop |
| camo_emr | albedo, normal, orm | opposing-force uniform; procedural digital pattern in Russian-style flora colours (no image copied), ~3 mm pixels |
| olive_knit, glove_green, khaki_webbing | albedo, normal, orm | balaclava (knit), gloves (cordura), sling (webbing) |
| ratnik_green, boot_leather | albedo, normal, orm | soldier rigs/pouches (olive cordura with 25 mm stitched MOLLE/PALS webbing rows), boots (dark pebbled leather with creases); used by OPFOR and Home Guard soldiers |
| ak_wood, plum_polymer | albedo, normal, orm | AK furniture (dark reddish-brown laminated birch, satin; plum polymer) |

Soldier materials reuse the sets above; no new texture files were added for the close-range soldier pass or the MakeHuman body. Additional soldier surfaces are shader-/material-only: skin (flat dark tone, `plainMat`), metal hardware (`gunmetal` set, recoloured), satin polymer hardware (`polymer` set, recoloured) and the sunglass lenses (physical material plus a stylised procedural reflection in `game/src/enemies.js`, not a captured or photographic reflection).

Soldier insignia (Swedish flag, generic dark "HV" shield) are drawn at runtime on a canvas in `game/src/enemies.js` (original simple graphics, no copied artwork).
| water | normal | harbour water ripples |
| puddles | mask | world-scale puddle / wetness distribution |
| marking | mask | worn road-paint alpha |

## Models

All level geometry (containers, crane, ship, warehouse, light masts, bollards),
the weapons, the soldiers' gear and the first-person hands are generated in
code under `game/src/`.

### Soldier body: `game/assets/models/soldier_body.bin`

| Item | Value |
|---|---|
| File | `game/assets/models/soldier_body.bin` (custom binary, format in `game/src/characters/body.js`), loaded same-origin with `THREE.FileLoader` during the loading screen |
| Built by | `tools/mh/build_soldier.py` (own code; Python 3 + numpy): `python3 tools/mh/build_soldier.py` |
| Derived from | MakeHuman hm08 base mesh `base.obj`, skeleton `default.mhskel`, weights `default_weights.mhw`, macro targets (caucasian young male, muscle / weight / ideal-proportion targets) |
| Author | MakeHuman team; copyright holders at the CC0 release: Data Collection AB, Joel Palmius, Jonas Hauquier |
| Licence | CC0 1.0 Universal (stated in every source file header, in `default_weights.mhw` (`"license": "CC0"`) and in the repository's `LICENSE.ASSETS.md`) |
| Source | https://github.com/makehumancommunity/makehuman (files fetched from `https://raw.githubusercontent.com/makehumancommunity/makehuman/master/...`, exact paths and SHA-256 hashes in `tools/mh/sources/SOURCES.md`) |
| Committed copies | `tools/mh/sources/` (+ `LICENSE.ASSETS.md`, `LICENSE.makehuman.md`); `tools/mh/fetch_sources.sh` re-downloads and verifies them |
| Not used | any MakeHuman program code (AGPL), skins / photographic textures, proxies, clothes |

What the build does to the CC0 data (all own processing): applies the targets
(adult male, muscle 0.70, weight 0.40, 50 % ideal proportions), drops the helper
geometry (keeps the two eyeballs), converts decimetres to metres at a 1.79 m
stature, curls the fingers into a rifle grip, offsets the skin into clothing
(jacket, trousers bloused over boots, boots with flattened toes and a rubber sole,
gloves, knit balaclava with an eye opening), adds fold displacement, maps the
MakeHuman weights onto the game's 19-bone skeleton, triangulates and decimates
(close LOD ~19.5 k triangles, far LOD ~2.6 k). The uniform, knit, glove and boot
surfaces use the original procedural textures listed above; no MakeHuman texture
is used. The build is deterministic (rebuilding gives a byte-identical file).
If the file fails to load, the game falls back to the original procedural
lofted body (`game/src/characters/soldier.js`).

## Audio

All sounds are synthesised at runtime with the Web Audio API
(`game/src/audio.js`). No sample files.
Rifle reports, echoes and outdoor impulse response, casings, bullet snaps, wet footsteps, foley, sea/engine/crane ambience (rain loops removed after listening feedback), squad-radio squelch and static and the fallback enemy "voice" murmur are generated procedurally in code (own work, no third-party audio). Enemy Russian barks use the browser's built-in `speechSynthesis` restricted to on-device voices (`voice.localService === true`); no network voices, no external calls; if no local Russian voice exists a synthesised unintelligible shout is used instead. Swedish comrade barks use on-device Swedish voices the same way, framed by synthesised radio squelch and static.

## Fonts

System fonts only (Arial/Helvetica, Consolas/Menlo).

## Possible future upgrade

Photo-scanned CC0 material libraries (e.g. ambientCG, Poly Haven) would raise
texture realism further. Their hosts are currently blocked from the
development container's network; if they are imported later, each file must
be added to this table with author, URL and licence.
