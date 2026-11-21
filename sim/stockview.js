/* ==========================================================================
 * TNC 426 simulator  --  stockview.js
 * How the 3-axis stock is DRAWN. The material model stays the engine's
 * TNC_STOCK height field (ui.js keeps stamping it; the checks, surfaceAt and
 * the removed volume read only that). This module keeps a display copy:
 *
 *   - a finer display field (quality medium x2, high x3 per axis, capped), cut
 *     with the same engine stamp (TNC_STOCK.stamp on a finer grid object, with
 *     extra visits in between so its scallops stay below the finer grid), or
 *     the engine field itself on low;
 *   - edge snapping: every node next to a step is moved sideways onto the wall.
 *     For a vertical tool the view records, per node, the signed distance to the
 *     edge of the visits (E, exact: discs, balls, cones), so walls are straight
 *     and sub-cell at any angle; elsewhere (low, tilted tools) the half-height
 *     line of a twice-blurred field. Rims of sloped cuts go to the crease.
 *     A staircase of cut / uncut nodes becomes a straight, vertical wall.
 *   - per-quad diagonal choice, per-vertex cavity (ambient occlusion from a box
 *     blur), cut / raw flag, wall direction;
 *   - one MeshStandardMaterial patched in onBeforeCompile: walls shade with the
 *     wall direction (smooth), flat faces with the face normal (crisp edges),
 *     curved surfaces with the vertex normal; procedural finish per surface:
 *     rolled mill finish on the raw top, face-mill arcs on machined floors, fine
 *     step lines on walls, band-saw marks on the raw sides. Colours / metalness /
 *     roughness come from the TNC_MATERIALS preset.
 *   - tiles of 32 x 32 quads that collapse to two triangles (or per 8 x 8 block)
 *     where everything around is one flat level; off-screen tiles are culled;
 *   - incremental repaint: only the rows a stamp touched (plus the AO radius)
 *     are recomputed and uploaded.
 *
 * Presentation only. Plain browser JS. Exposes one global: TNC_STOCKVIEW.
 * ========================================================================== */
var TNC_STOCKVIEW = (function () {
  'use strict';

  var FACTOR = { low: 1, medium: 2, high: 3 };
  var CAP = { low: Infinity, medium: 700000, high: 1300000 };   // display nodes
  var AO_MM = 2.5;                                               // cavity radius
  var CUR = null;                                                // the live view (settings listener)

  function factorFor(q, g) {
    var f = FACTOR[q] || 3;
    while (f > 1 && ((g.NX - 1) * f + 1) * ((g.NY - 1) * f + 1) > (CAP[q] || CAP.high)) f--;
    return f;
  }

  /* ---------------- shader patch ---------------- */
  var VERT_PARS = 'attribute vec4 sv;\nvarying vec2 vSv;\nvarying vec3 vP;\nvarying vec3 vON;\nvarying vec3 vWN;\n';
  var VERT_MAIN = '#include <begin_vertex>\n#ifdef SV_SIDE\nvSv=vec2(1.0,0.0);\nvec2 svW=objectNormal.xy;\n#else\nvSv=sv.xy;\nvec2 svW=sv.zw;\n#endif\nvP=position;\nvON=objectNormal;\nvWN=normalMatrix*vec3(svW,0.);\n';
  var FRAG_PARS = [
    'varying vec2 vSv;', 'varying vec3 vP;', 'varying vec3 vON;', 'varying vec3 vWN;',
    'uniform vec3 uRaw; uniform vec3 uCut; uniform float uRawR; uniform float uCutR;',
    'float svH(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    'float svN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);',
    '  return mix(mix(svH(i),svH(i+vec2(1.,0.)),f.x),mix(svH(i+vec2(0.,1.)),svH(i+vec2(1.,1.)),f.x),f.y); }',
    /* fade a periodic pattern out before it aliases: w = cycles per pixel */
    'float svFade(float w){ return 1.-smoothstep(.22,.55,w); }',
    ''
  ].join('\n');
  var FRAG_COLOR = [
    '#include <color_fragment>',
    'vec3 svFx=dFdx(vP), svFy=dFdy(vP);',
    'vec3 svF=normalize(cross(svFx,svFy));',
    'vec3 svV=normalize(vON);',
    'if(dot(svF,svV)<0.) svF=-svF;',
    /* a wall face takes the wall direction (the blurred gradient at its nodes), so walls shade smoothly, not per triangle;
       other faces the vertex normal where it agrees with the face (curved surfaces), else the face normal (crisp) */
    'vec3 svWN=normalize(vWN+1e-6);',
    'bool svSideF=abs(svF.z)<.35&&length(vWN)>.05;',
    'bool svUseF=!svSideF&&dot(svF,svV)<.96;',
    'vec3 svO=svSideF?normalize(vec3(svF.xy,0.)):(svUseF?svF:svV);',
    'float svWall=1.-smoothstep(.45,.8,abs(svO.z));',
    'float svAO=vSv.x;',
    '#ifdef SV_SIDE',
    '  float svCut=0.; svWall=1.;',
    '#else',
    '  float svCut=max(clamp(vSv.y,0.,1.),svWall);',
    '#endif',
    'vec3 svCol=mix(uRaw,uCut,svCut);',
    'float svR=mix(uRawR,uCutR,svCut);',
    '#ifndef SV_LOW',
    '{',
    '#ifdef SV_SIDE',
    /* raw sides: sawn bar stock -- slanted band-saw striations + coarse mottling */
    '  float along=abs(svO.x)>abs(svO.y)?vP.y:vP.x;',
    '  float sc=(along+vP.z*.42)/.85, w=fwidth(sc);',
    '  float st=abs(fract(sc)*2.-1.), n=svN(vec2(along*.06,vP.z*.5));',
    '  float s2=svN(vec2(sc*1.7,vP.z*3.));',
    '  svCol*=.92+.07*n+(.07*st+.05*s2-.06)*svFade(w);',
    '  svR+=.12*(n-.5)+.08*st*svFade(w);',
    '#else',
    '  if(svWall>.5){',
    /* walls: the flank of the cutter leaves fine horizontal lines, slightly uneven */
    '    float sc=vP.z/.18, w=fwidth(sc);',
    '    float st=abs(fract(sc+.15*svN(vP.xy*.4))*2.-1.);',
    '    svCol*=.90+.06*st*svFade(w);',
    '    svR=uCutR*.85+.08*st*svFade(w);',
    '  } else if(svCut>.5){',
    /* machined floors: face-mill arcs, rows along X, alternating direction */
    '    float S=11., R=5.4, f=.55;',
    '    float row=floor(vP.y/S), dy=vP.y-(row+.5)*S, s=sqrt(max(R*R-dy*dy,0.));',
    '    float xx=(vP.x+(mod(row,2.)<1.?-s:s))/f, w=fwidth(xx);',
    '    float tri=abs(fract(xx)*2.-1.);',
    '    float n=svN(vP.xy*.35), seam=smoothstep(R*.82,R,abs(dy));',
    '    float fd=svFade(w);',
    '    svCol*=1.+(.024*tri-.012)*fd+.03*(n-.5)-.015*seam;',
    '    svR+=(.06*tri-.03)*fd+.03*seam+.05*(n-.5);',
    '  } else {',
    /* raw top: rolled mill finish -- long streaks along X, low-frequency mottle */
    '    float sx=vP.y*2.2, w=fwidth(sx);',
    '    float st=svN(vec2(vP.x*.07,sx)), m=svN(vP.xy*.035), m2=svN(vP.xy*.21);',
    '    svCol*=.93+.07*m+.03*m2+.06*(st-.5)*svFade(w);',
    '    svR+=.10*(st-.5)*svFade(w)+.06*(m-.5);',
    '  }',
    '#endif',
    '}',
    '#endif',
    'diffuseColor.rgb*=svCol;'
  ].join('\n');
  var FRAG_ROUGH = '#include <roughnessmap_fragment>\nroughnessFactor=clamp(svR,.06,1.);\n';
  var FRAG_NORMAL = ['#include <normal_fragment_begin>',
    'if(svSideF){ vec3 wN=svWN; if(dot(wN,vViewPosition)<0.) wN=-wN; normal=wN; nonPerturbedNormal=wN; }',
    'else if(svUseF){ vec3 fN=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition))); normal=fN; nonPerturbedNormal=fN; }', ''].join('\n');
  var FRAG_AO = [
    '#include <aomap_fragment>',
    '{ float a=clamp(svAO,0.,1.5);',
    '  reflectedLight.indirectDiffuse*=a; reflectedLight.indirectSpecular*=min(a,1.);',
    '  reflectedLight.directDiffuse*=.45+.55*min(a,1.)+.2*max(a-1.,0.); reflectedLight.directSpecular*=.5+.5*min(a,1.); }'
  ].join('\n');

  function stockMaterial(THREE, side, low) {
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .5, roughness: .5, side: THREE.DoubleSide });
    var U = { uRaw: { value: new THREE.Color(0x9aa0a8) }, uCut: { value: new THREE.Color(0xb4bac2) }, uRawR: { value: .62 }, uCutR: { value: .38 } };
    m.defines = m.defines || {};
    if (side) m.defines.SV_SIDE = '';
    if (low) m.defines.SV_LOW = '';
    m.userData.sv = U;
    m.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', VERT_MAIN);
      sh.fragmentShader = FRAG_PARS + sh.fragmentShader
        .replace('#include <color_fragment>', FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
        .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
        .replace('#include <aomap_fragment>', FRAG_AO);
    };
    m.customProgramCacheKey = function () { return 'stockview' + (side ? 'S' : 'T') + (low ? 'L' : ''); };
    return m;
  }

  /* preset (TNC_MATERIALS) -> uniforms: raw = a little darker and duller, machined = brighter, finer */
  function applyPreset(THREE, m, p) {
    if (!m || !m.userData.sv || !p) return;
    var U = m.userData.sv, c = new THREE.Color(p.color), lum = c.r * .3 + c.g * .59 + c.b * .11;
    U.uRaw.value.copy(c).multiplyScalar(.54);
    U.uCut.value.copy(c).lerp(new THREE.Color(1, 1, 1), .10 * (1 - lum)).multiplyScalar(.80);
    U.uRawR.value = Math.min(1, p.roughness + .14);
    U.uCutR.value = Math.max(.1, p.roughness * .6);
    m.metalness = p.metalness;
    m.envMapIntensity = .55;
  }

  /* ---------------- the view ---------------- */
  function create(THREE, o) {
    var st = o.st, G = o.grid, STOCK = o.stock, root = o.root, quality = o.quality || 'high';
    var OX = 0, OY = 0, B1 = null, E = null, ZE = null, f, NX, NY, DX, DY, N, H, gD, B, T, Bb, pos, nrm, svA, top, skirt, floor, vice = [], dirty = null, preset = null;
    var topMat = null, sideMat = null;

    function alloc() {
      f = factorFor(quality, G);
      NX = (G.NX - 1) * f + 1; NY = (G.NY - 1) * f + 1; DX = G.DX / f; DY = G.DY / f; N = NX * NY;
      gD = { NX: NX, NY: NY, DX: DX, DY: DY };
      OX = f === 1 ? 0 : DX * .0731; OY = f === 1 ? 0 : DY * .0577;
      if (f === 1) H = o.hm; else { H = new Float32Array(N); for (var k = 0; k < N; k++) H[k] = st.z1; }
      B = new Float32Array(N); B1 = f === 1 ? null : new Float32Array(N); E = f === 1 ? null : new Float32Array(N).fill(1e9); ZE = f === 1 ? null : new Float32Array(N).fill(1e9); T = new Float32Array(N); Bb = new Float32Array(N);
      pos = new Float32Array(N * 3); nrm = new Float32Array(N * 3); svA = new Float32Array(N * 4);
      var low = quality === 'low';
      if (topMat) topMat.dispose(); if (sideMat) sideMat.dispose();
      topMat = stockMaterial(THREE, false, low); sideMat = stockMaterial(THREE, true, low);
      if (preset) { applyPreset(THREE, topMat, preset); applyPreset(THREE, sideMat, preset); }
      /* tiles of TQ x TQ quads sharing one set of vertex attributes; each has its own index: two triangles while it and
         its surroundings are one flat level (most of a part: raw top, pocket floors), every quad where something is.
         Off-screen tiles are culled. A software renderer pays per triangle, so this is what keeps a big plate fluid. */
      var aP = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), aN = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage),
        aS = new THREE.BufferAttribute(svA, 4).setUsage(THREE.DynamicDrawUsage);
      if (top) { top.children.slice().forEach(function (m) { top.remove(m); m.geometry.dispose(); }); }
      else { top = new THREE.Group(); top.name = 'stock'; }
      tiles = []; TX = Math.ceil((NX - 1) / TQ); TY = Math.ceil((NY - 1) / TQ);
      for (var tj = 0; tj < TY; tj++) for (var ti = 0; ti < TX; ti++) {
        var g = new THREE.BufferGeometry(), qi0 = ti * TQ, qj0 = tj * TQ, qi1 = Math.min(NX - 2, qi0 + TQ - 1), qj1 = Math.min(NY - 2, qj0 + TQ - 1);
        g.setAttribute('position', aP); g.setAttribute('normal', aN); g.setAttribute('sv', aS);
        g.setIndex(new THREE.BufferAttribute(new Uint32Array((qi1 - qi0 + 1) * (qj1 - qj0 + 1) * 6), 1));
        g.boundingBox = new THREE.Box3(new THREE.Vector3(st.x0 + qi0 * DX - DX, st.y0 + qj0 * DY - DY, st.z0), new THREE.Vector3(st.x0 + (qi1 + 1) * DX + DX, st.y0 + (qj1 + 1) * DY + DY, st.z1));
        g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
        g.setDrawRange(0, 0);
        var mesh = new THREE.Mesh(g, topMat); mesh.name = 'stock-tile'; mesh.matrixAutoUpdate = false;
        tiles.push({ m: mesh, qi0: qi0, qj0: qj0, qi1: qi1, qj1: qj1 }); top.add(mesh);
      }
      if (skirt) skirt.material = sideMat;
      dirty = { i0: 0, i1: NX - 1, j0: 0, j1: NY - 1, full: true };
    }
    var TQ = 32, TX = 0, TY = 0, tiles = [];
    alloc();

    skirt = new THREE.Mesh(new THREE.BufferGeometry(), sideMat); skirt.name = 'stock-sides';
    floor = new THREE.Mesh(new THREE.PlaneGeometry(st.x1 - st.x0, st.y1 - st.y0),
      new THREE.MeshStandardMaterial({ color: 0x4a535f, metalness: .5, roughness: .7, side: THREE.DoubleSide }));
    floor.position.set((st.x0 + st.x1) / 2, (st.y0 + st.y1) / 2, st.z0);
    top.userData.stockView = skirt.userData.stockView = floor.userData.stockView = null;   // filled below
    root.add(top); root.add(skirt); root.add(floor);
    /* vice jaws (TNC_STOCK.VICE; .on=false hides them): ground, blued tool steel */
    var vm = new THREE.MeshStandardMaterial({ color: 0x39424f, metalness: .82, roughness: .34, envMapIntensity: .8 });
    STOCK.vice(st).forEach(function (b) {
      var j = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), vm);
      j.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2); root.add(j); vice.push(j);
    });

    function mark(i0, i1, j0, j1) {
      i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(NX - 1, i1); j1 = Math.min(NY - 1, j1);
      if (i0 > i1 || j0 > j1) return;
      if (!dirty) dirty = { i0: i0, i1: i1, j0: j0, j1: j1 };
      else { dirty.i0 = Math.min(dirty.i0, i0); dirty.i1 = Math.max(dirty.i1, i1); dirty.j0 = Math.min(dirty.j0, j0); dirty.j1 = Math.max(dirty.j1, j1); }
    }
    function markAround(s, p, ax) {
      if (ax && (Math.abs(ax[0]) > 1e-6 || Math.abs(ax[1]) > 1e-6)) { mark(0, NX - 1, 0, NY - 1); return; }
      var r = (+s.toolR || 0) + 2 * Math.max(DX, DY);
      mark(Math.floor((p.x - r - st.x0) / DX), Math.ceil((p.x + r - st.x0) / DX), Math.floor((p.y - r - st.y0) / DY), Math.ceil((p.y + r - st.y0) / DY));
    }

    /* one visit of the tool: the engine's own stamp on the display grid (low: the engine field is the display field).
       The engine's visits are up to 0.45 R apart (its scallops are below its own grid); on the finer display grid
       they would show as beads, so the view adds visits in between, at most max(cell, 0.15 R) apart */
    var lastS = null, lastP = null;
    /* the display grid sits a few hundredths of a cell off the round numbers: a tool edge that falls exactly on a node
       column (R 1.5 at X+75.5 on a 0.25 grid) would otherwise cut that column only where a visit lands on a node row,
       which draws as spikes; the whole display is shifted back by the same amount below (about 0.015 mm) */
    // OX, OY: set in alloc()
    function stamp(s, p, ax, engineHit) {
      if (f === 1) { if (engineHit) markAround(s, p, ax); return !!engineHit; }
      var hit = false, r = +s.toolR || 0, vert = !ax || (Math.abs(ax[0]) < 1e-6 && Math.abs(ax[1]) < 1e-6);
      if (lastS === s && lastP) {
        var dx = p.x - lastP.x, dy = p.y - lastP.y, dz = p.z - lastP.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var n = Math.min(64, Math.ceil(d / Math.max(Math.min(DX, DY), .15 * r)));
        for (var k = 1; k < n; k++) {
          var q = { x: lastP.x + dx * k / n, y: lastP.y + dy * k / n, z: lastP.z + dz * k / n };
          q.x += OX; q.y += OY;
          if (vert) edges(s, q);
          if (STOCK.stamp(H, st, gD, s, q, ax, 0)) { hit = true; markAround(s, q, ax); }
        }
      }
      lastS = s; lastP = { x: p.x, y: p.y, z: p.z };
      var p2 = { x: p.x + OX, y: p.y + OY, z: p.z };
      if (vert) edges(s, p2);
      if (STOCK.stamp(H, st, gD, s, p2, ax, 0)) { hit = true; markAround(s, p2, ax); }
      return hit;
    }
    /* sub-cell wall positions. For a vertical tool the view knows where the edge of each visit lies, exactly: E is,
       per node, the signed distance (mm) to the edge of the visits that went deeper than the node (outside: > 0), or,
       for a node a visit lowered, to the edge of the visits at its own depth (inside: < 0); ZE = the depth E belongs
       to. Run before the engine stamp (it needs the height before the cut). Snapping then moves wall nodes by E:
       straight, sub-cell walls at any angle, not the half-height line of a blur. Drawing only. */
    function edges(s, p) {
      var r = +s.toolR || 0; if (!(r > 0)) return;
      var cone = !!s.cone, ball = !cone && (!!s.ball || (+s.toolR2 > 0 && +s.toolR2 >= r - 1e-9));
      var m = 2 * Math.max(DX, DY), R = r + m, z = p.z, full = cone || ball;
      var j0 = Math.max(0, Math.floor((p.y - R - st.y0) / DY)), j1 = Math.min(NY - 1, Math.ceil((p.y + R - st.y0) / DY));
      var rin = r - m, i, j, k;
      for (j = j0; j <= j1; j++) {
        var dy = st.y0 + j * DY - p.y, o2 = R * R - dy * dy; if (o2 < 0) continue;
        var xo = Math.sqrt(o2), xi = (!full && rin > 0 && rin * rin - dy * dy > 0) ? Math.sqrt(rin * rin - dy * dy) : -1;
        var ia = Math.max(0, Math.ceil((p.x - xo - st.x0) / DX)), ib = Math.min(NX - 1, Math.floor((p.x + xo - st.x0) / DX));
        var sa = xi > 0 ? Math.floor((p.x - xi - st.x0) / DX) : ib, sb = xi > 0 ? Math.ceil((p.x + xi - st.x0) / DX) : ib + 1;
        for (i = ia; i <= ib; i++) {
          if (i > sa && i < sb) { i = sb - 1; continue; }        // the deep inside of a flat cutter: no edge near
          k = j * NX + i;
          var dx = st.x0 + i * DX - p.x, d = Math.sqrt(dx * dx + dy * dy), h = H[k];
          /* the tool surface at d, and the radius at which it reaches height h */
          var zz = d > r ? Infinity : cone ? z + d : ball ? z + r - Math.sqrt(Math.max(0, r * r - d * d)) : z;
          var re = function (hh) { var t = hh - z; if (cone) return Math.max(0, Math.min(r, t)); if (ball) return t >= r ? r : t <= 0 ? 0 : Math.sqrt(r * r - (r - t) * (r - t)); return r; };
          if (h > zz + 1e-3) { E[k] = d - re(zz); ZE[k] = zz; }   // lowered: its own level starts here
          else if (h > zz - 1e-4) { if (ZE[k] >= h - 1e-4) { var v = d - r; if (v < E[k]) E[k] = v; } }   // already at this depth
          else if (h > z + 1e-4) {                                 // above the visit's bottom, not cut: a wall of a deeper visit
            var v2 = d - re(h);
            if (ZE[k] >= h - 1e-4) { E[k] = v2; ZE[k] = z; } else if (v2 < E[k]) { E[k] = v2; if (z < ZE[k]) ZE[k] = z; }
          }
        }
      }
    }
    function reset() {
      lastS = lastP = null;
      if (f !== 1) { H.fill(st.z1); E.fill(1e9); ZE.fill(1e9); }
      mark(0, NX - 1, 0, NY - 1);
    }

    /* ---- repaint the dirty rows ---- */
    function blur5(H, B, i0, i1, j0, j1) {         // B = 5x5 binomial of H on [i0..i1]x[j0..j1] (edges clamped)
      var i, j, r0 = Math.max(0, j0 - 2), r1 = Math.min(NY - 1, j1 + 2);
      for (j = r0; j <= r1; j++) { var row = j * NX;
        for (i = i0; i <= i1; i++) {
          var im2 = i - 2 < 0 ? 0 : i - 2, im1 = i - 1 < 0 ? 0 : i - 1, ip1 = i + 1 > NX - 1 ? NX - 1 : i + 1, ip2 = i + 2 > NX - 1 ? NX - 1 : i + 2;
          T[row + i] = (H[row + im2] + 4 * H[row + im1] + 6 * H[row + i] + 4 * H[row + ip1] + H[row + ip2]) * 0.0625; } }
      for (j = j0; j <= j1; j++) {
        var jm2 = (j - 2 < 0 ? 0 : j - 2) * NX, jm1 = (j - 1 < 0 ? 0 : j - 1) * NX, jj = j * NX, jp1 = (j + 1 > NY - 1 ? NY - 1 : j + 1) * NX, jp2 = (j + 2 > NY - 1 ? NY - 1 : j + 2) * NX;
        for (i = i0; i <= i1; i++) B[jj + i] = (T[jm2 + i] + 4 * T[jm1 + i] + 6 * T[jj + i] + 4 * T[jp1 + i] + T[jp2 + i]) * 0.0625;
      }
    }
    function boxBlur(i0, i1, j0, j1, R) {          // Bb = (2R+1)^2 box mean of H (edges clamped), via T
      var i, j, k, s, r0 = Math.max(0, j0 - R), r1 = Math.min(NY - 1, j1 + R), w = 1 / (2 * R + 1);
      for (j = r0; j <= r1; j++) { var row = j * NX; s = 0;
        for (k = i0 - R; k <= i0 + R; k++) s += H[row + (k < 0 ? 0 : k > NX - 1 ? NX - 1 : k)];
        for (i = i0; i <= i1; i++) { T[row + i] = s * w;
          var ka = i - R, kb = i + R + 1; s += H[row + (kb > NX - 1 ? NX - 1 : kb)] - H[row + (ka < 0 ? 0 : ka)]; } }
      for (i = i0; i <= i1; i++) { s = 0;
        for (k = j0 - R; k <= j0 + R; k++) s += T[(k < 0 ? 0 : k > NY - 1 ? NY - 1 : k) * NX + i];
        for (j = j0; j <= j1; j++) { Bb[j * NX + i] = s * w;
          var la = j - R, lb = j + R + 1; s += T[(lb > NY - 1 ? NY - 1 : lb) * NX + i] - T[(la < 0 ? 0 : la) * NX + i]; } }
    }
    function bs(x, y) {                            // B bilinear at fractional node coordinates (clamped)
      if (x < 0) x = 0; else if (x > NX - 1) x = NX - 1;
      if (y < 0) y = 0; else if (y > NY - 1) y = NY - 1;
      var i = Math.floor(x), j = Math.floor(y); if (i > NX - 2) i = NX - 2; if (j > NY - 2) j = NY - 2;
      var fx = x - i, fy = y - j, k = j * NX + i;
      return (B[k] * (1 - fx) + B[k + 1] * fx) * (1 - fy) + (B[k + NX] * (1 - fx) + B[k + NX + 1] * fx) * fy;
    }
    function hs(x, y) {                            // H bilinear (clamped)
      if (x < 0) x = 0; else if (x > NX - 1) x = NX - 1;
      if (y < 0) y = 0; else if (y > NY - 1) y = NY - 1;
      var i = Math.floor(x), j = Math.floor(y); if (i > NX - 2) i = NX - 2; if (j > NY - 2) j = NY - 2;
      var fx = x - i, fy = y - j, k = j * NX + i;
      return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) + (H[k + NX] * (1 - fx) + H[k + NX + 1] * fx) * fy;
    }
    function slope(a, h, b, n, d) {                // dH/dx at a node; a step on one side is left out
      var fa = h - a, fb = b - h, st = 1.0 * d;
      if (n < 2) return (fa + fb) / d;             // on the border one of them is 0
      if (Math.abs(fa) > st || Math.abs(fb) > st) return (Math.abs(fa) < Math.abs(fb) ? fa : fb) / d;
      return (fa + fb) / (2 * d);
    }
    var TS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
    function paint() {
      if (!dirty) return false;
      var Rb = Math.max(2, Math.min(16, Math.round(AO_MM / Math.max(DX, DY))));
      var m = Math.max(Rb, 4) + 1, d = dirty; dirty = null;
      var i0 = Math.max(0, d.i0 - m), i1 = Math.min(NX - 1, d.i1 + m), j0 = Math.max(0, d.j0 - m), j1 = Math.min(NY - 1, d.j1 + m);
      /* B: the field blurred twice (about 9x9 binomial; once on low, where a cell is already coarse) -- its half-height
         line is straight along any staircase of cut nodes, and its gradient gives the wall direction */
      var e = function (a, m2) { return [Math.max(0, i0 - m2), Math.min(NX - 1, i1 + m2), Math.max(0, j0 - m2), Math.min(NY - 1, j1 + m2)]; }, r1 = e(0, 6), r2 = e(0, 3);
      if (f === 1) blur5(H, B, r2[0], r2[1], r2[2], r2[3]);
      else { blur5(H, B1, r1[0], r1[1], r1[2], r1[3]); blur5(B1, B, r2[0], r2[1], r2[2], r2[3]); }
      boxBlur(i0, i1, j0, j1, Rb);
      var z1 = st.z1, cell = Math.min(DX, DY), aoR = Rb * cell, i, j, k;
      for (j = j0; j <= j1; j++) {
        var jm = j > 0 ? j - 1 : j, jp = j < NY - 1 ? j + 1 : j;
        for (i = i0; i <= i1; i++) {
          k = j * NX + i;
          var h = H[k], im = i > 0 ? i - 1 : i, ip = i < NX - 1 ? i + 1 : i;
          /* 3x3 range */
          var lo = h, hi = h, a, b, c, ncut = 0;
          for (b = jm; b <= jp; b++) for (a = im; a <= ip; a++) { c = H[b * NX + a]; if (c < lo) lo = c; else if (c > hi) hi = c; if (c < z1 - 1e-4) ncut++; }
          /* the largest jump to a 4-neighbour: a step (wall, snapped) or only a slope (left alone: a slope's iso line
             moves with the grid phase and would bead); shallow cut / uncut borders are snapped too (no colour staircase) */
          var jmp = Math.max(Math.abs(H[j * NX + ip] - h), Math.abs(H[j * NX + im] - h), Math.abs(H[jp * NX + i] - h), Math.abs(H[jm * NX + i] - h));
          var ox = 0, oy = 0, wx = 0, wy = 0;
          if (jmp > 3 * cell || (ncut > 0 && ncut < (jp - jm + 1) * (ip - im + 1) && hi - lo > 1e-3 && hi - lo < 1.2 * cell)) {
            var gx = (B[j * NX + ip] - B[j * NX + im]) / (ip - im), gy = (B[jp * NX + i] - B[jm * NX + i]) / (jp - jm), gl = Math.hypot(gx, gy);
            if (gl > 1e-7) {
              var nx = gx / gl, ny = gy / gl, mid = (hi + lo) / 2, best = 9, prev = bs(i + TS[0] * nx, j + TS[0] * ny) - mid;
              for (var t = 1; t < TS.length; t++) {
                var cur = bs(i + TS[t] * nx, j + TS[t] * ny) - mid;
                if ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0)) {
                  var tt = cur === prev ? (TS[t] + TS[t - 1]) / 2 : TS[t - 1] + (TS[t] - TS[t - 1]) * (prev / (prev - cur));
                  if (Math.abs(tt) < Math.abs(best)) best = tt;
                }
                prev = cur;
              }
              var ek = E ? E[k] : 1e9;
              if (jmp > 3 * cell && Math.abs(ek) < 1.6 * cell) {
                /* the exact edge: E along the direction E grows (from E's own gradient where its neighbours know it) */
                var ea = E[j * NX + im], eb = E[j * NX + ip], ec = E[jm * NX + i], ed = E[jp * NX + i], ux = nx, uy = ny;
                if (Math.abs(ea) < 4 * cell && Math.abs(eb) < 4 * cell && Math.abs(ec) < 4 * cell && Math.abs(ed) < 4 * cell) {
                  var ex = (eb - ea) / ((ip - im) * DX), ey = (ed - ec) / ((jp - jm) * DY), el = Math.hypot(ex, ey);
                  if (el > .3) { ux = ex / el; uy = ey / el; }
                }
                /* E > 0: the node is outside the deeper visits, it moves toward them (against E's gradient) */
                var mx = -ek * ux / DX, my = -ek * uy / DY, ml = Math.hypot(mx, my);
                if (ml > .72) { mx *= .72 / ml; my *= .72 / ml; }
                ox = mx; oy = my; nx = ux; ny = uy;
              } else if (best !== 9) { if (best > .72) best = .72; else if (best < -.72) best = -.72; ox = best * nx; oy = best * ny; }
              if (jmp > 3 * cell) { wx = -nx; wy = -ny; }
            }
          } else if (ncut > 0 && h >= z1 - 1e-4) {
            /* the rim of a sloped cut (ball nose, chamfer): an uncut node goes to where the cut surface, continued
               upward, meets the top -- the crease, not the grid */
            var rx = (B[j * NX + ip] - B[j * NX + im]) / (ip - im), ry = (B[jp * NX + i] - B[jm * NX + i]) / (jp - jm), rl = Math.hypot(rx, ry);
            if (rl > 1e-7) {
              rx = -rx / rl; ry = -ry / rl;                    // toward the cut
              var d1 = z1 - hs(i + rx, j + ry), d2 = z1 - hs(i + 2 * rx, j + 2 * ry), sl = d2 - d1;
              if (d1 > 1e-4 && sl > 1e-4) { var tr = 1 - d1 / sl; if (tr > 0) { if (tr > .85) tr = .85; ox = tr * rx; oy = tr * ry; } }
            }
          }
          if (i === 0 || i === NX - 1) ox = 0;                // the outline stays on the blank's sides (the skirt meets it)
          if (j === 0 || j === NY - 1) oy = 0;
          pos[k * 3] = st.x0 + (i + ox) * DX - (i === 0 || i === NX - 1 ? 0 : OX); pos[k * 3 + 1] = st.y0 + (j + oy) * DY - (j === 0 || j === NY - 1 ? 0 : OY); pos[k * 3 + 2] = h;
          /* surface normal of the floor / top the node belongs to: across a step the one-sided difference on its own level */
          var hx = slope(H[j * NX + im], h, H[j * NX + ip], ip - im, DX), hy = slope(H[jm * NX + i], h, H[jp * NX + i], jp - jm, DY), nl = 1 / Math.sqrt(hx * hx + hy * hy + 1);
          if (h >= z1 - 1e-4) { hx = hy = 0; nl = 1; }      // the raw top is a plane
          nrm[k * 3] = -hx * nl; nrm[k * 3 + 1] = -hy * nl; nrm[k * 3 + 2] = nl;
          /* cavity: below the neighbourhood mean = darker; above it (an edge) = a touch brighter */
          var dv = (Bb[k] - h) / aoR, ao = dv > 0 ? 1 - .62 * Math.pow(Math.min(1, dv), .7) : 1 + .3 * Math.min(1, -dv * 1.5);
          svA[k * 4] = ao; svA[k * 4 + 1] = h < z1 - 1e-4 ? 1 : 0; svA[k * 4 + 2] = wx; svA[k * 4 + 3] = wy;
        }
      }
      /* the tiles the region touches get their triangles again */
      var q0 = Math.max(0, j0 - 1), q1 = Math.min(NY - 2, j1), p0 = Math.max(0, i0 - 1), p1 = Math.min(NX - 2, i1), M = Rb + 3;
      for (var tj = Math.floor(q0 / TQ); tj <= Math.floor(q1 / TQ); tj++) for (var ti = Math.floor(p0 / TQ); ti <= Math.floor(p1 / TQ); ti++) tileIndex(tiles[tj * TX + ti], M);
      var at = tiles[0].m.geometry.attributes;
      [['position', 3], ['normal', 3], ['sv', 4]].forEach(function (e) {
        var A2 = at[e[0]]; if (A2.clearUpdateRanges) { A2.clearUpdateRanges(); A2.addUpdateRange(j0 * NX * e[1], (j1 - j0 + 1) * NX * e[1]); } A2.needsUpdate = true; });
      if (i0 === 0 || j0 === 0 || i1 === NX - 1 || j1 === NY - 1) buildSkirt();
      return true;
    }
    function flatAround(i0, i1, j0, j1, M) {      // nodes [i0..i1]x[j0..j1] and M around them all at one height?
      var a0 = Math.max(0, i0 - M), a1 = Math.min(NX - 1, i1 + M), b0 = Math.max(0, j0 - M), b1 = Math.min(NY - 1, j1 + M), h0 = H[j0 * NX + i0];
      for (var j = b0; j <= b1; j++) { var row = j * NX; for (var i = a0; i <= a1; i++) if (Math.abs(H[row + i] - h0) > 1e-5) return false; }
      return true;
    }
    /* a tile's triangles: two for the whole tile, or per SB x SB block two, or every quad where something is.
       A flat area joins a detailed one at T-junctions in one plane (the margin M keeps snapping and the cavity off it). */
    var SB = 8;
    function tileIndex(t, M) {
      var I = t.m.geometry.index, idx = I.array, n = 0;
      function rect(qi0, qj0, qi1, qj1) {
        var A = qj0 * NX + qi0, Bq = qj0 * NX + qi1 + 1, C = (qj1 + 1) * NX + qi0, D = (qj1 + 1) * NX + qi1 + 1;
        idx[n] = A; idx[n + 1] = Bq; idx[n + 2] = D; idx[n + 3] = A; idx[n + 4] = D; idx[n + 5] = C; n += 6;
      }
      if (flatAround(t.qi0, t.qi1 + 1, t.qj0, t.qj1 + 1, M)) rect(t.qi0, t.qj0, t.qi1, t.qj1);
      else for (var bj = t.qj0; bj <= t.qj1; bj += SB) for (var bi = t.qi0; bi <= t.qi1; bi += SB) {
        var ci = Math.min(t.qi1, bi + SB - 1), cj = Math.min(t.qj1, bj + SB - 1);
        if (flatAround(bi, ci + 1, bj, cj + 1, M)) { rect(bi, bj, ci, cj); continue; }
        /* every quad; the diagonal that joins the closer heights */
        for (var j = bj; j <= cj; j++) for (var i = bi; i <= ci; i++) {
          var a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
          if (Math.abs(H[a] - H[d]) <= Math.abs(H[b] - H[c])) { idx[n] = a; idx[n + 1] = b; idx[n + 2] = d; idx[n + 3] = a; idx[n + 4] = d; idx[n + 5] = c; }
          else { idx[n] = a; idx[n + 1] = b; idx[n + 2] = c; idx[n + 3] = b; idx[n + 4] = d; idx[n + 5] = c; }
          n += 6;
        }
      }
      if (I.clearUpdateRanges) { I.clearUpdateRanges(); I.addUpdateRange(0, n); }
      I.needsUpdate = true; t.m.geometry.setDrawRange(0, n); t.n = n;
    }
    /* the blank's four sides, following the edge heights down to the bottom */
    function buildSkirt() {
      var q = [], nn = [], z0 = st.z0, at = function (i, j) { return H[j * NX + i]; };
      function quad(x1, y1, h1, x2, y2, h2, nx, ny) {
        q.push(x1, y1, h1, x2, y2, h2, x2, y2, z0, x1, y1, h1, x2, y2, z0, x1, y1, z0);
        for (var r = 0; r < 6; r++) nn.push(nx, ny, 0);
      }
      var i, j;
      for (i = 0; i < NX - 1; i++) {
        quad(st.x0 + i * DX, st.y0, at(i, 0), st.x0 + (i + 1) * DX, st.y0, at(i + 1, 0), 0, -1);
        quad(st.x0 + (i + 1) * DX, st.y1, at(i + 1, NY - 1), st.x0 + i * DX, st.y1, at(i, NY - 1), 0, 1);
      }
      for (j = 0; j < NY - 1; j++) {
        quad(st.x1, st.y0 + j * DY, at(NX - 1, j), st.x1, st.y0 + (j + 1) * DY, at(NX - 1, j + 1), 1, 0);
        quad(st.x0, st.y0 + (j + 1) * DY, at(0, j + 1), st.x0, st.y0 + j * DY, at(0, j), -1, 0);
      }
      var g = skirt.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(q), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nn), 3));
      g.computeBoundingSphere();
    }

    function setMaterial(p) {
      preset = p; applyPreset(THREE, topMat, p); applyPreset(THREE, sideMat, p);
      var c = new THREE.Color(p.color).multiplyScalar(.55); floor.material.color.copy(c);
    }
    function setQuality(q) {
      if (q === quality) return;
      var f0 = f; quality = q;
      var lowNow = q === 'low';
      if (factorFor(q, G) === f0 && !!topMat.defines.SV_LOW === lowNow) return;
      alloc(); buildSkirt();
      if (o.replay) try { o.replay(); } catch (e) {}
      paint();
    }
    function dispose() {
      if (CUR === api) CUR = null;
      try { top.children.forEach(function (m) { m.geometry.dispose(); }); skirt.geometry.dispose(); topMat.dispose(); sideMat.dispose(); floor.geometry.dispose(); floor.material.dispose(); vm.dispose(); } catch (e) {}
    }

    var api = { top: top, skirt: skirt, floor: floor, vice: vice, stamp: stamp, reset: reset, paint: paint, setMaterial: setMaterial,
      setQuality: setQuality, dispose: dispose, invalidate: function () { mark(0, NX - 1, 0, NY - 1); },
      get factor() { return f; }, get triangles() { var n = 0; tiles.forEach(function (t) { n += (t.n || 0) / 3; }); return n; }, get grid() { return gD; }, get field() { return H; } };
    top.userData.stockView = skirt.userData.stockView = floor.userData.stockView = api;
    if (window.TNC_MATERIALS && TNC_MATERIALS.current) setMaterial(TNC_MATERIALS.current);
    else setMaterial({ color: 0xa4aab1, metalness: .42, roughness: .55 });
    buildSkirt(); paint();
    if (CUR && CUR !== api) CUR.dispose();
    CUR = api;
    return api;
  }

  if (typeof window !== 'undefined' && window.TNC_SETTINGS && TNC_SETTINGS.on) {
    TNC_SETTINGS.on(function (changed) {
      if (CUR && changed && changed.indexOf('quality') >= 0) try { CUR.setQuality(TNC_SETTINGS.get('quality')); } catch (e) {}
    });
  }

  return { create: create, factorFor: factorFor, get current() { return CUR; } };
})();
if (typeof module !== 'undefined') module.exports = TNC_STOCKVIEW;
