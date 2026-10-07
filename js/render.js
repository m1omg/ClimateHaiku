/* ClimateHaiku - drawing: starfield, the planet, and the two charts.
 * Rendering only reads the simulation; it never advances it. Animation speed
 * is tied to wall-clock time, so it does not depend on the display refresh rate.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root.ClimateModel || (typeof require === 'function' ? require('./climate.js') : null));
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ClimateRender = api;
  }
}(typeof self !== 'undefined' ? self : this, function (CM) {
  'use strict';

  var NW = 256;   // longitude samples of the surface noise maps
  var NH = 128;   // latitude samples

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // Periodic (in longitude) value noise, two octaves, normalised to [0, 1].
  function noiseMap(seed) {
    var out = new Float32Array(NW * NH);
    var rnd = mulberry32(seed);
    var octaves = [{ cells: 5, w: 0.62 }, { cells: 13, w: 0.38 }];
    octaves.forEach(function (oct) {
      var c = oct.cells;
      var lat = new Float32Array(c * (c + 1));
      for (var i = 0; i < lat.length; i++) lat[i] = rnd();
      for (var y = 0; y < NH; y++) {
        var fy = (y + 0.5) / NH * c;
        var iy = Math.floor(fy), ty = smooth(fy - iy);
        for (var x = 0; x < NW; x++) {
          var fx = (x + 0.5) / NW * c;
          var ix = Math.floor(fx), tx = smooth(fx - ix);
          var x0 = ix % c, x1 = (ix + 1) % c;
          var a = lat[iy * c + x0], b = lat[iy * c + x1];
          var d = lat[(iy + 1) * c + x0], e = lat[(iy + 1) * c + x1];
          var top = a + (b - a) * tx, bot = d + (e - d) * tx;
          out[y * NW + x] += oct.w * (top + (bot - top) * ty);
        }
      }
    });
    return out;
  }

  // Colour helpers.
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  function atmosphereColor(d) {
    if (d.pCO2 > 5 && d.T > 400) return [255, 214, 140];          // sulphuric haze (Venus-like)
    if (d.T > 400 && d.pH2O > 1) return [214, 228, 255];          // steam
    if (d.Ptotal < 0.05) return [255, 176, 130];                  // thin dusty air (Mars-like)
    if (d.T > 1200) return [255, 120, 60];                        // glowing surface
    return [112, 170, 255];                                       // Earth-like blue
  }

  function ocean(d) {
    var warm = clamp01((d.T - 285) / 60);
    var hot = clamp01((d.T - 350) / 120);
    var base = mix([10, 52, 104], [22, 120, 150], warm);
    return mix(base, [120, 62, 52], hot);
  }

  function landThreshold(sorted, landFraction) {
    var n = sorted.length;
    var idx = Math.floor(clamp01(1 - landFraction) * (n - 1));
    return sorted[idx];
  }

  // The renderer keeps the noise maps and the planet's offscreen buffer.
  function createRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var land = noiseMap(20240601);
    var cloud = noiseMap(7771);
    var landSorted = Float32Array.from(land).sort();
    var stars = null;
    var starLayer = null;
    var buf = null, bufCtx = null, bufImg = null;
    var W = 0, H = 0, dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      W = Math.max(64, Math.round(rect.width * dpr));
      H = Math.max(64, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      makeStars();
    }

    function makeStars() {
      starLayer = document.createElement('canvas');
      starLayer.width = W;
      starLayer.height = H;
      var s = starLayer.getContext('2d');
      var grad = s.createRadialGradient(W * 0.3, H * 0.25, 0, W * 0.3, H * 0.25, Math.max(W, H) * 0.9);
      grad.addColorStop(0, '#0d1a33');
      grad.addColorStop(0.6, '#070d1d');
      grad.addColorStop(1, '#03060d');
      s.fillStyle = grad;
      s.fillRect(0, 0, W, H);
      var rnd = mulberry32(42);
      stars = [];
      for (var i = 0; i < 260; i++) {
        var x = rnd() * W, y = rnd() * H, r = (rnd() < 0.08 ? 1.3 : 0.6) * dpr;
        var a = 0.25 + rnd() * 0.6;
        s.fillStyle = 'rgba(220,232,255,' + a.toFixed(2) + ')';
        s.beginPath(); s.arc(x, y, r, 0, Math.PI * 2); s.fill();
        if (i < 40) stars.push({ x: x, y: y, r: r, p: rnd() * 6.28 });
      }
    }

    function planetBuffer(size) {
      if (!buf || buf.width !== size) {
        buf = document.createElement('canvas');
        buf.width = size;
        buf.height = size;
        bufCtx = buf.getContext('2d');
        bufImg = bufCtx.createImageData(size, size);
      }
    }

    // Per-frame colour palette: the per-pixel loop only does arithmetic.
    function planetPalette(d) {
      var hasWater = d.foc > 0 && d.Wliquid > 0.001;
      var land0, land1;
      if (!hasWater) {
        if (d.Ptotal < 0.3 && d.T < 300) { land0 = [150, 84, 54]; land1 = [196, 120, 80]; }   // Mars-like dust
        else { land0 = [84, 74, 66]; land1 = [46, 40, 36]; }                                  // basalt
      } else {
        var dry = clamp01(1 - d.rh / 0.67);
        land0 = mix([60, 116, 56], [196, 164, 110], dry);
        land1 = mix([126, 152, 72], [226, 196, 140], dry);
      }
      return { ocean: ocean(d), land0: land0, land1: land1 };
    }

    // Draws the planet disk into the buffer, then scales it onto the canvas.
    function drawPlanet(d, cx, cy, R, tSec, lightDir, rotAngle) {
      var size = Math.max(64, Math.min(360, Math.round(R * 2 * 0.9)));
      planetBuffer(size);
      var data = bufImg.data;
      var atm = atmosphereColor(d);
      var pal = planetPalette(d);
      var cloudCover = clamp01(0.15 + 0.6 * d.rh + (d.runaway ? 0.4 : 0) + 0.2 * clamp01((d.T - 300) / 40));
      var steamy = d.pCO2 > 5 && d.T > 400;
      if (steamy) cloudCover = 0.95;
      var cloudR = steamy ? 240 : 248, cloudG = steamy ? 214 : 250, cloudB = steamy ? 150 : 253;
      var thr = landThreshold(landSorted, d.foc > 0 ? 1 - d.foc : 1);
      var shift = Math.floor(tSec * 4) % NW;
      var cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
      var lx = lightDir[0], ly = lightDir[1], lz = lightDir[2];
      var lava = clamp01((d.T - 900) / 600);
      var hotGlow = clamp01((d.T - 450) / 350);
      var iceLim = (Math.PI / 2) * (1 - d.fIce);
      var oR = pal.ocean[0], oG = pal.ocean[1], oB = pal.ocean[2];
      var l0 = pal.land0, l1 = pal.land1;
      var dR = l1[0] - l0[0], dG = l1[1] - l0[1], dB = l1[2] - l0[2];
      var aR = atm[0], aG = atm[1], aB = atm[2];
      for (var py = 0; py < size; py++) {
        var ny = -((py + 0.5) / size * 2 - 1);
        var lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        var v = Math.min(NH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * NH)));
        var isIceRow = Math.abs(lat) > iceLim;
        for (var px = 0; px < size; px++) {
          var nx = (px + 0.5) / size * 2 - 1;
          var r2 = nx * nx + ny * ny;
          var o = (py * size + px) * 4;
          if (r2 > 1) { data[o + 3] = 0; continue; }
          var z = Math.sqrt(1 - r2);
          var x3 = nx * cosR + z * sinR;      // rotate about the polar axis
          var z3 = -nx * sinR + z * cosR;
          var lon = Math.atan2(x3, z3);
          var u = Math.floor(((lon / (2 * Math.PI)) + 0.5) * NW) % NW;
          var li = v * NW + u;
          var landVal = land[li];
          var r, g, b;
          if (isIceRow) {
            r = 236; g = 244; b = 252;
          } else if (landVal > thr || d.foc <= 0) {
            var t = clamp01(landVal);
            r = l0[0] + dR * t; g = l0[1] + dG * t; b = l0[2] + dB * t;
          } else {
            r = oR; g = oG; b = oB;
          }
          // Clouds drift with time.
          var cv = cloud[v * NW + ((u + shift) % NW)];
          var cf = clamp01((cv - (1 - cloudCover)) / 0.12);
          // Lambert shading with a soft terminator.
          var ndl = x3 * lx + ny * ly + z * lz;
          var shade = 0.05 + 0.95 * clamp01((ndl + 0.2) / 1.2);
          r *= shade; g *= shade; b *= shade;
          r += (cloudR * shade - r) * cf;
          g += (cloudG * shade - g) * cf;
          b += (cloudB * shade - b) * cf;
          // Emission from hot surfaces (lava, magma cracks).
          var glow = hotGlow * (1 - cf * 0.7);
          if (lava > 0) {
            var crack = clamp01((cloud[li] - 0.55) * 4);
            glow = Math.max(glow, lava * (0.35 + 0.65 * crack));
          }
          if (glow > 0) {
            r += (255 - r) * glow * 0.8;
            g += (150 * (1 - lava) + 110 * lava - g) * glow * 0.6;
            b += (60 * (1 - lava) + 40 * lava - b) * glow * 0.4;
          }
          // Limb: atmospheric scattering brightens the edge.
          var fres = Math.pow(1 - z, 3) * 0.7;
          r += (aR - r) * fres; g += (aG - g) * fres; b += (aB - b) * fres;
          data[o] = r; data[o + 1] = g; data[o + 2] = b;
          data[o + 3] = 255 * clamp01((1 - r2) * 40);
        }
      }
      bufCtx.putImageData(bufImg, 0, 0);
      ctx.drawImage(buf, cx - R * 0.9, cy - R * 0.9, R * 1.8, R * 1.8);
    }

    function drawGlow(d, cx, cy, R) {
      var atm = atmosphereColor(d);
      var thick = 0.035 + 0.05 * clamp01(Math.log10(d.Ptotal + 1) / 2);
      var g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * (1 + thick * 3));
      var col = 'rgba(' + atm[0] + ',' + atm[1] + ',' + atm[2] + ',';
      g.addColorStop(0, col + '0.45)');
      g.addColorStop(0.35, col + '0.16)');
      g.addColorStop(1, col + '0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + thick * 3), 0, Math.PI * 2); ctx.fill();
    }

    function drawStar(starColor, sx, sy, radius, tSec) {
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 4);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.15, starColor + 'ff');
      g.addColorStop(0.45, starColor + '66');
      g.addColorStop(1, starColor + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, radius * 4, 0, Math.PI * 2); ctx.fill();
    }

    // Main planet view.
    function drawScene(d, opts) {
      if (W === 0) resize();
      ctx.drawImage(starLayer, 0, 0);
      var t = opts.timeSec;
      stars.forEach(function (s) {
        var a = 0.5 + 0.5 * Math.sin(t * 1.3 + s.p);
        ctx.fillStyle = 'rgba(230,240,255,' + (0.15 + 0.35 * a).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.8 + 0.4 * a), 0, Math.PI * 2); ctx.fill();
      });
      var cx = W * 0.56, cy = H * 0.52;
      var R = Math.min(W * 0.28, H * 0.36);
      // Star sits to the upper left, so the terminator is on the right.
      var sx = W * 0.06, sy = H * 0.12;
      var lightDir = [0.72, -0.42, 0.55];
      var ln = Math.sqrt(lightDir[0] * lightDir[0] + lightDir[1] * lightDir[1] + lightDir[2] * lightDir[2]);
      lightDir = [lightDir[0] / ln, lightDir[1] / ln, lightDir[2] / ln];
      drawStar(opts.starColor, sx, sy, Math.max(W, H) * 0.02, t);
      drawGlow(d, cx, cy, R);
      var rot = opts.tidallyLocked ? 0 : (t * 2 * Math.PI / opts.rotationPeriodSec);
      drawPlanet(d, cx, cy, R, t, lightDir, rot);
      // Overlay: a faint ring at the snow line for ice-covered worlds.
      if (d.fIce > 0.05) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + 0.1 * d.fIce).toFixed(2) + ')';
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Energy balance: absorbed and outgoing flux against surface temperature.
    function drawBalance(c, samples, markers, cfgInfo) {
      var g = c.getContext('2d');
      var w = c.width, h = c.height, m = { l: 46 * dpr, r: 12 * dpr, t: 12 * dpr, b: 30 * dpr };
      g.clearRect(0, 0, w, h);
      var x0 = m.l, x1 = w - m.r, y0 = m.t, y1 = h - m.b;
      var Tmin = 150, Tmax = 1500;
      var ymin = 0, ymax = Math.max(340, cfgInfo.yMax || 340);
      function X(T) { return x0 + (Math.log(T) - Math.log(Tmin)) / (Math.log(Tmax) - Math.log(Tmin)) * (x1 - x0); }
      function Y(v) { return y1 - (v - ymin) / (ymax - ymin) * (y1 - y0); }
      g.strokeStyle = 'rgba(148,163,184,0.18)';
      g.fillStyle = 'rgba(154,171,196,0.9)';
      g.font = (11 * dpr) + 'px system-ui, sans-serif';
      [200, 300, 400, 600, 900, 1200].forEach(function (T) {
        g.beginPath(); g.moveTo(X(T), y0); g.lineTo(X(T), y1); g.stroke();
        g.fillText(T + ' K', X(T) - 12 * dpr, h - 10 * dpr);
      });
      [0, 100, 200, 300].forEach(function (v) {
        if (v > ymax) return;
        g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke();
        g.fillText(v + ' W', 6 * dpr, Y(v) + 4 * dpr);
      });
      // Runaway limit line.
      if (cfgInfo.cap) {
        g.strokeStyle = 'rgba(248,113,113,0.7)';
        g.setLineDash([5 * dpr, 4 * dpr]);
        g.beginPath(); g.moveTo(x0, Y(cfgInfo.cap)); g.lineTo(x1, Y(cfgInfo.cap)); g.stroke();
        g.setLineDash([]);
      }
      function plot(key, color, width, dash) {
        g.strokeStyle = color; g.lineWidth = width * dpr;
        g.setLineDash(dash ? [6 * dpr, 4 * dpr] : []);
        g.beginPath();
        var started = false;
        for (var i = 0; i < samples.length; i++) {
          var s = samples[i];
          var v = s[key];
          if (!isFinite(v)) { started = false; continue; }
          var px = X(s.T), py = Y(Math.max(ymin, Math.min(ymax, v)));
          if (!started) { g.moveTo(px, py); started = true; } else { g.lineTo(px, py); }
        }
        g.stroke();
        g.setLineDash([]);
      }
      plot('Fabs', '#fbbf24', 2, true);
      plot('OLR', '#60a5fa', 2, false);
      markers.forEach(function (mk) {
        g.fillStyle = mk.color;
        g.beginPath(); g.arc(X(mk.T), Y(mk.value), (mk.current ? 5 : 3.5) * dpr, 0, Math.PI * 2); g.fill();
        if (mk.current) {
          g.strokeStyle = '#ffffff'; g.lineWidth = 1.5 * dpr;
          g.beginPath(); g.arc(X(mk.T), Y(mk.value), 8 * dpr, 0, Math.PI * 2); g.stroke();
        }
      });
    }

    // Time series: an array of {t, values} and a list of series definitions.
    function drawHistory(c, points, series) {
      var g = c.getContext('2d');
      var w = c.width, h = c.height, m = { l: 46 * dpr, r: 12 * dpr, t: 10 * dpr, b: 26 * dpr };
      g.clearRect(0, 0, w, h);
      if (points.length < 2) return;
      var x0 = m.l, x1 = w - m.r, y0 = m.t, y1 = h - m.b;
      var tEnd = points[points.length - 1].t, tStart = points[0].t;
      var logTime = tEnd / Math.max(tStart, 1) > 200 && tStart >= 0;
      function XT(t) {
        if (logTime) return x0 + (Math.log10(1 + t) / Math.log10(1 + tEnd)) * (x1 - x0);
        return x0 + ((t - tStart) / Math.max(1e-9, tEnd - tStart)) * (x1 - x0);
      }
      series.forEach(function (sr) {
        var vals = points.map(function (p) { return p[sr.key]; }).filter(isFinite);
        var lo = sr.lo !== undefined ? sr.lo : Math.min.apply(null, vals) - (sr.pad || 0);
        var hi = Math.max.apply(null, vals) + (sr.pad || 0);
        var span = sr.minSpan || 1e-9;
        if (hi - lo < span) {
          var mid = 0.5 * (hi + lo);
          lo = mid - span / 2;
          hi = mid + span / 2;
        }
        function Y(v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); }
        g.strokeStyle = sr.color; g.lineWidth = 2 * dpr;
        g.beginPath();
        points.forEach(function (p, i) {
          var v = p[sr.key];
          if (!isFinite(v)) return;
          var px = XT(p.t), py = Y(v);
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        });
        g.stroke();
      });
      g.strokeStyle = 'rgba(148,163,184,0.25)'; g.lineWidth = dpr;
      g.beginPath(); g.moveTo(x0, y1); g.lineTo(x1, y1); g.stroke();
      g.fillStyle = 'rgba(154,171,196,0.9)';
      g.font = (11 * dpr) + 'px system-ui, sans-serif';
      g.fillText(logTime ? 'log time' : 'time', x1 - 60 * dpr, h - 8 * dpr);
    }

    return {
      resize: resize,
      drawScene: drawScene,
      drawBalance: drawBalance,
      drawHistory: drawHistory,
      dpr: function () { return dpr; }
    };
  }

  return {
    createRenderer: createRenderer,
    atmosphereColor: atmosphereColor,
    noiseMap: noiseMap
  };
}));
