# Rocky: pitch decision table (NASA Space Apps 2026, 7 minutes)

Judged on Impact, Creativity, Validity, Relevance, Presentation (1 to 5 each).
Rule for this sheet: say only what the app shows and the checks support. Every number below was verified this session.

Pending: CAPCOM, sand AI, chance-of-getting-home and turn-back advisor are being ported from TETHER. Leave them out until they are ported and pass the checks. Then add them to Table A.

## Table A. Put in the pitch

| Feature | Strong argument | Evidence | Likely judge question and answer | Criterion |
|---|---|---|---|---|
| Walk-home map (the core idea) | Apollo crews had to be able to walk back to the lander. Rocky turns that rule into a map: for every 3 m cell, how much suit time is left if you turn back there. | Planning grid 3 m, built on 1 m terrain. Real USGS/HiRISE ground at Curiosity's boxwork, Gale crater. | "Why not a circle around the base?" Hills and slopes make the walk home longer one way than the other. The safe zone follows valleys, not a radius. | Relevance, Impact |
| Walking model | The suit-time cost comes from a walking model we checked against NASA suited treadmill tests. | Within 13% of the tests. Average bias +2%. About 17% low at Mars gravity. | "How do you know astronauts tire like your model says?" We ran our model on the same conditions as the NASA tests. It is close overall, and low at Mars gravity, so we keep a 20% reserve. | Validity |
| Radiation sky-shelter | Next to a cliff, rock blocks part of the sky, so the dose drops. Rocky predicts this from terrain alone. | r = 0.993 vs Guo et al. 2026 at 15 sites. 1,298 RAD stops: measured change about 0.59x predicted; right direction 89% of the time where shelter is large. | "Does it match the real rover?" Yes in direction and in ranking. Our model over-predicts the size of the drop, so measured change is about 0.59x what we predict. We say so on the Evidence screen. | Validity, Creativity |
| Terrain-aware dose | Picking the route by terrain cuts radiation dose. | About 10% less dose from terrain. | "Is 10% worth it?" It costs nothing extra in suit time on the routes we tested, and dose adds up over a mission. | Impact |
| Autopilot | Rocky picks the stops and order that give the most science while keeping the walk-home rule at every step. | Exact search over all 2^11 = 2,048 target sets. Checked against brute force. | "Is this a heuristic?" No. With 11 targets we can check every set, and the test suite confirms it. | Creativity, Validity |
| Base siting | Rocky scores every candidate habitat site by how much science one safe walk can reach. | 3,372 sites on a 36 m grid. | "How would planners use this?" To compare landing or habitat sites before the mission, with the same rule the crew will follow. | Impact, Relevance |
| Storm drill | A solar storm gives a short warning. Rocky shows where the fastest walk home beats that warning. | Uses May 2024 DONKI events. | "Where does the warning time come from?" From real May 2024 events in NASA's DONKI database. The fastest walk home is our model. | Relevance, Impact |
| Test suite | Every core number is checked by code anyone can run. | 55 checks in verify/verify.ts (physics, Dijkstra vs Bellman-Ford, autopilot vs exhaustive, Mars clock). | "Can we trust the code?" Run one command and all 55 checks run. | Validity, Presentation |
| Honest labels | Every number on screen is marked measured, computed or assumed. | Evidence screen lists sources and limits. | "What is assumed?" A 6 h suit, a 20% reserve, 30 min per stop. You can change them in the app. | Validity, Presentation |

## Table B. Demo only, not a pitch claim

| Feature | Why demo only | How to show it without over-claiming |
|---|---|---|
| Crew down (#3) | Hauling pace 0.5 m/s is a placeholder, not measured. | Say "with an assumed hauling pace". Move the pace slider to show the answer depends on it. |
| 3D photos | Depth is AI-estimated. | Say "illustrative 3D from a single photo". |
| AR / Mars in the room (#7) | It is a rehearsal and outreach tool, not tested with crews. | "Crews and students could rehearse a walk on a table." |
| Walk mode (first-person game) | Uses the planner's numbers, but the game is a teaching view. | "Walk the same plan on foot; the margin shown is the plan's." |
| Atlas, globe arrival (#1) | Imagery and place names are NASA/USGS data, not our work. | "Built on NASA and USGS maps." Credit the sources. |
| Weather / conditions | Live feed display, no model of ours behind it. | "Current conditions from REMS, for context." |
| Radiation guess game (#5) | A good hook, but the game is not the evidence. | Let a judge guess, then point to the r = 0.993 and 0.59x numbers. |
| CAPCOM, sand AI, chance home, turn-back advisor | Not ported or verified in Rocky yet. | Show only if ported and checked before the pitch. Otherwise skip. |

## Table C. Do not mention

| Avoid | Safe alternative |
|---|---|
| "Guarantees the crew gets home" | "Keeps a planned way home with a 20% reserve, under our assumptions." |
| "Validated by NASA" / "NASA-approved" | "Checked against NASA treadmill tests and Curiosity's RAD data. Not affiliated with NASA." |
| "Accurate radiation dose" | "Predicts the direction and ranking of the shelter effect; it over-predicts the size (about 0.59x)." |
| "AI plans the walk" | "An exact search plans the walk." |
| "Real 3D photos" | "AI-estimated depth, illustrative." |
| "Tested with astronauts" / "crew-ready" | "A planning and rehearsal tool for mission planners, analog teams and students." |
| "Hauling a crewmate takes X minutes" as fact | "With an assumed pace of 0.5 m/s, it takes X." |
| "1 m planning resolution" | "Plans on a 3 m grid from 1 m terrain." |
| "Predicts solar storms" | "Uses real past storm warnings to drill the walk home." |
| "Works anywhere on Mars" | "Built for Curiosity's boxwork site; the method can move to other sites with the same data." |
| Any feature still pending (sand AI, chance home, CAPCOM, turn-back) | Leave out until verified. |

## Suggested 7-minute running order (Table A only)

Server: http://localhost:5175/

| Time | Segment | Say | Screen |
|---|---|---|---|
| 0:00-0:45 | Problem | Maps show what Mars looks like, not whether you can walk home. The Apollo rule. | http://localhost:5175/#1 (arrival dive to the site) |
| 0:45-1:45 | Walk-home map | Suit time left for every 3 m cell. Hills bend the safe zone. | http://localhost:5175/#2, then http://localhost:5175/#/dashboard?view=plan (shorten the suit time, verdict turns red) |
| 1:45-2:45 | Walking model | Within 13% of NASA suited treadmill tests; 17% low at Mars gravity, so we keep a 20% reserve. | http://localhost:5175/#6 |
| 2:45-3:45 | Radiation | r = 0.993 at 15 sites; 1,298 RAD stops, 89% right direction, about 0.59x size. Terrain saves about 10% dose. | http://localhost:5175/#5, then http://localhost:5175/#/dashboard?view=evidence |
| 3:45-4:45 | Autopilot and base siting | Exact over 2,048 target sets. 3,372 habitat sites scored at 36 m. | http://localhost:5175/#/dashboard?view=autopilot, then http://localhost:5175/#4 |
| 4:45-5:30 | Storm drill | Fastest walk home vs the warning, May 2024 DONKI events. | http://localhost:5175/#/dashboard?view=storm |
| 5:30-6:15 | Trust | 55 checks anyone can run. Every number marked measured, computed or assumed. Assumptions: 6 h suit, 20% reserve, 30 min per stop. | http://localhost:5175/#/dashboard?view=evidence (or a terminal running the checks) |
| 6:15-7:00 | Impact and close | Who it helps: mission planners, crews rehearsing, analog teams, students. One sentence close. | http://localhost:5175/#/dashboard?view=plan |

Keep 10 to 15 seconds of slack. If time runs short, drop the base siting half of 3:45-4:45 first.
