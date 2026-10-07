// Run with: node --test tests/
// These tests check the physics anchors, the state transitions and the
// timing rules. They run in a few seconds.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CM = require(path.join(__dirname, '..', 'js', 'climate.js'));
const ST = require(path.join(__dirname, '..', 'js', 'states.js'));
const WD = require(path.join(__dirname, '..', 'js', 'presets.js'));

function presetCfg(id) {
  return JSON.parse(JSON.stringify(WD.findPreset(id).cfg));
}

function settled(cfg, T, years) {
  const st = CM.createState(cfg);
  if (T !== undefined) st.T = T;
  CM.settle(cfg, st, years || 2e5, 60);
  return { cfg, st, d: CM.diagnose(cfg, st) };
}

test('vapour pressure follows the steam tables', () => {
  assert.ok(Math.abs(CM.psatBar(373.15) - 1.0133) / 1.0133 < 0.005, 'boiling point at 1 atm');
  assert.ok(Math.abs(CM.psatBar(288.15) - 0.01705) / 0.01705 < 0.02, 'saturation at 15 C');
  assert.ok(CM.psatBar(700) > CM.psatBar(650) && isFinite(CM.psatBar(700)), 'continued smoothly above the critical point');
  assert.ok(Math.abs(CM.psatBar(647.0) - CM.psatBar(647.2)) < 1.0, 'no jump at the critical point');
});

test('Earth preset settles at a habitable equilibrium near 288 K', () => {
  const { d } = settled(presetCfg('earth'), 288);
  assert.ok(d.T > 285 && d.T < 291, `T = ${d.T}`);
  assert.ok(Math.abs(d.N) < 0.5, `net flux ${d.N}`);
  assert.equal(ST.classify(d).id, 'habitable');
});

test('Mars-like preset is cold, thin and dry', () => {
  const { d } = settled(presetCfg('mars'), 215);
  assert.ok(d.T > 200 && d.T < 225, `T = ${d.T}`);
  assert.ok(d.Ptotal < 0.01, `P = ${d.Ptotal}`);
  assert.equal(ST.classify(d).id, 'mars');
});

test('Venus-like preset is dense CO2 under sulphuric haze near 740 K', () => {
  const { d } = settled(presetCfg('venus'), 700);
  assert.ok(d.T > 700 && d.T < 780, `T = ${d.T}`);
  assert.ok(d.Ptotal > 80, `P = ${d.Ptotal}`);
  assert.equal(d.Wliquid, 0);
  assert.equal(ST.classify(d).id, 'venus');
});

test('snowball and warm states coexist near the present Sun (hysteresis)', () => {
  const cfg = presetCfg('earth');
  cfg.distanceAU = 1.0;
  const cold = settled(cfg, 225);
  const warm = settled(cfg, 288);
  assert.ok(cold.d.T < 240, `cold start stays frozen, T = ${cold.d.T}`);
  assert.ok(cold.d.fIce > 0.9, `ice cover ${cold.d.fIce}`);
  assert.equal(ST.classify(cold.d).id, 'snowball');
  assert.ok(warm.d.T > 280, `warm start stays warm, T = ${warm.d.T}`);
});

test('a 4% dimmer orbit falls past the snowball fold', () => {
  const cfg = presetCfg('earth');
  cfg.distanceAU = 1.04;             // flux about 0.92 of today
  const { d } = settled(cfg, 288);
  assert.ok(d.T < 250, `T = ${d.T}`);
});

test('a runaway boils the ocean in thousands of years, not instantly', () => {
  const cfg = presetCfg('earth');
  const st = CM.createState(cfg);
  CM.settle(cfg, st, 2e5, 60);          // equilibrium at Earth's orbit
  cfg.distanceAU = 0.9;                 // then flux about 1.23 of today
  assert.ok(CM.diagnose(cfg, st).runaway, 'the planet is in runaway');
  let sawWet = false;
  while (st.t < 1e5) {
    CM.step(cfg, st, 20);
    const d = CM.diagnose(cfg, st);
    if (d.Wliquid > 0.01 && ST.classify(d).id === 'wet_runaway') sawWet = true;
    if (d.Wliquid < 1e-3) break;
  }
  assert.ok(sawWet, 'the wet runaway state appears on the way');
  assert.ok(st.t > 500 && st.t < 3e4, `ocean gone after ${st.t} yr`);
});

test('hydrogen escape in a moist greenhouse takes 10^7 to 10^8 years per ocean', () => {
  const cfg = presetCfg('moist');
  const st = CM.createState(cfg);
  CM.settle(cfg, st, 2e5, 60);
  const d = CM.diagnose(cfg, st);
  assert.ok(d.T >= 300 && d.T < 320 && !d.runaway, `T = ${d.T}, runaway = ${d.runaway}`);
  assert.ok(d.escapeFlux > 1e12, `escape ${d.escapeFlux}`);
  assert.ok(d.loseWaterYears > 1e7 && d.loseWaterYears < 3e8, `${d.loseWaterYears} yr per TO`);
  assert.equal(ST.classify(d).id, 'moist');
});

test('the carbon thermostat holds Earth near its present CO2 level', () => {
  const cfg = presetCfg('earth');
  const st = CM.createState(cfg);
  CM.settle(cfg, st, 2e5, 60);
  for (let i = 0; i < 1000; i++) CM.step(cfg, st, 1000);
  const d = CM.diagnose(cfg, st);
  assert.ok(d.pCO2 > 2e-4 && d.pCO2 < 8e-4, `pCO2 = ${d.pCO2}`);
  assert.ok(d.T > 280 && d.T < 300, `T = ${d.T}`);
});

test('Earth-like brightening reaches runaway in about 1 Gyr', () => {
  const cfg = presetCfg('brightening');
  const st = CM.createState(cfg);
  CM.settle(cfg, st, 2e5, 60);
  const gyr = CM.timeToRunawayGyr(cfg, st);
  assert.ok(gyr > 0.8 && gyr < 1.6, `${gyr} Gyr`);
});

test('the fixed-step clock gives the same simulated time however frames divide wall time', () => {
  const rate = 1e6;
  const frames = (n) => Array.from({ length: n }, () => 1 / n);   // n frames of one second in total
  const splits = [frames(1), frames(60), frames(144), frames(73)];
  const totals = splits.map((parts) => {
    let acc = 0, steps = 0, simulated = 0;
    parts.forEach((dt) => {
      const tick = CM.clockTick(acc, rate, dt, 1e9);
      steps += tick.n;
      simulated += tick.n * tick.h;
      acc = tick.acc;
    });
    return simulated + acc;
  });
  totals.forEach((t) => assert.ok(Math.abs(t - rate) < 1e-6 * rate, `total ${t}`));
});

test('the implicit step converges as the step size shrinks', () => {
  const cfg = presetCfg('earth');
  cfg.distanceAU = 0.95;
  const run = (h) => {
    const st = CM.createState(cfg);
    st.T = 288;
    while (st.t < 400) CM.step(cfg, st, h);
    return st.T;
  };
  const coarse = run(20), fine = run(1);
  assert.ok(Math.abs(coarse - fine) < 1.5, `T(h=20) ${coarse} vs T(h=1) ${fine}`);
});

test('state classification names the catalogue states', () => {
  const ids = ST.CATALOG.map((s) => s.id);
  ['lava', 'wet_runaway', 'dry_runaway', 'moist', 'venus', 'mars', 'dry_icehouse', 'snowball',
    'eyeball', 'icehouse', 'waterworld', 'desert', 'hothouse', 'habitable'].forEach((id) => {
    assert.ok(ids.includes(id), `catalogue has ${id}`);
  });
});
