/* ClimateHaiku - application wiring: controls, the fixed-step simulation loop,
 * readouts, timeline and the science panel.
 *
 * Refresh-rate independence: the physics advances in whole steps of a size
 * chosen only from the simulated rate (never from the frame rate). Each frame
 * adds rate * dt to an accumulator and runs as many whole steps as fit. The
 * same simulated time gives the same result on a 60 Hz or a 144 Hz display.
 */
(function () {
  'use strict';

  var CM = window.ClimateModel;
  var ST = window.ClimateStates;
  var WD = window.ClimateWorlds;
  var RN = window.ClimateRender;
  var K = CM.K;
  var RAD = CM.RAD;
  var LOG10 = Math.LN10;

  var REFS = ST.REFERENCES || [];
  var rendererBusy = false;

  var app = {
    presetId: 'earth',
    cfg: null,
    st: null,
    rate: 1e3,            // simulated years per real second
    paused: false,
    acc: 0,               // simulated years waiting to be stepped
    history: [],
    sampleEvery: 0.5,     // simulated years between history samples
    nextSample: 0,
    dirty: true,
    timelineAt: -1e9,
    timelineItems: null,
    timelineHandle: null,
    lastCatalogId: null,
    lastWall: null,
    renderer: null
  };

  // ---------- formatting ----------

  function fmtYears(t) {
    if (!isFinite(t)) return 'never (at this setting)';
    if (t < 10) return t.toFixed(2) + ' yr';
    if (t < 1e4) return t.toFixed(0) + ' yr';
    if (t < 1e6) return (t / 1e3).toFixed(1) + ' kyr';
    if (t < 1e9) return (t / 1e6).toFixed(t < 1e7 ? 2 : 1) + ' Myr';
    return (t / 1e9).toFixed(2) + ' Gyr';
  }

  function fmtRate(r) {
    if (r < 1) return r.toFixed(2) + ' yr/s';
    return fmtYears(r).replace(/ yr$/, ' yr') + '/s';
  }

  function fmtPressure(p) {
    if (p >= 1) return p.toFixed(p >= 100 ? 0 : 2) + ' bar';
    if (p >= 0.01) return p.toFixed(3) + ' bar';
    if (p >= 1e-5) return (p * 1000).toFixed(2) + ' mbar';
    return (p * 1e6).toExponential(1) + ' ppm';
  }

  function fmtPpm(p) {
    var ppm = p * 1e6;
    if (ppm >= 1e4) return (p).toFixed(p >= 10 ? 1 : 2) + ' bar';
    if (ppm >= 10) return ppm.toFixed(0) + ' ppm';
    return ppm.toFixed(1) + ' ppm';
  }

  function fmtSci(x) {
    if (x === 0) return '0';
    return x.toExponential(1).replace('e-', '×10⁻').replace('e+', '×10⁺');
  }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // ---------- simulation setup ----------

  function loadPreset(id) {
    var preset = WD.findPreset(id);
    app.presetId = preset.id;
    app.cfg = JSON.parse(JSON.stringify(preset.cfg));
    app.st = CM.prepare(app.cfg, preset.settle || {});
    app.acc = 0;
    app.history = [];
    app.nextSample = 0;
    app.sampleEvery = 0.5;
    app.timelineAt = -1e9;
    app.dirty = true;
    var sel = document.getElementById('preset-select');
    if (sel.value !== preset.id) sel.value = preset.id;
    document.getElementById('time-hint').textContent = preset.blurb || '';
    syncControls(true);
    invalidateSolar();
  }

  function recordSample() {
    var d = CM.diagnose(app.cfg, app.st);
    app.history.push({
      t: app.st.t,
      T: d.T,
      Wl: d.Wliquid,
      P: d.Ptotal,
      co2: d.pCO2
    });
    if (app.history.length > 700) {
      app.history = app.history.filter(function (_, i) { return i % 2 === 0; });
      app.sampleEvery *= 2;
    }
    app.nextSample = app.st.t + app.sampleEvery;
  }

  function advance(nowMs) {
    if (app.lastWall === null) app.lastWall = nowMs;
    var dt = clamp((nowMs - app.lastWall) / 1000, 0, 0.1);
    app.lastWall = nowMs;
    if (app.paused || app.rate <= 0) return;
    var tick = CM.clockTick(app.acc, app.rate, dt, 6000);
    for (var i = 0; i < tick.n; i++) {
      CM.step(app.cfg, app.st, tick.h);
      if (app.st.t >= app.nextSample) recordSample();
    }
    app.acc = tick.acc;
    if (tick.n > 0) app.dirty = true;
  }

  // ---------- controls ----------

  // Controls read and write the world through get/set. Log controls work on
  // log10 values so the slider is even across decades.
  var GROUPS = [
    {
      title: 'Planet',
      items: [
        { id: 'mass', label: 'Planet mass', kind: 'log', min: -1, max: 0.699,
          get: function (a) { return a.cfg.massE; },
          set: function (a, v) { a.cfg.massE = v; },
          fmt: function (v) {
            var g = CM.planetGeometry(v);
            return v.toFixed(2) + ' M⊕ · g ' + g.g.toFixed(2) + ' m/s² · R ' + g.radiusE.toFixed(2) + ' R⊕';
          },
          note: 'Radius follows R ≈ M^0.27. For the same gas inventory, gravity sets the surface pressure.' },
        { id: 'water', label: 'Water inventory', kind: 'log', min: -4, max: 1,
          get: function (a) { return a.st.Wtot; },
          set: function (a, v) { a.st.Wtot = v; },
          fmt: function (v) { return v.toPrecision(3) + ' TO (' + (v * 100).toFixed(v < 0.01 ? 2 : 0) + '% of Earth\'s ocean)'; },
          note: '1 TO is one Earth ocean (1.4×10²¹ kg). Hydrogen escape removes it slowly while the planet is hot.' },
        { id: 'rot', label: 'Rotation period', kind: 'log', min: 0.778, max: 3.301,
          get: function (a) { return a.cfg.rotationHours; },
          set: function (a, v) { a.cfg.rotationHours = v; },
          fmt: function (v) { return v >= 48 ? (v / 24).toFixed(1) + ' days' : v.toFixed(1) + ' h'; },
          disabled: function (a) { return a.cfg.tidallyLocked; },
          note: 'Slow rotators build cloud decks on the sunlit side (Yang et al. 2014).' },
        { id: 'lock', label: 'Tidally locked to the star', kind: 'toggle',
          get: function (a) { return a.cfg.tidallyLocked; },
          set: function (a, v) { a.cfg.tidallyLocked = v; } }
      ]
    },
    {
      title: 'Star and orbit',
      items: [
        { id: 'star', label: 'Star type', kind: 'select',
          options: [['G', 'Sun-like G star'], ['F', 'Bright F star'], ['K', 'Orange K dwarf'], ['M', 'Red M dwarf']],
          get: function (a) { return a.cfg.starType; },
          set: function (a, v) {
            var t = CM.STAR_TYPES[v];
            a.cfg.starType = v;
            a.cfg.starLuminosity = t.luminosity;
            a.cfg.evolveStar = (v === 'G') ? a.cfg.evolveStar : false;
          } },
        { id: 'dist', label: 'Orbital distance', kind: 'log', min: -1, max: 0.699,
          get: function (a) { return a.cfg.distanceAU; },
          set: function (a, v) { a.cfg.distanceAU = v; },
          fmt: function (v) {
            var S = CM.insolationS(app.cfg, app.st.tStar) * (1 - (app.cfg.shade || 0));
            return v.toFixed(3) + ' AU · flux ' + S.toFixed(3) + ' S⊕';
          },
          note: 'Flux is luminosity divided by distance squared, relative to Earth today.' },
        { id: 'evolve', label: 'Sun-like brightening (Gough 1981)', kind: 'toggle',
          get: function (a) { return a.cfg.evolveStar; },
          set: function (a, v) { a.cfg.evolveStar = v; },
          note: 'A Sun-like star brightens about 10% per billion years.' },
        { id: 'shade', label: 'Orbital sunshade', kind: 'lin', min: 0, max: 0.9,
          get: function (a) { return a.cfg.shade || 0; },
          set: function (a, v) { a.cfg.shade = v; },
          fmt: function (v) { return (v * 100).toFixed(0) + '% of sunlight blocked'; } }
      ]
    },
    {
      title: 'Atmosphere',
      items: [
        { id: 'co2', label: 'CO₂ partial pressure', kind: 'log', min: -6, max: 2.3,
          get: function (a) { return CM.diagnose(a.cfg, a.st).pCO2; },
          set: function (a, v) { CM.setCO2Partial(a.cfg, a.st, v); },
          fmt: function (v) { return fmtPpm(v); },
          note: 'Ocean and rock take up CO₂, so the air value responds to temperature and water.' },
        { id: 'ch4', label: 'Methane', kind: 'log', min: -3, max: 4.7,
          get: function (a) { return a.cfg.ch4ppm; },
          set: function (a, v) { a.cfg.ch4ppm = v; },
          fmt: function (v) { return v >= 1e4 ? (v / 1e4).toFixed(1) + '%' : v.toFixed(v < 10 ? 2 : 0) + ' ppm'; } },
        { id: 'n2', label: 'Nitrogen inventory', kind: 'log', min: -3, max: 2,
          get: function (a) { return a.cfg.n2Inv; },
          set: function (a, v) { a.cfg.n2Inv = v; },
          fmt: function (v) { return fmtPressure(v * CM.planetGeometry(app.cfg.massE).gr) + ' surface pressure'; },
          note: 'Inventory is in Earth-bars: the pressure it would give on Earth. Gravity changes the real pressure.' },
        { id: 'o2', label: 'Oxygen inventory', kind: 'log', min: -6, max: 3,
          get: function (a) { return a.st.IO2; },
          set: function (a, v) { a.st.IO2 = v; },
          fmt: function (v) { return fmtPressure(v * CM.planetGeometry(app.cfg.massE).gr); },
          note: 'Oxygen left behind by escaping hydrogen accumulates here, since no biology or rock sink is modelled.' },
        { id: 'aer', label: 'Sulphate aerosol (sustained)', kind: 'lin', min: 0, max: 0.15,
          get: function (a) { return a.cfg.aerosol || 0; },
          set: function (a, v) { a.cfg.aerosol = v; },
          fmt: function (v) { return '+' + v.toFixed(3) + ' albedo'; },
          note: 'Stratospheric sulphate cools the planet only while it is being injected.' }
      ]
    },
    {
      title: 'Carbon cycle',
      items: [
        { id: 'volc', label: 'Volcanic CO₂ outgassing', kind: 'log', min: -2, max: 1.3,
          get: function (a) { return a.cfg.volcanism; },
          set: function (a, v) { a.cfg.volcanism = v; },
          fmt: function (v) { return '×' + v.toFixed(2) + ' Earth'; } },
        { id: 'weath', label: 'Silicate weathering', kind: 'log', min: -2, max: 1.3,
          get: function (a) { return a.cfg.weathering; },
          set: function (a, v) { a.cfg.weathering = v; },
          fmt: function (v) { return '×' + v.toFixed(2) + ' Earth'; },
          note: 'Weathering removes CO₂ faster when it is warm and wet. It stops in a steam atmosphere.' }
      ]
    }
  ];

  var ACTIONS = [
    { id: 'comet', label: 'Comet delivery: +0.1 TO water', run: function (a) { a.st.Wtot += 0.1; } },
    { id: 'drain', label: 'Drain half the ocean', run: function (a) { a.st.Wtot *= 0.5; } },
    { id: 'degas', label: 'Volcanic burst: +0.5 bar CO₂', run: function (a) {
        var p = CM.diagnose(a.cfg, a.st).pCO2;
        CM.setCO2Partial(a.cfg, a.st, p + 0.5);
      } },
    { id: 'scrub', label: 'Scrub CO₂ back to 280 ppm (pre-industrial)', run: function (a) { CM.setCO2Partial(a.cfg, a.st, 2.8e-4); } },
    { id: 'sulfate', label: 'Toggle sulphate injection (+0.03 albedo)', toggle: true,
      isOn: function (a) { return (a.cfg.aerosol || 0) > 0; },
      run: function (a) { a.cfg.aerosol = (a.cfg.aerosol || 0) > 0 ? 0 : 0.03; } },
    { id: 'shade', label: 'Toggle 10% orbital sunshade', toggle: true,
      isOn: function (a) { return (a.cfg.shade || 0) > 0; },
      run: function (a) { a.cfg.shade = (a.cfg.shade || 0) > 0 ? 0 : 0.1; } }
  ];

  var RATE_BUTTONS = [
    { rate: 1, label: '1 yr/s' },
    { rate: 1e3, label: '1 kyr/s' },
    { rate: 1e6, label: '1 Myr/s' },
    { rate: 1e8, label: '100 Myr/s' },
    { rate: 1e9, label: '1 Gyr/s' }
  ];

  var controlEls = {};

  function buildControls() {
    var root = document.getElementById('controls');
    GROUPS.forEach(function (g) {
      var det = document.createElement('details');
      det.open = g.title !== 'Carbon cycle';
      var sum = document.createElement('summary');
      sum.textContent = g.title;
      det.appendChild(sum);
      g.items.forEach(function (item) {
        var wrap = document.createElement('div');
        wrap.className = 'control';
        var head = document.createElement('div');
        head.className = 'control-head';
        var lab = document.createElement('label');
        lab.textContent = item.label;
        var out = document.createElement('output');
        head.appendChild(lab);
        head.appendChild(out);
        wrap.appendChild(head);
        var input;
        if (item.kind === 'toggle') {
          var row = document.createElement('label');
          row.className = 'toggle';
          input = document.createElement('input');
          input.type = 'checkbox';
          row.appendChild(input);
          row.appendChild(document.createTextNode(' ' + item.label));
          head.innerHTML = '';
          head.appendChild(row);
          head.appendChild(out);
          out.textContent = '';
        } else if (item.kind === 'select') {
          input = document.createElement('select');
          input.className = 'select field-select';
          item.options.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = o[0];
            opt.textContent = o[1];
            input.appendChild(opt);
          });
          wrap.appendChild(input);
        } else {
          input = document.createElement('input');
          input.type = 'range';
          input.min = item.min;
          input.max = item.max;
          input.step = item.kind === 'log' ? 0.001 : 0.001;
          wrap.appendChild(input);
        }
        if (item.note) {
          var note = document.createElement('div');
          note.className = 'note';
          note.textContent = item.note;
          wrap.appendChild(note);
        }
        input.addEventListener('input', function () { onControl(item, input); });
        input.addEventListener('change', function () { onControl(item, input); });
        controlEls[item.id] = { input: input, out: out, item: item, wrap: wrap };
        det.appendChild(wrap);
      });
      root.appendChild(det);
    });
  }

  function onControl(item, input) {
    var v;
    if (item.kind === 'toggle') v = input.checked;
    else if (item.kind === 'select') v = input.value;
    else if (item.kind === 'log') v = Math.pow(10, parseFloat(input.value));
    else v = parseFloat(input.value);
    if (item.kind !== 'toggle' && item.kind !== 'select') {
      if (!isFinite(v)) return;
    }
    item.set(app, v);
    app.dirty = true;
    app.timelineAt = -1e9;
    invalidateSolar();
    refreshControlOutputs();
  }

  function syncControls(force) {
    GROUPS.forEach(function (g) {
      g.items.forEach(function (item) {
        var c = controlEls[item.id];
        if (!c) return;
        if (document.activeElement === c.input && !force) return;
        var v = item.get(app);
        if (item.kind === 'toggle') {
          c.input.checked = !!v;
        } else if (item.kind === 'select') {
          c.input.value = v;
        } else if (item.kind === 'log') {
          c.input.value = Math.log10(Math.max(v, 1e-12));
          fillSlider(c.input);
        } else {
          c.input.value = v;
          fillSlider(c.input);
        }
        if (item.disabled) c.input.disabled = item.disabled(app);
      });
    });
    refreshControlOutputs();
  }

  function fillSlider(input) {
    var min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
    var pct = (v - min) / (max - min) * 100;
    input.style.setProperty('--fill', clamp(pct, 0, 100).toFixed(2) + '%');
  }

  function refreshControlOutputs() {
    GROUPS.forEach(function (g) {
      g.items.forEach(function (item) {
        var c = controlEls[item.id];
        if (!c) return;
        if (item.kind === 'toggle') return;
        if (item.kind === 'select') {
          c.out.textContent = '';
          return;
        }
        var v = item.kind === 'log' ? Math.pow(10, parseFloat(c.input.value)) : parseFloat(c.input.value);
        if (item.fmt) c.out.textContent = item.fmt(v);
        if (item.kind !== 'select') fillSlider(c.input);
        if (item.disabled) c.input.disabled = item.disabled(app);
      });
    });
  }

  function buildActions() {
    var root = document.getElementById('actions');
    ACTIONS.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = a.label;
      b.dataset.id = a.id;
      b.addEventListener('click', function () {
        a.run(app);
        app.dirty = true;
        app.timelineAt = -1e9;
        invalidateSolar();
        syncControls(true);
      });
      root.appendChild(b);
      a.el = b;
    });
  }

  function buildRates() {
    var root = document.getElementById('rate-buttons');
    RATE_BUTTONS.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = r.label;
      b.dataset.rate = String(r.rate);
      b.addEventListener('click', function () { setRate(r.rate); });
      root.appendChild(b);
      r.el = b;
    });
    var slider = document.getElementById('rate-slider');
    slider.addEventListener('input', function () {
      setRate(Math.pow(10, parseFloat(slider.value)));
    });
  }

  function setRate(r) {
    app.rate = r;
    app.dirty = true;
    var slider = document.getElementById('rate-slider');
    slider.value = Math.log10(r).toFixed(3);
    fillSlider(slider);
    updateRateUi();
  }

  function setPaused(p) {
    app.paused = p;
    var btn = document.getElementById('btn-play');
    btn.textContent = p ? 'Play' : 'Pause';
    btn.setAttribute('aria-pressed', p ? 'true' : 'false');
    app.dirty = true;
  }

  function updateRateUi() {
    RATE_BUTTONS.forEach(function (r) {
      r.el.classList.toggle('active', Math.abs(Math.log10(r.rate) - Math.log10(app.rate)) < 0.01);
    });
    document.getElementById('rate-out').textContent = fmtRate(app.rate);
  }

  // ---------- readouts ----------

  function statDefs() {
    return [
      { k: 'Surface temperature', key: 'temp' },
      { k: 'Surface pressure', key: 'press' },
      { k: 'Liquid ocean', key: 'ocean' },
      { k: 'Absorbed sunlight', key: 'abs' },
      { k: 'Albedo', key: 'alb' },
      { k: 'CO₂ in air', key: 'co2' },
      { k: 'Star and orbit', key: 'star' },
      { k: 'Gravity', key: 'grav' },
      { k: 'Oxygen', key: 'o2' },
      { k: 'Hydrogen escape', key: 'esc' },
      { k: 'Rotation', key: 'rot' },
      { k: 'Elapsed time', key: 'time' }
    ];
  }

  var statEls = {};

  function buildStats() {
    var root = document.getElementById('stats');
    statDefs().forEach(function (s) {
      var div = document.createElement('div');
      div.className = 'stat';
      var k = document.createElement('div');
      k.className = 'k';
      k.textContent = s.k;
      var v = document.createElement('div');
      v.className = 'v';
      var d = document.createElement('div');
      d.className = 'd';
      div.appendChild(k); div.appendChild(v); div.appendChild(d);
      root.appendChild(div);
      statEls[s.key] = { v: v, d: d };
    });
  }

  function updateStats(d) {
    var cfg = app.cfg;
    var setS = function (key, v, detail) {
      statEls[key].v.textContent = v;
      statEls[key].d.textContent = detail || '';
    };
    setS('temp', d.T.toFixed(1) + ' K', (d.T - 273.15).toFixed(1) + ' °C');
    setS('press', fmtPressure(d.Ptotal), 'N₂ ' + fmtPressure(d.pN2) + ' · O₂ ' + fmtPressure(d.pO2));
    setS('ocean', d.Wliquid.toPrecision(3) + ' TO', (d.foc * 100).toFixed(0) + '% of surface · ice ' + (d.fIce * 100).toFixed(0) + '%');
    setS('abs', d.Fabs.toFixed(0) + ' W/m²', 'outgoing ' + d.OLR.toFixed(0) + ' · net ' + d.N.toFixed(1));
    setS('alb', d.alpha.toFixed(3), 'optical depth τ ' + d.tau.total.toFixed(2));
    setS('co2', fmtPpm(d.pCO2), 'sink ' + (d.co2Years === Infinity ? 'off' : fmtYears(d.co2Years) + ' response'));
    setS('star', 'L ' + d.luminosity.toFixed(3) + ' L☉', 'age ' + app.st.tStar.toFixed(3) + ' Gyr · ' + CM.STAR_TYPES[cfg.starType].name);
    setS('grav', d.g.toFixed(2) + ' m/s²', 'radius ' + d.radiusE.toFixed(2) + ' R⊕');
    setS('o2', fmtPressure(d.O2), d.O2 > 1 ? 'abiotic build-up from water loss' : 'biological level');
    var escapeActive = d.escapeFlux > 1e10;
    setS('esc', escapeActive ? fmtSci(d.escapeFlux) + ' H/cm²/s' : 'negligible',
      escapeActive ? 'water lost ~' + fmtYears(d.loseWaterYears) + ' per TO' : 'cold trap intact');
    setS('rot', d.rotationHours >= 48 ? (d.rotationHours / 24).toFixed(1) + ' days' : d.rotationHours.toFixed(1) + ' h',
      cfg.tidallyLocked ? 'tidally locked' : (d.rotationAlbedo > 0.001 ? 'substellar clouds +' + d.rotationAlbedo.toFixed(3) : 'fast enough for even heating'));
    setS('time', fmtYears(app.st.t), 'since this preset started');
  }

  function updateBadge(cls) {
    document.getElementById('state-name').textContent = cls.name;
    document.getElementById('state-sub').textContent = cls.cond;
    var stage = document.querySelector('.stage-view');
    stage.style.setProperty('--state-color', cls.color);
    document.getElementById('state-dot').style.setProperty('--state-color', cls.color);
    document.querySelector('.state-badge').style.setProperty('--state-color', cls.color);
    document.getElementById('state-desc').textContent = cls.desc + ' ' + cls.why;
    var s = app.st;
    document.getElementById('clock-time').textContent = 't = ' + fmtYears(s.t);
    document.getElementById('clock-rate').textContent = app.paused ? 'paused' : 'running at ' + fmtRate(app.rate);
  }

  function buildCatalog() {
    var root = document.getElementById('catalog');
    ST.CATALOG.forEach(function (s) {
      var card = document.createElement('article');
      card.className = 'catalog-item';
      card.style.setProperty('--state-color', s.color);
      card.dataset.id = s.id;
      var h = document.createElement('h3');
      h.textContent = s.name;
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'state';
      h.appendChild(tag);
      var p = document.createElement('p');
      p.textContent = s.desc;
      var c = document.createElement('div');
      c.className = 'cond';
      c.textContent = s.cond;
      card.appendChild(h); card.appendChild(p); card.appendChild(c);
      root.appendChild(card);
    });
  }

  function markCatalog(id) {
    if (app.lastCatalogId === id) return;
    app.lastCatalogId = id;
    document.querySelectorAll('.catalog-item').forEach(function (el) {
      var on = el.dataset.id === id;
      el.classList.toggle('current', on);
      if (on) el.querySelector('.tag').textContent = 'now';
      else el.querySelector('.tag').textContent = 'state';
    });
  }

  function buildRefs() {
    var ol = document.getElementById('refs');
    REFS.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = r;
      ol.appendChild(li);
    });
  }

  // Timeline: estimated timescales for the current state. The runaway-time
  // search runs many simulations, so it is throttled.
  function timelineFor(d) {
    var items = [];
    var liquid = d.Wliquid > 0.02;
    var solar = app.timelineSolar;
    if (app.cfg.starType === 'G') {
      if (solar === undefined) {
        items.push({ title: 'Sun-like brightening to runaway (CO₂ fixed)', time: 'computing…', body: 'Searching for the luminosity at which this planet loses its stable climate, holding CO₂ and water constant.' });
      } else if (solar === 0) {
        items.push({ title: 'Sun-like brightening to runaway (CO₂ fixed)', time: 'already', body: 'This orbit is already past the runaway limit at the current composition.' });
      } else if (!isFinite(solar)) {
        items.push({ title: 'Sun-like brightening to runaway (CO₂ fixed)', time: 'not within 10 Gyr', body: 'The planet stays out of runaway for the rest of the search range.' });
      } else {
        items.push({ title: 'Sun-like brightening to runaway (CO₂ fixed)', time: '≈ ' + fmtYears(solar * 1e9), body: 'If the Sun keeps brightening (about 10% per Gyr) and CO₂ stays fixed, this orbit reaches runaway in this time. With the carbon cycle running, CO₂ falls first and the timing changes; try the Brightening Sun preset at 1 Gyr/s.', now: false });
      }
    }
    items.push({ title: 'Surface temperature response', time: '≈ ' + fmtYears(d.tauThermal), body: 'Ocean heat uptake sets how fast the surface reaches a new equilibrium. Deep oceans make this slower.' });
    if (d.co2Years !== Infinity) {
      items.push({ title: 'Carbon thermostat response', time: '≈ ' + fmtYears(d.co2Years), body: 'Volcanic outgassing against silicate weathering. Warming speeds weathering, which pulls CO₂ back down.' });
    } else {
      items.push({ title: 'Carbon thermostat', time: 'off', body: 'No rain-driven weathering: no liquid water, or it is too hot. CO₂ builds up from volcanoes alone.' });
    }
    if (d.escapeFlux > 1e10) {
      items.push({ title: 'Water lost by hydrogen escape', time: '≈ ' + fmtYears(d.loseWaterYears) + ' per TO', body: 'Once water reaches the stratosphere, escape is diffusion-limited at ~10¹³ H atoms cm⁻² s⁻¹. Lighter planets lose water faster.', now: true });
    }
    if (d.runaway && liquid) {
      items.push({ title: 'Ocean evaporation in a runaway', time: '≈ ' + fmtYears(d.evapYears), body: 'Absorbed sunlight minus the outgoing limit goes into evaporation. The runaway is quick compared with the water loss that follows.', now: true });
    }
    return items;
  }

  function updateTimeline(d, now) {
    var root = document.getElementById('timeline');
    if (now - app.timelineAt > 3000 || app.timelineAt < 0) {
      app.timelineAt = now;
      root.innerHTML = '';
      timelineFor(d).forEach(function (it) {
        var el = document.createElement('div');
        el.className = 'tl-item' + (it.now ? ' now' : '');
        var t = document.createElement('div');
        t.className = 'tl-title';
        t.textContent = it.title;
        var tm = document.createElement('div');
        tm.className = 'tl-time';
        tm.textContent = it.time;
        var b = document.createElement('div');
        b.className = 'tl-body';
        b.textContent = it.body;
        el.appendChild(t); el.appendChild(tm); el.appendChild(b);
        root.appendChild(el);
      });
    }
  }

  // Energy-balance curves for the chart: absorbed flux and outgoing longwave.
  function balanceSamples() {
    var ctx = CM.makeContext(app.cfg, app.st);
    var out = [];
    var n = 140;
    for (var i = 0; i <= n; i++) {
      var T = Math.exp(Math.log(150) + (Math.log(1500) - Math.log(150)) * i / n);
      var p = CM.partition(ctx, T);
      var f = CM.netFlux(ctx, T, p);
      out.push({ T: T, Fabs: f.Fabs, OLR: f.OLR, N: f.N });
    }
    return { samples: out, ctx: ctx };
  }

  // ---------- main loop ----------

  function frame(nowMs) {
    advance(nowMs);
    var d = CM.diagnose(app.cfg, app.st);
    app.lastDiag = d;
    var cls = ST.classify(d);
    var t = nowMs / 1000;

    if (app.dirty || app.frameCount % 15 === 0) {
      updateStats(d);
      updateBadge(cls);
      markCatalog(cls.id);
      refreshControlOutputs();
      updateRateUi();
      updateTimeline(d, nowMs);
      app.dirty = false;
    }
    if (nowMs - app.solarAt > 20000) invalidateSolar();
    app.frameCount++;

    app.renderer.drawScene(d, {
      timeSec: t,
      starColor: CM.STAR_TYPES[app.cfg.starType].color,
      tidallyLocked: app.cfg.tidallyLocked,
      rotationPeriodSec: 6 + 8 * clamp(Math.log10(d.rotationHours / 24) / 2, 0, 1)
    });
    if (app.frameCount % 2 === 0) {
      var bal = balanceSamples();
      var capNow = RAD.OLR_CAP_E * Math.pow(CM.planetGeometry(app.cfg.massE).gr, RAD.CAP_GAMMA);
      var markers = [{ T: d.T, value: d.OLR, color: cls.color, current: true }];
      var ymax = 0;
      bal.samples.forEach(function (s) { ymax = Math.max(ymax, s.Fabs, Math.min(s.OLR, 1e4)); });
      app.renderer.drawBalance(document.getElementById('chart-balance'), bal.samples, markers,
        { cap: capNow, yMax: Math.min(700, Math.max(340, ymax * 1.08)) });
    }
    if (app.frameCount % 4 === 0) {
      var series = [
        { key: 'T', color: '#fbbf24', minSpan: 40, pad: 3 },
        { key: 'Wl', color: '#60a5fa', lo: 0, minSpan: 0.1, pad: 0.05 }
      ];
      app.renderer.drawHistory(document.getElementById('chart-history'), app.history.concat([{ t: app.st.t, T: d.T, Wl: d.Wliquid }]), series);
      var lg = document.getElementById('history-legend');
      var tmin = Math.min.apply(null, app.history.map(function (h) { return h.T; }).concat([d.T]));
      var tmax = Math.max.apply(null, app.history.map(function (h) { return h.T; }).concat([d.T]));
      lg.innerHTML = '';
      [['#fbbf24', 'Surface T ' + tmin.toFixed(0) + '–' + tmax.toFixed(0) + ' K'],
       ['#60a5fa', 'Liquid ocean ' + d.Wliquid.toPrecision(2) + ' TO now']].forEach(function (x) {
        var sp = document.createElement('span');
        sp.style.setProperty('--swatch', x[0]);
        sp.textContent = x[1];
        lg.appendChild(sp);
      });
    }
    requestAnimationFrame(frame);
  }

  // The runaway-time search runs many simulations. It is debounced after edits,
  // and refreshed every 20 s while the planet evolves.
  function invalidateSolar() {
    app.timelineSolar = undefined;
    app.solarAt = performance.now();
    clearTimeout(app.solarTimer);
    if (app.cfg.starType !== 'G') return;
    app.solarTimer = setTimeout(function () {
      // Always estimated for the Sun-like brightening law, even when it is switched off.
      var c = Object.assign({}, app.cfg, { evolveStar: true });
      app.timelineSolar = CM.timeToRunawayGyr(c, app.st);
      app.timelineAt = -1e9;
      app.dirty = true;
    }, 400);
  }

  // ---------- start ----------

  function init() {
    var sel = document.getElementById('preset-select');
    WD.PRESETS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { loadPreset(sel.value); });
    document.getElementById('btn-reset').addEventListener('click', function () { loadPreset(app.presetId); });
    document.getElementById('btn-play').addEventListener('click', function () { setPaused(!app.paused); });
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); setPaused(!app.paused); }
      var map = { Digit1: 1, Digit2: 1e3, Digit3: 1e6, Digit4: 1e8, Digit5: 1e9 };
      if (map[e.code]) setRate(map[e.code]);
    });

    buildControls();
    buildActions();
    buildRates();
    buildStats();
    buildCatalog();
    buildRefs();
    app.renderer = RN.createRenderer(document.getElementById('planet'));
    var resize = function () {
      app.renderer.resize();
      var bal = document.getElementById('chart-balance');
      var hist = document.getElementById('chart-history');
      [bal, hist].forEach(function (c) {
        var r = c.parentElement.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.max(160, Math.round(r.width * dpr));
        c.height = Math.max(120, Math.round(r.height * dpr));
      });
      app.dirty = true;
    };
    window.addEventListener('resize', resize);
    app.frameCount = 0;
    app.solarAt = 0;
    setRate(1e3);
    setPaused(false);
    loadPreset('earth');
    resize();
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
