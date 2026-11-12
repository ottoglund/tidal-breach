# Asset provenance and licences

Every file the game loads is listed here. No photographs, scanned textures,
downloaded models, music or sound samples are used.

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
| ratnik_green, boot_leather | albedo, normal, orm | OPFOR vest/helmet cover (cordura), boots (pebbled leather) |
| ak_wood, plum_polymer | albedo, normal, orm | AK furniture (laminated wood, plum polymer) |
| water | normal | harbour water ripples |
| puddles | mask | world-scale puddle / wetness distribution |
| marking | mask | worn road-paint alpha |

## Models

All geometry (containers, crane, ship, warehouse, light masts, bollards,
guards, weapon and hands) is generated in code under `game/src/`. No external
model files.

## Audio

All sounds are synthesised at runtime with the Web Audio API
(`game/src/audio.js`). No sample files.

## Fonts

System fonts only (Arial/Helvetica, Consolas/Menlo).

## Possible future upgrade

Photo-scanned CC0 material libraries (e.g. ambientCG, Poly Haven) would raise
texture realism further. Their hosts are currently blocked from the
development container's network; if they are imported later, each file must
be added to this table with author, URL and licence.
