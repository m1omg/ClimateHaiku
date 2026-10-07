/* ClimateHaiku - climate state classification and the state catalogue.
 * Pure functions: takes the output of ClimateModel.diagnose() and returns a
 * named state. The catalogue text is the "science notes" shown in the UI.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root.ClimateModel || (typeof require === 'function' ? require('./climate.js') : null));
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ClimateStates = api;
  }
}(typeof self !== 'undefined' ? self : this, function (CM) {
  'use strict';

  // Ordered catalogue. "cond" is the condition the classifier uses (see classify).
  var CATALOG = [
    {
      id: 'lava', name: 'Lava world', color: '#f97316',
      cond: 'T above ~1500 K, molten surface',
      desc: 'Surface rock is molten. A steam runaway can end here, hot enough to melt silicates.',
      why: 'Silicate rock melts at roughly 1400 to 1800 K, so the surface stops being a solid boundary.',
      refs: ['Kasting 1988', 'Hamano et al. 2013']
    },
    {
      id: 'wet_runaway', name: 'Wet runaway greenhouse', color: '#f87171',
      cond: 'No stable energy balance; liquid ocean still present',
      desc: 'Absorbed sunlight is more than a water-vapour atmosphere can radiate. The ocean boils into a steam atmosphere over thousands of years.',
      why: 'Warming adds water vapour, which adds greenhouse. Once outgoing radiation saturates near 280 W m-2 (Goldblatt et al. 2013 give 282 W m-2 for a clear sky) there is no stable balance, and the excess energy goes into evaporation.',
      refs: ['Ingersoll 1969', 'Kasting 1988', 'Goldblatt et al. 2013']
    },
    {
      id: 'dry_runaway', name: 'Dry runaway greenhouse', color: '#fb7185',
      cond: 'No stable energy balance; ocean gone; steam atmosphere',
      desc: 'The ocean has evaporated. The steam atmosphere keeps heating, and hydrogen escape removes the water over roughly 10^7 to 10^8 years.',
      why: 'With no ocean there is nothing to cool the surface, and the steam keeps the outgoing flux near its limit. Only the slow loss of water to space breaks the loop.',
      refs: ['Kasting 1988', 'Hamano et al. 2013', 'Luger & Barnes 2015']
    },
    {
      id: 'moist', name: 'Moist greenhouse', color: '#fdba74',
      cond: 'Ocean still present and losing water to space; surface about 307-315 K',
      desc: 'Water vapour climbs above the cold trap and is split by sunlight. Hydrogen escapes and oxygen is left behind. The ocean survives, but it is shrinking.',
      why: 'The cold trap normally keeps stratospheric water low. Once it fails, the diffusion-limited hydrogen flux (about 1.3 to 1.9e13 atoms cm-2 s-1 at Earth gravity, Luger & Barnes 2015) sets the loss timescale. In this model the onset sits near 310 K, below the 330 to 350 K of published 1-D and 3-D studies, so the window is narrower and sits just inside the runaway limit. Kopparapu et al. (2014) find their own moist and runaway limits within 2% of each other.',
      refs: ['Kasting 1988', 'Kopparapu et al. 2013', 'Kopparapu et al. 2014', 'Wolf et al. 2017', 'Luger & Barnes 2015']
    },
    {
      id: 'venus', name: 'Venus-like (dry, hot)', color: '#fbbf24',
      cond: 'No liquid water, CO2 above ~5 bar, stable equilibrium',
      desc: 'A dense CO2 atmosphere with a sulphuric cloud deck, no ocean and a surface hot enough to melt lead. This is what remains after the water has gone.',
      why: 'CO2 absorbs strongly at high pressure, and the cloud deck reflects about three quarters of the sunlight (NASA gives a Bond albedo of 0.77). The greenhouse is set by CO2 pressure, not by water.',
      refs: ['Kasting 1988', 'Hamano et al. 2013', 'NASA Venus Fact Sheet']
    },
    {
      id: 'mars', name: 'Mars-like (cold, thin, dry)', color: '#fb923c',
      cond: 'No liquid water, surface pressure below ~0.3 bar, T below 273 K',
      desc: 'A thin CO2 atmosphere, dry dusty ground and ice caps. Low gravity and a small amount of air are not enough to hold heat.',
      why: 'Mars has a thin CO2 atmosphere: about 6 mbar, roughly 14 times Earth\'s CO2 partial pressure but under 1% of Earth\'s total surface pressure. Its greenhouse effect is only a few kelvin, and albedo dominates its temperature.',
      refs: ['Pierrehumbert 2010', 'NASA Mars Fact Sheet']
    },
    {
      id: 'dry_icehouse', name: 'Dry icehouse', color: '#c4b5fd',
      cond: 'No liquid water, thick atmosphere, T below 273 K',
      desc: 'A cold, dense atmosphere with no ocean. CO2 frost and dry ice cover the surface.',
      why: 'With no liquid water there is no ice-albedo feedback, and CO2 alone gives a modest greenhouse.',
      refs: ['Pierrehumbert 2010']
    },
    {
      id: 'snowball', name: 'Snowball', color: '#bae6fd',
      cond: 'Ice cover above 90%, T below ~240 K',
      desc: 'The whole ocean is frozen and reflects most of the sunlight. In this model it stays frozen for a range of insolations near today\'s, which makes the transition hard to reverse.',
      why: 'Ice albedo is a positive feedback. A snowball is a stable alternative to the warm state over a range of insolations, separated from it by an unstable branch (hysteresis). This is the mechanism in Budyko (1969) and Sellers (1969). The warm-to-snowball fold here (about 4% less sunlight at 280 ppm) is easier to reach than the 8 to 9% reduction that the CCSM4 model needs at 286 ppm (Yang, Peltier & Hu 2012).',
      refs: ['Budyko 1969', 'Sellers 1969', 'Hoffman et al. 1998', 'Pierrehumbert et al. 2011', 'Yang et al. 2012']
    },
    {
      id: 'eyeball', name: 'Eyeball / slushball', color: '#a5f3fc',
      cond: 'Ice cover 50-90%, T about 240-265 K',
      desc: 'Ice covers most of the planet, with a patch of open water left. On a tidally locked planet the patch can sit at the point facing the star ("Eyeball Earth", Pierrehumbert 2011). On a rotating planet it would more likely be an equatorial "waterbelt". This model keeps one global ice fraction, so it cannot tell the two apart.',
      why: 'Open water absorbs sunlight and gives off heat and vapour, so the ice-albedo feedback stops short of a full snowball. Enough CO2 can melt the ice again. Whether a tropical waterbelt forms robustly is contested (Braun et al. 2022).',
      refs: ['Pierrehumbert 2011', 'Pierrehumbert et al. 2011', 'Braun et al. 2022']
    },
    {
      id: 'icehouse', name: 'Icehouse (glacial)', color: '#93c5fd',
      cond: 'Ice cover 10-50%, T about 265-283 K',
      desc: 'Large ice sheets and a colder, drier climate, like the glacial periods of the Pleistocene.',
      why: 'The ice-albedo feedback has grown but has not taken over. The climate can still be pulled back by volcanic CO2.',
      refs: ['Hays et al. 1976', 'Walker et al. 1981']
    },
    {
      id: 'waterworld', name: 'Waterworld', color: '#38bdf8',
      cond: 'Ocean covers almost the whole surface, more than about 2.5 TO',
      desc: 'No exposed land in this model. A deep ocean stores a lot of heat and CO2, and its humid air makes a strong greenhouse.',
      why: 'Deep oceans have a large heat capacity, so the climate responds slowly. More water means more vapour and a stronger greenhouse, so in this model a waterworld runs warmer than Earth at the same distance. The ocean law here leaves no land above about 1.8 TO, but Cowan & Abbot (2014) find exposed land persists up to a water mass fraction of about 0.2%, roughly 8 to 9 Earth oceans for an Earth-mass planet.',
      refs: ['Cowan & Abbot 2014']
    },
    {
      id: 'desert', name: 'Desert world', color: '#d6b67a',
      cond: 'Liquid water below ~5% of the surface (under ~0.05 TO)',
      desc: 'Little water and mostly land. Humidity is low, the land is bright, and the temperature swings between day and night are large.',
      why: 'Dry air has little water-vapour greenhouse and a small heat capacity. In this model a desert is colder than a wet planet at the same distance, and its days and nights differ more.',
      refs: []
    },
    {
      id: 'hothouse', name: 'Hothouse (warm)', color: '#fde68a',
      cond: 'Ocean, surface about 300-310 K, water not yet escaping',
      desc: 'Warmer than today with a wet atmosphere. The planet is still stable, but its climate is more sensitive to small changes.',
      why: 'Water vapour and CO2 both add greenhouse warming. The ocean-atmosphere system is still below the runaway limit.',
      refs: ['Kasting 1988', 'Kopparapu et al. 2013']
    },
    {
      id: 'habitable', name: 'Habitable (temperate)', color: '#5eead4',
      cond: 'Liquid ocean, surface between ~273 and 300 K, little ice',
      desc: 'A temperate planet with liquid water, a carbon cycle that holds the climate steady, and little ice.',
      why: 'Planetary CO2 is set by volcanic outgassing against silicate weathering, which slows as the planet cools and speeds up as it warms.',
      refs: ['Walker et al. 1981', 'Kasting 1993']
    }
  ];

  var BY_ID = {};
  CATALOG.forEach(function (s) { BY_ID[s.id] = s; });

  // Sources for the model and the state descriptions. Full notes: docs/science.md.
  var REFERENCES = [
    'Braun et al. (2022). Nature Geoscience. doi:10.1038/s41561-022-00950-1.',
    'Budyko, M. I. (1969). The effect of solar radiation variations on the climate of the Earth. Tellus 21, 611-619.',
    'Caldeira, K. & Kasting, J. F. (1992). The life span of the biosphere revisited. Nature 360, 721-723.',
    'Cowan, N. B. & Abbot, D. S. (2014). Water cycling between ocean and mantle: super-Earths need not be waterworlds. ApJ 781, 27.',
    'Feulner, G. (2012). The faint young Sun problem. Reviews of Geophysics 50, RG2006.',
    'Gough, D. O. (1981). Solar interior structure and luminosity variations. Solar Physics 74, 21-34.',
    'Goldblatt, C., Robinson, T. D., Zahnle, K. J. & Crisp, D. (2013). Low simulated radiation limit for runaway greenhouse climates. Nature Geoscience 6, 661-667.',
    'Hamano, K., Abe, Y. & Genda, H. (2013). Emergence of two types of terrestrial planet on solidification of magma ocean. Nature 497, 607-610.',
    'Hoffman, P. F., Kaufman, A. J., Halverson, G. P. & Schrag, D. P. (1998). A Neoproterozoic snowball earth. Science 281, 1342-1346.',
    'Ingersoll, A. P. (1969). The runaway greenhouse: a history of water on Venus. Journal of the Atmospheric Sciences 26, 1191-1198.',
    'Kasting, J. F. (1988). Runaway and moist greenhouse atmospheres and the evolution of Earth and Venus. Icarus 74, 472-494.',
    'Kasting, J. F., Chen, H. & Kopparapu, R. K. (2015). Stratospheric temperatures and water loss from moist greenhouse atmospheres of Earth-like planets. arXiv:1510.03527.',
    'Kopparapu, R. K. et al. (2013). Habitable zones around main-sequence stars: new estimates. ApJ 765, 131.',
    'Kopparapu, R. K. et al. (2014). Habitable zones around main-sequence stars: dependence on planetary mass. ApJ Letters 787, L29.',
    'Leconte, J., Forget, F., Charnay, B., Wordsworth, R. & Pottier, A. (2013). Increased insolation threshold for runaway greenhouse processes on Earth-like planets. Nature 504, 268-271.',
    'Luger, R. & Barnes, R. (2015). Extreme water loss and abiotic O2 buildup on planets throughout the habitable zones of M dwarfs. Astrobiology 15, 119-143.',
    'NASA. Mars Fact Sheet. nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
    'NASA. Venus Fact Sheet (updated 2024). nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html',
    'Pierrehumbert, R. T. (2010). Principles of Planetary Climate. Cambridge University Press.',
    'Pierrehumbert, R. T. (2011). A palette of climates for Gliese 581g. ApJ Letters 726, L8.',
    'Pierrehumbert, R., Abbot, D., Voigt, A. & Koll, D. (2011). Climate of the Neoproterozoic. Annual Review of Earth and Planetary Sciences 39, 417-460.',
    'Sellers, W. D. (1969). A global climatic model based on the energy balance of the Earth-atmosphere system. Journal of Applied Meteorology 8, 392-400.',
    'Valencia, D., O\'Connell, R. J. & Sasselov, D. (2006). Internal structure of massive terrestrial planets. Icarus 181, 545-554.',
    'Walker, J. C. G., Hays, P. B. & Kasting, J. F. (1981). A negative feedback mechanism for the long-term stabilization of Earth\'s surface temperature. JGR 86, 9776-9782.',
    'Wolf, E. T. & Toon, O. B. (2015). The evolution of habitable climates under the brightening Sun. JGR Atmospheres 120, 5775-5794.',
    'Wolf, E. T., Shields, A. L., Kopparapu, R. K., Haqq-Misra, J. & Toon, O. B. (2017). Constraints on climate and habitability for Earth-like exoplanets determined from a general circulation model. arXiv:1702.03315.',
    'Yang, J., Boue, G., Fabrycky, D. C. & Abbot, D. S. (2014). Strong dependence of the inner edge of the habitable zone on planetary rotation rate. ApJ Letters 787, L2.',
    'Yang, J., Peltier, W. R. & Hu, Y. (2012). The initiation of modern "soft snowball" and "hard snowball" climates in CCSM4. Climate of the Past 8, 907-918.',
    'Hays, J. D., Imbrie, J. & Shackleton, N. J. (1976). Variations in the Earth\'s orbit: pacemaker of the ice ages. Science 194, 1121-1132.',
    'Kasting, J. F. (1993). Earth\'s early atmosphere. Science 259, 920-926.'
  ];

  // Secondary descriptors that can apply on top of any state.
  function tagsFor(d) {
    var tags = [];
    var cfg = d.cfg;
    if (cfg.tidallyLocked) tags.push('Tidally locked');
    else if (d.rotationHours > 300) tags.push('Slow rotator');
    if (cfg.massE >= 2) tags.push('Super-Earth');
    if (cfg.massE <= 0.3) tags.push('Low gravity');
    if (d.escapeFlux > 0.05 * CM.RAD.PHI_E * d.gr) tags.push('Losing water');
    if (d.O2 > 1) tags.push('Oxygen build-up');
    if (d.pCO2 < 1e-5) tags.push('Carbon starved');
    if (d.foc > 0 && d.foc < 0.15) tags.push('Dry land');
    return tags;
  }

  function classify(d) {
    var id;
    var liquid = d.Wliquid > 0.001;
    if (d.T >= 1500 && (d.runaway || !liquid)) {
      id = 'lava';
    } else if (d.runaway) {
      id = d.Wliquid > 0.01 ? 'wet_runaway' : 'dry_runaway';
    } else if (liquid && d.T >= 300 && d.escapeFlux > 1e12) {
      id = 'moist';
    } else if (!liquid) {
      if (d.pCO2 > 5 && d.T > 400) id = 'venus';
      else if (d.Ptotal < 0.3 && d.T < 273) id = 'mars';
      else if (d.T < 273) id = 'dry_icehouse';
      else id = 'desert';
    } else if (d.fIce >= 0.9) {
      id = 'snowball';
    } else if (d.fIce >= 0.5) {
      id = 'eyeball';
    } else if (d.fIce >= 0.1) {
      id = 'icehouse';
    } else if (d.foc >= 0.95 && d.Wliquid > 2.5) {
      id = 'waterworld';
    } else if (d.Wliquid < 0.05) {
      id = 'desert';
    } else if (d.T >= 300) {
      id = 'hothouse';
    } else {
      id = 'habitable';
    }
    var s = BY_ID[id];
    return {
      id: id,
      name: s.name,
      color: s.color,
      cond: s.cond,
      desc: s.desc,
      why: s.why,
      refs: s.refs,
      tags: tagsFor(d)
    };
  }

  return {
    CATALOG: CATALOG,
    BY_ID: BY_ID,
    REFERENCES: REFERENCES,
    classify: classify,
    tagsFor: tagsFor
  };
}));
