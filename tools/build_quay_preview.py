"""Build standalone WebGL previews from the current game baseline."""

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The detailed quay runs from z=20 to z=-30 along the eastern waterfront.
QUAY_GEOMETRY = """
const dockSteel = [.29,.35,.37];
const dockRubber = [.09,.12,.14];
const dockYellow = [.72,.49,.19];
S('quayWater').floor(39.35,-5,6.25,50,-.22,[1,1,1],1);

for (const z of [18,11,4,-3,-10,-17,-24]) {
  S('concrete').box(36.51,-.16,z,.27,.83,6.94,[.41,.45,.44]);
  S('metal').box(36.70,-.02,z,.13,.57,1.10,dockRubber);
  S('metal').box(36.78,-.02,z,.06,.42,.80,dockRubber);
  S('metal').box(35.02,.027,z,.28,.025,1.07,dockSteel);
  for (let slat = -4; slat <= 4; slat++) {
    S('metal').box(35.02,.042,z+slat*.105,.25,.009,.026,dockRubber);
  }
}

for (const z of [12,-4,-20]) {
  S('metal').box(35.23,.15,z,.53,.17,.73,dockRubber);
  S('metal').cylinder(35.23,.45,z,.18,.52,dockSteel,12);
  S('metal').cylinder(35.23,.72,z,.25,.11,dockYellow,12);
  S('glow').box(35.77,1.57,z,.07,.11,.23,[.66,.44,.20]);
}

for (const z of [10,-18]) {
  const line = [.39,.34,.24];
  S('wood').beam(36.20,1.03,z,38.85,.68,z-1.4,.062,line);
  S('wood').beam(38.85,.68,z-1.4,41.96,1.17,z-3.1,.062,line);
}

for (let z = -29; z < 20; z += 2.8) {
  S('hazard').floor(34.86,z,.16,1.32,.017,[.71,.64,.42],1);
}

for (const z of [7,-5,-17]) {
  S('metal').box(42.91,12.44,z,.34,.14,1.92,dockSteel);
  S('metal').box(42.90,10.99,z,.42,.11,1.96,dockSteel);
  S('glow').box(42.74,10.75,z,.09,.16,.33,[.95,.70,.34]);
}
"""

QUAY_SHADING = """
// Use metre-scale surface coordinates so wear stays aligned across mesh faces.
float quay = step(30.0,vPos.x)*step(-30.0,vPos.z)*step(vPos.z,20.0);
quay *= 1.0-uNoFog;
vec2 p = vPos.xz;
if (uWet > 1.5) {
  float waveA = sin(dot(p,vec2(4.4,2.0))-uTime*1.35);
  float waveB = sin(dot(p,vec2(-1.7,5.3))+uTime*.86);
  vec3 surface = normalize(vec3(.09*waveA+.045*waveB,1.,.04*waveA+.11*waveB));
  float grazing = pow(1.-max(dot(surface,eye),0.),4.);
  float lamp = pow(max(dot(surface,normalize(normalize(l1)+eye)),0.),52.);
  float foam = smoothstep(.94,1.,waveA*.72+waveB*.28)
             * (1.-smoothstep(36.3,37.3,p.x));
  color = mix(vec3(.014,.028,.034),vec3(.078,.117,.147),grazing)
        + vec3(.29,.54,.64)*lamp*.55 + vec3(.10,.13,.13)*foam;
} else if (quay > .5 && n.y > .6 && abs(vPos.y) < .12 && uWet > .3) {
  float pools = sin(p.x*2.1+sin(p.y*.55))*cos(p.y*1.1)
              + .34*sin(p.y*3.0+p.x);
  float wet = smoothstep(.23,.60,pools);
  float grain = sin(p.x*43.0)*sin(p.y*47.0);
  vec3 ripple = normalize(n+vec3(.035*sin(p.y*13.),0.,.035*cos(p.x*17.)));
  float facing = pow(1.-max(dot(ripple,eye),0.),4.);
  float reflection = pow(max(dot(ripple,normalize(normalize(l1)+eye)),0.),32.);
  color = color*(1.-wet*.42+grain*.06)
        + wet*(vec3(.049,.078,.108)*facing+vec3(.21,.32,.36)*reflection);
}
"""

REFERENCE_CAMERA = """
const quayReference = new URLSearchParams(location.search).get('reference') === '1';
if (quayReference) {
  document.body.insertAdjacentHTML('beforeend', '<style>#menu{display:none}</style>');
  Object.assign(player, {x:32.4, y:1.73, z:21.8, yaw:.24, pitch:-.075});
}
"""


def replace_once(source, original, replacement):
    if source.count(original) != 1:
        raise ValueError(f"Expected exactly one baseline anchor: {original[:80]}")
    return source.replace(original, replacement, 1)


def build(source, enhanced):
    source = replace_once(source, "let old=performance.now()", REFERENCE_CAMERA + "\nlet old=performance.now()")
    source = replace_once(source, "try{update(dt,now);render(now);}",
                          "try{if(!quayReference)update(dt,now);render(quayReference?8:now);}")
    source = replace_once(source, "for(const geo of gunMesh)drawMesh(",
                          "if(!quayReference)for(const geo of gunMesh)drawMesh(")
    if enhanced:
        source = replace_once(source, "float dist=length(vPos-uEye);",
                              QUAY_SHADING + "float dist=length(vPos-uEye);")
        source = replace_once(source, "const RENDERGROUPS=[];",
                              QUAY_GEOMETRY + "\nmaterials.quayWater = materials.hull;\nconst RENDERGROUPS=[];")
        source = replace_once(source, "key==='asphalt'?.78:",
                              "key==='quayWater'?2:key==='asphalt'?.78:")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Directory for the two generated HTML files")
    args = parser.parse_args()
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    pages = {"baseline.html": build(source, False), "quay.html": build(source, True)}
    args.output.mkdir(parents=True, exist_ok=True)
    for name, page in pages.items():
        (args.output / name).write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
