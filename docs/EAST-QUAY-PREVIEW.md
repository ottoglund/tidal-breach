# East quay preview

The prototype covers 50 metres of the east quay, from z = 20 m to z = −30 m. The existing WebGL renderer draws the new geometry and materials. It adds fenders, drainage grates, capped bollards, mooring lines, quay markings and fittings around the ship. A wetness mask varies the quay's asphalt sheen, and animated waves change the water's surface normal and floodlight highlights. The added geometry and shading are original procedural work with no external asset dependencies.

## Build and run

From the repository root, run:

```sh
python tools/build_quay_preview.py /tmp/tidal-preview
python -m http.server 8000 --bind 127.0.0.1 --directory /tmp/tidal-preview
```

Open [quay.html](http://127.0.0.1:8000/quay.html) to play the prototype. It uses the same mission and controls as the main game. The generated HTML also works as a standalone file. On Windows, use a writable directory such as `preview-output` in both commands.

## Fixed camera

Open [baseline](http://127.0.0.1:8000/baseline.html?reference=1) and [east quay](http://127.0.0.1:8000/quay.html?reference=1) in the same viewport. Both builds use position (32.4, 1.73, 21.8) in metres, yaw 0.24 rad, pitch −0.075 rad and scene time 8 seconds. The reference view hides the menu and weapon and freezes gameplay. Compare at 1280 × 720 on desktop and 844 × 390 in landscape touch mode. The Playwright suite captures all four frames.

## Operator equipment

The user's reference photo sets the look of the playable operator. The first-person model uses an original angular woodland fabric texture, olive gloves, a matte rifle silhouette, an open circular optic and khaki webbing. The photo is used as visual reference and is not embedded in the build. The full uniform silhouette is a reference for future third-person work.

Inspect [the first-person model](http://127.0.0.1:8000/quay.html?reference=operator) and [the sight picture](http://127.0.0.1:8000/quay.html?reference=operator-ads) from the same fixed camera. The browser suite captures both views on desktop.

## Remaining M1 work

Validate the captured renders visually and complete the mission on a desktop GPU and on physical iOS hardware in landscape. Record the browser, hardware, render resolution, FPS and memory before selecting the production renderer. The current preview uses procedural WebGL1 shading. glTF, a full PBR material pipeline and scene shadows remain part of the milestone.

