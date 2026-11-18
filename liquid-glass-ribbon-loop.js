/*
 * Liquid Glass Ribbon Loop — the smoky glass ribbon, closed into a loop with no ends.
 * Real-time WebGL (Three.js), custom glass shader. No build step; load as a module.
 *
 * Markup:
 *   <div data-liquid-glass></div>               transparent background (floats over the page)
 *   <div data-liquid-glass data-glass-backdrop>  paints the scope's background colour and any
 *                                               [data-glass-paint] text into the scene, so the
 *                                               glass refracts it; [data-glass-box] elements
 *                                               (lines, marks) are painted as their box in
 *                                               their background colour
 * Optional placement (fractions of the element), with -mobile variants for ≤ 479px:
 *   data-glass-x="0.5" data-glass-y="0.5" data-glass-size="0.8"
 * The scope is the closest [data-glass-scope], else the element's parent. Once the first
 * frame is drawn, the scope gets the class "is-glass-ready".
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

// 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT)
const SIMPLEX = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const TRAIL = 10;

// ---------- Vertex shader: the sheet keeps flowing ----------
// Every vertex knows the point on the centre line it belongs to (aCenter), the
// direction of the ribbon there (aTangent) and how far along it is (aAlong), so
// each stretch can twist, stretch and fold on its own rhythm.
const VERTEX = `
uniform float uTime;
uniform float uMorph;
uniform vec4 uTrail[${TRAIL}];
uniform vec3 uTrailDir[${TRAIL}];
attribute vec3 aCenter;
attribute vec3 aTangent;
attribute float aAlong;
attribute float aFade;
// the same vertex on the neighbouring ring, so shading follows the real shape
attribute vec3 aNextPos;
attribute vec3 aNextNormal;
attribute vec3 aNextCenter;
attribute vec3 aNextTangent;
attribute float aNextAlong;
attribute float aNextFade;
attribute float aNextDir;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFilm;
${SIMPLEX}
// noise input that goes once round a circle as you go once round the loop
vec3 loopIn(vec2 ring, float freq, float tt, float o) {
  return vec3(ring * (freq / 6.2831853) + vec2(o, o * 0.37), tt);
}
vec3 rotateAround(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
vec3 deform(vec3 p, vec3 n, vec3 C, vec3 Tg, float along, float f) {
  float t = uTime, m = uMorph;
  float s = along;
  vec2 ring = vec2(cos(s * 6.2831853), sin(s * 6.2831853));   // position around the loop, wraps seamlessly
  // local twist: each stretch of ribbon rotates about its own axis on its own beat
  // slowly drifting noise (not repeating waves), so the motion never visibly loops
  float twist = (snoise(loopIn(ring, 1.4, t * 0.05, 3.1)) * 0.3 + snoise(loopIn(ring, 2.0, t * 0.07, 8.4)) * 0.02) * m * f;  // gentle: wide sheets stay smooth
  // local stretch: the sheet widens and narrows like it is being pulled
  float stretch = 1.0 + 0.16 * snoise(loopIn(ring, 1.6, t * 0.05, 12.7)) * m * f;
  vec3 o = rotateAround((p - C) * stretch, Tg, twist);
  vec3 q = C + o;
  // folds and changes of curvature: the centre line drifts in a slow, smooth field
  vec3 w = q * 0.2 + vec3(0.0, t * 0.045, t * 0.035);
  vec3 d = vec3(snoise(w), snoise(w + 19.1), snoise(w + 37.7)) * 0.28 * m;
  d.z *= 0.7;
  q += d;
  // each section also bends on its own rhythm
  float a = s * 6.2831;
  q += vec3(snoise(loopIn(ring, 1.6, t * 0.05, 21.0)), snoise(loopIn(ring, 1.6, t * 0.05, 34.0)), snoise(loopIn(ring, 1.6, t * 0.05, 47.0)) * 0.7) * 0.075 * m * f;   // gentle: neighbouring stretches no longer crinkle against each other
  // a gentle ripple across the sheet itself
  q += n * snoise(q * 0.5 + vec3(t * 0.12)) * 0.008 * m * f;   // only a faint surface swell   // very gentle surface swell
  // finger trail through the liquid
  for (int i = 0; i < ${TRAIL}; i++) {
    float st = uTrail[i].w;
    if (st < 0.001) continue;
    float d = length(p - uTrail[i].xyz);
    float k = exp(-d * d * 1.4) * st * f;
    q += uTrailDir[i] * k * 0.45;
    q += n * sin(d * 7.0 - t * 6.0) * 0.03 * k * smoothstep(0.0, 0.6, d);
  }
  return q;
}
void main() {
  vec3 n = normal;
  vec3 p0 = deform(position, n, aCenter, aTangent, aAlong, aFade);
  // along the tube: the real neighbouring vertex, deformed with its own section data
  vec3 dAlong = (deform(aNextPos, aNextNormal, aNextCenter, aNextTangent, aNextAlong, aNextFade) - p0) * aNextDir;
  // around the tube: a tiny step within this same section
  vec3 tg = aTangent - n * dot(n, aTangent);
  tg = length(tg) > 1e-4 ? normalize(tg) : normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 bt = cross(n, tg);
  // step across the surface scaled to the local size of the cross-section, so it stays
  // accurate right up to the rounded tips (a fixed step crumpled the shading there)
  float e = clamp(0.2 * length(position - aCenter), 2e-4, 0.004);
  vec3 dAcross = deform(position + bt * e, n, aCenter, aTangent, aAlong, aFade) - p0;
  vec3 nr = deform(position + n * 0.004, n, aCenter, aTangent, aAlong, aFade) - p0;
  vec3 cr = cross(dAlong, dAcross);
  // if a step has collapsed (at a rounded tip), fall back to the deformed outward direction
  vec3 nn = length(cr) > 1e-9 ? normalize(cr) : normalize(nr);
  if (dot(nn, nr) < 0.0) nn = -nn;                       // keep the outward facing
  // at the rounded tips (where the motion is faded out) the measured direction becomes
  // unreliable as the outline shrinks to a point; blend to the surface's own direction there
  float tipW = 1.0 - smoothstep(0.0, 0.35, aFade);
  nn = normalize(mix(nn, normalize(n), tipW));
  vec4 mv = modelViewMatrix * vec4(p0, 1.0);
  vViewPos = mv.xyz;
  vWorldPos = (modelMatrix * vec4(p0, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nn);
  vNormal = normalize(normalMatrix * nn);
  vFilm = snoise(p0 * 0.55 + vec3(uTime * 0.04)) * 0.5 + 0.5;
  gl_Position = projectionMatrix * mv;
}`;

// ---------- Fragment shader: smoked glass, drawn in two passes ----------
// Pass 0 (every outer surface): adds soft highlights and dims what is behind.
//   Both operations commute, so the result never depends on draw order — no seams.
// Pass 1 (nearest front surface only): blends in the refracted backdrop.
const FRAGMENT = `
uniform sampler2D uBackdrop;
uniform float uUseBackdrop;
uniform vec2 uRes;
uniform float uEnvRot;
uniform float uTime;
uniform vec3 uSmoke;
uniform float uPass;
uniform float uLayer;
uniform float uDebug;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFilm;
// A large soft rectangular light seen in direction c (gnomonic projection, soft edges)
float softbox(vec3 r, vec3 c, float hw, float hh, float soft) {
  c = normalize(c);
  float d = dot(r, c);
  if (d <= 0.0) return 0.0;
  vec3 u = normalize(abs(c.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), c) : vec3(1.0, 0.0, 0.0));
  vec3 w = cross(c, u);
  float x = dot(r, u) / d, y = dot(r, w) / d;
  return smoothstep(hw + soft, hw - soft, abs(x)) * smoothstep(hh + soft, hh - soft, abs(y));
}
// Studio environment: dark room, large soft rectangular lights (fixed in the room, so
// highlights slide over the glass as it turns and deforms)
vec3 studio(vec3 r) {
  float ca = cos(uEnvRot), sa = sin(uEnvRot);
  r = vec3(ca * r.x + sa * r.z, r.y, -sa * r.x + ca * r.z);
  float l = 0.0;
  // wide, very soft edges: highlights fade through silver into grey instead of cutting off
  l += softbox(r, vec3(0.0, 1.0, 0.35), 1.0, 0.4, 0.75) * 1.9;     // big overhead box
  l += softbox(r, vec3(-1.0, 0.25, 0.55), 0.2, 1.0, 0.45) * 2.1;   // tall strip, left
  l += softbox(r, vec3(1.0, 0.1, 0.4), 0.18, 0.9, 0.45) * 1.6;     // tall strip, right
  l += softbox(r, vec3(0.35, 0.55, 1.0), 0.5, 0.28, 0.6) * 1.0;    // key light behind the viewer (gentle: no hot spots)
  l += softbox(r, vec3(-0.2, 0.15, -1.0), 0.9, 0.5, 0.6) * 1.0;    // back panel (rims)
  // room: deep black below, smoky grey toward the top — a smooth gradient between the lights
  float g = smoothstep(-0.7, 1.0, r.y);
  float base = 0.008 + 0.12 * g * g;
  base += 0.07 * exp(-pow((r.y - 0.12) * 3.2, 2.0));                // soft horizon band: smoky silver mid-tones
  base += 0.04 * exp(-pow((r.x + 0.3) * 1.6, 2.0)) * g;             // gentle broad wash from one side
  return vec3(base + l) * vec3(0.97, 0.985, 1.0);
}
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  if (dot(N, V) < 0.0) N = -N;
  float ct = clamp(dot(N, V), 0.0, 1.0);
  // liquid silver glass: reflective even face-on, strongly so at grazing angles
  float fres = 0.14 + 0.58 * pow(1.0 - ct, 3.0);        // smoky silver: edge-on parts read silver, not white
  float edge = pow(1.0 - ct, 2.2);
  float T = mix(0.9, 0.2, edge);                        // clear centres, dark smoky edges
  vec3 n = normalize(vNormal);
  if (dot(n, normalize(-vViewPos)) < 0.0) n = -n;
  if (uPass < 0.5) {
    vec3 R = reflect(-V, N);
    vec3 col = studio(R) * fres * 0.95;                 // soft, flowing silver reflections
    // filmic curve: long, smooth transitions from smoky grey through silver to white
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    // thickness: light caught inside the glass shows as a thin bright rim just inside the
    // edge, with the darker band of the edge itself behind it
    // (kept wide and soft: a thin hard rim line ended in sharp points where outlines meet)
    float rim = smoothstep(0.42, 0.85, 1.0 - ct) * (1.0 - smoothstep(0.84, 1.0, 1.0 - ct));
    col += vec3(0.85, 0.87, 0.9) * rim * 0.2;
    col += uSmoke * 0.02;                               // faint silvery body
    gl_FragColor = vec4(col, 1.0 - T);                  // out = reflections + behind × T
  } else {
    // subtle optical distortion of what's behind
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 off = n.xy * (0.045 + 0.09 * edge);              // gentler bending
    vec3 refr = texture2D(uBackdrop, uv - off).rgb;    // one clean bend, no colour split on the type
    gl_FragColor = vec4(refr * uSmoke, 0.92);           // the page is seen through the glass, bent
  }
  if (uDebug > 0.5) gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, 1.0);
  #include <colorspace_fragment>
}`;

const hosts = document.querySelectorAll('[data-liquid-glass]');
hosts.forEach((host) => {
  createLiquidGlass(host).catch((err) => console.error('[liquid-glass]', err));
});

async function createLiquidGlass(host) {
  const scope = host.closest('[data-glass-scope]') || host.parentElement;
  const useBackdrop = host.hasAttribute('data-glass-backdrop');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lowPower = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  // wait for the web fonts so the painted text matches, but never more than 2.5 s
  // (on a slow network the glass would otherwise stay hidden); repainted once they arrive
  if (useBackdrop && document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !useBackdrop, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 11);

  // ---------- Optional backdrop (page colour + text, for refraction) ----------
  let backdrop = null, paintCanvas = null, ctx = null;
  function newBackdropTexture() {
    if (backdrop) backdrop.dispose();
    backdrop = new THREE.CanvasTexture(paintCanvas);
    backdrop.colorSpace = THREE.SRGBColorSpace;
    scene.background = backdrop;
    uniforms.uBackdrop.value = backdrop;
  }
  function offsetIn(el, root) {
    let x = 0, y = 0;
    while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { x, y };
  }
  function paintBackdrop(w, h, dpr) {
    if (!useBackdrop) return;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (cw !== paintCanvas.width || ch !== paintCanvas.height || !backdrop) {
      paintCanvas.width = cw; paintCanvas.height = ch;   // texture storage is fixed-size
      newBackdropTexture();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scopeStyle = getComputedStyle(scope);
    ctx.fillStyle = scopeStyle.backgroundColor;
    ctx.fillRect(0, 0, w, h);
    const hostOff = offsetIn(host, scope);
    scope.querySelectorAll('[data-glass-paint]').forEach((block) => {
      const bs = getComputedStyle(block);
      const fs = parseFloat(bs.fontSize);
      const lineH = parseFloat(bs.lineHeight) || fs;
      ctx.save();
      ctx.translate(-hostOff.x, -hostOff.y);
      if (bs.transform && bs.transform !== 'none') {
        const m = new DOMMatrix(bs.transform);
        const [ox, oy] = bs.transformOrigin.split(' ').map(parseFloat);
        const o = offsetIn(block, scope);
        ctx.translate(o.x + ox, o.y + oy);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.translate(-(o.x + ox), -(o.y + oy));
      }
      ctx.font = `${bs.fontStyle} ${bs.fontWeight} ${fs}px ${bs.fontFamily}`;
      ctx.letterSpacing = bs.letterSpacing === 'normal' ? '0px' : bs.letterSpacing;
      ctx.fillStyle = bs.color === 'rgba(0, 0, 0, 0)' ? scopeStyle.color : bs.color;
      ctx.textBaseline = 'alphabetic';
      const runs = block.querySelectorAll('[data-glass-text]');
      (runs.length ? runs : [block]).forEach((run) => {
        const { x, y } = offsetIn(run, scope);
        const m = ctx.measureText(run.textContent);
        const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
        const baseline = getComputedStyle(run).display === 'inline'
          ? y + asc : y + (lineH - (asc + desc)) / 2 + asc;
        ctx.fillText(run.textContent, x, baseline);
      });
      ctx.restore();
    });
    // plain shapes (lines, marks): painted as their box in their background colour
    const hostRect = host.getBoundingClientRect();
    scope.querySelectorAll('[data-glass-box]').forEach((el) => {
      const r = el.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(r.left - hostRect.left, r.top - hostRect.top, r.width, r.height);
    });
    backdrop.needsUpdate = true;
  }

  // ---------- Geometry: the ribbon, closed into a loop (no ends) ----------
  // The same folding path as the ribbon, with one extra point joining its two former tips
  // over the top, so the band runs round without end.
  const pts = [
    [-1.0, 2.4, 0.6],
    [-1.6, 1.4, 1.0],
    [-2.1, 0.1, 0.3],
    [-1.6, -1.3, -0.6],
    [-0.5, -1.8, -0.2],
    [0.5, -0.95, 0.9],     // up through the middle, in front
    [-0.25, -0.15, 0.5],
    [-1.05, 0.55, -0.3],   // fold back across the centre, opened up
    [-0.2, 1.2, -0.8],
    [1.0, -0.9, -0.2],     // one long sweep down to the body (no extra small twist in the middle)
    [2.0, -0.4, 0.4],      // body on the right
    [2.3, 0.9, 0.8],
    [1.7, 2.0, 0.1],       // lobe rises
    [0.8, 2.1, -0.5],
    [-0.1, 2.55, 0.1],     // the join: a smooth arc over the top back into the start
  ];
  // draw the outer loops in toward the centre so the form reads as one intertwined object
  const pulled = pts.map(([x, y, z]) => {
    const d = Math.hypot(x, y - 0.2), k = d > 1.15 ? (1.15 + (d - 1.15) * 0.45) / d : 1;
    return [x * k, (y - 0.2) * k + 0.2, z];
  });
  const rough = new THREE.CatmullRomCurve3(pulled.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  // low-pass the centre line (wrapping round the loop): no sharp turns or tight curls
  const ND = 256;
  const dense = rough.getSpacedPoints(ND).slice(0, ND);
  // strong smoothing: fewer, larger, rounder bends (small kinks between them are smoothed away)
  const smoothPts = dense.map((_, i) => {
    const acc = new THREE.Vector3(); let wsum = 0;
    for (let k = -26; k <= 26; k++) {
      const wt = Math.exp(-(k * k) / 170);
      acc.addScaledVector(dense[(i + k + ND) % ND], wt); wsum += wt;
    }
    return acc.multiplyScalar(1 / wsum);
  });
  // closed cubic B-spline through the smoothed points: the bend changes continuously everywhere
  class LoopPath extends THREE.Curve {
    constructor(points) { super(); this.cp = points; this.arcLengthDivisions = 6000; }
    span(t) {
      const n = this.cp.length, x = (((t % 1) + 1) % 1) * n, i = Math.floor(x);
      return [x - i, (k) => this.cp[(i + k + n) % n]];
    }
    getPoint(t, out = new THREE.Vector3()) {
      const [s, P] = this.span(t), s2 = s * s, s3 = s2 * s;
      return out.set(0, 0, 0)
        .addScaledVector(P(-1), (1 - 3 * s + 3 * s2 - s3) / 6).addScaledVector(P(0), (4 - 6 * s2 + 3 * s3) / 6)
        .addScaledVector(P(1), (1 + 3 * s + 3 * s2 - 3 * s3) / 6).addScaledVector(P(2), s3 / 6);
    }
    getTangent(t, out = new THREE.Vector3()) {
      const [s, P] = this.span(t), s2 = s * s;
      return out.set(0, 0, 0)
        .addScaledVector(P(-1), (-1 + 2 * s - s2) / 2).addScaledVector(P(0), (-4 * s + 3 * s2) / 2)
        .addScaledVector(P(1), (1 + 2 * s - 3 * s2) / 2).addScaledVector(P(2), s2 / 2).normalize();
    }
  }
  // open up any bend still tighter than the band can flow round: relax only those stretches
  // of the path, a little at a time and with soft edges, so the rest of the shape is untouched
  {
    const n = smoothPts.length, rMin = 0.62, st = 3;
    const radius = (i) => {
      const a = smoothPts[(i - st + n) % n], b = smoothPts[i], c = smoothPts[(i + st) % n];
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ac = a.distanceTo(c);
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
      return area > 1e-12 ? (ab * bc * ac) / (4 * area) : 1e9;
    };
    const wt = new Float32Array(n), ws = new Float32Array(n), mid = new THREE.Vector3();
    for (let it = 0; it < 220; it++) {
      let any = false;
      for (let i = 0; i < n; i++) {
        const r = radius(i), x = Math.min(1, Math.max(0, (rMin - r) / (rMin * 0.5)));
        wt[i] = x * x * (3 - 2 * x); if (wt[i] > 0) any = true;
      }
      if (!any) break;
      for (let i = 0; i < n; i++) {            // soften the edges of the relaxed stretches
        let acc = 0, wsum = 0;
        for (let k = -6; k <= 6; k++) { const g = Math.exp(-(k * k) / 12); acc += wt[(i + k + n) % n] * g; wsum += g; }
        ws[i] = acc / wsum;
      }
      const src = smoothPts.map((v) => v.clone());
      for (let i = 0; i < n; i++) {
        if (ws[i] <= 0) continue;
        mid.addVectors(src[(i - 1 + n) % n], src[(i + 1) % n]).multiplyScalar(0.5);
        smoothPts[i].lerp(mid, 0.35 * ws[i]);
      }
    }
  }
  const path = new LoopPath(smoothPts);

  // Cross-section: a very thin ellipse — a sheet with softly rounded edges.
  const RADIAL = 36;
  function section(j, w, h, out) {
    const a = (j / RADIAL) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    return out.set(w * Math.sign(c) * Math.pow(Math.abs(c), 0.55), h * Math.sign(s) * Math.pow(Math.abs(s), 0.9));
  }

  function ribbonLoopGeometry(curve, segs) {
    const len = curve.getLength();
    const wrap = (i) => ((i % segs) + segs) % segs;
    const uw = (u) => ((u % 1) + 1) % 1;
    // rotation-minimising frames round the loop; the small twist left over after one full
    // turn is spread evenly along the loop, so the frames meet up exactly at the join
    const frameN = [], frameB = [], tanR = [];
    {
      const T = new THREE.Vector3(), Tp = new THREE.Vector3(), Nv = new THREE.Vector3(), axis = new THREE.Vector3();
      curve.getTangentAt(0, T);
      const ref = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      Nv.crossVectors(T, ref).normalize();
      const N0 = Nv.clone(), T0 = T.clone();
      const raw = [];
      for (let i = 0; i <= segs; i++) {
        Tp.copy(T); curve.getTangentAt(uw(i / segs), T);
        if (i > 0) {
          axis.crossVectors(Tp, T);
          const sl = axis.length();
          if (sl > 1e-9) Nv.applyAxisAngle(axis.multiplyScalar(1 / sl), Math.atan2(sl, Tp.dot(T)));
        }
        Nv.addScaledVector(T, -Nv.dot(T)).normalize();
        raw.push(Nv.clone()); tanR.push(T.clone());
      }
      // angle between where the frame ends up and where it started
      const B0 = new THREE.Vector3().crossVectors(T0, N0);
      const hol = Math.atan2(raw[segs].dot(B0), raw[segs].dot(N0));
      for (let i = 0; i < segs; i++) {
        const n = raw[i].clone().applyAxisAngle(tanR[i], -hol * (i / segs));
        frameN.push(n); frameB.push(new THREE.Vector3().crossVectors(tanR[i], n));
      }
    }
    // how tightly the path bends, smoothed round the loop
    const kap = new Float32Array(segs);
    const tA = new THREE.Vector3(), tB = new THREE.Vector3();
    const win = 0.005;
    for (let i = 0; i < segs; i++) {
      const u = i / segs;
      curve.getTangentAt(uw(u - win), tA); curve.getTangentAt(uw(u + win), tB);
      kap[i] = tA.angleTo(tB) / (len * 2 * win);
    }
    const R = Math.round(segs * 0.05);
    let kSm = new Float32Array(segs);
    for (let i = 0; i < segs; i++) { let mx = 0; for (let d = -R; d <= R; d++) mx = Math.max(mx, kap[wrap(i + d)]); kSm[i] = mx; }
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(segs);
      for (let i = 0; i < segs; i++) {
        let sum = 0, wsum = 0;
        for (let d = -2 * R; d <= 2 * R; d++) { const wt = Math.exp(-(d * d) / (R * R * 0.8)); sum += kSm[wrap(i + d)] * wt; wsum += wt; }
        out[i] = sum / wsum;
      }
      kSm = out;
    }
    const rooms = new Float32Array(segs);
    for (let i = 0; i < segs; i++) rooms[i] = 1.0 / Math.max(kSm[i], 1e-3);
    const roomAt = (u) => { const x = uw(u) * segs, i0 = Math.floor(x), f = x - i0; return rooms[wrap(i0)] * (1 - f) + rooms[wrap(i0 + 1)] * f; };
    // width profile (0..1), repeating exactly once round the loop
    const TAU = Math.PI * 2;
    const widthAt = (u) => {
      // two broad swells round the loop, gently varied: few necks, no small bulges
      const a = 0.55 + 0.45 * Math.sin(u * TAU * 2 + 0.7);
      const b = 0.75 + 0.25 * Math.sin(u * TAU * 1 + 2.0);
      return Math.min(1, Math.max(0, a * b * 1.15));
    };
    // twist plan: the designed twist (whole half-turns round the loop, so it meets up at the
    // join), turned at tight bends so the ribbon bends across its thin side; smoothed round
    const phiPlan = new Float32Array(segs);
    {
      const rate = new Float32Array(segs + 1);
      let total = 0;
      for (let i = 1; i <= segs; i++) { const u = i / segs; total += (2.0 + 2.5 * Math.pow(1 - widthAt(u), 2)) / segs; }
      // whole turns (not half-turns): the band must come back the same way up, or its two faces
      // would meet the wrong way round at the join
      const want = Math.max(1, Math.round(total / (Math.PI * 2))) * Math.PI * 2, scale = want / total;
      let phiD = 0.3;
      const Kv = new THREE.Vector3(), Ta = new THREE.Vector3(), Tb = new THREE.Vector3();
      const raw = new Float32Array(segs + 1);
      let prevTarget = null;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        if (i > 0) phiD += (2.0 + 2.5 * Math.pow(1 - widthAt(u), 2)) / segs * scale;   // slow, even twist
        const ii = wrap(i);
        curve.getTangentAt(uw(u - 0.01), Ta); curve.getTangentAt(uw(u + 0.01), Tb);
        Kv.subVectors(Tb, Ta).multiplyScalar(1 / (len * 0.02));
        const kmag = Kv.length();
        let target = phiD;
        if (kmag > 1e-4) {
          let th = Math.atan2(-Kv.dot(frameN[ii]), Kv.dot(frameB[ii]));
          const ref = prevTarget === null ? phiD : prevTarget;
          th += Math.round((ref - th) / Math.PI) * Math.PI;
          const blend = Math.min(1, Math.max(0, (kmag - 0.35) / 1.2));
          const bl = blend * blend * (3 - 2 * blend);
          const dPhi = th - phiD;
          target = phiD + bl * (dPhi - Math.round(dPhi / Math.PI) * Math.PI);
        }
        if (prevTarget !== null) target += Math.round((prevTarget - target) / Math.PI) * Math.PI;
        raw[i] = target; prevTarget = target;
      }
      // after one full turn the plan lands a whole number of half-turns on: the band looks the same
      let K = Math.round((raw[segs] - raw[0]) / Math.PI) * Math.PI;
      // if the turns at tight bends added an odd half-turn, spread one half-turn back out
      // evenly over the whole loop, so the band again comes back the same way up
      if (Math.round(K / Math.PI) % 2 !== 0) {
        for (let i = 0; i <= segs; i++) raw[i] -= Math.PI * (i / segs);
        K -= Math.PI;
      }
      const at = (i) => raw[wrap(i)] + K * Math.floor(i / segs);
      const Rw = Math.round(segs * 0.05);   // twist changes spread over a long stretch
      for (let i = 0; i < segs; i++) {
        let sum = 0, wsum = 0;
        for (let d = -Rw; d <= Rw; d++) { const wt = Math.exp(-(d * d) / (Rw * Rw * 0.4)); sum += at(i + d) * wt; wsum += wt; }
        phiPlan[i] = sum / wsum;
      }
    }
    // safe width per ring: limited by the part of the bend that runs along the width
    const effRoom = new Float32Array(segs);
    {
      const raw = new Float32Array(segs);
      const Ta = new THREE.Vector3(), Tb = new THREE.Vector3(), Kd = new THREE.Vector3(), Wd = new THREE.Vector3();
      for (let i = 0; i < segs; i++) {
        const u = i / segs;
        curve.getTangentAt(uw(u - 0.01), Ta); curve.getTangentAt(uw(u + 0.01), Tb);
        Kd.subVectors(Tb, Ta);
        const kl = Kd.length();
        Wd.copy(frameN[i]).multiplyScalar(Math.cos(phiPlan[i])).addScaledVector(frameB[i], Math.sin(phiPlan[i]));
        const al = kl > 1e-7 ? Math.abs(Kd.dot(Wd)) / kl : 0;
        const plain = roomAt(u) * 0.72;
        raw[i] = Math.min(plain * 3.5, plain / Math.sqrt(al * al + 0.05));
      }
      const Rm = Math.round(segs * 0.012), mn = new Float32Array(segs);
      for (let i = 0; i < segs; i++) { let m = Infinity; for (let d = -Rm; d <= Rm; d++) m = Math.min(m, raw[wrap(i + d)]); mn[i] = m; }
      for (let i = 0; i < segs; i++) {
        let sum = 0, wsum = 0;
        for (let d = -Rm; d <= Rm; d++) { const wt = Math.exp(-(d * d) / (Rm * Rm * 0.4)); sum += mn[wrap(i + d)] * wt; wsum += wt; }
        effRoom[i] = sum / wsum;
      }
    }
    const pos = [], center = [], tangent = [], along = [], fade = [], idx = [];
    const p = new THREE.Vector3(), c = new THREE.Vector2();
    // the band's width round the loop, smoothed: the bend limit alone changed in many small
    // steps, which showed as bumps on the edges. Taking the narrowest value over a stretch and
    // then smoothing keeps it within every bend's limit while it only swells in long waves.
    const wArr = new Float32Array(segs);
    {
      const raw = new Float32Array(segs);
      for (let i = 0; i < segs; i++) {
        const wBase = (0.36 + 0.95 * Math.pow(widthAt(i / segs), 1.2)) * 0.9;   // a little narrower; necks never pinched
        raw[i] = Math.max(wBase / Math.pow(1 + Math.pow(wBase / effRoom[i], 4), 0.25), 1e-3);
      }
      const Rn = Math.round(segs * 0.02), Rg = Math.round(segs * 0.035), mn = new Float32Array(segs);
      for (let i = 0; i < segs; i++) { let m = Infinity; for (let d = -Rn; d <= Rn; d++) m = Math.min(m, raw[wrap(i + d)]); mn[i] = m; }
      for (let pass = 0; pass < 2; pass++) {
        const src = pass === 0 ? mn : Float32Array.from(wArr);
        for (let i = 0; i < segs; i++) {
          let sum = 0, wsum = 0;
          for (let d = -Rg; d <= Rg; d++) { const wt = Math.exp(-(d * d) / (Rg * Rg * 0.35)); sum += src[wrap(i + d)] * wt; wsum += wt; }
          wArr[i] = sum / wsum;
        }
      }
    }
    for (let i = 0; i < segs; i++) {
      const u = i / segs;
      curve.getPointAt(u, p);
      const tan = tanR[i], N = frameN[i], B = frameB[i];
      const phi = phiPlan[i], cp = Math.cos(phi), sp = Math.sin(phi);
      const w = wArr[i];
      const swell = 0.94 + 0.12 * Math.sin(u * TAU * 1 + 1.1);
      const h = Math.max(1e-3, Math.min((0.07 + 0.085 * Math.sqrt(w)) * swell, w * 0.62));
      const slack = Math.min(1, Math.max(0, (roomAt(u) / Math.max(w, 1e-3) - 1.6) / 1.5));
      const motion = 0.4 + 0.6 * slack * slack * (3 - 2 * slack);
      const camberRaw = w * (0.12 + 0.1 * Math.sin(u * TAU * 2 + 0.4));
      const thick = h + camberRaw, lim = roomAt(u) * 0.62;
      const thinK = 1 / Math.pow(1 + Math.pow(thick / lim, 4), 0.25);
      const hT = h * thinK, camber = camberRaw * thinK;
      for (let j = 0; j < RADIAL; j++) {
        section(j, w, hT, c);
        c.y += camber * (1 - (c.x / w) * (c.x / w));
        const a2 = c.x * cp - c.y * sp, b2 = c.x * sp + c.y * cp;
        pos.push(p.x + N.x * a2 + B.x * b2, p.y + N.y * a2 + B.y * b2, p.z + N.z * a2 + B.z * b2);
        center.push(p.x, p.y, p.z);
        tangent.push(tan.x, tan.y, tan.z);
        along.push(u);
        fade.push(motion);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < RADIAL; j++) {
      const i2 = (i + 1) % segs;
      const a = i * RADIAL + j, b = i * RADIAL + (j + 1) % RADIAL;
      const d = i2 * RADIAL + j, e = i2 * RADIAL + (j + 1) % RADIAL;
      idx.push(a, d, b, d, e, b);
    }
    const box = new THREE.Box3().setFromArray(pos);
    const mid = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= mid.x; pos[i + 1] -= mid.y; pos[i + 2] -= mid.z;
      center[i] -= mid.x; center[i + 1] -= mid.y; center[i + 2] -= mid.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 3));
    g.setAttribute('aTangent', new THREE.Float32BufferAttribute(tangent, 3));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.getAttribute('normal').array;
    const count = pos.length / 3;
    const nPos = new Float32Array(count * 3), nNrm = new Float32Array(count * 3);
    const nCen = new Float32Array(count * 3), nTan = new Float32Array(count * 3);
    const nAlong = new Float32Array(count), nFade = new Float32Array(count), nDir = new Float32Array(count);
    for (let i = 0; i < segs; i++) for (let j = 0; j < RADIAL; j++) {
      const v = i * RADIAL + j, u2 = ((i + 1) % segs) * RADIAL + j;
      for (let k = 0; k < 3; k++) {
        nPos[v * 3 + k] = pos[u2 * 3 + k]; nNrm[v * 3 + k] = nrm[u2 * 3 + k];
        nCen[v * 3 + k] = center[u2 * 3 + k]; nTan[v * 3 + k] = tangent[u2 * 3 + k];
      }
      nAlong[v] = i + 1 < segs ? along[u2] : 1.0; nFade[v] = fade[u2]; nDir[v] = 1;
    }
    g.setAttribute('aNextPos', new THREE.BufferAttribute(nPos, 3));
    g.setAttribute('aNextNormal', new THREE.BufferAttribute(nNrm, 3));
    g.setAttribute('aNextCenter', new THREE.BufferAttribute(nCen, 3));
    g.setAttribute('aNextTangent', new THREE.BufferAttribute(nTan, 3));
    g.setAttribute('aNextAlong', new THREE.BufferAttribute(nAlong, 1));
    g.setAttribute('aNextFade', new THREE.BufferAttribute(nFade, 1));
    g.setAttribute('aNextDir', new THREE.BufferAttribute(nDir, 1));
    g.computeBoundingSphere();
    return g;
  }

  // ---------- Material ----------
  const uniforms = {
    uTime: { value: 0 },
    uMorph: { value: reduceMotion.matches ? 0.25 : 1 },
    uTrail: { value: Array.from({ length: TRAIL }, () => new THREE.Vector4()) },
    uTrailDir: { value: Array.from({ length: TRAIL }, () => new THREE.Vector3()) },
    uBackdrop: { value: null },
    uUseBackdrop: { value: useBackdrop ? 1 : 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uEnvRot: { value: 0 },
    uSmoke: { value: new THREE.Color(0xc8ccd3) },
    uDebug: { value: 0 },
  };
  const common = { vertexShader: VERTEX, fragmentShader: FRAGMENT };
  const additive = {
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,          // out = highlights + behind × transmittance
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
  };
  // Only the outer surface of the glass is drawn (drawing the inside walls too is what
  // produced hard lines). Where the glass overlaps itself, both outer surfaces show.
  // 1. depth of the nearest outer surface (no colour) — used to place the refraction
  const depthOnly = new THREE.ShaderMaterial({
    ...common,
    uniforms: { ...uniforms, uPass: { value: 0 }, uLayer: { value: 1 } },
    side: THREE.FrontSide,
    colorWrite: false,
    depthWrite: true,
    polygonOffset: true,             // tolerance so the refraction pass reliably matches
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  // 2. refraction of the page, on the nearest outer surface (backdrop mode)
  const refraction = new THREE.ShaderMaterial({
    ...common,
    uniforms: { ...uniforms, uPass: { value: 1 }, uLayer: { value: 1 } },
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.NormalBlending,
  });
  // 3. smoke and shine on every outer surface (order-independent, so overlaps add up cleanly)
  const glass = new THREE.ShaderMaterial({
    ...common, ...additive,
    uniforms: { ...uniforms, uPass: { value: 0 }, uLayer: { value: 1 } },
    side: THREE.FrontSide,
    depthTest: false,
  });

  if (useBackdrop) {
    paintCanvas = document.createElement('canvas');
    ctx = paintCanvas.getContext('2d');
  }

  const geometry = ribbonLoopGeometry(path, lowPower ? 700 : 1300);
  const mesh = new THREE.Mesh(geometry, glass);
  mesh.frustumCulled = false;                // vertices move on the GPU
  // order: depth → refracted page → smoke and shine on top
  mesh.renderOrder = 3;
  const pass = (material, order) => {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false; m.renderOrder = order;
    mesh.add(m);
  };
  if (useBackdrop) { pass(depthOnly, 1); pass(refraction, 2); }
  const spinner = new THREE.Group();          // slow rotation + user drag
  const pivot = new THREE.Group();            // placement + lean toward cursor
  spinner.add(mesh); pivot.add(spinner); scene.add(pivot);
  spinner.rotation.set(0.08, 0, 0);
  const radius = geometry.boundingSphere.radius;

  // ---------- Layout ----------
  const num = (name, fallback) => { const v = parseFloat(host.getAttribute(name)); return Number.isFinite(v) ? v : fallback; };
  const buf = new THREE.Vector2();
  function layout() {
    const { width: w, height: h } = host.getBoundingClientRect();
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(buf);
    uniforms.uRes.value.copy(buf);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * camera.aspect;
    const mobile = w <= 479;
    const sfx = mobile ? '-mobile' : '';
    const x = num('data-glass-x' + sfx, num('data-glass-x', 0.5));
    const y = num('data-glass-y' + sfx, num('data-glass-y', 0.5));
    const size = num('data-glass-size' + sfx, num('data-glass-size', 0.8));
    pivot.position.set((x - 0.5) * viewW, (0.5 - y) * viewH, 0);
    pivot.scale.setScalar((Math.min(viewW, viewH) * size) / (2 * radius) * 1.15);
    paintBackdrop(w, h, renderer.getPixelRatio());
  }
  new ResizeObserver(layout).observe(host);
  layout();
  if (useBackdrop && document.fonts) {
    document.fonts.ready.then(layout);
    document.fonts.addEventListener('loadingdone', layout);
  }
  host.liquidGlass = { renderer, scene, camera, mesh, uniforms, radial: RADIAL };

  // ---------- Interaction ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const lean = { x: 0, y: 0 }, leanNow = { x: 0, y: 0 };
  let inside = false, moved = false, lastHit = null, head = 0;
  let dragging = false, lastX = 0, lastY = 0, velX = 0, velY = 0;

  window.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    inside = fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1;
    lean.x = THREE.MathUtils.clamp(fx - 0.5, -0.7, 0.7) * 0.1;   // gently turns toward the cursor
    lean.y = THREE.MathUtils.clamp(fy - 0.5, -0.7, 0.7) * 0.06;
    ndc.set(fx * 2 - 1, -fy * 2 + 1);
    moved = true;
    if (dragging) {
      velY = (e.clientX - lastX) * 0.004;
      velX = e.pointerType === 'touch' ? 0 : (e.clientY - lastY) * 0.004;
      lastX = e.clientX; lastY = e.clientY;
    }
  }, { passive: true });
  host.style.touchAction = 'pan-y';
  host.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    host.setPointerCapture(e.pointerId);
  });
  const release = () => { dragging = false; };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);

  function stir() {
    if (!inside || !moved || dragging) { if (!inside) lastHit = null; return; }
    moved = false;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) { lastHit = null; return; }
    const local = mesh.worldToLocal(hit.point.clone());
    if (lastHit) {
      const dir = local.clone().sub(lastHit);
      const l = dir.length();
      if (l > 0.02) {
        dir.multiplyScalar(Math.min(l, 0.5) / l);
        uniforms.uTrail.value[head].set(local.x, local.y, local.z, 1);
        uniforms.uTrailDir.value[head].copy(dir);
        head = (head + 1) % TRAIL;
        lastHit = local;
      }
    } else lastHit = local;
  }

  // ---------- Loop (paused when off-screen or tab hidden) ----------
  const onScreen = () => {
    const r = host.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const clock = new THREE.Clock();
  let time = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (document.hidden || !onScreen()) return;
    const still = reduceMotion.matches;
    time += dt * (still ? 0.25 : 1);
    uniforms.uTime.value = time;
    uniforms.uEnvRot.value = time * 0.05;     // highlights drift slowly
    stir();
    uniforms.uTrail.value.forEach((v) => { v.w *= 0.965; });

    // slow rotation and floating; most of the life comes from the deformation
    // gentle sway around the front view, so the symmetry reads; drag adds momentum
    spinner.rotation.y += velY;
    spinner.rotation.x += velX;
    const homeY = still ? 0 : Math.sin(time * 0.13) * 0.08;
    const homeX = 0.04 + (still ? 0 : Math.sin(time * 0.1) * 0.03);
    if (!dragging) {
      spinner.rotation.y += (homeY - spinner.rotation.y) * 0.015;
      spinner.rotation.x += (homeX - spinner.rotation.x) * 0.015;
    }
    spinner.rotation.z = 0;
    velY *= dragging ? 0.5 : 0.94;
    velX *= dragging ? 0.5 : 0.94;
    mesh.position.y = still ? 0 : Math.sin(time * 0.4) * 0.1;
    mesh.position.x = 0;

    leanNow.x += (lean.x - leanNow.x) * 0.03;
    leanNow.y += (lean.y - leanNow.y) * 0.03;
    pivot.rotation.y = leanNow.x;
    pivot.rotation.x = leanNow.y;

    renderer.render(scene, camera);
    if (!scope.classList.contains('is-glass-ready')) scope.classList.add('is-glass-ready');
  });
}
