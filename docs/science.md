# ClimateHaiku: the science behind the game

This note explains what the game models, the equations, how each parameter was set, and how the results compare with published work. It is a teaching model. It captures the feedbacks that produce the climate states, not the spectroscopy or 3-D dynamics of a research model. Where the model and the literature disagree, the disagreement is stated below.

**Source status.** Literature numbers are labelled:
- **checked**: read in an abstract, a full text or an HTML table for this note;
- **quoted**: taken from a secondary source or search summary that was read;
- **recalled**: from memory, not re-checked here;
- **not checked**: named in a literature survey, not read here, and not used in the model or the text.

Numbers marked **model** come from this code.

## 1. What is simulated

A rocky planet is treated as one global-mean column: one surface temperature `T`, one water inventory, one atmospheric carbon inventory, one oxygen inventory and one star. Time advances in years. The state is classified every frame (see `js/states.js`).

| Quantity | Symbol | Unit | Notes |
|---|---|---|---|
| Surface temperature | `T` | K | global mean |
| Water inventory | `W` | TO | 1 TO = one Earth ocean = 1.4×10²¹ kg |
| Carbon inventory (air + ocean) | `N_C` | Earth-bar | 1 Earth-bar = the CO₂ that would exert 1 bar on Earth |
| Oxygen inventory | `I_O2` | Earth-bar | left behind by escaping hydrogen |
| Star age | `t*` | Gyr | sets the luminosity |

Inventories are masses expressed as Earth-bars, so surface pressure is `p = I × g/g_E`. The same gas mass gives more pressure on a heavier planet.

## 2. Planet and star

- **Radius and gravity.** `R = M^0.27` (Earth radii), and `g = g_E M/R²`. The exponent lies inside the range 0.267 to 0.272 that Valencia, O'Connell & Sasselov (2006, checked, abstract-level) give for super-Earths.
- **Surface area** `A = 4πR²`.
- **Incident flux.** `S = L/d²` in Earth units, and `F_in = 1361 S` W m⁻², reduced by the sunshade fraction.
- **Luminosity evolution.** Gough (1981) law for a Sun-like star: `L(t*)/L_now = 1 / [1 + 0.4 (1 − t*/4.57)]`. Feulner (2012) quotes it as a present-day brightening of 1% per ~114 Myr (quoted; the 1% figure is a calculation from the law).
- **Orbital period** (for tidal locking): `P_orb = 365.25 d × √(d³/M*)`, with `M* = L^(1/3.5)`.
- **Rotation albedo.** Slow rotators build substellar cloud decks. Yang, Boué, Fabrycky & Abbot (2014, quoted from a summary of the paper) report that the starlight a slow spinner can tolerate is nearly double that of a fast spinner. Here the extra albedo ramps from 0 at 48 h to 0.08 at 1000 h (**model**). The size of the effect is not calibrated to Yang et al.

## 3. Energy balance

The column energy `E(T)` (J m⁻²), measured from 0 °C, is

```
E(T) = χ c_w (W_kg − m_v)(T − T₀) + m_v [L₀ + c_v (T − T₀)] + C_dry (T − T₀) + C_land (1 − f_oc)(T − T₀)
```

- `m_v`: water vapour mass per area (kg m⁻²); `W_kg`: total water per area; `f_oc`: ocean fraction.
- `χ = 0.25`: the share of ocean heat capacity that exchanges on decade-to-century timescales (**model**). This gives an Earth response time of about 58 yr.
- `L₀ = 2.5×10⁶ J kg⁻¹`, `c_w = 4186 J kg⁻¹ K⁻¹`, `c_v = 2000 J kg⁻¹ K⁻¹`.

The net flux at the top of the atmosphere is `N(T) = F_abs(T) − OLR(T)` with `F_abs = F_in(1 − α)/4`. Each step solves the implicit balance

```
E(T_{n+1}) − E(T_n) = h · N(T_{n+1})
```

by Newton iteration with a bracketed fallback. Latent heat is held by the vapour inside `E`, so evaporating an ocean costs energy in proportion to its latent heat. The evaporation time of a runaway ocean therefore follows from energy conservation rather than from an assumed rate.

## 4. Outgoing longwave radiation and the runaway limit

The gray-atmosphere form is

```
OLR_gray(T) = σ T⁴ / (1 + ¾ τ)
```

with the optical depth split by gas (**model**, fitted to Earth, Mars and Venus):

```
τ_H2O = 0.225 ln(1 + p_H2O / 3.7×10⁻⁴ bar) + 0.0137 p_H2O²     (p in bar)
τ_CO2 = 7.76 p_CO2^0.635
τ_CH4 = 3.4 √p_CH4
τ_N2  = 0.04 p_N2
```

The water term has a log (line-wing) part and a quadratic self-continuum part, which matters only in steam. The CO₂ law is a power-law fit through the Earth, Mars and Venus anchors. It is least certain between about 0.1 and 10 bar.

**Runaway limit.** A water-vapour atmosphere cannot emit much more than about 280 W m⁻² (**model**, at Earth gravity). For comparison:
- Goldblatt et al. (2013), 1-D line-by-line, present Sun: 282 W m⁻² for a clear sky (checked); the earlier value they cite is 310 W m⁻² (Kasting 1988, quoted).
- Kopparapu et al. (2013): 291 W m⁻² with water-continuum absorption, against 440 W m⁻² without it (checked, arXiv).
- Leconte et al. (2013), 3-D with clouds: a runaway threshold near 375 W m⁻² of global-mean incident flux (checked, arXiv), which is about 1.10 S₀. This is higher than the 1-D value of 1.05 S₀ (Kopparapu et al. 2013), so the 1-D picture is not the last word.

The model uses

```
OLR_cap(g) = 280 W m⁻² × (g/g_E)^0.25 × max(1, T/1000 K)
```

as a soft limit. Where water dominates the optical depth (weight `w` from `τ_H2O/τ`):

```
OLR = (1 − w) OLR_gray + w · max( min(OLR_gray, OLR_cap), OLR_cap · clamp((τ − 1)/4) )
```

so thick steam emits near the limit rather than less. Without this plateau the outgoing flux falls as the optical depth grows, which is unphysical. Dense CO₂ atmospheres (Venus) are not limited, because `w ≈ 0`.

Gravity: Kopparapu et al. (2014, checked, ar5iv table) give runaway inner edges of 0.99, 1.107 and 1.188 S₀ for 0.1, 1 and 5 Earth masses. Relative to the Earth-mass edge, that is −10.6% and +7.3%, and the paper quotes about 10% and 7%. The model gives 0.909, 1.117 and 1.319 S₀ (bisection on the runaway flag, present composition): −18.6% and +18.1%. The sign of the model's `g^0.25` scaling agrees with the paper, but its size is 1.8 to 2.5 times theirs. The exponent was not fitted to their result.

A **runaway** is a state with no energy balance above the current temperature. In the code this means `N > 1 W m⁻²` at the current `T`, and no sign change of `N` at any temperature from `T` up to 800 K (sampled every 4 K up to 340 K, then coarser).

**Spread among published thresholds.** Kasting (1988, checked abstract) puts runaway at 1.4 S₀ and rapid water loss from 1.1 S₀. Kopparapu et al. (2013, checked) give 1.05 S₀ for runaway and 1.01 S₀ for the moist greenhouse. Kopparapu et al. (2014, checked) give 1.107 S₀ for an Earth-mass planet, and find their moist and runaway limits within 2% of each other. Wolf & Toon (2015, checked abstract) find no runaway through +21% S₀ in their model. The published range is therefore wide, and this is the largest single uncertainty in the model.

## 5. Albedo

```
α = α_surface + α_cloud + α_haze + α_rot + α_aerosol        (model)
```

- `α_surface`: ocean 0.06; land 0.22 (humid) to 0.28 (dry); ice 0.50, applied where there is water (`f_ice = iceCover(T) × min(1, 10 f_oc)`). Ice ramps from 233 K (fully ice-covered) to 283 K (ice-free). Over steam (`p_H2O > 0.5 bar` and `T > 450 K`) the surface is treated as dark, since cloud hides it.
- `α_cloud = 0.20 × min(1, RH/0.67) × (1 − 0.3 h_T) × (1 − 0.7 f_ice)`, with `h_T = clamp((T − 300)/35)`. Hot humid air loses part of its cloud albedo. This is a fitting choice, not a cloud scheme.
- `α_haze = 0.5 p_CO2/(p_CO2 + 5 bar)`: sulphuric haze on dense CO₂ worlds. This gives Venus an albedo of about 0.75 (the NASA Venus Fact Sheet gives a Bond albedo of 0.77, checked).

## 6. Water and hydrogen escape

- **Saturation vapour pressure.** IAPWS-95 Wagner form below the critical point (647.1 K). Above it the curve is continued as `p_c exp[8 (T/T_c − 1)]`, so water moves from liquid to vapour continuously.
- **Vapour in the air.** `m_v = min(W_kg, RH_eff · p_sat(T) · 10⁵ / g)`, with `RH_eff = max(RH(f_oc), clamp((T − 450)/100))`. Hot air is saturated with steam, so water is never pushed back into a liquid it has just left.
- **Relative humidity.** `RH = 0.25 min(1, f_oc/0.01) + 0.5 √f_oc`. Trace water gives almost no humidity. Earth's ocean (`f_oc ≈ 0.71`) gives RH ≈ 0.67.
- **Ocean fraction.** `f_oc = min(1, 0.71 W_liquid^0.6)` (**model**). This reaches 95% at about 1.6 TO and 100% at about 1.8 TO, so the model has no exposed land above about 1.8 TO. Cowan & Abbot (2014) find that exposed land persists up to a water mass fraction of about 0.2%, which is 8 to 9 TO for an Earth-mass planet (section 8).
- **Hydrogen escape.** Once water reaches the stratosphere, hydrogen escapes at a diffusion-limited flux:

  ```
  φ(T) = 1.8×10¹³ H cm⁻² s⁻¹ × (g/g_E) × 1/[1 + exp(−(T − 310 K)/1 K)]      (× 4 in a runaway)
  ```

  The constant is the middle of the range from Luger & Barnes (2015, checked, arXiv). Their diffusion limit is `F = b g (m_O − m_H)/[k T (1 + X_O/X_H)]` with `b = 4.8×10¹⁷ (T/K)^0.75 cm⁻¹ s⁻¹`. At T = 400 K and Earth gravity it gives 1.9×10¹³ (for X_O/X_H = 0) to 1.3×10¹³ (for X_O/X_H = ½). The flux is proportional to gravity in their formula, so in this regime lighter planets lose water more slowly. The ×4 factor in a runaway is a **model** assumption for hydrodynamic-like escape of a steam column.
- **Water loss.** Each lost H₂O removes two H atoms, so `dW/dt = −φ × 1.4958×10⁻²² kg m⁻² s⁻¹ × A / (1.4×10²¹ kg)` TO s⁻¹. At Earth gravity the diffusion-limited rate removes one Earth ocean in about 3×10⁷ yr. Luger & Barnes (2015) and Wolf et al. (2017) both note that this is a lower bound on the time, because supply of water to the stratosphere is ignored.
- **Oxygen.** Each lost H₂O leaves half an O₂ molecule behind, so one TO releases about 240 bar of O₂ on Earth gravity if nothing consumes it. Luger & Barnes (2015, checked) give 120 bar (energy-limited) to 240 bar (diffusion-limited) for Venus's lost water. The model has no oxygen sink, so its O₂ values are an upper bound.

**Onset temperature.** The model's onset is 310 K at the surface (**model**). Published onset values are higher: 330 K (Wolf et al. 2017, checked, arXiv:1702.03315), 340 K (Kopparapu et al. 2013, checked), and a stratosphere that warms above about 350 K (Kasting, Chen & Kopparapu 2015, checked, arXiv:1510.03527). The model's onset is 20 to 30 K too low. That is the main reason its moist window is narrow and sits just inside the runaway limit. Kopparapu et al. (2014, checked) find their own moist and runaway limits within 2% of each other in flux.

## 7. Carbon cycle

Atmospheric CO₂ is set by volcanic outgassing against silicate weathering (Walker, Hays & Kasting 1981; the journal details are checked, the equation is not).

- **Ocean storage.** `K(T) = 50 × W_liquid × exp[−0.035 (T − 288)]` (**model**). The ocean holds K times the air amount, and solubility falls with temperature (Henry's law). So `p_CO2 = N_C (g/g_E)/(1 + K)`.
- **Volcanism.** `V = 5.1×10⁻⁸ Earth-bar yr⁻¹ × (knob)`, about 0.05 bar per Myr today (**model**).
- **Weathering.**
  ```
  W = 1.76×10⁻⁷ × (knob) × (1 − f_oc) × min(RH/0.67, 1.5)
      × exp[(min(T, 330) − 288)/12] × (p_CO2/4.2×10⁻⁴ bar)^0.3
      × [p/(p + 10⁻⁵ bar)] / [normalisation] × rain(T)
  ```
  with `rain(T) = clamp((340 − T)/20, 0, 1)`: there is no rain-driven weathering in a steam atmosphere. The factor `p/(p + 10⁻⁵ bar)` is a biological floor (about 10 ppm, where photosynthesis is thought to stall; the value is from Caldeira & Kasting 1992, recalled, not re-checked). The normalisation keeps Earth's reference equilibrium unchanged. The 12 K e-folding is shorter than the 13.7 K that later papers give for this law (17.7 K if runoff is kept separate), so weathering here is about 14% more sensitive to temperature. Those values are quoted from later papers, not from the 1981 text.
- **Update.** `N_{n+1} = (N_n + h(V − W + s N_n))/(1 + h s)`, with `s = ∂W/∂N_C` evaluated locally. This is stable for any step size.

On Earth the thermostat has an e-folding time of about 1.4 Myr (**model**). Published estimates of the weathering response vary (roughly 0.1 to 1 Myr, recalled); the model is at the slow end.

## 8. Calibration and comparison with the literature

| Quantity | Target | Model | Status of the target |
|---|---|---|---|
| Earth surface temperature, 1 AU, 420 ppm CO₂ | ~288 K | 288.1 K | design target |
| Earth outgoing longwave flux | ~239 W m⁻² | 236 W m⁻² | observed |
| Earth albedo | ~0.30 | 0.306 | observed |
| Mars surface temperature | 214 K | 216 K | NASA Mars Fact Sheet, checked |
| Venus surface temperature | 737 K | 736 K | NASA Venus Fact Sheet, checked |
| Venus Bond albedo | 0.77 | 0.75 | NASA, checked |
| OLR limit (runaway) | 282 W m⁻² | 280 W m⁻² at Earth gravity | Goldblatt et al. 2013, checked |
| **Runaway edge, present Sun** | **S = 1.107** (Kopparapu et al. 2014, checked) | **S ≈ 1.117** | **model is within 1%**; 6% above the 2013 value of 1.05 |
| Runaway edge, 0.1 and 5 Earth masses | S = 0.99 and 1.188 (Kopparapu et al. 2014): −10.6% and +7.3% | S = 0.909 and 1.319: −18.6% and +18.1% | **model's gravity effect is 1.8 to 2.5 times too large** |
| **Moist greenhouse onset, surface** | **330 to 340 K** | **310 K** | **model is 20 to 30 K low** |
| Warm-to-snowball fold | 8 to 9% solar reduction at 286 ppm (CCSM4; Yang, Peltier & Hu 2012, checked) | 4% reduction (S ≈ 0.96) at 280 ppm | model glaciates with less cooling |
| Exposed land persists to | about 0.2% of planet mass, which is about 8 to 9 TO for an Earth-mass planet (Cowan & Abbot 2014, checked) | no land above about 1.8 TO (ocean law) | **model loses land about five times sooner** |
| Brightening to runaway, CO₂ held fixed | ~1 Gyr (Caldeira & Kasting 1992, checked abstract) | 1.2 Gyr | model; see section 9 |

These are checked by the test suite (`tests/climate.test.js`): the Earth, Mars and Venus anchors, the snowball bistability near today's Sun, the wet-runaway boil-off time, the thermostat, the Gough timescale, the frame-independent clock and the convergence of the implicit step.

## 9. Timescales: how long does a climate take to change?

The game is built around this question. Model numbers are shown beside the literature where a checked value exists.

| Process | Model | Literature | Notes |
|---|---|---|---|
| Surface temperature response | ~60 yr (Earth) | — | `χ c_w W / λ`; a deep ocean adds centuries |
| Carbon thermostat response | ~1.4 Myr (Earth) | ~0.1–1 Myr (recalled) | slower when weathering is weak |
| Brightening to runaway, CO₂ fixed | ~1.2 Gyr from today | ~1 Gyr (Caldeira & Kasting 1992, checked abstract); S = 1.10 at +1.0 Gyr (calc from Gough, quoted) | |
| Wet runaway: ocean to 0.01 TO | ~5 kyr at S ≈ 1.23 | no sourced value found | set by the energy excess |
| Moist greenhouse water loss | ~3.4×10⁷ yr per TO at 313 K (diffusion cap, a lower bound) | ~1 Gyr per Earth ocean at 355 K, supply-limited (Wolf et al. 2017, checked) | the literature range is about 3×10⁷ to 10⁹ yr |
| Dry steam to Venus-like | ~10⁷–10⁸ yr | up to ~100 Myr for planets inside ~0.8 AU (Hamano et al. 2013, checked) | |

**Brightening run (model, carbon cycle running).** The result differs from the fixed-CO₂ estimate:
- 0 to 1.1 Gyr: habitable, and the thermostat draws CO₂ down from 420 ppm towards 30 ppm. Surface temperature rises from 288 K to about 300 K.
- About 1.3 Gyr: moist greenhouse (about 307 K), with escape active.
- About 1.4 to 2.0 Gyr: the ocean is mostly lost at about 306 K. The escape flux there is a few per cent of its maximum.
- About 2.2 Gyr: a dry, CO₂-rich Venus-like state, after the volcanic CO₂ has built up.

In this run the planet never reaches a wet runaway. Caldeira & Kasting (1992, checked abstract) find that Earth may lose its water within a further ~1 Gyr, which is consistent with this sequence. The model's wet runaway is therefore not reproduced as the first step. This is a model result to check, not a conclusion.

**Two things follow.** Warm-to-runaway transitions are slow: the Sun brightens over Gyr, the carbon cycle adjusts over Myr, and water is lost over 10⁷ to 10⁹ yr. Once a planet crosses the runaway limit, the ocean boils away in thousands of years, which is fast next to everything else. Near a tipping point the adjustment slows (critical slowing), so a planet lingers near the edge before it moves on.

## 10. Preset worlds and the states they show

The classifier (`js/states.js`) works from the diagnostics:

- **Runaway** (`N > 1 W m⁻²` with no balance above the current `T`): wet if the ocean holds more than 0.01 TO, otherwise dry. At 1500 K or above, a runaway or dry surface is a lava world.
- **Moist greenhouse:** liquid ocean, `T ≥ 300 K`, and hydrogen escape above 10¹² atoms cm⁻² s⁻¹.
- **Hothouse:** liquid ocean, `T ≥ 300 K`, and escape below that threshold.
- **Venus-like:** no liquid, CO₂ above 5 bar, `T > 400 K`.
- **Mars-like:** no liquid, pressure below 0.3 bar, `T < 273 K`.
- **Snowball, eyeball, icehouse:** ice cover at least 90%, 50 to 90% and 10 to 50%.
- **Waterworld:** at least 95% ocean and more than 2.5 TO. The ocean law reaches 95% at about 1.6 TO, so the 2.5 TO guard sets the label.
- **Desert:** liquid below 0.05 TO, with ice cover below 10%.
- **Habitable:** liquid ocean, `T` below 300 K, little ice.

Preset values are in `js/presets.js`. Some presets start at Earth's orbit and are then pushed into their named state by a change of orbit, so the transition plays out in the simulation.

## 11. Limitations

- **Global mean only.** No latitude structure, no day–night structure beyond the rotation albedo term, and no ice-sheet dynamics.
- **Greenhouse fit.** The CO₂ and water terms are fitted to Earth, Mars and Venus. Between roughly 0.1 and 10 bar of CO₂ the fit is least certain. The hothouse preset is the warmest case that depends on it.
- **Runaway and moist edges.** The model's runaway edge (S ≈ 1.12) agrees with Kopparapu et al. (2014) to 1%, but its gravity dependence is 1.8 to 2.5 times theirs (section 4). Its moist onset (310 K) lies below the 330 to 350 K of the literature. Kopparapu et al. (2014) find their moist and runaway limits within 2% of each other, so a narrow moist window is also what their model gives. The model's window sits just inside its runaway edge.
- **Hydrogen escape.** Only diffusion-limited escape is modelled, plus a runaway factor. The flux is a constant times gravity, so water loss in a moist greenhouse is a lower bound on time. Supply limits and hydrodynamic escape from small planets are not modelled. Non-thermal escape of heavy gases (which shaped Mars) is not modelled either.
- **Snowball.** Bistability depends on the ice-albedo ramp and on the cloud term, not on an ice-line model. The warm-to-snowball fold (S ≈ 0.96) is easier to reach than the 8 to 9% solar reduction that CCSM4 needs at 286 ppm (Yang, Peltier & Hu 2012). The model's snowball is therefore easier to trigger than in that general circulation model.
- **Carbon.** Weathering and volcanism are single-box laws. There is no biology beyond a low-CO₂ floor, and no methane source.
- **Oxygen.** O₂ released by water loss has no sink, so its build-up is an upper bound.
- **Steam.** Above about 1000 K the emission limit is extrapolated, not computed. Lava and magma chemistry are not modelled.
- **Land and waterworlds.** The ocean-fraction law leaves no exposed land above about 1.8 TO. Cowan & Abbot (2014) keep exposed land up to about 0.2% of planet mass, which is about 8 to 9 TO for an Earth-mass planet. The 8 TO waterworld preset is therefore a fully ocean planet here, while the Cowan & Abbot threshold would still allow exposed land at that inventory. The 2.5 TO guard of the waterworld label is well below that threshold too.
- **Eyeball and waterbelt.** One global ice fraction cannot tell a substellar open pool (Eyeball Earth, Pierrehumbert 2011, which assumes tidal locking) from an equatorial waterbelt. Whether waterbelts form robustly is contested (Braun et al. 2022).
- **Desert.** Its trend (colder than a wet planet at the same distance) is a model result and was not checked against the literature in this session.

## 12. Sources

**Checked this session (abstract, full text or HTML table, with the link where one was given):**
- Goldblatt, C., Robinson, T. D., Zahnle, K. J. & Crisp, D. (2013). Low simulated radiation limit for runaway greenhouse climates. *Nature Geoscience* 6, 661–667. doi:10.1038/ngeo1892
- Kopparapu, R. K. et al. (2013). Habitable zones around main-sequence stars: new estimates. *ApJ* 765, 131. arXiv:1301.6674
- Kopparapu, R. K. et al. (2014). Habitable zones around main-sequence stars: dependence on planetary mass. *ApJ Letters* 787, L29. arXiv:1404.5292. Read in the HTML version: runaway inner edges of 0.99, 1.107 and 1.188 S_eff for 0.1, 1 and 5 Earth masses; the paper's own ~10% and ~7% mass dependence; moist and runaway limits within 2% of each other.
- Leconte, J. et al. (2013). Increased insolation threshold for runaway greenhouse processes on Earth-like planets. *Nature* 504, 268–271. arXiv:1312.3337
- Hamano, K., Abe, Y. & Genda, H. (2013). Emergence of two types of terrestrial planet on solidification of magma ocean. *Nature* 497, 607–610. doi:10.1038/nature12163
- Luger, R. & Barnes, R. (2015). Extreme water loss and abiotic O₂ buildup on planets throughout the habitable zones of M dwarfs. *Astrobiology* 15, 119–143. arXiv:1411.7412
- Wolf, E. T., Shields, A. L., Kopparapu, R. K., Haqq-Misra, J. & Toon, O. B. (2017). Constraints on climate and habitability for Earth-like exoplanets determined from a general circulation model. arXiv:1702.03315
- Kasting, J. F., Chen, H. & Kopparapu, R. K. (2015). Stratospheric temperatures and water loss from moist greenhouse atmospheres of Earth-like planets. arXiv:1510.03527
- Wolf, E. T. & Toon, O. B. (2015). The evolution of habitable climates under the brightening Sun. *JGR Atmospheres* 120, 5775–5794. doi:10.1002/2015JD023302 (abstract)
- Kasting, J. F. (1988). Runaway and moist greenhouse atmospheres and the evolution of Earth and Venus. *Icarus* 74, 472–494. doi:10.1016/0019-1035(88)90116-9 (abstract)
- Caldeira, K. & Kasting, J. F. (1992). The life span of the biosphere revisited. *Nature* 360, 721–723. doi:10.1038/360721a0 (abstract)
- Pierrehumbert, R. T. (2011). A palette of climates for Gliese 581g. *ApJ Letters* 726, L8. Read in the publisher's abstract: the Eyeball Earth case has a stable pool of open water centred on the substellar point, and the analysis assumes tidal locking.
- Yang, J., Peltier, W. R. & Hu, Y. (2012). The initiation of modern "soft snowball" and "hard snowball" climates in CCSM4. *Climate of the Past* 8, 907–918. Read in the abstract: runaway glaciation at an 8–9% solar reduction with 286 ppmv CO₂, or at 6% with 70–100 ppmv; CCSM3 needed 10–10.5% with 286 ppmv.
- Cowan, N. B. & Abbot, D. S. (2014). Water cycling between ocean and mantle: super-Earths need not be waterworlds. *ApJ* 781, 27. arXiv:1401.0720. Read in the abstract: exposed land persists when the water mass fraction is below about 0.2%, for planets of any mass.
- Valencia, D., O'Connell, R. J. & Sasselov, D. (2006). Internal structure of massive terrestrial planets. *Icarus* 181, 545–554. arXiv:astro-ph/0511150. Read in an abstract-level excerpt: R ∝ M^0.267–0.272 for super-Earths. A 2008 conference abstract by one of the authors gives 0.262; it is not used.
- NASA. Mars Fact Sheet. nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html. Read: average surface temperature about 214 K (−59 °C), surface pressure 6.36 mb, CO₂ 95.1% by volume.
- NASA. Venus Fact Sheet (updated 2024). nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html

**Quoted from a secondary source or search summary that was read:**
- Gough, D. O. (1981). Solar interior structure and luminosity variations. *Solar Physics* 74, 21–34. (as quoted by Feulner, G. (2012). The faint young Sun problem. *Reviews of Geophysics* 50, RG2006, arXiv:1204.4449)
- Yang, J., Boué, G., Fabrycky, D. C. & Abbot, D. S. (2014). Strong dependence of the inner edge of the habitable zone on planetary rotation rate. *ApJ Letters* 787, L2. Bibliographic details and the summary of results come from a search result; the paper itself was not read.
- Braun et al. (2022). *Nature Geoscience*, doi:10.1038/s41561-022-00950-1. From a search summary: the study concludes that waterbelts do not arise robustly or spontaneously under Neoproterozoic conditions. The author list and title were not read.
- Walker, J. C. G., Hays, P. B. & Kasting, J. F. (1981). *JGR* 86, 9776–9782. The journal details come from a bibliographic record. The law as restated in later papers has a CO₂ exponent of 0.3 and an e-folding of 13.7 K (17.7 K if runoff is kept separate). The 1981 text was not read.

**Recalled, not re-checked in this session:**
- Budyko, M. I. (1969). *Tellus* 21, 611–619. Sellers, W. D. (1969). *J. Appl. Meteorol.* 8, 392–400.
- Ingersoll, A. P. (1969). The runaway greenhouse. *J. Atmos. Sci.* 26, 1191–1198.
- Hoffman, P. F. et al. (1998). A Neoproterozoic snowball earth. *Science* 281, 1342–1346.
- Pierrehumbert, R. T. (2010). *Principles of Planetary Climate*. Cambridge University Press.
- Pierrehumbert, R., Abbot, D., Voigt, A. & Koll, D. (2011). Climate of the Neoproterozoic. *Annu. Rev. Earth Planet. Sci.* 39, 417–460. doi:10.1146/annurev-earth-040809-152447. The bibliographic record was checked; the content was not read.
- Cowan & Abbot, Valencia and Walker: see the checked and quoted lists above.
- Hays, J. D., Imbrie, J. & Shackleton, N. J. (1976). *Science* 194, 1121–1132. Kasting, J. F. (1993). *Science* 259, 920–926.

**Not checked, not used.** These were named in a literature survey and not read here. No number from them enters the model or the text. The survey's figures are listed only so that the claims are on record:
- Pierrehumbert et al. (2011): deglaciation near 3360 ppmv CO₂ at 94% of today's Sun, and initiation near 50 ppmv in a zero-dimensional model (claimed).
- Abe et al. (2011), habitable-zone limits for dry planets; Zsom et al. (2013), inner edge for dry planets.
- Nakayama et al. (2019); Kite & Ford (2018); Kitzmann et al. (2015).
- Anagnostou et al. (2016): about 1400 ppm CO₂ in the early Eocene (claimed).
- Zeng et al. (2016); Zahnle & Catling (2017).
- Wordsworth et al. (2013, 2017) and Ramirez et al. (2014), on early Mars.

**Not used:** Lebrun et al. (2013) (only conference abstracts were found).
