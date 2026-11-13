"""Dependency-free source checks for the v0.2 renderer (game/)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game"
SRC = {p.relative_to(GAME).as_posix(): p.read_text() for p in (GAME / "src").rglob("*.js")}
HTML = (GAME / "index.html").read_text()
ALL = HTML + "".join(SRC.values())


class GameV2SourceChecks(unittest.TestCase):
    def test_game_rules_present(self):
        game = SRC["src/game.js"] if "src/game.js" in SRC else SRC["game.js"]
        for item in ("shoot()", "reload()", "interact()", "sabotage(n)", "finish(win)", "damage(amount)", "blocked(x, z", "wallHit(ax, az, bx, bz)"):
            with self.subTest(item=item):
                self.assertIn(item, game)
        self.assertIn("this.nodes.every(n => n.done)", game)

    def test_three_nodes(self):
        level = SRC.get("src/world/level.js") or SRC["world/level.js"]
        self.assertEqual(len(re.findall(r"label: 'NOD [ABC]", level)), 3)

    def test_offline_no_external_requests(self):
        # no network calls, analytics or CDN scripts – everything is served from the repo
        self.assertNotRegex(ALL, r"https?://(?!www\.w3\.org)")
        self.assertNotIn("fetch(", ALL)
        self.assertNotIn("XMLHttpRequest", ALL)
        self.assertNotIn("sendBeacon", ALL)

    def test_qa_api_gated(self):
        main = SRC.get("src/main.js") or SRC["main.js"]
        self.assertIn("params.get('qa') === '1'", main)
        self.assertIn("Object.defineProperty(window, '__TIDAL_QA__'", main)

    def test_vendored_three_is_local_and_licensed(self):
        self.assertTrue((GAME / "vendor/three/three.module.min.js").exists())
        self.assertIn("MIT License", (GAME / "vendor/three/LICENSE").read_text())
        self.assertIn('"three":"./vendor/three/three.module.min.js"', HTML)

    def test_textures_documented(self):
        assets = (ROOT / "docs/ASSETS.md").read_text()
        for tex in sorted({p.name.rsplit("_", 1)[0] for p in (GAME / "assets/textures").glob("*.webp")}):
            with self.subTest(texture=tex):
                self.assertIn(tex, assets)

    def test_models_documented(self):
        # every imported model file needs provenance (author, licence, source) in docs/ASSETS.md
        assets = (ROOT / "docs/ASSETS.md").read_text()
        for model in sorted((GAME / "assets/models").glob("*")):
            with self.subTest(model=model.name):
                self.assertIn(f"game/assets/models/{model.name}", assets)
        self.assertIn("CC0", assets)
        self.assertTrue((ROOT / "tools/mh/sources/SOURCES.md").exists())

    def test_low_preset_uses_lite_shaders(self):
        q = SRC["src/quality.js"]
        low, medium, high = (re.search(name + r": \{.*?\n  \},", q, re.S).group(0) for name in ("low", "medium", "high"))
        self.assertIn("liteShading: true", low)
        self.assertIn("liteShading: false", medium)
        self.assertIn("liteShading: false", high)
        # every custom injection reads the tier and keeps its programs apart in the cache
        for f in ("src/characters/cloth.js", "src/characters/skin.js", "src/viewmodel/arms.js"):
            with self.subTest(file=f):
                self.assertIn("SHADER.lite", SRC[f])
                self.assertIn("customProgramCacheKey", SRC[f])
        # the shader failure guard is wired up in main.js
        self.assertIn("renderer.debug.onShaderError", SRC["src/main.js"])

    def test_no_non_constant_shader_loops_or_mediump(self):
        # WebGL2 allows dynamic loops, but the injections keep constant bounds (cheap to unroll on mobile GPUs) and
        # rely on three's highp default (iOS Safari supports highp in fragment shaders)
        for name, src in SRC.items():
            if name.startswith(("src/characters/", "src/viewmodel/")) or name in ("src/fog.js", "src/materials.js"):
                with self.subTest(file=name):
                    self.assertNotRegex(src, r"mediump|lowp")
                    self.assertNotRegex(src, r"for \(int \w+ = [^;]*; \w+ [<>=]+ (?!-?\d)[^;]*;")

    def test_legacy_fallback_link(self):
        self.assertIn("../index.html", HTML)


if __name__ == "__main__":
    unittest.main()
