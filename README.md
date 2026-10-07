# ClimateHaiku

A browser game about the climate of a rocky planet. Choose a planet's mass, water, gases, orbit, rotation and carbon cycle, then run time forward and watch it drift between climate states: snowball, eyeball, habitable, hothouse, moist greenhouse, wet and dry runaway, Venus-like, Mars-like, desert, waterworld, and more.

There is no build step. Open `index.html` in a browser, or serve the folder with any static server.

## Running

```sh
open index.html          # or: python3 -m http.server, then visit http://localhost:8000
node --test tests/climate.test.js
```

The tests need Node 18 or newer (`node:test`). They run the physics anchors, the state transitions and the timing rules in a few seconds.

## What you can change

- **Planet:** mass (0.1–5 Earth masses; radius follows R ≈ M^0.27), water inventory (in Earth oceans, TO), rotation period, tidal locking.
- **Star and orbit:** star type, orbital distance, Sun-like brightening (Gough 1981), an orbital sunshade.
- **Atmosphere:** CO₂ partial pressure, methane, nitrogen and oxygen inventories, sustained sulphate aerosol.
- **Carbon cycle:** volcanic outgassing and silicate weathering.
- **Management actions:** comet water delivery, draining the ocean, volcanic CO₂ bursts, scrubbing CO₂, sulphate injection, sunshade on/off.
- **Time:** pause, and run at 1 yr/s up to 1 Gyr/s. A slider sets any rate in between.

Keyboard: `Space` pauses; `1`–`5` set the rate.

## Layout

```
index.html            page layout (no build step)
css/style.css         styles
js/climate.js         physics: energy balance, greenhouse, water, carbon, escape, clock
js/states.js          climate-state classifier and state catalogue
js/presets.js         preset worlds (each starts in the state it is named after)
js/render.js          planet view and charts (canvas)
js/app.js             controls, fixed-step loop, readouts, timeline
tests/climate.test.js physics and timing tests
docs/science.md       equations, calibration, timescales and references
```

Scripts are plain browser scripts, so they also load over `file://`. `climate.js`, `states.js` and `presets.js` also run under Node, which is how the tests use them.

## Time and refresh rate

The physics advances in whole steps. The step size depends only on the simulated rate, never on the frame rate. Each animation frame adds `rate × wall-clock time` to an accumulator and runs the whole steps that fit. So the same simulated time gives the same result on a 60 Hz or a 144 Hz display, and the planet's animation speed is also tied to wall-clock time.

## Model in brief

A global-mean energy balance: absorbed sunlight against outgoing longwave radiation, with a gray-atmosphere greenhouse fitted to Earth, Mars and Venus, the water-vapour saturation law (IAPWS), an ocean and steam energy budget, an outgoing-flux limit that defines the runaway greenhouse, a carbonate–silicate thermostat, hydrogen escape that slowly removes water and leaves oxygen behind, and Gough's solar brightening law. `docs/science.md` gives the equations, the calibration, the timescales and the sources. Where the model departs from published values (the gravity effect on the runaway edge, the moist onset, the waterworld threshold and the snowball fold), that note says so.

This is a teaching model. It is not a 3-D climate simulation, and it is least certain between about 0.1 and 10 bar of CO₂.
