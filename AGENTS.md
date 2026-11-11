# Instructions for coding agents – TIDAL BREACH

**Goal:** turn the currently playable but graphically basic FPS into a convincing, cinematic, highly detailed single-player port environment. The user's priority is realism and quality over speed.

1. Preserve the working game in `index.html` until its replacement meets feature parity.
2. Keep forward/right/left controls consistent (do not mirror input); support mouse and mobile touch.
3. Do not break shooting, magazine/reload, damage/armour, pause/restart, 3-node objective chain or extraction.
4. Separate **implemented**, **tested**, **accepted** and **planned** work. Don't invent benchmarks or call this AAA.
5. Avoid unlicensed imagery, music and models. Document author, license and URL for each imported asset.
6. Design a 40–60-metre quay visual vertical slice before overhauling the entire map.
7. Compare before/after **actual game renders** at fixed camera coordinates (desktop and landscape mobile).
8. Choose rendering stack based on on-device benchmarking, not hype; keep iOS Safari compatibility and a WebGL fallback.
9. Run automated tests and manually check a complete mission on real hardware before calling it done.
10. Don't introduce data collection, payments, accounts or unexplained external calls.

Review docs/ROADMAP.md and docs/ACCEPTANCE.md before making changes. Update both after each accepted milestone.