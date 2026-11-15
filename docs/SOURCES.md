# Rocky: sources for every scientific claim

Checked 2026-11-15. Confidence levels:
- **Direct**: the source states the value or method that Rocky uses.
- **Partial**: the source supports the idea, but Rocky's exact number is not in it.
- **None**: no source was found, so the claim is an assumption.

"URL checked" means it returned HTTP 200 on that date, or that Crossref confirmed the DOI metadata (marked *Crossref*). Some publishers return 403 to scripts, but their DOIs still resolve in a browser. Nothing here was invented. Anything not verified is marked **UNVERIFIED**.

## 1. Walk-back rule (Apollo)

| Claim in Rocky | Source | What it supports | Confidence |
|---|---|---|---|
| "Apollo's walk-back rule": every stop must leave enough suit consumables to walk back to base (src/landing/Landing.tsx:58, src/scenes/s4.ts:2) | Benjamin, P. & Bottomley, T. A. (Bellcomm), 1970, *Evaluation of Mobility Modes on Lunar Exploration Traverses: Marius Hills, Copernicus Peaks, and Hadley Apennines Missions*, NASA NTRS 19700009560. https://ntrs.nasa.gov/citations/19700009560 (title and authors confirmed through the NTRS API) | Bellcomm analysis of the walkback and rideback constraints that set the LRV traverse envelopes. A search summary says it assumes about 3 km/h walking and a 30 min reserve. **I did not read the PDF, so check these numbers before quoting them.** | Partial |
| Same rule, how it was applied | Apollo 17 Final Lunar Surface Procedures, Vol. 2 (Contingency). https://pds-geosciences.wustl.edu/Lunar/urn-nasa-pds-apollodoc/document_a17/mission/a17_final_lunar_surface_procedures_vol2_contingency.pdf (found by search, not fetched) | Contingency walking-traverse procedures | Partial (UNVERIFIED) |
| Modern walkback test basis | Norcross, J., Stroud, L. C. et al., 2008, *The Effects of Terrain and Navigation on Human EVA Walkback Performance on the Moon*, NTRS 20080014286. https://ntrs.nasa.gov/citations/20080014286 | NASA walkback performance study | Partial |

## 2. Walking model (src/planner/physics.ts)

| Claim | Source | Supports | Confidence |
|---|---|---|---|
| The model is ported from Pextant (physics.ts:1) | NASA/MIT Pextant, github.com/norheim/pextant (checked) | The code that Rocky ported | Direct (code) |
| Speed vs slope, piecewise (physics.ts:43-49) | Marquez, J. J., 2008, *Design and Evaluation of Path Planning Decision Support for Planetary Surface Exploration*, J. Aerospace Computing, Information, and Communication, doi:10.2514/1.26248 (*Crossref*) | Path-planning decision support. **The coefficients come from Pextant's code. I did not check them against the paper.** | Partial |
| Energy: (3.28·m + 71.1)(0.661 cosθ + 0.115/v)·L, plus a slope term (physics.ts:69-73) | Santee, W. R. et al., 2001, *The Impact of Load and Grade on Energy Expenditure During Load Carriage, Part II: Field Study*, US Army USARIEM, doi:10.21236/ADA394170 (*Crossref*). The usual journal citation is Santee et al. 2001, Aviat. Space Environ. Med. 72(6) (**no DOI; UNVERIFIED**) | A load-carriage energy model on slopes | Partial (coefficients from Pextant) |
| Gravity used only in the lifting term; scaling level walking by (g/9.81)^0.5 (physics.ts:4-5) | none | Labelled as an assumption in the code | None (ASSUMED) |
| Pace cap 0.92 m/s (physics.ts:17,37) | none | | None (ASSUMED) |
| Maximum slope 20° ("lunar EVA ConOps", physics.ts:16) | no ConOps document found | | None. Cite it or label it assumed |
| Masses: body 80, suit 60, tools 15 out, 25 back (kg) (physics.ts:31-34) | none. The NASA tests in §3 used a 121 kg Mark III suit | | None (ASSUMED) |

## 3. NASA suited treadmill tests (scene 6, public/data/validation_walking.json)

All five NTRS links were checked (HTTP 200).

| ID in Rocky | Source |
|---|---|
| EWT-2007 | *The Walkback Test: A Study to Evaluate Suit and Life Support System Performance Requirements for a 10 km Traverse in a Planetary Suit*, NTRS 20070016007, https://ntrs.nasa.gov/citations/20070016007 |
| EWT-2008 | *Feasibility of Suited 10-km Ambulation "Walkback" on the Moon*, NTRS 20080014853, https://ntrs.nasa.gov/citations/20080014853 |
| IST-REVIEW-2009 | *Metabolic and Subjective Results Review of the Integrated Suit Test Series*, NTRS 20090007828, https://ntrs.nasa.gov/citations/20090007828 |
| IST2-TP (2010) | *Metabolic Costs and Biomechanics of Inclined Ambulation and Exploration Tasks in a Planetary Suit*, NTRS 20110003409, https://ntrs.nasa.gov/citations/20110003409 |
| ANALOGS-2013 | *Using Analogs for Performance Testing of Humans in Spacesuits in Simulated Reduced Gravity*, NTRS 20140002724, https://ntrs.nasa.gov/citations/20140002724 |
| Related (not cited in Rocky) | *Integrated Suit Test 1*, NTRS 20080013604, https://ntrs.nasa.gov/citations/20080013604 |

**Confidence: direct for the conditions, partial for the values.** The VO2 group means were read off chart markers by hand (the JSON says so). Each point records its page and figure.

**VO2 to watts at 20.9 J/ml O2** (validation_walking.json "j_per_ml"). This is the standard energy equivalent of oxygen, about 4.8 to 5.05 kcal/L depending on the respiratory exchange ratio, which gives about 20 to 21 J/ml. I did not verify a specific citation, so label it "standard physiology constant". Weir 1949 (J. Physiol. 109:1) is the usual reference (**UNVERIFIED**). Confidence: partial.

## 4. Terrain factor (sand and rock)

| Claim | Source | Confidence |
|---|---|---|
| Sand costs up to 1.8×, rock up to 2.0× (src/components/FlightPlan.tsx:81, src/ground.ts:8-9). The prototype used (1-0.45 sand)(1-0.5 rock) | Pandolf, Givoni & Goldman, 1977, *Predicting energy expenditure with loads while standing or walking very slowly*, J. Appl. Physiol. 43(4):577, doi:10.1152/jappl.1977.43.4.577 (*Crossref*). Pandolf's terrain factor η runs from 1.0 (treadmill) to about 2.1 (loose sand) (**I did not read the table**). | Partial. 1.8 and 2.0 are not Pandolf's values. Keep "ASSUMED" (the code already says so) and cite Pandolf only as the type of model |

## 5. Mars constants

| Claim | Source | Confidence |
|---|---|---|
| g = 3.71 m/s² (physics.ts:7) | NASA NSSDCA Mars Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html (checked) | Direct |
| Mean radius 3389.5 km (src/scenes/s1.ts:12, src/ground.ts:27, src/globe/marsGlobe.ts:49) | Same fact sheet: "Volumetric mean radius 3389.5" (checked) | Direct |

## 6. Radiation

| Claim | Source | Confidence |
|---|---|---|
| 0.64 mSv/day on open ground (src/planner/summary.ts:6) | Hassler, D. M. et al., 2014, *Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover*, Science 343, doi:10.1126/science.1244797 (*Crossref*) | Direct (0.64 ± 0.12 mSv/day; public_data/README_science.md:52) |
| RAD instrument | Hassler et al., 2012, *The Radiation Assessment Detector (RAD) Investigation*, Space Sci. Rev., doi:10.1007/s11214-012-9913-1 (checked) | Direct |
| Terrain shielding (sky blocked by terrain), horizon model, validation r = 0.993 (src/scenes/s5.ts:61, pipeline/validate_rad.py, Landing.tsx:67) | Guo, J. et al., 2026, *Influence of Mars Topography on Radiation Dose Detected by the Mars Science Laboratory and Assessment of Mars…*, JGR Planets, doi:10.1029/2026JE009704 (*Crossref*) | Direct for the method and the Table 1 ratios. r = 0.993 is Rocky's own result |
| RAD dose data | NASA PDS PPI, MSL RAD, https://pds-ppi.igpp.ucla.edu/mission/MSL/RAD (checked) | Direct |
| ~220 µGy/day corroboration | Guo et al., 2015, arXiv:1507.03473 (listed in README_science.md; not re-checked) | Partial |

## 7. Solar particle events

| Claim | Source | Confidence |
|---|---|---|
| 20 May 2024 event, 8.1 mGy at RAD | NASA, *NASA Watches Mars Light Up During Epic Solar Storm*, https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasa-watches-mars-light-up-during-epic-solar-storm/ (checked) | Direct |
| 30 min warning before particles arrive (src/store.ts:12,53) | none for Mars. The store comment says "tens of minutes" | None (ASSUMED). Do not present it as measured |
| DONKI SEP catalogue (public/data/space_weather.json) | NASA CCMC DONKI, https://kauai.ccmc.gsfc.nasa.gov/DONKI/ (timed out from here, so not checked). README_science.md:47 already warns that DONKI is centred on Earth and has no entry for 20 May 2024 | Partial |

## 8. Ground and imagery data

| Claim | Source | Confidence |
|---|---|---|
| THEMIS night IR: rock stays warm and sand cools (src/ground.ts:3-6) | Christensen, P. R. et al., 2004, *The Thermal Emission Imaging System (THEMIS) for the Mars 2001 Odyssey Mission*, Space Sci. Rev., doi:10.1023/B:SPAC.0000021008.16305.94 (checked) | Direct for the instrument and the thermal-inertia principle. The sand and rock split is Rocky's own derivation |
| USGS MSL Gale DEM Mosaic 1 m v3 | https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif (checked) | Direct |
| HiRISE | McEwen, A. S. et al., 2007, JGR Planets, doi:10.1029/2005JE002605 (*Crossref*) | Direct |
| CTX | Malin, M. C. et al., 2007, *Context Camera Investigation on board MRO*, JGR, doi:10.1029/2006JE002808 (*Crossref*) | Direct |
| Viking MDIM 2.1 colour, MOLA shaded relief | NASA Mars Trek layer IDs in src/globe/marsGlobe.ts:51-52. No journal paper was checked (MOLA: Smith et al. 2001, JGR, **UNVERIFIED**) | Partial (credit the data products) |

## 9. Time and weather

| Claim | Source | Confidence |
|---|---|---|
| Sol and LMST algorithm (src/marsclock.ts:1) | Allison, M. & McEwen, M., 2000, *A post-Pathfinder evaluation of areocentric solar coordinates…*, Planet. Space Sci., doi:10.1016/S0032-0633(99)00092-6 (*Crossref*). NASA GISS Mars24, https://www.giss.nasa.gov/tools/mars24/ (checked) | Direct |
| REMS weather (src/feeds.ts:10) | Gómez-Elvira, J. et al., 2012, *REMS: The Environmental Sensor Suite for the MSL Rover*, Space Sci. Rev., doi:10.1007/s11214-012-9921-1 (checked) | Direct |

## 10. Boxwork site and Curiosity targets

Curiosity mission blog posts on science.nasa.gov were found by search but not fetched one by one:
- Sols 4600-4601: https://science.nasa.gov/blog/curiosity-blog-sols-4600-4601-up-and-over-the-sand-covered-ramp/
- Sols 4627-4628: https://science.nasa.gov/blog/curiosity-blog-sols-4627-4628-a-ridge-stop-in-the-boxworks/
- Sols 4689-4694: https://science.nasa.gov/blog/curiosity-blog-sols-4689-4694-drill-in-the-boxwork-unit-is-go/
- Sols 4709-4715: https://science.nasa.gov/blog/curiosity-blog-sols-4709-4715-drilling-high-and-low-in-the-boxwork-unit

Confidence is partial. Each target in public/data/science_targets.json should link its own sol post.

The target point values (src/scenes/s4.ts:179) are Rocky's assumed weights. They have no source.

## 11. Hauling an incapacitated crew member (scene 3)

| Source | What it gives |
|---|---|
| Chappell, S. P., Scheuring, R. A. et al., 2007, *Haughton-Mars Project/NASA 2006 Lunar Medical Contingency Simulation: Equipment and Methods for Medical Evacuation of an Injured Crewmember*, NTRS 20060050772, https://ntrs.nasa.gov/citations/20060050772 | Analog evacuation methods |
| Walton, M., Norcross, J. et al., 2023, *EVA on the Lunar Surface: Mapping Mitigation Risk Consequence for Crew Needing Assistance or Rescue*, NTRS 20230005461, https://ntrs.nasa.gov/citations/20230005461 | Rescue risk framework |
| Morgan, K., Greene, B. et al., 2025, *South Pole Safety: Designing the NASA Lunar Rescue System*, NTRS 20250000528, https://ntrs.nasa.gov/citations/20250000528 | Rescue system design |

The NTRS records were confirmed through the API. I did not read the full texts and found no Mars hauling pace in them. **The 0.5 m/s hauling pace (src/scenes/s3-drill.ts:3, s3.ts:190) has no source.** The app already says so, which is correct. Confidence: none (ASSUMED).

## 12. Suit duration and reserve

| Claim | Source | Confidence |
|---|---|---|
| 6 h EVA (src/scenes/plan.ts:8, src/store.ts:53) | No source checked. ISS EVAs typically last about 6.5 h, and the xEMU/AxEMU target is about 8 h (**UNVERIFIED**) | Partial at best |
| 20% consumables reserve | No NASA document found that states 20%. Apollo used fixed time reserves (30 min per the Bellcomm summary above, UNVERIFIED) | None (ASSUMED planning margin) |
| 30 min work per stop | none | None (ASSUMED) |

## 13. Algorithms and AI

| Claim | Source | Confidence |
|---|---|---|
| Orienteering problem (src/planner/autopilot.ts:4) | Golden, B. L., Levy, L. & Vohra, R., 1987, *The orienteering problem*, Naval Research Logistics 34(3):307 (*Crossref*, doi:10.1002/1520-6750(198706)34:3<307::AID-NAV3220340302>3.0.CO;2-D) | Direct |
| Held-Karp subset DP (autopilot.ts:5) | Held, M. & Karp, R. M., 1962, *A Dynamic Programming Approach to Sequencing Problems*, J. SIAM 10(1), doi:10.1137/0110015 (*Crossref*) | Direct |
| Dijkstra cost fields (src/planner/fields.ts) | Dijkstra, 1959, Numer. Math. 1:269 (**UNVERIFIED** DOI 10.1007/BF01386390) | Direct (standard) |
| Depth Anything V2 for 3D photos (src/components/Photo3D.tsx:3, Drawers.tsx:37) | Yang, L. et al., 2024, *Depth Anything V2*, arXiv:2406.09414 (checked) | Direct. The app correctly labels the depth "illustrative" |
| DINOv2 ("sand AI") | Oquab, M. et al., 2023, arXiv:2304.07193 (checked) | **Not referenced anywhere in rocky/src or pipeline.** Do not claim it |
| Qwen 2.5 (CAPCOM) | Qwen Team, 2024, *Qwen2.5 Technical Report*, arXiv:2412.15115 (**not verified**) | **Not referenced anywhere in rocky/src or pipeline.** Do not claim it |

## 14. Claims to label "assumed" or drop

- **Pace cap 0.92 m/s**, physics.ts:37
- **20° maximum slope**, physics.ts:36. The "lunar EVA ConOps" citation was not found.
- **Masses** (80/60/15/25 kg), physics.ts:31-34
- **Level-walking gravity scaling (g/9.81)^0.5**, physics.ts:5. Already labelled.
- **Sand 1.8× and rock 2.0× walking cost**, FlightPlan.tsx:81. Already labelled.
- **Mission budget** (store.ts:53, plan.ts:8):
  - 6 h EVA: partial
  - 20% reserve: assumed
  - 30 min per stop: assumed
- **30 min SPE warning**, store.ts:53
- **0.5 m/s hauling pace**, s3-drill.ts:3. Already labelled.
- **Target science values**, s4.ts:179. Already labelled.
- **Partner mass in the rescue drill** ("same suit"), store.ts:85
- **Sand and rock placement inside each 80 m THEMIS pixel from terrain shape**, ground.ts:6. This is a derived heuristic.
- **Hand-read VO2 chart values** (scene 6). Keep the existing "read from charts" disclaimer.
