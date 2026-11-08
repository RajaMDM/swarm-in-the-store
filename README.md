# The Swarm in the Store

**A browser swarm simulation of shoppers in a retail store, driven by governed master data.**

▶ **[Live demo](https://rajamdm.github.io/swarm-in-the-store/)** · 📖 **[The article](https://www.linkedin.com/pulse/swarm-store-raja-shahnawaz-soni-bozof/)**

![Swarm in the Store demo](assets/screenshot.png)

Every shopper follows simple local rules and sees only the cells around them. Nobody plans the queues, hotspots or wasted walking: they emerge from the crowd. Change the store, then change the **master data**, and watch what happens.

> Emergence is only as true as the master data beneath it.

## What you can do

| Lever | What it changes |
| --- | --- |
| Store layout | Grid aisles or a racetrack loop, both read from the location master |
| Promo stand | Front of store, an end-cap or the back wall, or none |
| Open checkouts | 1 to 6 staffed lanes |
| Arrivals per minute | How busy the store is |
| **Master data quality** | **Clean, or dirty with two real-world defects switched on** |
| Seed | Same seed, same shoppers, same result |

Press **Compare clean vs dirty data** to run both scenarios instantly with identical shoppers, and see the cost of bad master data in one table.

### The two master data defects

1. **Stale category location.** The product master still lists *Household* in the snacks aisle after a refit. Shoppers search the wrong aisle; some find it, some give up (*lost items*).
2. **Phantom checkout lane.** The location master lists lane *L7* as open, but it was decommissioned. It looks empty, so shoppers queue there, wait, then rejoin a real lane at the back (*phantom detours*).

Typical result (grid layout, 3 lanes, 3 arrivals/min, seed 1989): dirty data adds about **10% to time in store**, more than **doubles average queue wait**, and loses **around 30 items** an hour. Run it yourself; the numbers are reproducible.

## How it works

```
data/                        Governed inputs ("the masters")
  location-master.json         store geometry, checkouts, promo slots
  product-master.json          categories and which shelf they live on
  customer-segments.json       shopper missions and behaviour
src/
  engine.js                  DOM-free simulation (runs in browser and Node)
  renderer.js                canvas drawing
  app.js                     levers, live metrics, run comparison
tests/engine.test.mjs        15 tests, Node's built-in runner, zero dependencies
```

- **Governance gate.** Before anything runs, eight checks validate the masters: rectangular grid, every category has a shelf, no orphan shelves, everything reachable, segment shares sum to 100%. Fail one and the Run button stays disabled.
- **Local rules only.** Each tick, a shopper compares its four neighbouring cells using a precomputed distance map and how crowded each cell is. Blocked shoppers sidestep, then squeeze through. No central planner.
- **Reproducible.** One seeded generator per concern (arrivals, shopper profiles, behaviour). Clean and dirty runs face the *same* customers, so differences come from the data alone.
- **Shareable.** Every setting lives in the URL. Copy the link and someone else gets your exact run.

## Run it locally

No build step and no dependencies. ES modules need a local server (opening `index.html` from disk will not load the data):

```bash
git clone https://github.com/RajaMDM/swarm-in-the-store.git
cd swarm-in-the-store
python3 -m http.server 8000      # then open http://localhost:8000
npm test                         # Node 20+
```

## Honest limits

- **Illustrative, not calibrated.** Arrival rates, dwell times and service times are plausible defaults, not measurements from a real store. Calibrate against footfall sensors and POS data before using numbers in a decision.
- **Grid movement.** Shoppers move cell to cell (about 1 m, 1 second per tick). Good enough for congestion patterns, not for fine-grained pedestrian dynamics.
- **Giving up saves walking.** In some runs dirty data shows slightly less walking, because shoppers who abandon a missing item skip that trip. The cost shows up as lost items instead.
- All names and data are fictitious.

## Built by

**Raja Shahnawaz Soni** · Enterprise data management practitioner · [LinkedIn](https://www.linkedin.com/in/raja-shahnawaz/) · [GitHub](https://github.com/RajaMDM)

*Built, not described.* MIT licensed.
