"""Offline dependency-free source regression tests."""
import re
import unittest
from pathlib import Path

HTML = (Path(__file__).resolve().parents[1] / "index.html").read_text()

class GameSourceChecks(unittest.TestCase):
    def test_renderer(self):
        for item in ("getContext('webgl'", "gl.drawArrays(", "requestAnimationFrame"):
            self.assertIn(item, HTML)

    def test_game_rules(self):
        for item in (
            "function start()", "function shoot()", "function reload()",
            "function interact()", "function sabotage(", "function finish(",
            "function damage(", "function blocked(", "function wallHit("
        ):
            with self.subTest(item=item):
                self.assertIn(item, HTML)

    def test_three_nodes(self):
        self.assertEqual(len(re.findall(r"label:'NOD [ABC]", HTML)), 3)
        self.assertIn("nodes.every(n=>n.done)", HTML)

    def test_offline(self):
        self.assertNotRegex(HTML, r"<script\b[^>]+\bsrc=")
        self.assertNotIn("fetch(", HTML)

    def test_test_api_gated(self):
        self.assertIn("get('qa')==='1'", HTML)
        self.assertIn("Object.defineProperty(window,'__TIDAL_QA__'", HTML)

    def test_asphalt_aggregate_and_aged_cracks(self):
        self.assertIn("Pebbled aggregate", HTML)
        self.assertIn("Thin branching cracks", HTML)
        self.assertIn("g.ellipse(x,y,rx,ry", HTML)

    def test_recoil_moves_weapon_and_bullet_together(self):
        self.assertIn("recoilPitch", HTML)
        self.assertIn("pitch+rr(-spread,spread)+recoil*.72", HTML)
        self.assertIn("recoil*=Math.exp", HTML)
        self.assertIn("Math.min(.24,recoil+(player.ads?.042:.062))", HTML)

if __name__ == "__main__":
    unittest.main()



class PreviewGeneratorChecks(unittest.TestCase):
    def test_preview_has_distinct_procedural_enemy_camouflage(self):
        generator = (Path(__file__).resolve().parents[1] /
                     "tools" / "build_quay_preview.py").read_text()
        self.assertIn("function createRussianCamoTexture()", generator)
        self.assertIn("function createRussianEnemy()", generator)
        self.assertIn("createRussianCamoTexture();", generator)
        self.assertIn("operatorFabric", generator)
        self.assertIn("AIMPOINT", generator)
        self.assertIn("steel.box(x,opticY,-.174", generator)


