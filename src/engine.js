/**
 * Swarm in the Store — simulation engine.
 *
 * DOM-free so the same code runs in the browser demo and in Node tests.
 * Every random draw comes from one seeded generator, so a given seed,
 * parameter set and master data always produce identical results.
 *
 * Model in one paragraph: the store is a grid read from the location master.
 * Shoppers arrive at the entrance, each with a mission from the customer
 * segment master. They walk to the shelves on their list (located via the
 * product master), dwell, may be pulled in by a promo stand, then queue at a
 * checkout and leave. No agent sees the whole store: each step only compares
 * neighbouring cells and how crowded they are. Congestion, queues and
 * hotspots emerge from those local decisions.
 */

/** Seconds of store time represented by one simulation tick. */
export const TICK_SECONDS = 1;

/** Cell types after parsing the location-master grid. */
export const CELL = Object.freeze({ FLOOR: 0, WALL: 1, SHELF: 2, COUNTER: 3, ENTRANCE: 4, PROMO: 5 });

/** More than this many shoppers in one cell and others route around it. */
export const CROWD_CAP = 3;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const UNREACHABLE = 1e9;
const LANE_JOIN_DISTANCE = 3;
/** Seconds a shopper stands at a closed lane before giving up on it. */
const PHANTOM_WAIT = [45, 90];
const SEARCH_RECOVERY_PROBABILITY = 0.55;
const SIDESTEP_AFTER = 3;
const SQUEEZE_AFTER = 8;

/**
 * Mulberry32: a small, fast, well-distributed seeded PRNG.
 * @param {number} seed Any integer.
 * @returns {() => number} Function returning floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parse an ASCII grid from the location master.
 * @param {string[]} rows Equal-length strings.
 * @returns {{W:number,H:number,type:Uint8Array,shelf:Array<string|null>}}
 * @throws {Error} On ragged rows or unknown symbols.
 */
export function parseGrid(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Layout grid is empty.');
  const W = rows[0].length;
  const H = rows.length;
  rows.forEach((r, i) => {
    if (typeof r !== 'string' || r.length !== W) {
      throw new Error(`Layout row ${i} has width ${r?.length}, expected ${W}.`);
    }
  });
  const type = new Uint8Array(W * H);
  const shelf = new Array(W * H).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      const i = y * W + x;
      if (ch === '.') type[i] = CELL.FLOOR;
      else if (ch === '#') type[i] = CELL.WALL;
      else if (ch === 'E') type[i] = CELL.ENTRANCE;
      else if (ch === 'C' || ch === 'K') type[i] = CELL.COUNTER;
      else if (/[0-9]/.test(ch)) { type[i] = CELL.SHELF; shelf[i] = ch; }
      else throw new Error(`Unknown layout symbol '${ch}' at (${x},${y}).`);
    }
  }
  return { W, H, type, shelf };
}

const isWalkable = (t) => t === CELL.FLOOR || t === CELL.ENTRANCE;

/**
 * Breadth-first distance (in steps) from every walkable cell to the nearest source.
 * @param {{W:number,H:number,type:Uint8Array}} grid
 * @param {number[]} sources Cell indices.
 * @returns {Int32Array} Distances; UNREACHABLE where no path exists.
 */
export function distanceField(grid, sources) {
  const { W, H, type } = grid;
  const d = new Int32Array(W * H).fill(UNREACHABLE);
  const q = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (d[s] !== 0) { d[s] = 0; q[tail++] = s; }
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (d[n] !== UNREACHABLE || !isWalkable(type[n])) continue;
      d[n] = d[i] + 1;
      q[tail++] = n;
    }
  }
  return d;
}

/** Walkable cells that touch (4-neighbour) any cell matching `pred`. */
function cellsBeside(grid, pred) {
  const { W, H, type } = grid;
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!isWalkable(type[i])) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (pred(ny * W + nx)) { out.push(i); break; }
      }
    }
  }
  return out;
}

/**
 * Data-quality checks on the three masters — the governance gate the demo
 * shows before it will run.
 * @param {{layout:object, products:object, segments:object}} data
 * @returns {{check:string, ok:boolean, detail:string}[]}
 */
export function validateMasterData({ layout, products, segments }) {
  const results = [];
  const add = (check, ok, detail) => results.push({ check, ok, detail });
  let grid;
  try {
    grid = parseGrid(layout.grid);
    add('Grid is rectangular with known symbols', true, `${grid.W} × ${grid.H} cells`);
  } catch (err) {
    add('Grid is rectangular with known symbols', false, err.message);
    return results;
  }
  const { W, type, shelf } = grid;
  const idx = ([x, y]) => y * W + x;
  const codes = new Set(shelf.filter(Boolean));
  const cats = products.categories;

  const missing = cats.filter((c) => !codes.has(c.code)).map((c) => c.name);
  add('Every product category has a shelf', missing.length === 0,
    missing.length ? `No shelf for: ${missing.join(', ')}` : `${cats.length} categories placed`);

  const known = new Set(cats.map((c) => c.code));
  const orphans = [...codes].filter((c) => !known.has(c));
  add('Every shelf maps to a product category', orphans.length === 0,
    orphans.length ? `Orphan shelf codes: ${orphans.join(', ')}` : 'No orphan shelves');

  const entrances = [];
  type.forEach((t, i) => { if (t === CELL.ENTRANCE) entrances.push(i); });
  add('Store has an entrance', entrances.length > 0, `${entrances.length} entrance cells`);
  if (!entrances.length) return results;
  const fromDoor = distanceField(grid, entrances);

  const lanes = [...layout.checkouts, layout.collect];
  const badLanes = lanes.filter((l) => fromDoor[idx(l.service)] >= UNREACHABLE).map((l) => l.id);
  add('Checkout and collect points are reachable', badLanes.length === 0,
    badLanes.length ? `Unreachable: ${badLanes.join(', ')}` : `${lanes.length} service points`);

  const unreachableCats = cats.filter((c) => {
    const beside = cellsBeside(grid, (i) => shelf[i] === c.code);
    return beside.length === 0 || beside.every((i) => fromDoor[i] >= UNREACHABLE);
  }).map((c) => c.name);
  add('Every category is reachable from the entrance', unreachableCats.length === 0,
    unreachableCats.length ? `Unreachable: ${unreachableCats.join(', ')}` : 'All aisles reachable');

  const badPromo = Object.entries(layout.promoSlots)
    .filter(([, s]) => type[idx(s.cell)] !== CELL.FLOOR).map(([k]) => k);
  add('Promo slots sit on open floor', badPromo.length === 0,
    badPromo.length ? `Blocked slots: ${badPromo.join(', ')}` : `${Object.keys(layout.promoSlots).length} slots`);

  const share = segments.segments.reduce((s, g) => s + g.share, 0);
  add('Customer segment shares sum to 100%', Math.abs(share - 1) < 1e-6, `${Math.round(share * 100)}%`);
  return results;
}

/**
 * @typedef {object} SimParams
 * @property {number} openCheckouts Real lanes staffed (1..checkouts.length).
 * @property {number} arrivalsPerMin Mean shopper arrivals per minute.
 * @property {string} promoSlot 'none' or a key of layout.promoSlots.
 * @property {'clean'|'dirty'} dataQuality Dirty = stale category location + phantom lane.
 * @property {number} durationMin Simulated store minutes.
 */

/**
 * Build a simulation.
 * @param {{data:{layout:object, products:object, segments:object}, params:SimParams, seed:number}} config
 */
export function createSimulation({ data, params, seed }) {
  const { layout, products, segments } = data;
  // Three independent streams ("common random numbers"): arrivals and shopper
  // profiles stay identical across scenarios, so a clean-vs-dirty comparison
  // faces the same customers and only the master data differs.
  const rngArrive = mulberry32(seed);
  const rngProfile = mulberry32(seed ^ 0x9e3779b9);
  const rng = mulberry32(seed ^ 0x85ebca6b);
  const randint = ([lo, hi], r = rng) => lo + Math.floor(r() * (hi - lo + 1));
  const dirty = params.dataQuality === 'dirty';

  const grid = parseGrid(layout.grid);
  const { W, H, type, shelf } = grid;
  const idx = ([x, y]) => y * W + x;

  let promoCell = -1;
  if (params.promoSlot && params.promoSlot !== 'none') {
    const slot = layout.promoSlots[params.promoSlot];
    if (!slot) throw new Error(`Unknown promo slot '${params.promoSlot}'.`);
    promoCell = idx(slot.cell);
    type[promoCell] = CELL.PROMO;
  }

  const entrances = [];
  type.forEach((t, i) => { if (t === CELL.ENTRANCE) entrances.push(i); });

  const fieldCache = new Map();
  /** Distance field for a named target, computed once and cached. */
  function field(key) {
    let f = fieldCache.get(key);
    if (f) return f;
    let sources;
    if (key === 'exit') sources = entrances;
    else if (key === 'promo') sources = cellsBeside(grid, (i) => i === promoCell);
    else if (key.startsWith('cat:')) {
      const code = key.slice(4);
      sources = cellsBeside(grid, (i) => shelf[i] === code);
    } else if (key.startsWith('svc:')) sources = [laneById.get(key.slice(4)).service];
    else throw new Error(`Unknown field key '${key}'.`);
    f = distanceField(grid, sources);
    fieldCache.set(key, f);
    return f;
  }

  const makeLane = (def, phantom) => ({
    id: def.id, phantom, service: idx(def.service), counter: def.counter ?? null,
    queueDir: def.queueDir, queue: [], serving: null, serveLeft: 0,
  });
  const open = Math.max(1, Math.min(params.openCheckouts, layout.checkouts.length));
  const lanes = layout.checkouts.slice(0, open).map((c) => makeLane(c, false));
  const phantomLanes = dirty ? (layout.phantomCheckouts ?? []).map((c) => makeLane(c, true)) : [];
  const collectLane = makeLane(layout.collect, false);
  const laneById = new Map([...lanes, ...phantomLanes, collectLane].map((l) => [l.id, l]));

  const believedCode = new Map(products.categories.map((c) => [c.id, dirty && c.staleCode ? c.staleCode : c.code]));
  const trueCode = new Map(products.categories.map((c) => [c.id, c.code]));

  const occ = new Uint16Array(W * H);
  const heat = new Float32Array(W * H);
  const crowdStamp = new Int32Array(W * H).fill(-1);
  const agents = [];
  const durationTicks = Math.round((params.durationMin * 60) / TICK_SECONDS);
  const lambda = (params.arrivalsPerMin / 60) * TICK_SECONDS;

  const stats = {
    arrived: 0, completed: 0, served: 0, timeInStore: 0, walked: 0,
    waitTotal: 0, waitCount: 0, peakQueue: 0, exposures: 0, impulseBuys: 0,
    lostItems: 0, searchTicks: 0, staleArrivals: 0, phantomDetours: 0, crowdedTicks: 0,
  };
  let t = 0;
  let nextId = 0;

  function poisson(l) {
    const limit = Math.exp(-l);
    let k = 0;
    let p = 1;
    do { k++; p *= rngArrive(); } while (p > limit);
    return k - 1;
  }

  function pickSegment() {
    let r = rngProfile();
    for (const s of segments.segments) { if ((r -= s.share) < 0) return s; }
    return segments.segments[segments.segments.length - 1];
  }

  function spawn() {
    const seg = pickSegment();
    const pos = entrances[Math.floor(rngProfile() * entrances.length)];
    const pool = products.categories.slice();
    const list = [];
    const n = Math.min(randint(seg.listSize, rngProfile), pool.length);
    for (let k = 0; k < n; k++) {
      const c = pool.splice(Math.floor(rngProfile() * pool.length), 1)[0];
      const believed = believedCode.get(c.id);
      list.push({ kind: 'cat', categoryId: c.id, key: `cat:${believed}`,
        trueKey: `cat:${trueCode.get(c.id)}`, stale: believed !== trueCode.get(c.id) });
    }
    const a = {
      id: nextId++, seg, pos, state: 'walk', list, current: null, dwell: 0, after: null,
      enteredAt: t, walked: 0, items: seg.id === 'collect' ? 1 : 0, exposed: false,
      lane: null, queueJoin: -1, avoidPhantom: false, blocked: 0,
      jx: rngProfile() - 0.5, jy: rngProfile() - 0.5,
    };
    occ[pos]++;
    stats.arrived++;
    agents.push(a);
    nextTarget(a);
  }

  function nextTarget(a) {
    if (a.list.length === 0) { headToCheckout(a); return; }
    let best = 0;
    let bestD = Infinity;
    a.list.forEach((tg, k) => {
      const dist = field(tg.key)[a.pos];
      if (dist < bestD) { bestD = dist; best = k; }
    });
    a.current = a.list.splice(best, 1)[0];
    a.state = 'walk';
  }

  function headToCheckout(a) {
    let lane = collectLane;
    if (a.seg.id !== 'collect') {
      const options = a.avoidPhantom ? lanes : [...lanes, ...phantomLanes];
      let bestScore = Infinity;
      for (const l of options) {
        const score = l.queue.length + (l.serving ? 1 : 0) + field(`svc:${l.id}`)[a.pos] / 40;
        if (score < bestScore) { bestScore = score; lane = l; }
      }
    }
    a.lane = lane;
    a.current = { kind: 'lane', key: `svc:${lane.id}` };
    a.state = 'walk';
  }

  function joinLane(a) {
    const lane = a.lane;
    // The wait clock starts at the first queue a shopper joins — including a
    // phantom lane — because from the customer's side that time is queueing.
    if (a.queueJoin < 0) a.queueJoin = t;
    if (lane.phantom) {
      stats.phantomDetours++;
      a.state = 'confused';
      a.dwell = randint(PHANTOM_WAIT);
      a.avoidPhantom = true;
      return;
    }
    occ[a.pos]--;
    a.state = 'queue';
    lane.queue.push(a);
  }

  /**
   * One step down the distance field. Shoppers prefer forward cells that are
   * not crowded; after a few blocked ticks they will sidestep, and after more
   * they squeeze into a crowded cell. Without this escalation, people standing
   * in a corridor can gridlock everyone behind them.
   */
  function move(a, f) {
    const x = a.pos % W;
    const y = (a.pos - x) / W;
    const allowSideways = a.blocked >= SIDESTEP_AFTER;
    const ignoreCrowd = a.blocked >= SQUEEZE_AFTER;
    let best = -1;
    let bestScore = Infinity;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!isWalkable(type[n])) continue;
      if (f[n] > f[a.pos] || (f[n] === f[a.pos] && !allowSideways)) continue;
      if (occ[n] >= CROWD_CAP && !ignoreCrowd) continue;
      const score = f[n] + occ[n] * 0.6 + rng() * 0.5;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best < 0) { a.blocked++; return; }
    if (f[best] < f[a.pos]) a.blocked = 0;
    occ[a.pos]--;
    occ[best]++;
    a.pos = best;
    a.walked++;
  }

  function checkPromo(a) {
    if (promoCell < 0 || a.exposed) return;
    const px = promoCell % W;
    const py = (promoCell - px) / W;
    const x = a.pos % W;
    const y = (a.pos - x) / W;
    if (Math.max(Math.abs(px - x), Math.abs(py - y)) > 2) return;
    a.exposed = true;
    stats.exposures++;
    const busy = a.current && (a.current.kind === 'promo' || a.current.kind === 'exit');
    if (!busy && rng() < a.seg.impulse) {
      if (a.current && a.current.kind !== 'lane') a.list.unshift(a.current);
      a.current = { kind: 'promo', key: 'promo' };
    }
  }

  function arrive(a) {
    const tg = a.current;
    if (tg.kind === 'exit') {
      occ[a.pos]--;
      a.state = 'done';
      stats.completed++;
      stats.timeInStore += t - a.enteredAt;
      stats.walked += a.walked;
      return;
    }
    a.state = 'dwell';
    if (tg.kind === 'promo') { a.dwell = randint([3, 6]); a.after = 'impulse'; return; }
    if (tg.stale && !tg.searched) {
      stats.staleArrivals++;
      a.dwell = randint([8, 15]);
      stats.searchTicks += a.dwell;
      a.after = 'search';
      return;
    }
    a.dwell = randint(a.seg.dwell);
    a.after = 'pick';
  }

  function finishDwell(a) {
    const tg = a.current;
    if (a.after === 'pick') { a.items++; nextTarget(a); return; }
    if (a.after === 'impulse') { a.items++; stats.impulseBuys++; nextTarget(a); return; }
    if (a.after === 'search') {
      if (rng() < SEARCH_RECOVERY_PROBABILITY) {
        a.current = { ...tg, key: tg.trueKey, stale: false, searched: true };
        a.state = 'walk';
      } else {
        stats.lostItems++;
        nextTarget(a);
      }
    }
  }

  function updateAgent(a) {
    switch (a.state) {
      case 'walk':
      case 'exit': {
        checkPromo(a);
        const f = field(a.current.key);
        if (a.current.kind === 'lane' && f[a.pos] <= LANE_JOIN_DISTANCE) { joinLane(a); return; }
        if (f[a.pos] === 0) { arrive(a); return; }
        if (rng() < a.seg.speed) move(a, f);
        return;
      }
      case 'dwell':
        if (--a.dwell <= 0) finishDwell(a);
        return;
      case 'confused':
        if (--a.dwell <= 0) headToCheckout(a);
        return;
      default:
        return; // queue, serve and done are driven by the lanes
    }
  }

  function updateLane(lane) {
    if (!lane.serving && lane.queue.length) {
      const a = lane.queue.shift();
      stats.waitTotal += t - a.queueJoin;
      stats.waitCount++;
      a.state = 'serve';
      lane.serving = a;
      lane.serveLeft = lane === collectLane ? randint([40, 70]) : 20 + 3 * a.items + randint([0, 10]);
    }
    if (lane.serving && --lane.serveLeft <= 0) {
      const a = lane.serving;
      lane.serving = null;
      stats.served++;
      a.pos = lane.service;
      occ[a.pos]++;
      a.state = 'exit';
      a.current = { kind: 'exit', key: 'exit' };
    }
  }

  /** Advance one tick. Returns false once the run is over. */
  function step() {
    if (t >= durationTicks) return false;
    for (let k = poisson(lambda); k > 0; k--) spawn();
    for (const a of agents) updateAgent(a);
    for (const l of lanes) updateLane(l);
    updateLane(collectLane);
    for (const a of agents) {
      if (a.state === 'walk' || a.state === 'exit' || a.state === 'dwell' || a.state === 'confused') {
        heat[a.pos] += 1;
        if (occ[a.pos] >= CROWD_CAP && crowdStamp[a.pos] !== t) { crowdStamp[a.pos] = t; stats.crowdedTicks++; }
      }
    }
    for (const l of [...lanes, collectLane]) stats.peakQueue = Math.max(stats.peakQueue, l.queue.length);
    t++;
    return true;
  }

  /** Run to the end without rendering. */
  function runToEnd() { while (step()); return metrics(); }

  /**
   * Current headline metrics. Averages include shoppers still in the store
   * (elapsed time so far), so a run where people get stuck cannot look better
   * by only counting the ones who escaped.
   */
  function metrics() {
    let timeSum = stats.timeInStore;
    let waitSum = stats.waitTotal;
    let waitN = stats.waitCount;
    let inStore = 0;
    for (const a of agents) {
      if (a.state === 'done') continue;
      inStore++;
      timeSum += t - a.enteredAt;
      if ((a.state === 'queue' || a.state === 'confused') && a.queueJoin >= 0) {
        waitSum += t - a.queueJoin;
        waitN++;
      }
    }
    const per = (v, n, d = 1) => (n ? +((v * TICK_SECONDS) / n).toFixed(d) : 0);
    return {
      simMinutes: +(t * TICK_SECONDS / 60).toFixed(1),
      arrived: stats.arrived,
      inStore,
      completed: stats.completed,
      avgTimeInStoreMin: stats.arrived ? +((timeSum * TICK_SECONDS) / stats.arrived / 60).toFixed(2) : 0,
      avgQueueWaitSec: per(waitSum, waitN),
      peakQueue: stats.peakQueue,
      promoExposurePct: promoCell < 0 ? null : stats.arrived ? +((stats.exposures / stats.arrived) * 100).toFixed(1) : 0,
      impulseBuys: stats.impulseBuys,
      avgWalkM: stats.completed ? +(stats.walked / stats.completed).toFixed(1) : 0,
      lostItems: stats.lostItems,
      searchMinutes: +((stats.searchTicks * TICK_SECONDS) / 60).toFixed(1),
      phantomDetours: stats.phantomDetours,
      crowdingCellMin: +((stats.crowdedTicks * TICK_SECONDS) / 60).toFixed(1),
    };
  }

  return {
    step, runToEnd, metrics,
    get tick() { return t; },
    get finished() { return t >= durationTicks; },
    durationTicks, grid, layout, promoCell, agents, lanes, phantomLanes, collectLane, heat, occ,
  };
}
