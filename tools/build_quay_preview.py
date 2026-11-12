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

QUAY_NOISE = """
float quayHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx)*vec3(.1031,.1030,.0973));
  p += dot(p,p.yzx+19.19);
  return fract((p.x+p.y)*p.z);
}
float quayNoise(vec2 p) {
  vec2 cell = floor(p), blend = fract(p);
  blend = blend*blend*(3.-2.*blend);
  return mix(mix(quayHash(cell),quayHash(cell+vec2(1.,0.)),blend.x),
             mix(quayHash(cell+vec2(0.,1.)),quayHash(cell+vec2(1.,1.)),blend.x),blend.y);
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
  float pools = .76*quayNoise(p*vec2(1.3,.61))+.24*quayNoise(p*vec2(4.6,3.1));
  float wet = smoothstep(.50,.69,pools);
  float grain = sin(p.x*43.0)*sin(p.y*47.0);
  vec3 ripple = normalize(n+vec3(.035*sin(p.y*13.),0.,.035*cos(p.x*17.)));
  float facing = pow(1.-max(dot(ripple,eye),0.),4.);
  float reflection = pow(max(dot(ripple,normalize(normalize(l1)+eye)),0.),32.);
  color = color*(1.-wet*.42+grain*.06)
        + wet*(vec3(.035,.057,.078)*facing+vec3(.18,.27,.31)*reflection);
} else if (quay > .5 && abs(n.x) > .7 && vPos.x > 41. && uEmit < .1) {
  float runoff = quayNoise(vec2(vPos.z*2.9,vPos.y*.16));
  float seams = smoothstep(.95,1.,cos(vPos.z*1.91));
  color *= 1.-.25*runoff-.10*seams;
}
"""

RUSSIAN_ENEMY = """
function createRussianCamoTexture() {
  const [canvas,ctx]=textureCanvas('Russian digital camouflage',256,256);
  const colors=['#455044','#303b32','#59604d','#252e2b','#6c6d54'];
  for(let y=0;y<256;y+=8) for(let x=0;x<256;x+=8) {
    const n=noise2((x+13)*.31+(y-7)*.79);
    ctx.fillStyle=colors[Math.floor(n*colors.length)];
    ctx.fillRect(x,y,8,8);
  }
  for(let i=0;i<560;i++) {
    const x=Math.floor(rr(0,32))*8,y=Math.floor(rr(0,32))*8;
    ctx.fillStyle=colors[Math.floor(rr(0,colors.length))];
    ctx.fillRect(x,y,8,rr(8,25));
  }
  ctx.fillStyle='#d7d1b01a';
  for(let y=2;y<256;y+=5)ctx.fillRect(0,y,256,1);
  makeTex('rusCamo',canvas);
}

function createRussianEnemy() {
  const base=createEnemy(),uniform=new Builder(),kit=new Builder();
  const olive=[.32,.37,.28],dark=[.19,.23,.20],gear=[.25,.29,.27];
  uniform.box(0,1.18,.035,.80,.91,.455,olive);
  for(const x of [-.2,.2])uniform.box(x,.49,.035,.285,.81,.355,olive);
  for(const x of [-.57,.57])uniform.box(x,1.22,-.07,.275,.70,.305,olive,x<0?.15:-.15);
  uniform.box(0,1.84,.035,.50,.54,.49,dark);
  for(let i=0;i<12;i++) {
    const z=-.235+(i%4)*.125,y=.85+Math.floor(i/4)*.25;
    uniform.box(-.22+(i%2)*.04,y,z,.19,.18,.018,i%3===0?dark:gear);
    uniform.box(.19-(i%2)*.04,y+.015,z+.035,.18,.17,.018,i%3===1?dark:gear);
  }
  kit.box(0,1.86,-.258,.42,.46,.035,dark);
  kit.box(0,2.09,-.37,.64,.23,.045,gear);
  kit.box(0,1.89,-.285,.36,.13,.022,dark);
  kit.box(-.59,1.47,-.08,.07,.12,.035,[.72,.76,.68]);
  kit.box(.59,1.47,-.08,.07,.12,.035,[.72,.76,.68]);
  kit.box(.17,1.13,-.56,.25,.17,.79,[.18,.21,.19]);
  kit.box(.15,1.18,-.91,.12,.11,.87,[.29,.32,.29]);
  return [...base,...modelMesh({rusCamo:uniform,enemyKit:kit})];
}
"""

OPERATOR_MODEL = """
function createOperatorWeapon() {
  const meshes = {};
  const mesh = name => meshes[name] ||= new Builder();
  const [canvas, paint] = textureCanvas('operator fabric', 256, 256);
  paint.fillStyle = '#77744e';
  paint.fillRect(0, 0, 256, 256);
  const panels = [
    ['#3a4132', [[0,0],[110,0],[151,61],[78,88],[0,55]]],
    ['#252a28', [[0,111],[81,86],[128,136],[89,210],[0,178]]],
    ['#a39566', [[136,0],[221,0],[256,39],[201,74],[158,44]]],
    ['#414735', [[171,83],[256,52],[256,163],[222,178],[169,142]]],
    ['#9b8d64', [[108,176],[166,136],[218,188],[180,256],[84,256]]],
    ['#282d28', [[231,179],[256,168],[256,256],[194,256]]],
  ];
  for (const [color, polygon] of panels) {
    paint.fillStyle = color;
    paint.beginPath();
    paint.moveTo(...polygon[0]);
    for (const point of polygon.slice(1)) paint.lineTo(...point);
    paint.closePath();
    paint.fill();
  }
  paint.fillStyle = '#ffffff14';
  for (let y = 0; y < 256; y += 4) paint.fillRect(0, y, 256, 1);
  makeTex('operatorFabric', canvas);
  makeTex('aimpointMark', makeLabel('AIMPOINT', 'white', 256, 64));

  const steel = mesh('gun');
  const fabric = mesh('operatorFabric');
  const trim = mesh('white');
  const dark = [.24,.26,.25], edge = [.34,.36,.34], black = [.14,.16,.15];
  const olive = [.32,.36,.24], strap = [.46,.42,.29], cloth = [.91,.91,.87];
  const x = .24, opticY = .07;

  // Circular surfaces run along the local Z axis so the optic stays open in ADS.
  function tube(builder, cx, cy, start, end, outer, inner, color) {
    const segments = 20;
    const point = (radius, angle, z) => [cx + radius*Math.cos(angle), cy + radius*Math.sin(angle), z];
    for (let i = 0; i < segments; i++) {
      const a = i * 2*Math.PI/segments, b = (i+1) * 2*Math.PI/segments;
      const mid = (a+b)*.5, normal = [Math.cos(mid),Math.sin(mid),0];
      builder.quad(point(outer,a,start),point(outer,b,start),point(outer,b,end),point(outer,a,end),normal,color);
      if (inner > 0) {
        builder.quad(point(inner,b,start),point(inner,a,start),point(inner,a,end),point(inner,b,end),
                     normal.map(component => -component),color);
      }
      for (const [z, nz] of [[start,1],[end,-1]]) {
        builder.quad(point(inner,a,z),point(outer,a,z),point(outer,b,z),point(inner,b,z),[0,0,nz],color);
      }
    }
  }

  steel.box(x,-.154,-.17,.166,.185,.63,dark);
  steel.box(x,-.078,-.20,.135,.058,.61,edge);
  steel.box(x,-.165,-.70,.145,.148,.51,black);
  steel.box(x,-.237,-.71,.175,.055,.49,dark);
  for (const side of [-1,1]) {
    for (let i = 0; i < 5; i++) {
      steel.box(x+side*.076,-.148,-.50-i*.086,.015,.026,.052,edge);
    }
  }
  tube(steel,x,-.141,-.93,-1.51,.031,0,dark);
  tube(steel,x,-.141,-1.45,-1.61,.052,.032,edge);
  steel.box(x,-.277,.09,.095,.19,.115,black);
  steel.box(x,-.287,-.24,.109,.24,.15,dark);
  steel.box(x,-.399,-.24,.12,.032,.165,edge);
  steel.box(x,-.171,.34,.139,.15,.45,black);
  steel.box(x,-.188,.574,.154,.195,.06,dark);
  steel.box(x,-.007,-.23,.089,.092,.112,black);
  tube(steel,x,opticY,-.125,-.338,.081,.057,dark);
  tube(steel,x,opticY,-.117,-.155,.093,.058,edge);
  tube(steel,x,opticY,-.295,-.347,.091,.059,edge);
  steel.box(x+.09,opticY,-.242,.039,.048,.058,black);
  steel.box(x,opticY+.084,-.24,.055,.041,.052,black);
  steel.box(x,opticY,-.174,.009,.009,.003,[1.8,.09,.045]);
  steel.box(x+.106,opticY,-.241,.045,.035,.071,edge);
  steel.cylinder(x+.097,opticY,-.241,.022,.035,[.19,.21,.19],12);
  trim.planeX(x+.094,opticY,-.24,.105,.035,[.82,.83,.78],1);

  // Cuffs and overlapping glove panels preserve a readable silhouette at night.
  fabric.box(.47,-.53,.12,.31,.33,.63,cloth,-.22,.28);
  fabric.box(-.04,-.43,-.23,.28,.30,.70,cloth,.25,.30);
  fabric.box(.384,-.398,-.13,.193,.194,.147,cloth,-.22,.22);
  fabric.box(.045,-.327,-.55,.176,.168,.148,cloth,.25,.22);
  trim.box(.29,-.291,.064,.142,.177,.224,olive,-.19);
  trim.box(.24,-.249,-.64,.211,.123,.174,olive,.20);
  for (let i = 0; i < 4; i++) {
    trim.box(.185+i*.033,-.203,-.70,.028,.056,.089,olive);
  }
  trim.box(.309,-.19,-.605,.052,.093,.108,[.40,.43,.30],-.27);
  trim.beam(.34,-.139,-.85,.39,-.33,-.66,.039,strap);
  trim.beam(.39,-.33,-.66,.42,-.38,-.40,.039,strap);
  trim.beam(.42,-.38,-.40,.36,-.23,.33,.039,strap);
  steel.box(.417,-.362,-.39,.066,.051,.079,black);
  return modelMesh(meshes);
}
"""

REFERENCE_CAMERA = """
const reference = new URLSearchParams(location.search).get('reference');
const operatorReference = reference === 'operator' || reference === 'operator-ads';
const quayReference = reference === '1' || operatorReference;
if (quayReference) {
  document.body.insertAdjacentHTML('beforeend', '<style>#menu{display:none}</style>');
  Object.assign(player, {x:32.4, y:1.73, z:21.8, yaw:.24, pitch:-.075, ads:reference === 'operator-ads' ? 1 : 0});
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
                          "if(!quayReference || operatorReference)for(const geo of gunMesh)drawMesh(")
    if enhanced:
        source = replace_once(source, "const enemyMesh=createEnemy();",
                              RUSSIAN_ENEMY + "\ncreateRussianCamoTexture();\nconst enemyMesh=createRussianEnemy();")
        source = replace_once(source, "const gunMesh=createGun();",
                              OPERATOR_MODEL + "\nconst gunMesh=createOperatorWeapon();")
        source = replace_once(source, "const enemyMesh=createEnemy();",
                              source[source.index("const enemyMesh=createEnemy();"):source.index("const enemyMesh=createEnemy();")] + "const enemyMesh=createEnemy();") if False else source
        source = replace_once(source, ".115-player.ads*.13", ".115-player.ads*.3214")
        source = replace_once(source, "-.28+player.ads*.11", "-.28+player.ads*.2198")
        source = replace_once(source, "void main(){vec4 tex=texture2D(uTex,vUV);",
                              QUAY_NOISE + "void main(){vec4 tex=texture2D(uTex,vUV);")
        for lamp in ("l0", "l2"):
            half_vector = f"normalize({lamp})+eye"
            source = replace_once(source, f"dot(n,{half_vector})",
                                  f"dot(n,normalize({half_vector}))")
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



