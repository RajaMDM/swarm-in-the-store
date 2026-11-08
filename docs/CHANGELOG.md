# Changelog

Meaningful changes only. Newest first.

## 1.1.0 — 2026-11-08

Response to an external design review (Gemini). Every point was assessed; most were accepted.

**Changed**
- **Defects are now pure data.** Removed the engine's clean/dirty switch. System-of-record files (location, product masters) are separated from physical reality (new `planogram.json`, `pos-registers.json`). Defects are patches in `data/defects.json`. A test enforces that the engine contains no defect logic. *Impact: answers "rigged demo"; the cost of a defect now emerges from shoppers acting on wrong data.*
- **Defects unbundled** into independent toggles, plus a 2×2 defect matrix across 10 seeds with ranges and an automatic interaction readout (add up, compound or mask). *Impact: one seed was an anecdote; results now show variance and interactions.*
- **Two-tier governance.** Tier 1 structural checks (block the run); Tier 2 operational sync checks (product master vs planogram, lane status vs POS registers) that warn. *Impact: removes the contradiction of an all-green gate running on bad data.*
- **Framing:** signage, store app and the queue-call board are stated as the channels by which master data reaches shoppers. "Local rules only" wording corrected: navigation is global wayfinding, crowd behaviour is local.

**Added**
- Queue walkouts (segment patience; halved after a dead-lane detour).
- Illustrative item and order values; revenue captured and revenue at risk per hour.

**Found by the model**
- Stale aisle cut promo reach by about 40%, because Household traffic used to pass the promo stand.
- The two defects partly mask each other on queue wait, for spatial reasons.

## 1.0.0 — 2026-11-08

**Added**
- Browser demo: two store layouts, promo stand placement, 1–6 checkouts, arrival rate, seed, run length, speed and footfall heatmap.
- Master data quality switch with two defects (stale category location, phantom checkout lane).
- One-click *Compare clean vs dirty data* using identical shoppers, with a best/worst-highlighted comparison table.
- Eight master data governance checks that gate the Run button.
- Shareable URLs that reproduce a run exactly.
- 15 engine tests on Node's built-in runner; CI on every push.

**Fixed (before release)**
- Shopper gridlock behind a blocked corridor, which made dirty data look better than clean. *Impact: the demo's core comparison was wrong; it now consistently shows the cost of bad data.*
- Averages that ignored shoppers still in the store (survivorship bias).
- Time spent at a closed lane not counted as queue wait.
