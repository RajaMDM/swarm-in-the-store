# Changelog

Meaningful changes only. Newest first.

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
