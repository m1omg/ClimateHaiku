/* ClimateHaiku - preset worlds. Each preset is a full configuration plus the
 * starting surface temperature, so the world starts in the state it is named after.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ClimateWorlds = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Shared defaults: an Earth-like planet around a Sun-like star at 1 AU.
  var BASE = {
    massE: 1,
    waterTO: 1,
    rotationHours: 24,
    tidallyLocked: false,
    starType: 'G',
    starLuminosity: 1,
    distanceAU: 1,
    evolveStar: false,
    starAgeGyr: 4.57,
    co2Partial: 4.2e-4,      // bar, atmospheric partial pressure
    ch4ppm: 1.9,
    n2Inv: 0.79,             // Earth-bar inventory
    o2Inv: 0.21,
    aerosol: 0,
    shade: 0,
    volcanism: 1,
    weathering: 1,
    initialT: 288
  };

  // settle: overrides used only for the initial equilibrium. Worlds that start
  // on the edge of a runaway settle at Earth's orbit first, so they do not arrive
  // already boiled off; the change of orbit then drives them into the state.
  function world(id, name, overrides, opts) {
    var cfg = {};
    Object.keys(BASE).forEach(function (k) { cfg[k] = BASE[k]; });
    Object.keys(overrides).forEach(function (k) { cfg[k] = overrides[k]; });
    cfg.initialT = (opts && opts.T) || cfg.initialT;
    return {
      id: id,
      name: name,
      blurb: (opts && opts.blurb) || '',
      settle: (opts && opts.settle) || null,
      cfg: cfg
    };
  }

  var PRESETS = [
    world('earth', 'Earth today', {}, {
      T: 288,
      blurb: 'Liquid ocean and about 420 ppm CO₂ (near today\'s level). The carbon cycle keeps the climate steady.'
    }),
    world('snowball', 'Snowball Earth', {
      distanceAU: 1.03, co2Partial: 1e-4
    }, {
      T: 225,
      blurb: 'Ice over the whole ocean. Ice albedo keeps it frozen. Only a big CO2 increase can melt it.'
    }),
    world('eyeball', 'Eyeball Earth', {
      distanceAU: 1.0, co2Partial: 3e-4
    }, {
      T: 253,
      blurb: 'Mostly frozen, with open water near the tropics. A transition state between snowball and habitable.'
    }),
    world('faint-sun', 'Faint young Sun', {
      evolveStar: true, starAgeGyr: 0.5, co2Partial: 0.03
    }, {
      T: 288,
      blurb: 'The Sun was about 25% dimmer 4 billion years ago. High CO2 is what kept early Earth from freezing.'
    }),
    world('brightening', 'Brightening Sun (1 Gyr)', {
      evolveStar: true, starAgeGyr: 4.57
    }, {
      T: 288,
      blurb: 'Set the clock to 1 Gyr per second and watch the Sun brighten about 10% per Gyr. The carbon thermostat holds for a while, then runs out.'
    }),
    world('moist', 'Moist greenhouse', {
      distanceAU: 0.9465, waterTO: 1
    }, {
      T: 288, settle: { distanceAU: 1 },
      blurb: 'Hot enough for water to reach the stratosphere. Hydrogen escape is slow (10^7-10^8 years per Earth ocean).'
    }),
    world('wet-runaway', 'Wet runaway greenhouse', {
      distanceAU: 0.9
    }, {
      T: 288, settle: { distanceAU: 1 },
      blurb: 'The planet gets more sunlight than a steam atmosphere can radiate. The ocean boils off over a few thousand years.'
    }),
    world('dry-runaway', 'Dry runaway greenhouse', {
      distanceAU: 0.9, waterTO: 0.01
    }, {
      T: 288, settle: { distanceAU: 1 },
      blurb: 'A runaway on a planet with little water. The ocean evaporates faster than hydrogen can escape, and the steam keeps the surface hot.'
    }),
    world('venus', 'Venus-like (dry, hot)', {
      massE: 0.815, waterTO: 1e-9, distanceAU: 0.723, co2Partial: 92, n2Inv: 3.2, o2Inv: 1e-6, ch4ppm: 0
    }, {
      T: 700,
      blurb: 'A dense CO2 atmosphere with a bright sulphuric cloud deck. This is the end state after the water is lost.'
    }),
    world('mars', 'Mars-like', {
      massE: 0.107, waterTO: 1e-4, distanceAU: 1.52, co2Partial: 0.0056, n2Inv: 0.0005, o2Inv: 0.0001, ch4ppm: 0
    }, {
      T: 215,
      blurb: 'Low gravity, a 6-millibar CO2 atmosphere and no liquid water. The surface is cold and dry.'
    }),
    world('desert', 'Desert world', {
      waterTO: 0.02, distanceAU: 0.95
    }, {
      T: 300,
      blurb: 'Only 2% of Earth\'s ocean. Little humidity, bright dry land and a weak water-vapour greenhouse.'
    }),
    world('waterworld', 'Waterworld', {
      massE: 2, waterTO: 8
    }, {
      T: 300,
      blurb: 'Deep global ocean around a 2-Earth-mass planet. Heat capacity is large and humidity is high, so it is more prone to overheating.'
    }),
    world('slow-rotator', 'Slow rotator', {
      rotationHours: 1000, distanceAU: 0.92
    }, {
      T: 288,
      blurb: 'A 42-day day. Clouds on the sunlit side brighten the planet, so it stays habitable closer in than Earth can (Yang et al. 2014).'
    }),
    world('tidal-m-dwarf', 'Tidally locked M-dwarf', {
      starType: 'M', starLuminosity: 0.03, distanceAU: 0.16, tidallyLocked: true
    }, {
      T: 288,
      blurb: 'A close orbit around a red dwarf. Tidal locking makes one face permanently day, with clouds keeping it habitable.'
    }),
    world('hothouse', 'Hothouse Earth', {
      co2Partial: 0.007
    }, {
      T: 300,
      blurb: 'About 17 times today\'s CO₂. Warm and humid with no ice, and the ocean is just starting to leak water (the greenhouse fit is least certain at higher pressures).'
    }),
    world('super-earth', 'Super-Earth ocean', {
      massE: 4, waterTO: 3, distanceAU: 1.0
    }, {
      T: 290,
      blurb: 'Four Earth masses and three oceans. Higher gravity holds a thicker atmosphere (about 2 bar here), and the deep ocean makes it a waterworld.'
    })
  ];

  function findPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return PRESETS[0];
  }

  return {
    BASE: BASE,
    PRESETS: PRESETS,
    findPreset: findPreset
  };
}));
