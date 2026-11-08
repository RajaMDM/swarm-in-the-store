# Tech Memory

*Decisions, patterns and gotchas, for future maintainers (and future Claude sessions).*

## Architecture

- **Zero-dependency static site.** `index.html` + ES modules in `src/` + JSON in `data/`. No bundler, no framework, no npm runtime dependencies. Hosted on GitHub Pages from `main` root.
- **Engine is DOM-free** (`src/engine.js`). The same module runs in the browser and in Node tests. Anything touching `window`/`document` belongs in `renderer.js` or `app.js`.
- **Belief vs reality.** System-of-record files (`location-master.json`, `product-master.json`, `customer-segments.json`) are what the store's systems believe. Reality files (`planogram.json`, `pos-registers.json`) are what is on the floor. Shoppers act on belief (signage from `product.aisle`, queue board from `checkout.status`) and collide with reality (stock per planogram, service only where a register exists).
- Grid digits are **fixture group codes**, not categories. The planogram maps fixture → category; the product master's `aisle` is where the signage *says* a category is.
- **Defects** are patches in `data/defects.json`, applied by `src/defects.js` to deep copies of the system-of-record files only. Path syntax: `key`, `key[*]`, `key[field=value]`, last segment = field. A patch that matches nothing throws.
- **Lanes:** the shift plan (`openCheckouts`) staffs the first N lanes that have a register. A lane without a register is called by the queue board only if its record says `open` (the zombie case). It never serves.

## Simulation model

- 1 tick = 1 second; 1 cell ≈ 1 metre.
- Navigation uses **BFS distance fields**, computed lazily per target (`fix:<fixtureCode>` = where the signage points, `cat:<categoryId>` = where it physically is, `svc:<laneId>`, `promo`, `exit`) and cached. Agents step to a neighbour with a lower distance, preferring less crowded cells (soft cap `CROWD_CAP = 3`).
- Shopping list order is greedy nearest-next by distance field.
- Queues are logical: once within `LANE_JOIN_DISTANCE` (3) of a service cell, an agent leaves the grid and joins `lane.queue`. The renderer draws queues along `queueDir`.
- **Walkouts:** at checkout choice, if the best queue length (including the person being served) ≥ the shopper's patience, they abandon the basket (`walkoutValue`). A dead-lane detour halves patience.
- **Validation** returns `{structural, operational}`. Structural failures disable Run; operational failures are warnings.

## Reproducibility

- Three independent `mulberry32` streams seeded from one seed: `rngArrive` (Poisson arrivals), `rngProfile` (segment, entrance, list, render jitter) and `rng` (behaviour). **Common random numbers** mean every defect combination gets identical shoppers. Do not draw arrival or profile randomness from `rng`, or comparisons stop being like-for-like.
- All settings serialise to the URL hash.

## Gotchas and past bugs (do not reintroduce)

1. **Gridlock from strictly-forward movement.** Agents originally only moved to cells with a lower distance and under the crowd cap. Shoppers paused at the phantom lane blocked a one-cell corridor and 60+ agents froze. Fix: escalate after `SIDESTEP_AFTER` (3) blocked ticks to equal-distance moves, and after `SQUEEZE_AFTER` (8) ignore the crowd cap. Guarded by the test "no gridlock".
2. **Survivorship bias in averages.** Time in store and queue wait were averaged only over finished shoppers, so a gridlocked run looked *better*. Fix: averages include in-store agents' elapsed time, and in-progress waits.
3. **Phantom time not counted as waiting.** The wait clock now starts at the first queue joined, phantom included (`a.queueJoin` set once).
4. **Random streams diverging between scenarios** made clean and dirty runs have different arrival counts. Fixed by the three-stream split above.
5. `node --test tests/` fails on Node 22 (treats the directory as a file). Use `npm test` (`node --test tests/*.test.mjs`).
6. ES modules and `fetch` do not work from `file://`. Always serve the folder.
7. **Zombie lane reduced walkouts** (v1.1 dev): an empty-looking dead lane absorbed shoppers who would otherwise balk. Fixed by halving patience after a dead-lane detour.
8. The engine-purity test strips comments before scanning for `dirty|clean|defect|stale|zombie|phantom`. Do not name engine variables after specific defects.
9. Re-rendered defect checkboxes detach DOM handles; browser test scripts must re-query after each click.

## Performance

A 60-minute run of ~200 shoppers runs headless in ~10–50 ms in Node, so the defect matrix (4 scenarios × 10 seeds = 40 runs) finishes in a couple of seconds in the browser.
