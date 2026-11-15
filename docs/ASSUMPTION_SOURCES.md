# Rocky: sources for the model assumptions

Checked 2026-11-15. This file adds to docs/SOURCES.md and does not repeat it. A source is cited here only if it was opened (the PDF text was read) or its DOI was confirmed through Crossref. Where neither was possible, the entry says so.

Verdicts: **STRONGLY BACKED**, **PARTLY BACKED**, **NO SOURCE EXISTS** (no source found in this pass).

## Key primary sources opened

- **[B70]** Benjamin & Bottomley (Bellcomm), 1970, NTRS 19700009560. The full PDF text was read.
- **[CONOPS]** NASA, *Exploration EVA System Concept of Operations Summary for Artemis Phase 1 Lunar Surface Mission*, EVA-EXP-0075, Feb 2020. https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf. The PDF text was read.
- **[P77]** Pandolf, Givoni & Goldman 1977, J Appl Physiol 43(4):577-581, doi:10.1152/jappl.1977.43.4.577 (confirmed through Crossref).
- **[SG72]** Soule & Goldman 1972, *Terrain coefficients for energy cost prediction*, J Appl Physiol 32(5):706-708, doi:10.1152/jappl.1972.32.5.706 (confirmed through Crossref).
- **[W49]** Weir 1949, J Physiol, doi:10.1113/jphysiol.1949.sp004363 (confirmed through Crossref).

## 1. 6 h EVA duration (src/store.ts:55 `evaHours: 6`)

**What the sources say:**
- [CONOPS]: "Supports EVAs of up to 8 hours in duration (6±2 hours)". It also lists "6 hours (egress to ingress)" for each Artemis EVA.
- [B70], Apollo J-mission rule: "Maximum continuous time in a pressurized suit shall not exceed 5 hours for a nominal EVA mission and 6 hours in case of an emergency."

**Verdict: STRONGLY BACKED.** Keep the value.

**Say:** "Six hours is NASA's nominal Artemis EVA length: the Exploration EVA ConOps says 6 plus or minus 2 hours."

## 2. 20% reserve (src/store.ts:55 `reservePct: 20`)

**What the sources say:**
- [B70] does not use a percentage reserve. Its rule is: "In event of an LRV failure, the crewmen shall be able to walk back to the LM on the consumables remaining in the PLSS." So the reserve is whatever the walk home costs.
- [CONOPS] gives the same kind of rule: rover range is "limited by a fully recharged suit walk back".

No percentage margin was found in either source.

**Verdict: PARTLY BACKED.** The walk-back principle is directly sourced. The 20% figure is ours.

**Say:** "Apollo's rule was that the crew must always be able to walk home on what is left in the backpack. We add a 20 percent buffer on top of that, and that buffer is our own choice."

## 3. 30 min science per stop (src/store.ts:55 `workMinPerStop: 30`)

**What the sources say:**
- [B70] Table 1: 0.25 h (15 min) of "site tasks". In the text, a typical rover traverse spends "15 minutes ... at each site", with 7 to 10 stations. Walking traverses cover "5 to 8 km" with "4 to 6 stations".

**Verdict: PARTLY BACKED.** Apollo planning used 15 min. Our 30 min is twice that, which is conservative for a sample stop.

**Option:** Set `workMinPerStop: 15` at src/store.ts:55 to match Apollo exactly, or keep 30 and present it as conservative.

**Say:** "Apollo planners budgeted 15 minutes per station. We allow 30, because Mars sampling is slower and more careful."

## 4. 30 min solar particle warning (src/store.ts:55 `flareLeadMin: 30`)

**What the sources say:**
- COSPAR/ILWS space weather roadmap (Schrijver et al. 2015, arXiv:1503.06135; found by search, not opened in full): for well-connected events, the fastest SEP arrivals can follow flare onset by only a few minutes.
- The HESPERIA REleASE forecasting system gave warnings of about 105 to 107 minutes, but at Earth, not Mars (arXiv:2502.15555; found by search).

No Mars-specific warning time was found. Mars has no dedicated flare monitor in place, so a real warning could be close to zero.

**Verdict: NO SOURCE EXISTS** for a fixed 30 min at Mars.

**Say:** "Warning time at Mars is not known. It can be minutes or more than an hour, so 30 minutes is a scenario setting you can change, not a forecast." Present it as a slider and keep 30 as the default.

## 5. 20° maximum slope (src/planner/physics.ts:36 `maxSlopeDeg: 20`; comment at :16)

**What the sources say:**
- [CONOPS]: "Walking up/down/across a slope of up to 20° and on traverses of up to 2 km away from the lander". It notes that "Apollo 15 traversed on slopes of ~17°".

**Verdict: STRONGLY BACKED.**

**Fix:** Update the comment at physics.ts:16 to cite "NASA EVA-EXP-0075 (2020)".

**Say:** "Twenty degrees is NASA's design slope for the Artemis suit, from the Exploration EVA ConOps."

## 6. 0.92 m/s pace cap (src/planner/physics.ts:37)

**What the sources say:**
- [B70] Table 1: walking at 4 km/h (1.11 m/s), both nominal and emergency. This figure is derated for loads, slopes and lunar surface.
- [CONOPS]: "Assumes ~2 km/hr walking pace on relatively level regolith" (0.56 m/s) for its 2 km walking range.

**Verdict: PARTLY BACKED.** 0.92 m/s (3.3 km/h) falls between the two NASA planning figures, 2 and 4 km/h. Neither source gives 0.92 exactly.

**Say:** "Our pace cap of 3.3 km/h sits between NASA's Artemis planning pace of 2 km/h and Apollo's 4 km/h."

## 7. Masses: body 80, suit 60, tools 15, samples 25 kg (src/planner/physics.ts:31-34)

**What the sources say:**
- [B70]: each astronaut may carry equipment "having a maximum total earthweight of 80 pounds" (36 kg). Our tools plus samples total 40 kg, so the two figures roughly match.
- The NASA EHP TechLeap rescue topic (ig.utexas.edu TDC-140, found by search) uses 250 kg for a suited incapacitated crewmember, which means suit plus body is about 250 kg. The SOURCES.md tests used a 121 kg Mark III suit.
- No NASA-STD-3001 anthropometry number was opened in this pass.

**Verdict: PARTLY BACKED** for the carried load. The 60 kg suit is low: Artemis-class suits are over 100 kg.

**Suggestion:** Set `suitMass` at physics.ts:33 to about 120 kg (Mark III, from the SOURCES.md tests), or label 60 as an assumption.

**Say:** "Apollo allowed about 36 kg of tools and samples per astronaut. We use 40."

## 8. Sand 1.8-2.1×, rock 1.3-2× energy factors

**What the sources say:**
- Pandolf's terrain coefficient η ([P77], with values from [SG72]): blacktop 1.0, dirt road 1.1, light brush 1.2, heavy brush 1.5, swampy bog 1.8, **loose sand 2.1**. The table was read through a secondary source (Wikipedia). The DOIs were confirmed, but the papers' own tables were not opened.
- There is no "rock" class in the table.

**Verdict: PARTLY BACKED.** Sand 2.1 is backed. 1.8 is the bog value, not a sand value. The rock range 1.3-2 has no source.

**Suggestion:** Use sand 2.1. For rock, either use 1.2-1.5 (the brush classes, by analogy) or label it as an assumption.

**Say:** "Loose sand costs about twice the energy of a paved road. That is the standard Pandolf/Soule-Goldman coefficient of 2.1."

## 9. Hauling an incapacitated suited crewmember

**What the sources say:**
- NASA EHP TechLeap topic (found by search): a 250 kg incapacitated suited crewmember, one healthy rescuer, no rover, and a "worst-case drag time of one hour".
- Haughton-Mars 2006 winch and litter test, NTRS 20060050772 (URL returns HTTP 200). It found that suit attachment points are critical.
- Walton, AsMA 2022, ICR and suited injury, NTRS 20220005724 (found by search).
- ESA's LESA device, tested at NEEMO-22 and NEEMO-23 (press coverage).

The ESA trainer quoted in that coverage says carrying a crewmate over the shoulder in a suit is not possible.

**Verdict: PARTLY BACKED** (feasibility and constraints). No sourced drag pace was found.

**Say:** "NASA's own requirement assumes one astronaut drags a 250 kg suited crewmate for up to an hour, so Rocky shortens the safe radius when someone must be hauled."

## 10. Science target ranking

No document was found in this pass that sets out how the MSL team ranks drill targets.

**Verdict: NO SOURCE EXISTS.**

**Say:** "Target values are our illustrative scores, not an MSL team ranking."

## 11. VO2 energy equivalent of 20.9 J/ml

**What the sources say:**
- Weir's equation [W49] gives about 3.94 kcal per litre of O2 plus 1.11 kcal per litre of CO2. This is roughly 20.2 kJ/L at RQ 0.82, rising to 21.1 kJ/L at RQ 1.0.

**Verdict: STRONGLY BACKED** as a standard value. 20.9 is the usual rounded figure and matches an RQ of about 0.95.

**Say:** "We convert oxygen to energy with the Weir equation: about 20.9 joules per millilitre of oxygen."

## 12. Bellcomm 1970 numbers (read from the PDF)

- Walking speed: **4 km/h**, nominal and emergency (Table 1).
  - Nominal walking: 1625 BTU/h, derated for load, slopes and surface.
  - Emergency walking: 1400 BTU/h, with any carried load abandoned.
- Rover: 5 or 10 km/h at 700 BTU/h.
- Overhead: 1.5 h. Site tasks: 0.25 h. ALSEP deployment: 1.0 h. All at 1100 BTU/h.
- Suit limits: 5 h nominal, 6 h emergency. Up to 80 lb of carried equipment.
- Walk-back rule: after an LRV failure, the crew walks back on the PLSS consumables that remain. After a PLSS failure, the crew returns on the SLSS.
- **There is no "30 min reserve".** That was an error in the search summary that SOURCES.md relied on. SOURCES.md §1 should drop the reserve claim and change "about 3 km/h" to "4 km/h".
- Walking traverses: 5 to 8 km total, 4 to 6 stations. A 10 km/h rover covers 10 to 15 km and 7 to 10 stations, with sites about 1.4 km apart.
- The authors' conclusion: relaxing the time-in-suit and emergency walkback constraints "would significantly increase the scientific return".
