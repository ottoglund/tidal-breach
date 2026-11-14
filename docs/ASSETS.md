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
| camo_m90 | albedo, normal, orm | player-side uniform; procedural splinter pattern (4-16 cm shards) in colours of the Swedish M90 estimated from own knowledge (no image copied or sampled; luminance steps kept even so the pattern survives sodium light), 5.5 mm ripstop with yarn slubs, pilling in abraded areas; 1024 px over 0.45 m |
| camo_emr | albedo, normal, orm | opposing-force uniform; procedural digital pattern in Russian-style flora colours estimated from own knowledge (no image copied or sampled), ~3 mm pixels in 2-10 cm clusters, 5.5 mm ripstop with yarn slubs, pilling; 1024 px over 0.4 m |
| olive_knit, glove_green, khaki_webbing | albedo, normal, orm | balaclava (knit), gloves (cordura), sling (webbing) |
| ratnik_green, boot_leather | albedo, normal, orm | soldier rigs/pouches (olive cordura with 25 mm stitched MOLLE/PALS webbing rows), boots (dark pebbled leather with creases); used by OPFOR and Home Guard soldiers |
| ak_wood, plum_polymer | albedo, normal, orm | AK furniture (dark reddish-brown laminated birch, satin; plum polymer) |
| skin_detail | normal (lossless; R, G = tangent-space normal X / Y, B = cavity) | soldiers' faces: skin micro-relief over a 24 mm tile (47 um texels) - pores on a jittered ~0.55 mm grid and broken, domain-warped Worley furrows, height in metres; tiled in the face's metric UVs by `game/src/characters/skin.js` (`make_textures.py skin_detail`) |

Soldier materials reuse the sets above; the only texture added for the people is `skin_detail` (synthesised, see the table). Additional soldier surfaces are shader-/material-only: skin, eyes and short hair (`game/src/characters/skin.js`: albedo per look in the measured light-skin range, procedural mottling, capillary redness, small moles, eyelid creases, eyebrows, stubble tinted by the hair colour, procedural forehead / crow's-feet / under-eye / nasolabial / neck creases as a bump, skin specular F0 0.028 with an oily T-zone, iris / sclera / lid shadow, scalp hair-density fade (~2.5 cm, strand-broken, low-pass filtered hairline), hair strands with Kajiya-Kay style anisotropic highlights, wrap lighting; all evaluated from the bind-pose position, no image data except `skin_detail`; six looks - skin tone from fair to medium brown, hair from blond to black, iris colour - in `LOOKS`), the knitted rib relief of the balaclava and the uniform / gear / boot surface layers (`game/src/characters/cloth.js`, procedural, no image data: analytic ripstop double-yarn and 2/1 twill relief aligned with the `camo_*` texture grid and faded below a pixel, compression folds at elbows / knees / hips driven by each soldier's own bone matrices in the vertex shader, sewn seams and panel dye-lot shifts placed from the body's bind-pose segments, high-point and seam abrasion with pilling, physically motivated wet darkening, curvature-based cordura edge wear, boot vamp flex creases and scuffed toe caps; the first-person sleeves reuse the yarn relief and add fold-crest wear in `game/src/viewmodel/arms.js`), metal hardware (`gunmetal` set, recoloured), satin polymer hardware (`polymer` set, recoloured) and the sunglass lenses (semi-transparent physical material plus a stylised procedural reflection in `game/src/enemies.js`, not a captured or photographic reflection). The first-person glove seams and stitches, knuckle strip, cordura basket weave, pebbled synthetic-leather palm, fold relief, fabric sheen, wear and sleeve stitching are drawn by `game/src/viewmodel/arms.js` from per-vertex data in the arms file (no textures beyond `glove_green` / `camo_m90`). The Home Guard helmet on the bare head (shell, rails, shroud, counterweight, Y-strap and chin strap laid on the face surface) is generated in `game/src/characters/soldier.js` (`helmetMH`, `chinStrap`) from the body asset's own head vertices.

Soldier insignia (Swedish flag, generic dark "HV" shield) are drawn at runtime on a canvas in `game/src/enemies.js` (original simple graphics, no copied artwork).

The soldiers' muzzle flash (side-view flame with ragged streaks and an end-on petalled star) is also drawn at runtime on a canvas in `game/src/enemies.js` (`flashParts`, own work, no image data). The rifle sling (webbing strap over the left shoulder, `slingGeometry` in `game/src/characters/soldier.js`), the rain-water film / run-off streaks on wet cloth (`game/src/characters/cloth.js`), the rain bursts on soldiers' shoulders and heads (`createSplashes` in `game/src/world/atmosphere.js`) and the soft ground contact shadows under soldiers (`game/src/characters/contact.js`) are procedural geometry / shader code (own work, no image data). Also own code, no image data: the sling's rope simulation (`updateSling`, `game/src/enemies.js`), the face animation (`updateFace`: blinks, gaze, speech-driven jaw / brows; rotation sizes from the CC0 MakeHuman face pose units, see the Models section), the breath vapour puffs (extra instances in the splash draw call, `game/src/world/atmosphere.js`), wet skin / hair / teeth shading (`game/src/characters/skin.js`), rain beads and fibre sheen on cloth (`cloth.js`) and the per-soldier ground-bounce light probe (`game/src/characters/probe.js`).
| water | normal | harbour water ripples |
| puddles | mask | world-scale puddle / wetness distribution |
| marking | mask | worn road-paint alpha |

## Models

All level geometry (containers, crane, ship, warehouse, light masts, bollards),
the weapons and the soldiers' gear are generated in code under `game/src/`. The
soldier body and the first-person forearms / hands are built offline from the
CC0 MakeHuman base mesh (below); the old procedural first-person hands
(`game/src/viewmodel/hands.js`) remain as the load-failure fallback.

### Soldier body: `game/assets/models/soldier_body.bin`

| Item | Value |
|---|---|
| File | `game/assets/models/soldier_body.bin` (custom binary, format in `game/src/characters/body.js`), loaded same-origin with `THREE.FileLoader` during the loading screen |
| Built by | `tools/mh/build_soldier.py` (own code; Python 3 + numpy): `python3 tools/mh/build_soldier.py` |
| Derived from | MakeHuman hm08 base mesh `base.obj` (body, eyeball and teeth helpers), skeleton `default.mhskel`, weights `default_weights.mhw` (incl. the face bones), macro targets (caucasian young male, muscle / weight / ideal-proportion targets); face pose units `face-poseunits.bvh` / `.json` (read offline by `tools/mh/poseunits.py` for the lid / eye / jaw rotation sizes; not shipped) |
| Author | MakeHuman team; copyright holders at the CC0 release: Data Collection AB, Joel Palmius, Jonas Hauquier |
| Licence | CC0 1.0 Universal (stated in every source file header, in `default_weights.mhw` (`"license": "CC0"`) and in the repository's `LICENSE.ASSETS.md`) |
| Source | https://github.com/makehumancommunity/makehuman (files fetched from `https://raw.githubusercontent.com/makehumancommunity/makehuman/master/...`, exact paths and SHA-256 hashes in `tools/mh/sources/SOURCES.md`) |
| Committed copies | `tools/mh/sources/` (+ `LICENSE.ASSETS.md`, `LICENSE.makehuman.md`); `tools/mh/fetch_sources.sh` re-downloads and verifies them |
| Not used | any MakeHuman program code (AGPL), skins / photographic textures, proxies, clothes, expression modifiers (the face pose units are only read for rotation sizes) |

What the build does to the CC0 data (all own processing): applies the targets
(adult male, muscle 0.70, weight 0.40, 50 % ideal proportions), drops the helper
geometry (keeps the two eyeballs), converts decimetres to metres at a 1.79 m
stature, curls the fingers into a rifle grip, offsets the skin into clothing
(jacket, trousers bloused over boots, boots with smoothed toe boxes - the toe region is pushed out to its local hull, the cap wall and dome are moved onto an analytic super-ellipse toe cap, and the shading normals of the boot fronts are smoothed after decimation - and a rubber sole,
gloves, a 5 mm knit balaclava stretched over the lips and nose tip with an eye
opening, the knit below the jaw doubling as a neck gaiter - its top follows a
smooth contour: the faces the cut line crosses are split along it, and a
half-round rolled hem strip is added from the knit surface down to the skin),
adds a second,
bare head (the undressed MakeHuman face and neck plus a short-hair shell) for
the Swedish soldiers, keeps the MakeHuman eyeballs and upper / lower teeth, adds fold displacement,
maps the MakeHuman weights onto the game's 19-bone skeleton (with a longer
hand / forearm blend at the wrist) plus a 9-bone face rig (jaw, eyes, upper / lower lids, brows: each the sum of
the MakeHuman face bones below it, pivots at the MakeHuman joints; the balaclava keeps only the jaw), triangulates and decimates (close LOD
23.6 k triangles holding both heads, ~18.3 k (balaclava) / ~19.0 k (bare head)
used per soldier; far LOD ~2.6 k). The uniform, knit, glove and boot
surfaces use the original procedural textures listed above; no MakeHuman texture
is used. The build is deterministic (rebuilding gives a byte-identical file).
If the file fails to load, the game falls back to the original procedural
lofted body (`game/src/characters/soldier.js`).

### First-person arms: `game/assets/models/viewmodel_arms.bin`

| Item | Value |
|---|---|
| File | `game/assets/models/viewmodel_arms.bin` (same `TBMH` container as the soldier body, parsed by `parseTBMH` in `game/src/characters/body.js`; layout in `game/src/viewmodel/arms.js`), loaded same-origin with `THREE.FileLoader` during the loading screen |
| Built by | `tools/mh/build_arms.py` (own code; Python 3 + numpy; reuses the body preparation of `build_soldier.py`): `python3 tools/mh/build_arms.py` |
| Derived from | the same CC0 MakeHuman files as the soldier body (`base.obj` hands and forearms, `default.mhskel`, `default_weights.mhw` finger / wrist / forearm weights, the macro targets); no additional files fetched |
| Author / Licence / Source | as for the soldier body above (MakeHuman team, CC0 1.0, `tools/mh/sources/SOURCES.md`) |
| Not used | any MakeHuman program code (AGPL), skins, textures, proxies, clothes |

What the build does (all own processing): selects the MakeHuman hand and forearm
of each side, subdivides the sleeve once (Catmull-Clark), places the hands on the
Ak 4C in the viewmodel's gun space (right hand on the pistol grip with the index
along the receiver, left hand under the handguard with the thumb along its left
side), slims the fingers (radius x 0.86 about each phalanx axis), closes every finger by searching MCP / PIP / DIP angles against a
signed-distance model of the rifle (the left index is solved toward a wrap target round the handguard) (linear-blend skinning with the MakeHuman
finger weights; the A-pose finger spread is closed), swings the forearm toward
the old viewmodel's elbow direction, dresses a 1.8 mm cordura glove (longer
fingertips, padded knuckle strip, gauntlet with strap) and a baggy M90 sleeve
(bunched folds, snug hemmed cuff with a tab, inner lip showing the cloth
thickness), and bakes per-vertex ambient occlusion (rays against a voxelised
copy of the arm and the rifle) plus seam / strip / palm fields used by the
shader. ~10.4 k triangles for both arms (5.2 k each). If the file fails to load,
the procedural hands are used. A last contact step (`conform`) draws the glove
surface that faces the rifle within 13 mm (left hand, handguard) / 9 mm (right
hand, grip) onto it with a smoothed falloff (soft tissue under grip pressure) and
pushes any penetration out; the right thumb is solved toward a reachable spot on
the left side of the pistol grip.

## Audio

All sounds are synthesised at runtime with the Web Audio API
(`game/src/audio.js`). No sample files.
Rifle reports, echoes and outdoor impulse response, casings, bullet snaps, wet footsteps, foley, sea/engine/crane ambience (rain loops removed after listening feedback), squad-radio squelch and static and the fallback enemy "voice" murmur are generated procedurally in code (own work, no third-party audio). Enemy Russian barks use the browser's built-in `speechSynthesis` restricted to on-device voices (`voice.localService === true`); no network voices, no external calls; if no local Russian voice exists a synthesised unintelligible shout is used instead. Comrade radio barks are in English (changed from Swedish after listening feedback) and use on-device English voices the same way, framed by synthesised radio squelch and static.

## Fonts

System fonts only (Arial/Helvetica, Consolas/Menlo).

## Possible future upgrade

Photo-scanned CC0 material libraries (e.g. ambientCG, Poly Haven) would raise
texture realism further. Their hosts are currently blocked from the
development container's network; if they are imported later, each file must
be added to this table with author, URL and licence.
