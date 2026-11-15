# Rocky: presentation brief

This file is the full brief for building Rocky's pitch deck. It's written for a new Claude session that has never seen the project. Read all of it before designing a slide: it says what Rocky is, what is proven, what is assumed, how to phrase each claim, what never to say, and how the deck should look.

Companion files in this folder:
- `PITCH_TABLE.md`: an earlier pitch / demo / do-not-say table. This brief supersedes it where they differ.
- `SOURCES.md`: the bibliography. Its §1 Bellcomm numbers are wrong; use §8 of this brief.
- `ASSUMPTION_SOURCES.md`: research on the input values.
- `screenshots/`: 15 screenshots of the app, plus `rocky-logo.png`.

---

## 1. The event and the judges

- **Event:** NASA Space Apps Challenge 2026, Tunis local event.
- **Challenge:** *Interplanetary Survival Guide: Martian Map*. Build a map that helps astronauts survive and work on the Martian surface. The challenge text says existing maps (Mars Trek, USGS) are built for regional views, not for the few kilometres a crew covers on foot.
- **Pitch format:** 7 minutes, then 3 minutes of questions.
- **Judging:** Impact, Creativity, Validity, Relevance and Presentation, each scored 1 to 5.
- **Audience:** NASA-affiliated scientists and engineers. They reward honesty about limits and punish over-claiming. Our strongest card is **Validity**: we checked our models against real NASA measurements and we say where they fall short.

## 2. What Rocky is (one paragraph)

Rocky is a planning tool for the first astronauts who will walk on Mars. For every 3 m square of a real place on Mars, it answers one question: **"If I walk here, can I still get back to the habitat before my suit runs out, with a safety margin?"**

The place is Curiosity's "boxwork" region on Mount Sharp, in Gale crater: a 3.2 km square mapped from NASA/USGS data at 1 m. Rocky shows the answer as a map, plans the best science walk that keeps the rule at every step, scores where to put the base, and drills emergencies (solar storm, a crew member collapsing).

**One-sentence version:** *"On the Moon, Apollo astronauts always had to be able to walk home. We turned that rule into a map of Mars, and we checked our map against real data from the Curiosity rover."*

**Logo:** a rock golem (`screenshots/rocky-logo.png`). The name is **Rocky**. Rocky grew out of the team's earlier app TETHER (Malek's work) and the team's own prototype, Marswalk.

## 3. The story arc

The deck should follow one story, not a feature list:

1. **Hook, the human question.** "You are 2 km from your habitat on Mars, carrying rock samples, with 90 minutes of suit left. Can you get home?"
2. **The gap.** Today's Mars maps show what the ground looks like. None tells a suited astronaut whether they can still get back from where they stand.
3. **The idea.** Apollo's walk-back rule: always be able to walk home on what's left in the backpack. It was a single distance on a checklist; Rocky makes it a map, for every point.
4. **Why Mars is harder.** Hills burn suit time, loads change (you return heavier with samples), radiation, and solar storms with little warning. So the safe zone follows the terrain, not a circle.
5. **The live demo** (section 7).
6. **Why you can trust it.** Each model was checked against NASA measurements: suit treadmill tests and Curiosity's radiation detector. We show where we're wrong.
7. **What it's for.** Mission planners choosing landing and habitat sites, crews rehearsing a walk, analog field teams, students.
8. **Close.** "The first people on Mars will need to know, at every step, that they can get home. Rocky shows them."

**Tone:** calm, precise, engineering. Short sentences. Numbers with units. No hype words (revolutionary, AI-powered, game-changing).

## 4. The core concept, explained simply (for a slide)

```
reserve at a point = (suit time − time already spent − time to walk home from here) ÷ suit time
```

- Suit time is **6 h**. The rule: at **every point** of the walk, if the crew turned back now, they'd arrive with at least **20%** left.
- The ground is a grid of 1066 × 1066 squares, 3 m each (≈ 1.1 million). One shortest-path search (Dijkstra), run backwards from the habitat, gives every square its walk-home time. Checking any route is then just reading values along it.
- **A step costs effort, not distance.** Walking speed depends on slope (Marquez 2008). Energy depends on slope, speed, mass and Mars gravity, 3.71 m/s² (Santee 2001). Both come from NASA/MIT's Pextant planner. Ground steeper than 20° is impassable.
- **Visual metaphor for the slide:** contour lines on a hiking map show height. Rocky's contour lines show **minutes to safety**.

## 5. Features to present (the pitch)

Each entry gives the claim, how to frame it, the evidence, the source, the likely judge question and the answer, and the screenshot to use.

### 5.1 Walk-home map and the walk-back rule (core)
- **Frame:** "We took the walk-back rule NASA used on Apollo, documented in a 1970 Bellcomm memo, and applied it to every 3-metre square of USGS's 1-metre terrain of Mount Sharp."
- **What's on screen:**
  - White lines = walk home every 10 minutes.
  - White boundary = the tether line, where the rule stops holding.
  - Red = beyond the tether.
  - Route profile at the bottom: the blue line is the reserve along the route and must stay above the red dashed 20% line. A green dot marks the worst point.
  - Big number: **"Tether holds 51%"** = the lowest reserve anywhere on the demo route.
- **Demo walk:** habitat at Curiosity's sol-4600 position. Four stops at real Curiosity targets: Altadena, Ayopaya, Nevado Sajama, Campo Marte. 2.04 km, 2 h 55 min of suit time, 90 m of climb.
- **Sources:** Bellcomm 1970 memo (NASA NTRS 19700009560); USGS MSL Gale 1 m DEM; HiRISE colour imagery (McEwen 2007).
- **Judge:** "Why trust the walk times?" → "They come from NASA/MIT's Pextant equations, and we tested them against NASA suit data (5.2)."
- **Screenshots:** `p-plan.jpg` (map), `s2.jpg` (3D, astronauts walking with "Walk home 6 min, Reserve 97%").

### 5.2 Walking-energy model, checked against people in suits
- **Frame:** "Every walk time comes from NASA and MIT's Pextant energy equations. We tested them against five NASA reports where people walked on a treadmill in a real 121 kg suit at Moon and Mars gravity: within 13% on average, bias +2%. At Mars gravity the model is about 17% low, which is exactly why we keep a 20% buffer."
- **Numbers:** 9 test conditions; average gap 13%; bias +2%; 5 of 9 predictions within the spread between NASA's own subjects. An optional "gravity-scaled" setting is 46% too low, so it stays off.
- **How measured watts are computed:** oxygen used × body mass × 20.9 J/ml ÷ 60 (Weir 1949).
- **Sources:** Marquez 2008 (doi:10.2514/1.26248); Santee 2001 (USARIEM, doi:10.21236/ADA394170); NASA suited treadmill reports 2007–2013 (Walkback test 2007, 10 km walkback 2008, Integrated Suit Tests 2009, Suit Test 2 slopes 2010, reduced-gravity analogs 2013), all on NTRS.
- **Judge:** "Is it valid on Mars?" → "No validated Mars-gravity walking model exists anywhere. Ours is about 17% low there; our 20% buffer covers it. We show this on screen."
- **Screenshot:** `s6.jpg` (treadmill rig, gauge "Rocky predicts 534 W, NASA measured 468 W", scatter chart).

### 5.3 Radiation: terrain sky shelter, checked against Curiosity's detector
- **Frame:** "Cosmic rays come from the whole sky, so a cliff that hides part of the sky lowers the dose. A 2026 peer-reviewed study measured this at Curiosity's parking spots. We rebuilt their method on the same NASA terrain and matched their sky-blocking at r = 0.993. Then we went further and compared against Curiosity's own radiation detector at 1,298 stops."
- **Numbers:**
  - r = 0.993 against Guo et al. 2026 at 15 sites (mean difference under 1 point).
  - 1,298 stops tested.
  - 89% of predictions go the right direction where the shelter is large (62 stops), after removing day-to-day space weather.
  - Maria Gordon Notch, sol 3324: 33.4% of the sky blocked; predicted −20.2% dose vs −19.3% measured.
- **Say up front:** on average the real change is **about 0.6×** what we predict, so we overestimate. The app now also shows the value corrected to match the detector. Terrain saves only around **10%** of the dose; the habitat is the real shelter.
- **Sources:** Guo et al. 2026, JGR Planets (doi:10.1029/2026JE009704); Hassler et al. 2014, *Science* (Curiosity's dose, 0.64 mSv/sol); RAD Level 2 data in NASA PDS.
- **Judge:** "So the terrain protects astronauts?" → "Only a little, about 10%, and our model overestimates it. That's why our storm drill sends the crew to the habitat."
- **Screenshot:** `s5.jpg` (astronaut under a dome showing the hidden sky, "33% of the sky blocked", guess-and-reveal quiz).

### 5.4 Autopilot: the best science walk, solved exactly
- **Frame:** "Choosing which targets to visit, and in what order, is a known optimisation problem: the orienteering problem. We solve it exactly. All 2,048 combinations of the 11 targets are checked with the best order for each, and the winner is re-walked square by square to prove the rule holds everywhere."
- **Do not call it AI.** Exactness is the selling point: a safety tool shouldn't guess.
- **Sources:** Held & Karp 1962; Golden et al. 1987 (orienteering problem).
- **Judge:** "Who decides what's valuable?" → "The ranking follows the mission's own choices: Curiosity drills only its highest-priority rocks, so drill sites rank highest. The exact values are an input a science team would set, and they're editable."
- **Screenshot:** `p-autopilot.jpg`.

### 5.5 Base siting: where to put the habitat
- **Frame:** "Mission planners choose landing and habitat sites by asking what the crew can reach. Rocky makes that measurable. For 3,372 flat spots (every 36 m, slope under 10°), it asks how much of Curiosity's real science one safe walk can reach. The targets are real places Curiosity studied; how much each is worth is a science-team input."
- **Demo result:** site A reaches 7 of 11 targets (value 51 of 75) with a 27% lowest reserve. The current habitat already ties the best (603 spots tie for the top value), so moving it gains nothing. That shows the tool tells the truth even when the answer is "don't move".
- **Present the method as the contribution, and the target values as settings.**
- **Screenshot:** `s4.jpg` (teal discs = scored sites, pins A and Now).

### 5.6 Solar storm drill
- **Frame:** "In May 2024 Curiosity measured the largest radiation dose of its mission, from a solar storm. When a storm's particles arrive soon after the flare, the only real defence is getting to shelter. Rocky answers: from where you are, can you reach the habitat in time? The warning time is a slider, because it varies from storm to storm."
- **On screen:** green = reaches the habitat within the warning; red = too far, needs a closer shelter. Demo: worst point 12 min from the habitat against a 30-min warning; 1.72 km², 25% of the walkable site, is inside.
- **It uses the fastest walk home (least time), not the least-effort one.** In an emergency you hurry.
- **Sources:** NASA's article on the May 2024 event (Curiosity measured 8.1 mGy); NASA DONKI space-weather database.
- **Careful:**
  - Present it as a drill, not live alerts.
  - The 30 minutes has no Mars source; call it "a scenario setting".
  - DONKI has no alert dated 20 May 2024, so don't call the listed DONKI entries "the event Curiosity measured".
- **Screenshot:** `p-storm.jpg`.

### 5.7 Chance of getting home (just added)
- **Frame:** "A plan says yes or no. Real people walk at different speeds and tasks run over. Rocky runs the walk 10,000 times with that variation and gives a probability. It's an estimate, and the variation ranges are shown."
- **Code checks:**
  - With no variation, it gives exactly the plan's verdict.
  - The same seed gives the same answer.
  - The fast formula matches the simulation.
- **Keep it short:** one sentence, a single supporting point. The variation ranges are partly assumed.

### 5.8 Honest labels and automated checks
- **Frame:** "Every number in Rocky is tagged measured (by an instrument), computed (by us from measured data) or assumed (a setting you can change). 74 automated checks re-run every claim: physics, path search against a brute-force search, autopilot against exhaustive search, the Mars clock, the validations."
- **Judge:** "What if your assumption is wrong?" → "It's a slider; change it and the whole map updates." Move the slider live.
- **Screenshot:** `p-evidence.jpg`.

## 6. Demo-only features (show them, never claim them as science)

| Feature | Why it's demo-only | How to show it |
|---|---|---|
| Crew-down drill (scene 3, `s3.jpg`) | No source gives a pace for hauling a suited person. NASA only requires that one rescuer can drag a 250 kg suited crew member for up to 1 h. Our 0.5 m/s is a placeholder. | "A what-if: how much the safe zone shrinks if one astronaut carries the other." |
| Turn-back advisor | Its decision table was solved offline for 9 of the 11 targets and the demo habitat only. | Mention it only if asked. |
| Sand vs rock (THEMIS night infrared) and the sand AI layer | Estimates. THEMIS pixels are about 80 m. The AI layer misses about 4 in 10 sand patches (59% recall). | "A layer that flags likely sand." No accuracy figures in the pitch. |
| CAPCOM voice assistant | A small language model in the browser; needs Chrome or Edge and a 0.9 GB download. Risky live. | Only if pre-loaded on the demo laptop; otherwise skip. |
| 3D rover photos | The depth is AI-estimated (Depth Anything V2), labelled "not measured". | "Look around inside a Curiosity photo." |
| AR / Mars in the room (scene 7, `s7.jpg`) | A rehearsal and outreach tool, not a calculation. | "Crews can rehearse the walk on a table before leaving Earth." |
| Helmet-view walk and voice alerts (`p-walk.jpg`) | A game on the same model; nothing new to defend. | A short visual moment. |
| Weather window | Real REMS data, but the curve through the day is an approximation. | Skip, or show briefly. |
| Atlas and globe intro (`p-atlas.jpg`, `s1-*.jpg`) | NASA imagery, not our work. | Use as the opening visual and for context only. |

## 7. Live demo script (about 90 seconds, local server http://localhost:5175/)

1. `#1`: the globe dive from orbit to the boxwork, about 11 s. "A real place, three NASA cameras."
2. `#2`: two astronauts walking; the card reads "Walk home 6 min, Reserve 97%". The panel says "Tether holds 51%".
3. `#/dashboard?view=plan`: the map with Curiosity's real path (white dotted line) and our route. Drag "EVA length" from 6 h down to about 2.5 h: the safe zone shrinks and the verdict turns red. **This is the money moment.**
4. `#/dashboard?view=autopilot`: "Find the best walk", the exact search.
5. `#/dashboard?view=storm`: the green area you can reach in time.
6. `#5`: radiation quiz. Guess, then reveal what Curiosity measured.
7. `#/dashboard?view=evidence`: the validation charts, dots on the diagonal.

**Backup plan:** if the laptop or wifi fails, use the screenshots in `screenshots/`. Rocky runs locally with no internet once loaded, except live NASA feeds, which fall back to cached copies.

## 8. Sources: what each one supports

| Claim | Source | Status |
|---|---|---|
| Walk-back rule | Bellcomm 1970 memo, NASA NTRS 19700009560. The real numbers from the PDF: walking speed **4 km/h** (nominal and emergency), suit time **5 h nominal / 6 h emergency**, each astronaut carries up to **36 kg (80 lb)**, **15 min** of tasks per station. **There is no "30-minute reserve" in it.** | Read in full |
| 6 h suit, up to 20° slope | NASA Exploration EVA ConOps for Artemis (EVA-EXP-0075, 2020): "EVAs of up to 8 hours (6±2)"; "walking up/down/across a slope of up to 20°" | Read in full |
| Walking speed vs slope | Marquez 2008, doi:10.2514/1.26248 | DOI confirmed |
| Walking energy | Santee 2001, doi:10.21236/ADA394170 | DOI confirmed |
| Planner implementation | NASA/MIT Pextant (GitHub) | Opened |
| Suit treadmill data | NASA NTRS reports, 2007–2013 (five reports) | Opened |
| Oxygen energy, 20.9 J/ml | Weir 1949 (20.2–21.1 kJ per litre) | DOI confirmed |
| Sand cost about 2× | Pandolf 1977 terrain coefficient (loose sand = 2.1); Soule & Goldman 1972 | DOI confirmed |
| Mars gravity 3.71 m/s², radius 3,389.5 km | NASA NSSDCA Mars fact sheet | Opened |
| Curiosity's radiation dose | Hassler et al. 2014, *Science*; RAD instrument paper Hassler 2012 | DOI confirmed |
| Terrain shielding | Guo et al. 2026, JGR Planets, doi:10.1029/2026JE009704 | DOI confirmed |
| Detector data | RAD Level 2, NASA PDS | Opened |
| May 2024 event | NASA article (8.1 mGy measured by Curiosity) | Opened |
| Imagery and terrain | HiRISE (McEwen 2007); CTX (Malin 2007); USGS 1 m Gale DEM; Viking MDIM; MOLA | Confirmed |
| Sand and rock from night temperature | THEMIS (Christensen 2004) | DOI confirmed |
| Weather | REMS (Gómez-Elvira 2012) | DOI confirmed |
| Mars clock | Mars24, Allison & McEwen 2000 | Confirmed |
| Autopilot | Held & Karp 1962; Golden 1987 | Confirmed |
| 3D photos | Depth Anything V2 (arXiv) | Opened |
| Crew rescue | NASA requirement: one rescuer drags a 250 kg suited crew member for up to 1 h. No walking pace exists. | NTRS records only |

## 9. Assumptions: how strong each one is, and the exact wording

| Input | Rocky value | Backing | Say |
|---|---|---|---|
| Suit duration | 6 h | **Strong.** NASA Artemis: 6±2 h; Apollo: 5–6 h | "Six hours, NASA's Artemis planning figure." |
| Max slope | 20° | **Strong.** NASA Artemis suit design slope | "Twenty degrees is NASA's design slope for the Artemis suit." |
| Reserve | 20% | **Partly.** The walk-back rule is real; the percentage is ours, justified by the model being ~17% low at Mars gravity | "Apollo's rule: always be able to walk home on what's left. Our 20% buffer is on top, and it covers the gap we measured in our own model." |
| Walking pace cap | 0.92 m/s | **Partly.** Between NASA Artemis (~2 km/h) and Apollo (4 km/h) | "Within NASA's and Apollo's range; adjustable." |
| Work per stop | 30 min | **Partly.** Apollo planned 15 min | **Don't mention it.** If asked: "Apollo planned 15 minutes; we use a conservative 30, and it's a slider." |
| Loads | 15 kg out, 25 kg back | **Partly.** Close to Apollo's 36 kg limit | "Close to Apollo's carry limit." |
| Suit mass | 60 kg | **Too light.** A real suit is about 120 kg; a fix to 120 kg is pending | Don't quote the suit mass. Walking times don't depend on mass in Rocky; only energy does. |
| Sand cost | 1.8× (THEMIS option) / 2.1× (AI layer) | Pandolf: loose sand = 2.1 | "Loose sand costs about twice the energy, Pandolf's standard coefficient of 2.1." |
| Solar warning | 30 min | **No source for Mars** | "Warning time at Mars isn't known, so 30 minutes is a scenario setting, not a forecast." |
| Science values | 1–10 per target | **No source** for the numbers; the ranking follows Curiosity's drill choices | "Illustrative values; the ranking follows the mission's drill choices; a science team would set them." |
| Hauling pace | 0.5 m/s | **No source** | Demo only. |

## 10. Never say this (and what to say instead)

| Don't say | Say instead |
|---|---|
| "every metre" | "every 3-metre square, on 1-metre terrain" |
| "oxygen remaining" | "suit time and energy" |
| "live solar alerts" / "predicts solar storms" | "a drill on a real 2024 event" |
| "accurate radiation dose" | "it gets the direction right; it overestimates the size, and we correct for that" |
| "terrain protects astronauts" | "terrain saves about 10%; the habitat is the shelter" |
| "AI plans the walk" | "an exact optimisation" |
| "validated by NASA" / "NASA-approved" / "crew-ready" | "checked against NASA measurements" |
| "works anywhere on Mars" | "works anywhere with a HiRISE terrain model, such as Jezero or the human landing candidates" (that's future work) |
| "it reproduces 37.9% exactly" | "33.4% vs the paper's 37.9% at the hardest site; r = 0.993 across 15 sites" |
| "the Apollo memo says a 30-minute reserve" | (it doesn't; see §8) |
| "real 3D photos" | "a depth estimate, labelled as not measured" |
| any number from the crew-down drill as a fact | "a what-if" |

## 11. Likely judge questions, with answers

- **"How is this different from Mars Trek or a route planner?"** → Trek shows layers, and JPL's tools plan rover paths. Neither models a suited human: suit time, the heavier return load, the walk-back rule at every step, storm reach.
- **"Is the walking model valid on Mars?"** → No validated Mars-gravity model exists. We tested ours against NASA suit treadmill data: 13% average gap, 17% low at Mars gravity, covered by the 20% buffer.
- **"How did you validate radiation?"** → The same terrain and method as a 2026 JGR Planets paper, r = 0.993; then 1,298 stops against Curiosity's detector. We overestimate, about 0.6×, and the app shows the corrected value.
- **"Why the boxwork?"** → It's the challenge's own example, Curiosity explored it in 2025–26, and it has the best data.
- **"Did you use AI to build it?"** → Yes, Claude for code, research and drafting; it's disclosed. All data is NASA/USGS, and every number is computed by our code and checked by tests.
- **"What's next?"** → Any site with a HiRISE terrain model (Jezero, the human landing candidates), real suit consumable rates, two-astronaut buddy limits, live space weather.

## 12. Suggested slide outline (7 minutes)

| # | Time | Slide | Content | Visual |
|---|---|---|---|---|
| 1 | 0:00 | Title | Rocky, the golem logo, team name, challenge name | `s1-orbit.jpg` as the full-bleed background |
| 2 | 0:15 | The question | "You are 2 km from your habitat, carrying samples, 90 minutes of suit left. Can you get home?" | `s1-arrive.jpg` (the boxwork square) |
| 3 | 0:45 | The gap | Maps show terrain, not whether you can get back | Side by side: a plain map vs Rocky's walk-home map |
| 4 | 1:15 | The idea | Apollo walk-back rule → a map; the reserve formula; "contour lines of minutes to safety" | `p-plan.jpg` cropped to the map |
| 5 | 1:45 | Live demo | Section 7, steps 1–3 (EVA slider moment) | Live |
| 6 | 3:15 | Plan smarter | Autopilot (exact, 2,048 combinations) and base siting (3,372 sites) | `s4.jpg` |
| 7 | 3:45 | Survive emergencies | Storm drill, with the May 2024 event | `p-storm.jpg` |
| 8 | 4:30 | Proof 1: walking | 13% vs NASA suit tests; 17% low at Mars → 20% buffer | `s6.jpg` + one big number |
| 9 | 5:15 | Proof 2: radiation | r = 0.993; 1,298 detector stops; we overestimate, so we correct | `s5.jpg` + one big number |
| 10 | 5:50 | Honest by design | Measured / computed / assumed; 74 checks; limits stated | `p-evidence.jpg` |
| 11 | 6:15 | Who it helps, what's next | Planners, crews, analog teams, students; Jezero, real suit rates | Simple list |
| 12 | 6:40 | Close | "The first people on Mars will need to know, at every step, that they can get home. Rocky shows them." | `s2.jpg` (two astronauts walking) |
| Backup | - | Appendix | Sources table (§8), assumptions table (§9), the demo-only features | - |

If time runs short, cut slide 6 (base siting) first, then shorten slide 7.

## 13. Visual direction

The team wants it **NASA-like, clean and not "vibe-coded"**. They explicitly rejected a navy/neon look.

- **Follow Rocky's own design, after NASA's Horizon Design System:** white pages, near-black text, neutral greys, a black top bar.
- **Colour only where it carries meaning:**
  - green `#00A91C` = safe / holds
  - red `#D83933` = beyond the tether / no-go
  - NASA blue `#005EA2` = data lines and links
  - amber `#E5A000` = caution
- **The Mars imagery is the only large area of colour.** Let the screenshots carry the slides.
- **Type:** Inter for headings and numbers, Public Sans for body text, DM Mono for small technical labels (sparingly).
- **One idea per slide:** one big number with a short label, or one screenshot with two or three annotations.
- **Annotate screenshots** with thin callout lines and plain labels such as "white dotted = Curiosity's real path", "white solid = our route", "red = beyond the tether".
- **Avoid:** emoji, gradients, rocket clip-art, dark neon, stock "space" photos, NASA logos or branding (the challenge forbids NASA logos).
- **Credit imagery** in a small footer line: "HiRISE: NASA/JPL/University of Arizona. Terrain: USGS."

## 14. Screenshots (`screenshots/`)

| File | Shows |
|---|---|
| `s1-orbit.jpg` | Mars globe from orbit, the headline "Can we still walk home?" |
| `s1-arrive.jpg` | End of the dive: the 3.2 km boxwork square at 6.4 km altitude |
| `s2.jpg` | Two astronauts walking the route; "Walk home 6 min, Reserve 97%"; "Tether holds 51%" |
| `s3.jpg` | Crew-down drill, step 1 |
| `s4.jpg` | Base siting: teal discs, pins A and Now, "7 of 11 targets" |
| `s5.jpg` | Radiation test at Maria Gordon Notch, "33% of the sky blocked" |
| `s6.jpg` | Suit test: treadmill rig, watts gauge, scatter chart |
| `s7.jpg` | Mars in the room: the terrain model on a table in a phone frame |
| `p-plan.jpg` | Planner map: Curiosity's path, our route, route profile, "Tether holds 51%" |
| `p-autopilot.jpg` | Autopilot panel |
| `p-storm.jpg` | Storm drill: green reachable area, "Shelter in time, 12 min" |
| `p-walk.jpg` | Helmet view with HUD |
| `p-atlas.jpg` | Mars atlas |
| `p-conditions.jpg` | Weather view |
| `p-evidence.jpg` | Evidence / validation view |

These screenshots predate the latest additions (chance of getting home, detector-corrected dose, sand AI layer, CAPCOM). Retake `p-plan.jpg` if you want those visible.

## 15. Project state, for reference

- **Code:**
  - repo GharsallahDev/tether-marswalk, branch `chedly`, folder `rocky/`
  - run with `npm run dev`; the app is at http://localhost:5175/
  - the latest merged work is local and not yet pushed
- **Pending decisions:**
  - fix suit mass to 120 kg and the THEMIS sand factor to 2.1 (walk times and the 51% stay the same; energy numbers rise)
  - push `chedly`
- **The old TETHER Team Guide PDF is out of date for Rocky:**
  - 9 → 11 targets
  - 512 → 2,048 combinations
  - 3 → 4 demo stops
  - its Bellcomm numbers are wrong
  - the AI features now exist in Rocky again, but are demo-only
- **The public site** gharsallahdev.github.io/tether still shows the old TETHER, not Rocky. Deployment is handled by another team member.
