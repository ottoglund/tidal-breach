// Soldier skin, eye and hair shading. Used by the MakeHuman body (characters/soldier.js, materials in enemies.js).
// Everything except the micro-relief is evaluated from the bind-pose position (stable while the skeleton moves).
//  skin : measured-range albedo (light Nordic skin, sRGB ~0.55-0.78, no saturation boost), gentle haemoglobin
//         mottling (cheeks / nose / ears), lips, eye sockets, lid creases, shaved stubble tied to the hair colour,
//         eyebrows; specular F0 0.028 (skin IOR ~1.4) instead of the generic 0.04, roughness ~0.5 with an oilier
//         T-zone (forehead, nose) and matte stubble; pores and fine furrows from a tiled detail normal map in the face's
//         metric UVs (skin_detail_normal: texgen, 24 mm tile) with micro-occlusion, plus procedural forehead lines,
//         crow's feet, under-eye and nasolabial creases (bump from bind-space height); a subtle wrap term with a red
//         shift past the terminator as a cheap subsurface stand-in
//  eye  : sclera, limbal ring, iris with radial fibres and pupil, upper-lid shadow, glossy cornea (eyeball vertices)
//  hair : short military cut. The scalp itself carries the hair colour with a soft density fade (front hairline,
//         faded sides and nape), so the thin hair shell above it only needs a smooth, noise-broken coverage contour
//         (no per-texel stochastic cut-out, no dotted seam). Strand detail is band-limited by the pixel footprint and
//         the shell gets Kajiya-Kay style anisotropic highlights along the strand direction (radial from the crown
//         whorl, skinned with the head).
import * as THREE from 'three';
import { textures } from '../materials.js';

const NOISE = /* glsl */`
float skH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float skN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH(i), skH(i + vec3(1, 0, 0)), f.x), mix(skH(i + vec3(0, 1, 0)), skH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(skH(i + vec3(0, 0, 1)), skH(i + vec3(1, 0, 1)), f.x), mix(skH(i + vec3(0, 1, 1)), skH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// band-limited noise: fades to its mean once one period covers ~a pixel (no sparkle / aliasing at distance)
float skNb(vec3 p, float fw) { return mix(skN(p), 0.5, smoothstep(0.35, 0.9, fw)); }
// hairline height above the eyes (m) by angle round the head from the forehead (same table as tools/mh/build_soldier.py)
float skHairLine(float th) {
  return th < 0.45 ? mix(0.058, 0.056, th / 0.45) : th < 0.8 ? mix(0.056, 0.045, (th - 0.45) / 0.35)
    : th < 1.05 ? mix(0.045, 0.036, (th - 0.8) / 0.25) : th < 1.2 ? mix(0.036, -0.012, (th - 1.05) / 0.15)
    : th < 1.38 ? -0.012 : th < 1.62 ? mix(-0.012, 0.012, (th - 1.38) / 0.24) : th < 1.95 ? mix(0.012, 0.0, (th - 1.62) / 0.33)
    : th < 2.3 ? mix(0.0, -0.05, (th - 1.95) / 0.35) : mix(-0.05, -0.078, (th - 2.3) / 0.8416);
}
// the same line low-pass filtered round the head (5 taps over +-0.12 rad, ~1 cm of arc each side): rounds the
// temple notch, where the raw table steps 5 cm in height over ~1 cm and read as a hard vertical edge
float skHairLineS(float th) {
  return (skHairLine(abs(th - 0.12)) + skHairLine(abs(th - 0.06)) + skHairLine(th) + skHairLine(th + 0.06) + skHairLine(th + 0.12)) * 0.2;
}
vec3 skBump(vec3 p, vec3 n, float h, float fd) {
  vec3 dx = dFdx(p), dy = dFdy(p);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1) * fd;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}`;

const eyeU = (o) => ({ uEyeR: { value: new THREE.Vector3(...(o.eyeR || [0.03, 1.68, -0.137])) }, uEyeL: { value: new THREE.Vector3(...(o.eyeL || [-0.03, 1.68, -0.137])) } });

/**
 * Per-soldier looks (Swedish Home Guard faces; OPFOR show the skin round the eyes): skin base colour (sRGB albedo),
 * hair colour, iris colour. The skin tones are spread across the light-to-medium range (fair / pink, light, ruddy,
 * olive-tan, medium brown) and the hair from blond to near-black, so soldiers next to each other read as different
 * people; earlier the four skin tones were within ~4 % of each other and the scalp showed mostly skin (see the
 * coverage note in skinShading), so every look rendered alike.
 */
export const LOOKS = [
  { skin: 0xc29a88, hair: 0x3d2b1f, iris: 0x5a7282 },   // light skin, dark brown hair, blue-grey eyes
  { skin: 0xd4b1a1, hair: 0xa08458, iris: 0x6a8ca2 },   // fair / pink, blond, blue eyes
  { skin: 0xa97f66, hair: 0x1e1813, iris: 0x4a3523 },   // olive-tan, near-black hair, brown eyes
  { skin: 0xcc9b88, hair: 0x7a4128, iris: 0x627258 },   // ruddy, auburn / red, grey-green eyes
  { skin: 0xbd9783, hair: 0x5e4d3c, iris: 0x6d7880 },   // light, ash brown, grey eyes
  { skin: 0x92684f, hair: 0x15110e, iris: 0x3a2a1c },   // medium brown, black hair, dark brown eyes
];

const DETAIL_TILE = 0.024;    // metres per tile of skin_detail_normal (texgen skin_detail)

/**
 * Skin material of the soldiers' faces, also drawing the short-hair shell and the eyeballs (one draw call): the body
 * asset marks hair vertices with uv.y >= 1000 and eyeball vertices with uv.y >= 2000; face UVs are the MakeHuman
 * atlas scaled to metres (used for the tiled micro-relief). o = { eyeR, eyeL, headC } (bind-pose landmarks from the
 * body asset), hair / iris colours optional. Chains any previous onBeforeCompile (wetness).
 */
export function skinShading(m, o = {}) {
  const prev = m.onBeforeCompile;
  const det = textures.skin_detail_normal || null;
  const U = { ...eyeU(o), uIris: { value: new THREE.Color(o.iris ?? 0x5a7282) }, uHair: { value: new THREE.Color(o.hair ?? 0x4b3828) },
    uHeadC: { value: new THREE.Vector3(...(o.headC || [0, 1.718, -0.0515])) }, tSkinDet: { value: det } };
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, U);
    if (det) shader.defines = { ...(shader.defines || {}), SK_DETAIL: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkP;\nvarying vec2 vSkUv;\nvarying vec3 vSkT;\nuniform vec3 uHeadC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkP = position; vSkUv = uv;')
      // strand direction: radial from the crown whorl, tangent to the scalp (bind space), skinned like the normal
      .replace('#include <skinnormal_vertex>', `
        vec3 skDir = position - vec3(0.012, uHeadC.y + 0.075, uHeadC.z + 0.055);
        skDir = normalize(skDir - objectNormal * dot(skDir, objectNormal) + vec3(0.0, -0.002, 0.0));
        #include <skinnormal_vertex>
        #ifdef USE_SKINNING
          skDir = (skinMatrix * vec4(skDir, 0.0)).xyz;
        #endif
        vSkT = normalize((modelViewMatrix * vec4(skDir, 0.0)).xyz);`);
    // wrap lighting (light reaches a little past the terminator, red furthest) + anisotropic hair highlights
    const lp = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `{
        float ndl = dot( geometryNormal, directLight.direction );
        vec3 w = vec3( 0.26, 0.12, 0.085 ) * skWrap;
        vec3 wrapD = clamp( ( vec3( ndl ) + w ) / ( 1.0 + w ), 0.0, 1.0 );
        reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseColor );
        if ( skHairK > 0.0 ) {
          // Kajiya-Kay: primary lobe (shifted toward the tip, light colour) + secondary (shifted toward the root,
          // tinted by the hair: light that went through the fibre once), both along the strand tangent
          vec3 T = normalize( vSkT );
          vec3 Hh = normalize( directLight.direction + geometryViewDir );
          float t1 = dot( T, Hh ) + 0.1, t2 = dot( T, Hh ) - 0.08;
          float s1 = pow( max( 1.0 - t1 * t1, 0.0 ), 0.5 * 70.0 ), s2 = pow( max( 1.0 - t2 * t2, 0.0 ), 0.5 * 16.0 );
          float vis = clamp( ndl * 0.75 + 0.25, 0.0, 1.0 ) * smoothstep( -0.2, 0.2, ndl );
          reflectedLight.directSpecular += directLight.color * vis * skHairK * ( 0.035 * s1 + 0.05 * s2 * skHairTint );
        }
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSkP;
varying vec2 vSkUv;
varying vec3 vSkT;
uniform vec3 uEyeR, uEyeL, uIris, uHair, uHeadC;
#ifdef SK_DETAIL
uniform sampler2D tSkinDet;
#endif
float skOil = 0.0, skStub = 0.0, skWrap = 1.0, skRough = -1.0, skDet = 0.0, skHgt = 0.0, skHairK = 0.0, skCav = 1.0, skF0 = 0.028;
vec3 skHairTint = vec3(1.0);
${NOISE}`)
      .replace('#include <lights_physical_pars_fragment>', lp)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 p = vSkP;
        vec3 ec = p.x > 0.0 ? uEyeR : uEyeL;              // nearer eye
        vec3 e = p - ec;
        float sx = p.x > 0.0 ? 1.0 : -1.0;
        float eyeY = 0.5 * (uEyeR.y + uEyeL.y), frontZ = uEyeR.z;
        float fwP = length(fwidth(p));                     // pixel footprint (m)
        float n2 = skN(p * 90.0 + 3.1), n3 = skN(p * 23.0 + 7.7), n1 = skNb(p * 420.0, fwP * 420.0);
        vec3 base = diffuseColor.rgb;
        vec3 col = base * (0.95 + 0.07 * n2 + 0.04 * n1);
        // hair density on the scalp: front hairline ~1 cm soft edge, longer fade on the clipped sides and the nape
        vec3 q = p - vec3(0.0, eyeY, uHeadC.z);
        float th = abs(atan(q.x, -q.z));
        float hl = skHairLineS(th);
        // density fade across the hairline: ~2.5 cm at the front (sparse fine hairs well below the line, density
        // building up gradually), longer on the clipped sides and the nape
        float fadeW = mix(0.025, 0.036, smoothstep(0.9, 1.7, th));
        // irregular outline: ~1.5 cm lobes (temples, widow's peak), 3 mm tufts, fine strands
        float edgeN = 0.014 * (skN(p * 55.0 + 4.2) - 0.5) + 0.007 * (skN(p * 260.0 + 1.7) - 0.5) + 0.003 * (skNb(p * 900.0, fwP * 900.0) - 0.5);
        // height above the hairline -> distance across it on the scalp (the line runs nearly vertically at the
        // sideburns, where a plain height difference would give a razor-thin fade)
        float hlS = (skHairLineS(th + 0.03) - skHairLineS(max(th - 0.03, 0.0))) / 0.06 / max(length(q.xz), 0.05);
        // strand frame in bind space (radial from the crown whorl) for the strand texture
        vec3 sd = normalize(p - vec3(0.012, uHeadC.y + 0.075, uHeadC.z + 0.055));
        vec3 st = normalize(cross(sd, normalize(p - uHeadC)));
        float aS = dot(p, st), bS = dot(p, sd);
        // strands (0.7 mm), tufts (2-4 mm) and clumps (~8 mm) along the strand direction, each faded by the footprint
        float fine = skNb(vec3(aS * 1400.0, bS * 160.0, 0.0), fwP * 1400.0);
        float tuft = skNb(vec3(aS * 330.0, bS * 75.0, 5.0), fwP * 330.0);
        float clump = skN(vec3(aS * 120.0, bS * 45.0, 9.0));
        float hx = smoothstep(-0.55 * fadeW, fadeW, (q.y - hl) * inversesqrt(1.0 + hlS * hlS) + edgeN);
        hx *= hx * (1.6 - 0.6 * hx);                        // slow, sparse start; density builds up toward the scalp
        // inside the fade the density is carried by individual strands / tufts rather than a uniform tint
        float hd = clamp(hx + (0.55 * fine + 0.45 * tuft - 0.5) * 1.1 * hx * (1.0 - hx) * 4.0 * 0.5, 0.0, 1.0);
        vec3 ecE = vec3(sx * 0.074, eyeY - 0.014, uHeadC.z + 0.012);
        hd *= smoothstep(0.024, 0.036, length((p - ecE) * vec3(0.55, 1.0, 1.15)));     // clear round the ears
        float strands = 0.3 * fine + 0.4 * tuft + 0.3 * clump;
        // hair length: full on top, short on the clipped sides / nape (more scalp shows through)
        float hlen = smoothstep(hl + 0.004, hl + 0.04, q.y) * (0.55 + 0.45 * smoothstep(1.9, 0.9, th)) + 0.35 * smoothstep(1.4, 0.4, th);
        // coverage of the scalp by hair seen from outside: even a ~6 mm clipper cut hides most of the scalp, and the
        // scalp that shows is shaded by the hair round it (col * 0.32); with the old, lower coverage and a lighter
        // scalp term the skin dominated and dark, blond and red hair all rendered the same light brown
        float cover = clamp(0.62 + 0.4 * hlen + 0.3 * (tuft - 0.5) + 0.2 * (clump - 0.5), 0.4, 0.98);
        vec3 hairC = uHair * (0.5 + 0.9 * strands) * (0.9 + 0.2 * n3);
        // hair coverage seen on the surface, identical on the scalp and on the shell so the shell edge has no seam
        float hmix = clamp(hd * 1.1 + 0.3 * (tuft - 0.5) * (1.0 - hd), 0.0, 1.0);
        if (vSkUv.y > 1500.0) {
          // eyeball: sclera, limbal ring, iris with radial fibres, pupil (angle from the eye's forward axis, -Z)
          vec3 d = normalize(e);
          float rr = acos(clamp(-d.z, -1.0, 1.0)) / 0.5;      // iris edge at ~29 degrees
          float az = atan(d.y, d.x);
          vec3 sclera = vec3(0.56, 0.53, 0.5) * (0.93 + 0.07 * skN(p * 900.0));
          sclera = mix(sclera, vec3(0.55, 0.36, 0.34), smoothstep(0.9, 1.9, rr) * 0.4);
          float fib = 0.75 + 0.25 * skN(vec3(az * 14.0, rr * 6.0, 0.0)) + 0.15 * skN(vec3(az * 40.0, rr * 3.0, 2.0));
          vec3 irisC = uIris * fib * mix(0.95, 0.55, rr);
          irisC = mix(irisC, vec3(0.25, 0.17, 0.08), smoothstep(0.55, 0.3, rr) * 0.45);
          col = mix(irisC, sclera, smoothstep(0.96, 1.04, rr));
          col *= 1.0 - 0.55 * exp(-pow((rr - 0.98) / 0.06, 2.0));
          col = mix(vec3(0.012), col, smoothstep(0.3, 0.36, rr));
          col *= 1.0 - 0.55 * smoothstep(0.1, 0.45, d.y);       // upper lid and lashes shade the top of the eye
          skWrap = 0.0; skRough = 0.07; skF0 = 0.025;
        } else if (vSkUv.y > 500.0) {
          // short-hair shell: kept where the scalp is (mostly) covered; the contour is smooth and noise-broken, the
          // colour below it already matches, so the shell edge reads as hair thinning out, not as a seam
          float keep = hd + 0.18 * (tuft - 0.5);
          if (keep < 0.8) discard;
          // the shell fades in over its first stretch (sheen, roughness, wrap), so its edge reads as hair thickening
          float se = smoothstep(0.8, 0.97, keep);
          col = mix(col, mix(col * 0.32, hairC, cover), hmix);  // scalp shows between the strands, more on the sides
          skWrap = mix(1.0, 0.25, hmix * se); skRough = mix(0.5, 0.72 - 0.12 * strands, hmix * (0.4 + 0.6 * se));
          skHairK = (0.3 + 1.2 * clump * tuft) * cover * hmix * se; skF0 = mix(0.028, 0.02, hmix);
          // secondary (transmitted) lobe: light that passed through the fibre once is filtered by the pigment, so it is
          // as dark as the hair (previously normalised to the brightest channel, which gave dark-brown and black hair
          // the same strong orange glow as auburn hair and made every look render as light brown)
          skHairTint = min(uHair * 2.4, vec3(1.0));
        } else {
          // haemoglobin: cheeks, nose, ears (subtle, no orange push)
          float cheek = exp(-pow(length((p.xy - vec2(sx * 0.042, eyeY - 0.035)) / vec2(0.022, 0.02)), 2.0));
          float nose = exp(-pow(length((p - vec3(0.0, eyeY - 0.038, frontZ - 0.03)) / vec3(0.012, 0.022, 0.02)), 2.0));
          float ear = smoothstep(0.062, 0.075, abs(p.x));
          float lipsD = length((p.xy - vec2(0.0, eyeY - 0.084)) / vec2(0.024, 0.0075));
          float lips = (1.0 - smoothstep(0.75, 1.15, lipsD)) * step(p.z, frontZ);
          // blotchy capillary redness (cheeks, nose, chin) and a slightly sallower forehead / temples
          float blot = smoothstep(0.45, 0.8, skN(p * 65.0 + 2.3)) * (0.6 * cheek + 0.5 * nose + 0.3);
          float red = clamp(0.5 * cheek + 0.5 * nose + 0.4 * ear + 0.2 * (n3 - 0.5) + 0.5 * blot, 0.0, 1.0);
          col *= mix(vec3(1.0), vec3(1.0, 0.88, 0.88), red * 0.55);
          col *= mix(vec3(1.0), vec3(1.02, 1.0, 0.94), smoothstep(eyeY + 0.01, eyeY + 0.05, p.y) * (1.0 - hd));
          col *= 0.96 + 0.08 * skN(p * 38.0 + 6.1);
          // a few small moles / freckles (0.6-1.2 mm), band-limited
          vec3 mc = floor(p * 140.0);
          float mh = skH(mc + 17.0);
          vec3 mo = mc + vec3(skH(mc + 3.0), skH(mc + 5.0), skH(mc + 7.0));
          float mole = step(0.992, mh) * (1.0 - smoothstep(0.08, 0.16 + fwP * 140.0, length(p * 140.0 - mo)));
          col = mix(col, col * vec3(0.62, 0.52, 0.48), mole * 0.7 * (1.0 - hd));
          col = mix(col, base * vec3(0.78, 0.55, 0.55) * (0.9 + 0.15 * n2), lips * 0.65);
          // eye region: slightly darker, cooler sockets, upper-lid crease, lash line, pink inner corners
          float sock = exp(-dot(e.xy / vec2(0.024, 0.017), e.xy / vec2(0.024, 0.017)));
          col *= 1.0 - 0.16 * sock;
          col *= mix(vec3(1.0), vec3(0.95, 0.9, 0.96), sock);
          float cx = e.x / 0.015;
          float crease = exp(-cx * cx - pow((e.y - 0.0095 - 0.0025 * (1.0 - cx * cx)) / 0.0026, 2.0));
          col *= 1.0 - 0.38 * crease;
          float lidLine = exp(-pow(e.x / 0.013, 2.0) - pow((e.y + 0.0072) / 0.0018, 2.0));
          col *= 1.0 - 0.3 * lidLine;
          float canthus = exp(-pow((abs(p.x) - 0.016) / 0.004, 2.0) - pow(e.y / 0.004, 2.0));
          col = mix(col, base * vec3(0.8, 0.52, 0.52), 0.45 * canthus);
          // shaved stubble on the jaw, chin and upper lip; visibility follows the hair colour (dark hair: blue-grey shadow)
          float jaw = smoothstep(eyeY - 0.05, eyeY - 0.075, p.y) * smoothstep(0.072, 0.05, abs(p.x)) * step(p.z, frontZ + 0.07);
          float lip = exp(-pow(p.x / 0.024, 2.0) - pow((p.y - (eyeY - 0.068)) / 0.006, 2.0));
          skStub = clamp(max(jaw, lip * 0.9) * (1.0 - lips) * smoothstep(eyeY - 0.16, eyeY - 0.12, p.y), 0.0, 1.0);
          float hairDark = 1.0 - clamp(dot(uHair, vec3(0.3, 0.55, 0.15)) * 4.0, 0.0, 0.8);
          col *= mix(vec3(1.0), vec3(0.8, 0.82, 0.86) * (0.9 + 0.2 * n1), skStub * 0.55 * hairDark);
          // eyebrows: arched band above each eye, fuller toward the nose, broken into short hairs
          float bx = sx * e.x;                                   // + toward the temple
          float byc = 0.0175 + 0.005 * (1.0 - pow(clamp(bx / 0.024, -1.0, 1.0), 2.0)) - 0.002 * smoothstep(0.0, 0.025, bx);
          float bth = mix(0.0034, 0.0016, smoothstep(-0.018, 0.026, bx));
          float brow = (1.0 - smoothstep(bth * 0.6, bth + 0.0028, abs(e.y - byc))) * (1.0 - smoothstep(0.016, 0.03, abs(bx - 0.004)))
                     * step(p.z, frontZ + 0.03);
          float bh = skNb(vec3(bx * 2200.0, (e.y - byc) * 500.0 + bx * 300.0, 1.0), fwP * 2200.0);
          col = mix(col, uHair * (0.6 + 0.6 * bh), clamp(brow * (0.3 + 0.5 * bh), 0.0, 0.7));
          // scalp: hair colour fading in toward the hairline (the shell takes over where it is dense)
          col = mix(col, mix(col * 0.32, hairC, cover), hmix);
          // T-zone oil (forehead centre, nose, chin)
          skOil = clamp(nose + smoothstep(eyeY + 0.015, eyeY + 0.04, p.y) * smoothstep(0.045, 0.015, abs(p.x)) * 0.8
                + exp(-pow(p.x / 0.015, 2.0) - pow((p.y - (eyeY - 0.115)) / 0.01, 2.0)) * 0.4, 0.0, 1.0) * (1.0 - hd);
          // micro-relief strength by region: strongest on the nose and cheeks, faint on lids and lips, none on hair
          float lid = exp(-dot(e.xy / vec2(0.017, 0.011), e.xy / vec2(0.017, 0.011)));
          skDet = (0.75 + 0.35 * nose + 0.3 * cheek) * (1.0 - 0.75 * lid) * (1.0 - 0.8 * lips) * (1.0 - hd) * (1.0 - brow * 0.6);
          // fine creases (height in m): forehead lines, crow's feet, under-eye, nasolabial folds, neck lines
          float front = smoothstep(frontZ + 0.06, frontZ + 0.02, p.z);
          float wf = max(fwP, 0.0007);                           // never thinner than ~a pixel
          float fl = 0.0;
          for (int i = 0; i < 3; i++) {
            float yi = eyeY + 0.036 + float(i) * 0.0105 + 0.006 * pow(p.x / 0.05, 2.0);
            fl += exp(-pow((p.y - yi) / wf, 2.0)) * (0.55 + 0.45 * skN(vec3(p.x * 70.0, float(i) * 3.0, 0.0)));
          }
          fl *= smoothstep(0.055, 0.025, abs(p.x)) * front;
          vec2 cf = vec2(sx * p.x - 0.05, p.y - eyeY + 0.001);   // outer canthus
          float rc = length(cf), ac = atan(cf.y, cf.x);
          float crow = 0.0;
          for (int i = 0; i < 3; i++) crow += exp(-pow((ac - (float(i) - 1.0) * 0.42) * rc / wf, 2.0));
          crow *= smoothstep(0.003, 0.007, rc) * smoothstep(0.022, 0.012, rc) * step(0.0, cf.x + 0.004);
          float ue = exp(-pow(e.x / 0.014, 2.0) - pow((e.y + 0.0125 + 0.003 * pow(e.x / 0.014, 2.0)) / max(wf, 0.0012), 2.0));
          vec2 na = vec2(sx * 0.0175, eyeY - 0.041), nb = vec2(sx * 0.031, eyeY - 0.084);
          vec2 pa = p.xy - na, ba = nb - na;
          float tn = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float nl = exp(-pow(length(pa - ba * tn) / 0.003, 2.0)) * front * (0.5 + 0.5 * sin(tn * 3.1416));
          float neck = 0.0;
          for (int i = 0; i < 2; i++) neck += exp(-pow((p.y - (eyeY - 0.175 - float(i) * 0.02 + 0.01 * pow(p.x / 0.05, 2.0))) / max(wf, 0.0012), 2.0));
          neck *= smoothstep(frontZ + 0.11, frontZ + 0.07, p.z) * step(p.y, eyeY - 0.15);
          skHgt = -0.00009 * fl - 0.00006 * crow - 0.00008 * ue - 0.0005 * nl - 0.00007 * neck;
          col *= 1.0 - 0.18 * clamp(fl * 0.6 + crow * 0.4 + ue * 0.5 + nl * 0.6 + neck * 0.3, 0.0, 1.0);
          skRough = clamp(mix(0.55, 0.42, skOil) + 0.1 * skStub + 0.12 * brow - 0.08 * lips + 0.06 * (n2 - 0.5) + 0.1 * hd, 0.3, 0.75);
        }
        #ifdef SK_DETAIL
        {
          vec4 dt = texture2D(tSkinDet, vSkUv / ${DETAIL_TILE.toFixed(4)});
          skCav = mix(1.0, 0.82 + 0.36 * dt.b, skDet);            // pores / furrows: micro-occlusion
          col *= skCav;
        }
        #endif
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = skRough >= 0.0 ? skRough : roughnessFactor;`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
      #ifdef SK_DETAIL
      if (skDet > 0.001) {
        // tiled micro-relief in the face's metric UVs: tangent frame from screen-space derivatives (no tangents)
        vec2 duv = vSkUv / ${DETAIL_TILE.toFixed(4)};
        vec4 dt = texture2D(tSkinDet, duv);
        vec2 nxy = (dt.rg * 2.0 - 1.0) * 0.9 * skDet;
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(duv), st1 = dFdy(duv);
        vec3 N = normal;
        vec3 q1p = cross(q1, N), q0p = cross(N, q0);
        vec3 Tg = q1p * st0.x + q0p * st1.x, Bg = q1p * st0.y + q0p * st1.y;
        float dd = max(dot(Tg, Tg), dot(Bg, Bg));
        if (dd > 1e-30) {
          float sc = inversesqrt(dd);
          vec3 mapN = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
          normal = normalize(mat3(Tg * sc, Bg * sc, N) * mapN);
        }
      }
      #endif
      normal = skBump(-vViewPosition, normal, skHgt, faceDirection);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      material.specularColor = vec3(skF0) * mix(1.0, skCav, 0.5);
      material.specularF90 = 1.0;`);
  };
  m.customProgramCacheKey = () => 'skin3' + (det ? 'd' : '');
  return m;
}
