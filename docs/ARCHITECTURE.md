# Architecture and rendering migration

## Current baseline
`index.html` is a self-contained, offline-capable WebGL1 game with programmatic meshes/textures, JavaScript gameplay, audio and desktop/mobile controls. It is simple to run but unsuitable for production-grade asset authoring at scale.

## Candidate next rendering stack
Benchmark **Babylon.js** and **Three.js** for PBR metallic/roughness materials, glTF 2.0, directional shadows, light probes, fog, tone mapping, GPU-instancing and scalable quality levels. Prefer WebGL2 with a compatible fallback over making WebGPU mandatory on mobile. If targeting native desktop AAA fidelity, plan a distinct Unreal/Unity delivery track, rather than overstating HTML's visual ceiling.

## Boundaries
- Game state and mission rules
- Desktop/touch input adapters
- Scene and asset loading
- Rendering, postprocessing and camera
- AI/navigation and collision
- Audio and HUD
- Automated integration tests

## Migration
**Preserve the current working `index.html`.** Build the realistic quay as a separate proof-of-concept first. Promote it to the game only when it preserves shooting, movement, combat, all three sabotage nodes, and extraction. Avoid runtime dependency on unreviewed CDNs. No accounts, tracking, payments or unexplained network calls.
