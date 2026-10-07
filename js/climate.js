/* ClimateHaiku - simplified climate physics for a terrestrial planet.

   A zero-dimensional (global-mean) energy-balance model with:
   - a gray-atmosphere greenhouse fitted to Earth, Mars and Venus anchors,
   - a water-vapour saturation law (IAPWS/Wagner vapour pressure),
   - an ocean/steam energy budget (latent heat is stored in the vapour),
   - a runaway limit on the outgoing longwave flux (Simpson-Nakajima type cap),
   - a carbonate-silicate thermostat (volcanism vs. weathering),
   - hydrogen escape (moist greenhouse), which slowly removes water and
     leaves oxygen behind,
   - Sun-like luminosity evolution (Gough 1981).

   Units: K, bar, W m^-2, years (t), kg. "TO" = one Earth ocean (1.4e21 kg).
   "Earth-bar" = inventory of a gas that exerts 1 bar on Earth. A gas with
   inventory I has surface pressure I * g / g_Earth on a planet of gravity g.

   This file has no DOM access, so it runs in the browser and in Node tests.
*/
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ClimateModel = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var K = {
    SIGMA: 5.670374419e-8,   // W m^-2 K^-4
    S_EARTH: 1361,           // W m^-2, Earth solar constant
    G_EARTH: 9.80665,        // m s^-2
    R_EARTH: 6.371e6,        // m
    OCEAN_KG: 1.4e21,        // one terrestrial ocean (TO)
    YEAR_S: 3.15576e7,       // s per year
    T0: 273.15,              // K
    TC: 647.096,             // K, critical temperature of water
    PC_BAR: 220.64,          // bar, critical pressure of water
    L0: 2.5e6,               // J kg^-1 latent heat at 0 C
    CW: 4186,                // J kg^-1 K^-1, liquid water
    CV: 2000,                // J kg^-1 K^-1, water vapour
    CP_AIR: 1004,            // J kg^-1 K^-1, dry air
    CHI_OCEAN: 0.25,         // share of ocean heat capacity acting on decade-century scales
    C_LAND: 2.0e6,           // J m^-2 K^-1 for a fully land-covered surface
    H2O_KG_PER_HATOM: 1.4958e-22 // kg m^-2 s^-1 per (H atom cm^-2 s^-1) of escape, halved for H2O
  };

  // Radiative and surface parameters. Calibration notes live in docs/science.md.
  var RAD = {
    A_W: 0.225,         // water vapour: ln term (tau per unit ln)
    P_W: 3.7e-4,        // bar, pressure scale of the water line wings
    B_W: 0.0137,        // bar^-2, water self-continuum (matters only for steam)
    A_CO2: 7.76,        // CO2 optical depth coefficient
    N_CO2: 0.635,       // CO2 pressure exponent
    A_CH4: 3.4,         // CH4 coefficient (tau ~ sqrt p)
    A_N2: 0.04,         // N2 pressure broadening / collision-induced term
    OLR_CAP_E: 280,     // W m^-2, runaway limit at Earth gravity
    CAP_GAMMA: 0.25,    // runaway limit scales as (g/g_E)^gamma
    CAP_SHARP: 20,      // sharpness of the soft limit (near 1 below ~0.9 of the cap)
    ALB_OCEAN: 0.06,
    ALB_ICE: 0.5,
    ALB_LAND_WET: 0.22,
    ALB_LAND_DRY: 0.28,
    ALB_CLOUD: 0.20,    // cloud albedo at Earth-like humidity
    CLOUD_HOT_T0: 300,  // K, hot air thins its cloud deck above this
    CLOUD_HOT_W: 35,    // K, width over which the cloud albedo falls
    CLOUD_HOT_DROP: 0.3, // fraction of cloud albedo lost when hot
    ALB_HAZE: 0.5,      // dense CO2 sulphuric haze (Venus), saturating
    HAZE_P0: 5,         // bar
    ALB_ROT_MAX: 0.08,  // extra albedo from substellar clouds on slow rotators
    T_ICE_FULL: 233,    // K, ice-covered at and below this
    T_ICE_NONE: 283,    // K, ice-free at and above this (wide ramp: weak ice feedback near today)
    OCEAN_A: 0.71,      // ocean-covered fraction of a 1-TO planet (Earth)
    OCEAN_EXP: 0.6,     // ocean fraction grows as water^0.6
    RH_BASE: 0.25,      // relative humidity over dry land with some water nearby
    RH_OCEAN: 0.5,      // extra humidity from ocean area (sqrt of ocean fraction)
    KOC: 50,            // ocean carbon capacity (ocean/atmosphere CO2) at 1 TO, 288 K
    KOC_TEMP: 0.035,    // per K, solubility falls with temperature
    T_KOC_REF: 288,
    VOLC_E: 5.1e-8,     // Earth-bar per year of volcanic CO2 at volcanism = 1
    W_K: 1.76e-7,       // weathering rate scale (Earth-bar per year)
    W_TEMP: 12,         // K, e-folding temperature of weathering
    W_TMAX: 330,        // K, weathering rate stops growing above this
    W_TSHUT: 340,       // K, no rain above this: weathering shuts off
    CAP_TREF: 1000,     // K, above this the runaway limit rises with the (hot, dense) photosphere
    W_EXP: 0.3,         // weathering exponent on pCO2
    P_CO2_E: 4.2e-4,    // bar, Earth reference pCO2
    PHI_E: 1.8e13,      // H atoms cm^-2 s^-1, diffusion-limited H escape at Earth gravity (Luger & Barnes 2015: 1.3-1.9e13)
    T_MOIST: 310,       // K, surface temperature where water reaches the stratosphere (cold trap fails)
    W_MOIST: 1,         // K, width of the onset (the cold trap holds below ~305 K)
    P_CO2_MIN: 1e-5,    // bar (~10 ppm): photosynthesis and weathering stall below this
    RH_NORM: 0.67       // humidity of Earth's ocean-covered planet
  };

  var STAR_TYPES = {
    G: { name: 'Sun-like G star', luminosity: 1.0, mass: 1.0, color: '#fff3dc' },
    F: { name: 'Bright F star', luminosity: 2.5, mass: 1.3, color: '#f7f9ff' },
    K: { name: 'Orange K dwarf', luminosity: 0.35, mass: 0.75, color: '#ffc27a' },
    M: { name: 'Red M dwarf', luminosity: 0.03, mass: 0.35, color: '#ff8f5a' }
  };

  var SUN_AGE_GYR = 4.57;

  function clamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
  }

  // ---------- geometry and star ----------

  function planetGeometry(massE) {
    var R = Math.pow(massE, 0.27);            // radius in Earth radii (rocky planets)
    var rm = R * K.R_EARTH;
    var gr = massE / (R * R);                 // gravity relative to Earth
    return {
      massE: massE,
      radiusE: R,
      gr: gr,
      g: K.G_EARTH * gr,
      A: 4 * Math.PI * rm * rm                // surface area, m^2
    };
  }

  // Gough (1981) luminosity law for a Sun-like star, normalised to 1 at 4.57 Gyr.
  function goughLuminosity(ageGyr) {
    return 1 / (1 + 0.4 * (1 - ageGyr / SUN_AGE_GYR));
  }

  function starLuminosity(cfg, ageGyr) {
    var type = STAR_TYPES[cfg.starType] || STAR_TYPES.G;
    var base = (cfg.starLuminosity !== undefined ? cfg.starLuminosity : type.luminosity);
    if (!cfg.evolveStar) return base;
    return base * goughLuminosity(ageGyr);
  }

  function insolationS(cfg, ageGyr) {
    return starLuminosity(cfg, ageGyr) / (cfg.distanceAU * cfg.distanceAU);
  }

  // Orbital period in days from Kepler's third law with a mass-luminosity guess.
  function orbitalPeriodDays(cfg) {
    var type = STAR_TYPES[cfg.starType] || STAR_TYPES.G;
    var mStar = Math.pow(type.luminosity, 1 / 3.5);
    return 365.25 * Math.sqrt(Math.pow(cfg.distanceAU, 3) / mStar);
  }

  function rotationPeriodHours(cfg) {
    return cfg.tidallyLocked ? orbitalPeriodDays(cfg) * 24 : cfg.rotationHours;
  }

  // Slow rotation builds substellar cloud decks that brighten the planet
  // (Yang et al. 2014). Ramps up from ~2 days to ~40 days.
  function rotationAlbedo(cfg) {
    var P = rotationPeriodHours(cfg);
    var s = clamp(Math.log(P / 48) / Math.log(1000 / 48), 0, 1);
    return RAD.ALB_ROT_MAX * s;
  }

  // ---------- thermodynamics ----------

  // Saturation vapour pressure of water in bar (IAPWS-95 Wagner form).
  // Above the critical point there is no liquid/vapour boundary; the curve is
  // continued smoothly so that water moves into the vapour continuously.
  function psatBar(T) {
    if (T >= K.TC) return K.PC_BAR * Math.exp(8 * (T / K.TC - 1));
    var t = Math.max(T, 150);
    var tau = 1 - t / K.TC;
    var s = -7.85951783 * tau + 1.84408259 * Math.pow(tau, 1.5) - 11.7866497 * Math.pow(tau, 3) +
            22.6807411 * Math.pow(tau, 3.5) - 15.9618719 * Math.pow(tau, 4) + 1.80122502 * Math.pow(tau, 7.5);
    return K.PC_BAR * Math.exp((K.TC / t) * s);
  }

  // Humidity of the air over a surface with ocean fraction foc. Trace water
  // (foc well below 1%) gives almost no humidity, so dry planets stay dry.
  function relHumidity(foc) {
    if (foc <= 0) return 0;
    return RAD.RH_BASE * clamp(foc / 0.01, 0, 1) + RAD.RH_OCEAN * Math.sqrt(clamp(foc, 0, 1));
  }

  // Ocean fraction of the surface from liquid water inventory (TO).
  function oceanFraction(wlTO) {
    if (wlTO <= 0) return 0;
    return Math.min(1, RAD.OCEAN_A * Math.pow(wlTO, RAD.OCEAN_EXP));
  }

  function iceFraction(T) {
    return clamp((RAD.T_ICE_NONE - T) / (RAD.T_ICE_NONE - RAD.T_ICE_FULL), 0, 1);
  }

  // ---------- context: everything fixed during one implicit step ----------

  function makeContext(cfg, st) {
    var geo = planetGeometry(cfg.massE);
    var S = insolationS(cfg, st.tStar);
    var rh = relHumidity(st.foc);
    return {
      geo: geo,
      g: geo.g,
      gr: geo.gr,
      A: geo.A,
      Fin: S * K.S_EARTH * (1 - (cfg.shade || 0)),
      Wkg: st.Wtot * K.OCEAN_KG / geo.A,      // total water, kg m^-2
      NC: st.NC,                               // CO2 inventory, Earth-bar (air + ocean)
      IN2: cfg.n2Inv,                          // N2 inventory, Earth-bar
      IO2: st.IO2,                             // O2 inventory, Earth-bar
      ch4: (cfg.ch4ppm || 0) * 1e-6,           // CH4 mixing ratio
      foc: st.foc,                             // ocean fraction (lagged one step)
      rh: rh,
      aRot: rotationAlbedo(cfg),
      aAer: cfg.aerosol || 0,
      volc: cfg.volcanism === undefined ? 1 : cfg.volcanism,
      weath: cfg.weathering === undefined ? 1 : cfg.weathering
    };
  }

  // Partition of water and carbon between air, ocean and rock at temperature T.
  function partition(ctx, T) {
    var psat = psatBar(T);
    // Hot air is saturated with steam whatever the lagged ocean fraction says,
    // so water cannot be pushed back into a liquid it has just left.
    var rhEff = Math.max(ctx.rh, clamp((T - 450) / 100, 0, 1));
    var cap = (psat === Infinity) ? Infinity : rhEff * psat * 1e5 / ctx.g;   // kg m^-2
    var mv = Math.max(0, Math.min(ctx.Wkg, cap));
    var wlKg = Math.max(0, ctx.Wkg - mv);
    var wlTO = wlKg * ctx.A / K.OCEAN_KG;
    var koc = RAD.KOC * wlTO * Math.exp(-RAD.KOC_TEMP * (T - RAD.T_KOC_REF));
    var pH2O = mv * ctx.g / 1e5;
    var pCO2 = ctx.NC * ctx.gr / (1 + koc);
    var pN2 = ctx.IN2 * ctx.gr;
    var pO2 = ctx.IO2 * ctx.gr;
    var pCH4 = ctx.ch4 * (pH2O + pCO2 + pN2 + pO2);
    var pDry = pCO2 + pN2 + pO2 + pCH4;
    return {
      mv: mv,
      wlKg: wlKg,
      wlTO: wlTO,
      pH2O: pH2O,
      pCO2: pCO2,
      pN2: pN2,
      pO2: pO2,
      pCH4: pCH4,
      pDry: pDry,
      P: pDry + pH2O,
      koc: koc,
      psat: psat
    };
  }

  // Ice albedo only applies where there is water to freeze (dry Mars has no sea ice).
  function iceCover(T, fo) {
    return iceFraction(T) * clamp(fo * 10, 0, 1);
  }

  function albedo(ctx, T, part) {
    var fIce = iceCover(T, oceanFraction(part.wlTO));
    var fo = oceanFraction(part.wlTO);
    var rh = ctx.rh;
    var dryness = clamp(1 - rh / RAD.RH_NORM, 0, 1);
    var aLand = RAD.ALB_LAND_WET + (RAD.ALB_LAND_DRY - RAD.ALB_LAND_WET) * dryness;
    // Over a hot steam atmosphere the surface is hidden by cloud: it is dark,
    // like ocean, whatever the continents are. Dry Venus has no steam and is not affected.
    var steamy = clamp((part.pH2O - 0.5) / 2, 0, 1) * clamp((T - 450) / 100, 0, 1);
    aLand = aLand + (RAD.ALB_OCEAN - aLand) * steamy;
    var aSurf = (1 - fIce) * (fo * RAD.ALB_OCEAN + (1 - fo) * aLand) + fIce * RAD.ALB_ICE;
    // Hot, humid air carries thinner cloud decks (lower albedo near the runaway limit).
    var hot = clamp((T - RAD.CLOUD_HOT_T0) / RAD.CLOUD_HOT_W, 0, 1);
    var aCloud = RAD.ALB_CLOUD * clamp(rh / RAD.RH_NORM, 0, 1) * (1 - RAD.CLOUD_HOT_DROP * hot) * (1 - 0.7 * fIce);
    var aHaze = RAD.ALB_HAZE * part.pCO2 / (part.pCO2 + RAD.HAZE_P0);
    return Math.min(0.95, aSurf + aCloud + aHaze + ctx.aRot + ctx.aAer);
  }

  // Optical depth split by gas.
  function opticalDepth(part) {
    var tw = RAD.A_W * Math.log(1 + part.pH2O / RAD.P_W) + RAD.B_W * part.pH2O * part.pH2O;
    var tc = RAD.A_CO2 * Math.pow(Math.max(part.pCO2, 0), RAD.N_CO2);
    var tm = RAD.A_CH4 * Math.sqrt(Math.max(part.pCH4, 0));
    var tn = RAD.A_N2 * part.pN2;
    return { w: tw, c: tc, m: tm, n: tn, total: tw + tc + tm + tn };
  }

  // Outgoing longwave flux. Gray atmosphere, then a soft cap when water vapour
  // dominates the opacity (the runaway limit).
  function outgoingLongwave(ctx, T, tau) {
    var gray = K.SIGMA * T * T * T * T / (1 + 0.75 * tau.total);
    var hot = Math.max(1, T / RAD.CAP_TREF);
    var cap = RAD.OLR_CAP_E * Math.pow(ctx.gr, RAD.CAP_GAMMA) * hot;
    var wWater = tau.total > 0 ? tau.w / tau.total : 0;
    // The limit applies to water-vapour atmospheres, not to dense CO2 (Venus).
    var weight = clamp((wWater - 0.2) / 0.4, 0, 1);
    // Rising side: a soft minimum with the limit.
    var x = gray / cap, k = RAD.CAP_SHARP;
    var limited = gray / Math.pow(1 + Math.pow(x, k), 1 / k);
    // Thick steam: the emitting layer is high and hot, so the flux stays near
    // the limit instead of falling away as the optical depth grows.
    var thick = clamp((tau.total - 1) / 4, 0, 1);
    var waterOLR = Math.max(limited, cap * thick);
    return (1 - weight) * gray + weight * waterOLR;
  }

  // Net downward flux at the top of the atmosphere (W m^-2) at temperature T.
  function netFlux(ctx, T, part) {
    var a = albedo(ctx, T, part);
    var Fabs = ctx.Fin * (1 - a) / 4;
    var olr = outgoingLongwave(ctx, T, opticalDepth(part));
    return { N: Fabs - olr, Fabs: Fabs, OLR: olr, alpha: a };
  }

  // Column energy above 0 C (J m^-2): liquid sensible heat (fraction chi),
  // vapour latent + sensible heat, dry air and land heat capacity.
  function columnEnergy(ctx, T, part) {
    var dT = T - K.T0;
    var eLiq = K.CHI_OCEAN * K.CW * part.wlKg * dT;
    var eVap = part.mv * (K.L0 + K.CV * dT);
    var eDry = K.CP_AIR * part.pDry * 1e5 / ctx.g * dT;
    var eLand = K.C_LAND * (1 - oceanFraction(part.wlTO)) * dT;
    return eLiq + eVap + eDry + eLand;
  }

  function residual(ctx, T, En, hs) {
    var part = partition(ctx, T);
    var fl = netFlux(ctx, T, part);
    return columnEnergy(ctx, T, part) - En - hs * fl.N;
  }

  // Solve the implicit energy balance E(T) - E_n = h N(T) for T, starting at T_n.
  // Newton steps first; if the slope is not positive, bracket the sign change
  // nearest to T_n (expanding geometrically, so runaway heating is found too).
  function solveSurfaceT(ctx, Tn, En, hs) {
    function F(T) { return residual(ctx, T, En, hs); }
    var T = Tn;
    for (var it = 0; it < 80; it++) {
      var f0 = F(T);
      var slope = (F(T + 0.01) - f0) / 0.01;
      if (!(slope > 0) || !isFinite(slope)) break;
      var cap = Math.max(25, 0.5 * T);
      var dT = clamp(-f0 / slope, -cap, cap);
      T = clamp(T + dT, 20, 1e5);
      if (Math.abs(dT) < 1e-7 * Math.max(1, T)) return T;
    }
    var fn = F(Tn);
    if (fn === 0) return Tn;
    var sameSign = function (a) { return (a <= 0) === (fn <= 0); };
    var upLo = Tn, fUpLo = fn, dnHi = Tn, fDnHi = fn;
    for (var s = 0.25; s < 1e5; s *= 1.5) {
      var up = Tn + s;
      var fu = F(up);
      if (!sameSign(fu)) return bisectRoot(upLo, up, fUpLo);
      upLo = up; fUpLo = fu;
      var dn = Math.max(20, Tn - s);
      var fd = F(dn);
      if (!sameSign(fd)) return bisectRoot(dn, dnHi, fd);
      dnHi = dn; fDnHi = fd;
    }
    return Tn;
    function bisectRoot(lo, hi, flo) {
      for (var b = 0; b < 60; b++) {
        var mid = 0.5 * (lo + hi);
        var fm = F(mid);
        if ((fm <= 0) === (flo <= 0)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      return 0.5 * (lo + hi);
    }
  }

  // ---------- state ----------

  // Build an initial state from a configuration. The atmospheric CO2 partial
  // pressure is what the player sets; the inventory includes the ocean share.
  function createState(cfg) {
    var geo = planetGeometry(cfg.massE);
    var Wtot = cfg.waterTO;
    var foc0 = oceanFraction(Wtot);
    var T0 = cfg.initialT || 288;
    var st = {
      t: 0,
      tStar: cfg.starAgeGyr,
      T: T0,
      Wtot: Wtot,
      foc: foc0,
      NC: 0,
      IO2: cfg.o2Inv,
      cumulativeH2OLost: 0
    };
    st.NC = co2InventoryFor(cfg, st, cfg.co2Partial);
    return st;
  }

  // Inventory (Earth-bar) that gives the requested atmospheric CO2 partial pressure.
  function co2InventoryFor(cfg, st, pCO2Bar) {
    var geo = planetGeometry(cfg.massE);
    var ctx = makeContext(cfg, st);
    var part = partition(ctx, st.T);
    var ratio = 1 + part.koc;
    return pCO2Bar * ratio / geo.gr;
  }

  // Changes the inventory for a new partial pressure at the current state.
  function setCO2Partial(cfg, st, pCO2Bar) {
    st.NC = co2InventoryFor(cfg, st, pCO2Bar);
  }

  // Silicate weathering draws CO2 down, but only where rain falls: it is
  // capped at high temperature and shuts off in a steam atmosphere.
  function weatheringRate(ctx, T, part, foc) {
    var rh = relHumidity(foc);
    var land = 1 - foc;
    var humid = clamp(rh / RAD.RH_NORM, 0, 1.5);
    var Tw = Math.min(T, RAD.W_TMAX);
    var tf = Math.exp((Tw - 288) / RAD.W_TEMP);
    var p = Math.max(part.pCO2, 1e-12);
    var pf = Math.pow(p / RAD.P_CO2_E, RAD.W_EXP);
    // Biological floor, normalised so that Earth's reference pCO2 is unaffected.
    var floor = (p / (p + RAD.P_CO2_MIN)) * ((RAD.P_CO2_E + RAD.P_CO2_MIN) / RAD.P_CO2_E);
    var rain = clamp((RAD.W_TSHUT - T) / 20, 0, 1);
    return RAD.W_K * ctx.weath * land * humid * tf * pf * floor * rain;   // Earth-bar per year
  }

  // d(weathering)/d(NC) at fixed temperature, by a small perturbation of NC.
  function carbonSinkSlope(ctx, T, part, foc, Wth) {
    if (part.pCO2 <= 0 || ctx.NC <= 0) return 0;
    var dNC = 0.01 * ctx.NC;
    var ratio = (ctx.NC + dNC) / ctx.NC;
    var pert = { pCO2: part.pCO2 * ratio };
    var W2 = weatheringRate(ctx, T, pert, foc);
    return Math.max(0, (W2 - Wth) / dNC);
  }

  function escapeFlux(ctx, T, runaway) {
    var f = 1 / (1 + Math.exp(-(T - RAD.T_MOIST) / RAD.W_MOIST));
    var base = RAD.PHI_E * ctx.gr;               // diffusion-limited flux is proportional to gravity (Luger & Barnes 2015)
    return base * f * (runaway ? 4 : 1);         // hydrodynamic boost when steam is present
  }

  // One time step of h years. Implicit in surface temperature and carbon,
  // so it stays stable for large steps (the runaway ocean loss is energy-limited).
  function step(cfg, st, hYears) {
    if (hYears <= 0) return st;
    var hs = hYears * K.YEAR_S;
    var ctx = makeContext(cfg, st);
    var En = columnEnergy(ctx, st.T, partition(ctx, st.T));
    var T1 = solveSurfaceT(ctx, st.T, En, hs);
    var part = partition(ctx, T1);
    var foc1 = oceanFraction(part.wlTO);

    // Hydrogen escape: slowly removes water, and oxygen is left behind.
    var fl = netFlux(ctx, T1, part);
    var runaway = fl.N > 0.5 && isRunawayAt(ctx, T1, part);
    var phi = escapeFlux(ctx, T1, runaway);           // H atoms cm^-2 s^-1
    var dWkgm2 = phi * K.H2O_KG_PER_HATOM * hs;       // kg m^-2 of water lost
    var dWTO = Math.min(st.Wtot, dWkgm2 * ctx.A / K.OCEAN_KG);
    st.Wtot = st.Wtot - dWTO;
    st.cumulativeH2OLost += dWTO;
    // Each lost H2O leaves half an O2 molecule behind (2 H2O -> O2 + 4 H escape).
    st.IO2 += dWTO * K.OCEAN_KG * (16 / 18) / ctx.A * K.G_EARTH / 1e5;

    // Carbon: volcanic source and weathering sink, linearised implicitly with
    // the local slope dW/dNC (the biological floor makes it steeper than p^0.3).
    var Wth = weatheringRate(ctx, T1, part, foc1);
    var V = RAD.VOLC_E * ctx.volc;
    var s = carbonSinkSlope(ctx, T1, part, foc1, Wth);
    st.NC = Math.max(0, (st.NC + hYears * (V - Wth + s * st.NC)) / (1 + hYears * s));

    st.T = T1;
    st.foc = foc1;
    st.tStar += hYears / 1e9;
    st.t += hYears;
    return st;
  }

  // A runaway: there is no stable energy balance above T (N stays positive).
  // Checked up to 800 K: a dry, CO2-rich Venus-like equilibrium (~735 K) is not
  // a runaway, but a steam atmosphere with no equilibrium below 800 K is.
  function isRunawayAt(ctx, T, part) {
    // Already far above the Venus-like range: a steam atmosphere is a runaway.
    if (T >= 800) return part.pH2O > part.pCO2;
    if (netFlux(ctx, T, part).N <= 1) return false;      // clearly heating, not balanced
    // Look for a balance anywhere above T: densely up to 340 K, then coarser.
    var grid = [];
    for (var g = T + 4; g < 340; g += 4) grid.push(g);
    grid = grid.concat([340, 360, 380, 400, 430, 470, 520, 580, 650, 730, 800]);
    for (var i = 0; i < grid.length; i++) {
      var Ti = grid[i];
      if (Ti <= T) continue;
      if (netFlux(ctx, Ti, partition(ctx, Ti)).N <= 0) return false;
    }
    return true;
  }

  // A ready-to-run world: equilibrate at the settle configuration, then set the
  // CO2 air pressure requested in cfg (the inventory depends on the temperature
  // it was set at), and equilibrate again.
  // Worlds that start at a different orbit (runaway starts) are not advanced
  // at their target orbit here, so the change happens in the simulation.
  function prepare(cfg, settleOverrides) {
    var overrides = settleOverrides || {};
    var settleCfg = Object.assign({}, cfg, overrides);
    var st = createState(cfg);
    settle(settleCfg, st, 2e5, 60);
    setCO2Partial(cfg, st, cfg.co2Partial);
    if (Object.keys(overrides).length === 0) settle(cfg, st, 500, 5);
    return st;
  }

  // Let the surface reach its equilibrium (carbon left alone).
  function settle(cfg, st, years, steps) {
    var n = steps || 60;
    var h = years / n;
    for (var i = 0; i < n; i++) {
      var ctx = makeContext(cfg, st);
      var En = columnEnergy(ctx, st.T, partition(ctx, st.T));
      st.T = solveSurfaceT(ctx, st.T, En, h * K.YEAR_S);
      st.foc = oceanFraction(partition(ctx, st.T).wlTO);
    }
    return st;
  }

  // ---------- diagnostics for display and classification ----------

  function diagnose(cfg, st) {
    var ctx = makeContext(cfg, st);
    var part = partition(ctx, st.T);
    var fl = netFlux(ctx, st.T, part);
    var tau = opticalDepth(part);
    var runaway = isRunawayAt(ctx, st.T, part);
    var phi = escapeFlux(ctx, st.T, runaway);
    var wlTO = part.wlTO;
    var fo = oceanFraction(wlTO);
    var fIce = iceCover(st.T, fo);
    var rh = relHumidity(fo);
    var S = insolationS(cfg, st.tStar);
    var Fin = S * K.S_EARTH * (1 - (cfg.shade || 0));
    var cap = RAD.OLR_CAP_E * Math.pow(ctx.gr, RAD.CAP_GAMMA);
    var colD = columnEnergy;

    // Thermal response time: heat capacity over the feedback slope.
    var h = 0.01;
    var dE = (colD(ctx, st.T + h, partition(ctx, st.T + h)) - colD(ctx, st.T, part)) / h;
    var dN = (netFlux(ctx, st.T + h, partition(ctx, st.T + h)).N - fl.N) / h;
    var lambda = -dN;
    var tauT = (lambda > 0.01) ? (dE / lambda) / K.YEAR_S : Infinity;

    var evapYears = (fl.N > 0 && part.wlKg > 0) ? (part.wlKg * K.L0 / fl.N) / K.YEAR_S : Infinity;
    var loseWaterYears = phi > 0 ? (st.Wtot * K.OCEAN_KG / ctx.A) / (phi * K.H2O_KG_PER_HATOM) / K.YEAR_S : Infinity;
    var dWdt = -(phi * K.H2O_KG_PER_HATOM) * ctx.A / K.OCEAN_KG;   // TO per second
    var Wth = weatheringRate(ctx, st.T, part, fo);
    var co2Years = (Wth > 0) ? st.NC / (RAD.W_EXP * Wth) : Infinity;

    return {
      cfg: cfg,
      T: st.T,
      t: st.t,
      tStarGyr: st.tStar,
      geo: ctx.geo,
      g: ctx.g,
      gr: ctx.gr,
      radiusE: ctx.geo.radiusE,
      Ptotal: part.P,
      pCO2: part.pCO2,
      pH2O: part.pH2O,
      pN2: part.pN2,
      pO2: part.pO2,
      pCH4: part.pCH4,
      pDry: part.pDry,
      Wtot: st.Wtot,
      Wliquid: wlTO,
      Wvapour: part.mv * ctx.A / K.OCEAN_KG,
      foc: fo,
      fIce: fIce,
      rh: rh,
      Fin: Fin,
      S: S,
      luminosity: starLuminosity(cfg, st.tStar),
      alpha: fl.alpha,
      Fabs: fl.Fabs,
      OLR: fl.OLR,
      N: fl.N,
      OLRcap: cap,
      tau: tau,
      runaway: runaway,
      moistFraction: 1 / (1 + Math.exp(-(st.T - RAD.T_MOIST) / RAD.W_MOIST)),
      escapeFlux: phi,
      dWdtTOperYear: dWdt * K.YEAR_S,
      O2: st.IO2 * ctx.gr,
      NC: st.NC,
      hasLiquid: wlTO > 1e-6,
      rotationHours: rotationPeriodHours(cfg),
      rotationAlbedo: ctx.aRot,
      tauThermal: tauT,
      evapYears: evapYears,
      loseWaterYears: loseWaterYears,
      co2Years: co2Years,
      koc: part.koc,
      psat: part.psat
    };
  }

  // Time (years) until the Sun-like brightening pushes the planet past its
  // runaway limit, at fixed orbit and composition. Uses the energy balance
  // at the current equilibrium and the Gough luminosity law.
  function timeToRunawayGyr(cfg, st) {
    if (!cfg.evolveStar) return Infinity;
    var base = starLuminosity(cfg, st.tStar);
    function runawayAt(mult) {
      var c = Object.assign({}, cfg, { starLuminosity: base * mult, evolveStar: false });
      var s = Object.assign({}, st);
      settle(c, s, 2e5, 40);
      return diagnose(c, s).runaway;
    }
    var lo = 1, hi = 1.5;
    if (runawayAt(1)) return 0;
    var k = 0;
    while (!runawayAt(hi) && k < 12) { hi *= 1.25; k++; }
    if (!runawayAt(hi)) return Infinity;
    for (var i = 0; i < 18; i++) {
      var mid = 0.5 * (lo + hi);
      if (runawayAt(mid)) hi = mid; else lo = mid;
    }
    // Luminosity needed, relative to the Sun at 4.57 Gyr, then invert Gough.
    var needL = base * hi;
    var x = 1 - (1 / needL - 1) / 0.4;   // t / 4.57
    var tNeed = x * SUN_AGE_GYR;
    return Math.max(0, tNeed - st.tStar);
  }

  // ---------- fixed-step clock ----------

  // Simulated years per step. Depends only on the simulated rate, never on the
  // frame rate, so the same simulated time gives the same trajectory.
  function stepYears(rate) {
    return clamp(rate / 60, 0.02, 1e6);
  }

  // Splits a wall-clock interval into whole steps. The leftover stays in the
  // accumulator, so the total simulated time is the same however the wall time
  // is divided into frames.
  function clockTick(acc, rate, dtWall, maxSteps) {
    var h = stepYears(rate);
    var total = acc + rate * dtWall;
    var n = Math.floor(total / h);
    if (n > maxSteps) {
      n = maxSteps;
      total = Math.min(total, h);      // drop an unbounded backlog rather than stall
      return { h: h, n: n, acc: total - Math.min(total, h) };
    }
    return { h: h, n: n, acc: total - n * h };
  }

  // ---------- public API ----------

  return {
    K: K,
    RAD: RAD,
    STAR_TYPES: STAR_TYPES,
    SUN_AGE_GYR: SUN_AGE_GYR,
    clamp: clamp,
    planetGeometry: planetGeometry,
    goughLuminosity: goughLuminosity,
    starLuminosity: starLuminosity,
    insolationS: insolationS,
    orbitalPeriodDays: orbitalPeriodDays,
    rotationPeriodHours: rotationPeriodHours,
    psatBar: psatBar,
    iceFraction: iceFraction,
    oceanFraction: oceanFraction,
    relHumidity: relHumidity,
    makeContext: makeContext,
    partition: partition,
    albedo: albedo,
    opticalDepth: opticalDepth,
    outgoingLongwave: outgoingLongwave,
    netFlux: netFlux,
    columnEnergy: columnEnergy,
    solveSurfaceT: solveSurfaceT,
    createState: createState,
    setCO2Partial: setCO2Partial,
    co2InventoryFor: co2InventoryFor,
    weatheringRate: weatheringRate,
    escapeFlux: escapeFlux,
    step: step,
    stepYears: stepYears,
    clockTick: clockTick,
    settle: settle,
    prepare: prepare,
    isRunawayAt: isRunawayAt,
    diagnose: diagnose,
    timeToRunawayGyr: timeToRunawayGyr
  };
}));
