# Tech Memory

*Decisions, patterns and gotchas, for future maintainers (and future Claude sessions).*

## Architecture

- **Zero-dependency static site.** `index.html` + ES modules in `src/` + JSON in `data/`. No bundler, no framework, no npm runtime dependencies. Hosted on GitHub Pages from `main` root.
- **Engine is DOM-free** (`src/engine.js`). The same module runs in the browser and in Node tests. Anything touching `window`/`document` belongs in `renderer.js` or `app.js`.
- **Master data is the source of truth.** Layouts are ASCII grids in `data/location-master.json` (`#` wall, `.` floor, `E` entrance, `C` checkout, `K` collect, digits = shelf of that category code). Product categories map to shelf codes in `data/product-master.json`. Shopper behaviour lives in `data/customer-segments.json`.

## Simulation model

- 1 tick = 1 second; 1 cell ≈ 1 metre.
- Navigation uses **BFS distance fields**, computed lazily per target (`cat:<code>`, `svc:<laneId>`, `promo`, `exit`) and cached. Agents step to a neighbour with a lower distance, preferring less crowded cells (soft cap `CROWD_CAP = 3`).
- Shopping list order is greedy nearest-next by distance field.
- Queues are logical: once within `LANE_JOIN_DISTANCE` (3) of a service cell, an agent leaves the grid and joins `lane.queue`. The renderer draws queues along `queueDir`.
- Dirty data: `staleCode` on a product redirects its believed location; `phantomCheckouts` in the location master add lanes that look open but never serve.

## Reproducibility

- Three independent `mulberry32` streams seeded from one seed: `rngArrive` (Poisson arrivals), `rngProfile` (segment, entrance, list, render jitter) and `rng` (behaviour). **Common random numbers** mean clean and dirty runs get identical shoppers. Do not draw arrival or profile randomness from `rng`, or comparisons stop being like-for-like.
- All settings serialise to the URL hash.

## Gotchas and past bugs (do not reintroduce)

1. **Gridlock from strictly-forward movement.** Agents originally only moved to cells with a lower distance and under the crowd cap. Shoppers paused at the phantom lane blocked a one-cell corridor and 60+ agents froze. Fix: escalate after `SIDESTEP_AFTER` (3) blocked ticks to equal-distance moves, and after `SQUEEZE_AFTER` (8) ignore the crowd cap. Guarded by the test "no gridlock".
2. **Survivorship bias in averages.** Time in store and queue wait were averaged only over finished shoppers, so a gridlocked run looked *better*. Fix: averages include in-store agents' elapsed time, and in-progress waits.
3. **Phantom time not counted as waiting.** The wait clock now starts at the first queue joined, phantom included (`a.queueJoin` set once).
4. **Random streams diverging between scenarios** made clean and dirty runs have different arrival counts. Fixed by the three-stream split above.
5. `node --test tests/` fails on Node 22 (treats the directory as a file). Use `npm test` (`node --test tests/*.test.mjs`).
6. ES modules and `fetch` do not work from `file://`. Always serve the folder.

## Performance

A 60-minute run of ~200 shoppers runs headless in ~10–50 ms in Node, so "Compare clean vs dirty" runs instantly in the browser.
