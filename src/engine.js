/**
 * Swarm in the Store — simulation engine.
 *
 * DOM-free so the same code runs in the browser demo and in Node tests.
 * Every random draw comes from seeded generators, so a given seed,
 * parameter set and data always produce identical results.
 *
 * Two kinds of data, deliberately kept apart:
 *   System of record (what the store's systems believe)
 *     - location master: geometry, lane status (drives the queue-call board)
 *     - product master: which aisle each category is on (drives signage/app)
 *     - customer segments: shopper missions and behaviour
 *   Physical reality (what is actually on the floor)
 *     - planogram: which category is really stocked on each fixture
 *     - POS registers: which lanes can really serve customers
 *
 * Shoppers act on the system of record (signage, queue board) and collide
 * with physical reality. The engine has no notion of "clean" or "dirty"
 * data: a defect is simply a system-of-record file that disagrees with
 * reality, and its cost emerges from shoppers acting on it.
 *
 * Navigation: shoppers follow floor-level wayfinding (a distance map built
 * from the location master) towards the aisle the signage names, while
 * reacting only to crowding in their four neighbouring cells.
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
/** Seconds a shopper stands at a lane with no register before giving up on it. */
const DEAD_LANE_WAIT = [45, 90];
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
 * @returns {{W:number,H:number,type:Uint8Array,fixture:Array<string|null>}}
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
  const fixture = new Array(W * H).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      const i = y * W + x;
      if (ch === '.') type[i] = CELL.FLOOR;
      else if (ch === '#') type[i] = CELL.WALL;
      else if (ch === 'E') type[i] = CELL.ENTRANCE;
      else if (ch === 'C' || ch === 'K') type[i] = CELL.COUNTER;
      else if (/[0-9]/.test(ch)) { type[i] = CELL.SHELF; fixture[i] = ch; }
      else throw new Error(`Unknown layout symbol '${ch}' at (${x},${y}).`);
    }
  }
  return { W, H, type, fixture };
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
 * Two-tier master data checks.
 *
 * Tier 1, structural integrity: is the data well-formed and internally
 * consistent? Failure blocks the simulation.
 * Tier 2, operational sync: does the system of record agree with physical
 * reality? Failure is a warning; the store still opens, and pays for it.
 *
 * @param {{layout:object, products:object, segments:object, planogram:object, registers:object}} data
 * @returns {{structural:{check:string,ok:boolean,detail:string}[], operational:{check:string,ok:boolean,detail:string}[]}}
 */
export function validateMasterData({ layout, products, segments, planogram, registers }) {
  const structural = [];
  const operational = [];
  const add = (list, check, ok, detail) => list.push({ check, ok, detail });
  let grid;
  try {
    grid = parseGrid(layout.grid);
    add(structural, 'Grid is rectangular with known symbols', true, `${grid.W} × ${grid.H} cells`);
  } catch (err) {
    add(structural, 'Grid is rectangular with known symbols', false, err.message);
    return { structural, operational };
  }
  const { W, type, fixture } = grid;
  const idx = ([x, y]) => y * W + x;
  const gridCodes = new Set(fixture.filter(Boolean));
  const planCodes = new Set(planogram.fixtures.map((f) => f.code));
  const catIds = new Set(products.categories.map((c) => c.id));

  const unplanned = [...gridCodes].filter((c) => !planCodes.has(c));
  add(structural, 'Every fixture group is in the planogram', unplanned.length === 0,
    unplanned.length ? `Fixtures with no planogram entry: ${unplanned.join(', ')}` : `${gridCodes.size} fixture groups`);

  const unknownCats = planogram.fixtures.filter((f) => !catIds.has(f.category)).map((f) => f.category);
  add(structural, 'Planogram categories exist in the product master', unknownCats.length === 0,
    unknownCats.length ? `Unknown: ${unknownCats.join(', ')}` : 'All matched');

  const stocked = new Set(planogram.fixtures.filter((f) => gridCodes.has(f.code)).map((f) => f.category));
  const unstocked = products.categories.filter((c) => !stocked.has(c.id)).map((c) => c.name);
  add(structural, 'Every product category is stocked somewhere', unstocked.length === 0,
    unstocked.length ? `Not on any fixture: ${unstocked.join(', ')}` : `${products.categories.length} categories`);

  const badAisles = products.categories.filter((c) => !gridCodes.has(c.aisle)).map((c) => `${c.name} → ${c.aisle}`);
  add(structural, 'Product master aisles reference real fixtures', badAisles.length === 0,
    badAisles.length ? `No such fixture: ${badAisles.join(', ')}` : 'All aisle codes exist');

  const entrances = [];
  type.forEach((t, i) => { if (t === CELL.ENTRANCE) entrances.push(i); });
  add(structural, 'Store has an entrance', entrances.length > 0, `${entrances.length} entrance cells`);
  if (!entrances.length) return { structural, operational };
  const fromDoor = distanceField(grid, entrances);

  const points = [...layout.checkouts, layout.collect];
  const badLanes = points.filter((l) => fromDoor[idx(l.service)] >= UNREACHABLE).map((l) => l.id);
  add(structural, 'Checkout and collect points are reachable', badLanes.length === 0,
    badLanes.length ? `Unreachable: ${badLanes.join(', ')}` : `${points.length} service points`);

  const unreachable = [...gridCodes].filter((code) => {
    const beside = cellsBeside(grid, (i) => fixture[i] === code);
    return beside.length === 0 || beside.every((i) => fromDoor[i] >= UNREACHABLE);
  });
  add(structural, 'Every fixture is reachable from the entrance', unreachable.length === 0,
    unreachable.length ? `Unreachable fixtures: ${unreachable.join(', ')}` : 'All aisles reachable');

  const badPromo = Object.entries(layout.promoSlots)
    .filter(([, s]) => type[idx(s.cell)] !== CELL.FLOOR).map(([k]) => k);
  add(structural, 'Promo slots sit on open floor', badPromo.length === 0,
    badPromo.length ? `Blocked slots: ${badPromo.join(', ')}` : `${Object.keys(layout.promoSlots).length} slots`);

  const share = segments.segments.reduce((s, g) => s + g.share, 0);
  add(structural, 'Customer segment shares sum to 100%', Math.abs(share - 1) < 1e-6, `${Math.round(share * 100)}%`);

  // Tier 2: system of record vs physical reality.
  const mismatched = products.categories.filter((c) => {
    const where = planogram.fixtures.filter((f) => f.category === c.id).map((f) => f.code);
    return where.length > 0 && !where.includes(c.aisle);
  }).map((c) => {
    const where = planogram.fixtures.filter((f) => f.category === c.id).map((f) => f.code).join('/');
    return `${c.name}: product master says aisle ${c.aisle}, planogram has it on ${where}`;
  });
  add(operational, 'Aisle signage matches the planogram', mismatched.length === 0,
    mismatched.length ? mismatched.join('; ') : 'Product master and planogram agree');

  const installed = new Set(registers.registers.map((r) => r.lane));
  const openWithoutRegister = layout.checkouts.filter((l) => l.status === 'open' && !installed.has(l.id)).map((l) => l.id);
  add(operational, 'No lane is open without a POS register', openWithoutRegister.length === 0,
    openWithoutRegister.length ? `${openWithoutRegister.join(', ')} marked open in the location master, but no register is installed`
      : 'Lane status and register list agree');

  return { structural, operational };
}

/**
 * @typedef {object} SimParams
 * @property {number} openCheckouts Shift plan: how many lanes with a register are staffed.
 * @property {number} arrivalsPerMin Mean shopper arrivals per minute.
 * @property {string} promoSlot 'none' or a key of layout.promoSlots.
 * @property {number} durationMin Simulated store minutes.
 */

/**
 * Build a simulation.
 * @param {{data:{layout:object, products:object, segments:object, planogram:object, registers:object},
 *          params:SimParams, seed:number}} config
 */
export function createSimulation({ data, params, seed }) {
  const { layout, products, segments, planogram, registers } = data;
  // Three independent streams ("common random numbers"): arrivals and shopper
  // profiles stay identical across scenarios, so comparing two versions of
  // the data faces the same customers and only the data differs.
  const rngArrive = mulberry32(seed);
  const rngProfile = mulberry32(seed ^ 0x9e3779b9);
  const rng = mulberry32(seed ^ 0x85ebca6b);
  const randint = ([lo, hi], r = rng) => lo + Math.floor(r() * (hi - lo + 1));

  const grid = parseGrid(layout.grid);
  const { W, H, type, fixture } = grid;
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

  // Physical reality: where each category actually is.
  const fixturesFor = new Map();
  for (const f of planogram.fixtures) {
    if (!fixturesFor.has(f.category)) fixturesFor.set(f.category, new Set());
    fixturesFor.get(f.category).add(f.code);
  }
  const categoryById = new Map(products.categories.map((c) => [c.id, c]));

  const fieldCache = new Map();
  /** Distance field for a named target, computed once and cached. */
  function field(key) {
    let f = fieldCache.get(key);
    if (f) return f;
    let sources;
    if (key === 'exit') sources = entrances;
    else if (key === 'promo') sources = cellsBeside(grid, (i) => i === promoCell);
    else if (key.startsWith('fix:')) {
      const code = key.slice(4);
      sources = cellsBeside(grid, (i) => fixture[i] === code);
    } else if (key.startsWith('cat:')) {
      const codes = fixturesFor.get(key.slice(4)) ?? new Set();
      sources = cellsBeside(grid, (i) => codes.has(fixture[i]));
    } else if (key.startsWith('svc:')) sources = [laneById.get(key.slice(4)).service];
    else throw new Error(`Unknown field key '${key}'.`);
    f = distanceField(grid, sources);
    fieldCache.set(key, f);
    return f;
  }

  // Lanes. Registers are physical; status is what the queue board believes.
  // The shift plan staffs the first N lanes that have a register. Lanes
  // without a register are called only if their record still says open.
  const installed = new Set(registers.registers.map((r) => r.lane));
  const makeLane = (def, serves) => ({
    id: def.id, serves, service: idx(def.service), counter: def.counter ?? null,
    queueDir: def.queueDir, queue: [], serving: null, serveLeft: 0,
  });
  const lanes = [];
  const deadLanes = [];
  let staffed = 0;
  for (const def of layout.checkouts) {
    if (installed.has(def.id)) {
      if (staffed < params.openCheckouts) { lanes.push(makeLane(def, true)); staffed++; }
    } else if (def.status === 'open') {
      deadLanes.push(makeLane(def, false));
    }
  }
  if (!lanes.length) throw new Error('No staffed checkout lanes: check the POS register list and Open checkouts.');
  const collectLane = makeLane(layout.collect, true);
  const laneById = new Map([...lanes, ...deadLanes, collectLane].map((l) => [l.id, l]));

  const occ = new Uint16Array(W * H);
  const heat = new Float32Array(W * H);
  const crowdStamp = new Int32Array(W * H).fill(-1);
  const agents = [];
  const durationTicks = Math.round((params.durationMin * 60) / TICK_SECONDS);
  const lambda = (params.arrivalsPerMin / 60) * TICK_SECONDS;

  const stats = {
    arrived: 0, completed: 0, served: 0, timeInStore: 0, walked: 0,
    waitTotal: 0, waitCount: 0, peakQueue: 0, exposures: 0, impulseBuys: 0,
    lostItems: 0, lostValue: 0, searchTicks: 0, wrongAisleVisits: 0, deadLaneDetours: 0,
    walkouts: 0, walkoutValue: 0, revenue: 0, crowdedTicks: 0,
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
      // Shoppers head where the signage (product master) says the category is.
      list.push({ kind: 'cat', categoryId: c.id, key: `fix:${c.aisle}`, trueKey: `cat:${c.id}` });
    }
    const a = {
      id: nextId++, seg, pos, state: 'walk', list, current: null, dwell: 0, after: null,
      enteredAt: t, walked: 0, items: 0, basketValue: 0, exposed: false,
      lane: null, queueJoin: -1, avoidDead: false, blocked: 0, patience: seg.patience,
      jx: rngProfile() - 0.5, jy: rngProfile() - 0.5,
    };
    if (seg.id === 'collect') { a.items = 1; a.basketValue = seg.orderValue ?? 0; }
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

  function leave(a) {
    a.state = 'exit';
    a.current = { kind: 'exit', key: 'exit' };
  }

  function headToCheckout(a) {
    let lane = collectLane;
    if (a.seg.id !== 'collect') {
      // The queue-call board offers every lane the location master says is open.
      const options = a.avoidDead ? lanes : [...lanes, ...deadLanes];
      let bestScore = Infinity;
      for (const l of options) {
        const score = l.queue.length + (l.serving ? 1 : 0) + field(`svc:${l.id}`)[a.pos] / 40;
        if (score < bestScore) { bestScore = score; lane = l; }
      }
    }
    // Balking: if even the best queue is longer than this shopper tolerates,
    // they abandon the basket and walk out.
    const length = lane.queue.length + (lane.serving ? 1 : 0);
    if (length >= a.patience) {
      stats.walkouts++;
      stats.walkoutValue += a.basketValue;
      a.walkedOut = true;
      leave(a);
      return;
    }
    a.lane = lane;
    a.current = { kind: 'lane', key: `svc:${lane.id}` };
    a.state = 'walk';
  }

  function joinLane(a) {
    const lane = a.lane;
    // The wait clock starts at the first queue a shopper joins, including a
    // lane with no register: from the customer's side that time is queueing.
    if (a.queueJoin < 0) a.queueJoin = t;
    if (!lane.serves) {
      stats.deadLaneDetours++;
      a.state = 'confused';
      a.dwell = randint(DEAD_LANE_WAIT);
      a.avoidDead = true;
      // Someone who has just queued at a dead lane is less willing to queue again.
      a.patience = Math.max(1, Math.floor(a.patience / 2));
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

  /** Is the target category physically on the fixture the shopper has reached? */
  function foundHere(tg) {
    if (tg.key === tg.trueKey) return true;
    const code = tg.key.slice(4);
    return fixturesFor.get(tg.categoryId)?.has(code) ?? false;
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
    if (!foundHere(tg)) {
      stats.wrongAisleVisits++;
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
    if (a.after === 'pick') {
      a.items++;
      a.basketValue += categoryById.get(tg.categoryId)?.avgItemValue ?? 0;
      nextTarget(a);
      return;
    }
    if (a.after === 'impulse') {
      a.items++;
      a.basketValue += products.promoItemValue ?? 0;
      stats.impulseBuys++;
      nextTarget(a);
      return;
    }
    if (a.after === 'search') {
      // Some shoppers ask staff or browse until they find it; others give up.
      if (rng() < SEARCH_RECOVERY_PROBABILITY) {
        a.current = { ...tg, key: tg.trueKey };
        a.state = 'walk';
      } else {
        stats.lostItems++;
        stats.lostValue += categoryById.get(tg.categoryId)?.avgItemValue ?? 0;
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
      stats.revenue += a.basketValue;
      a.pos = lane.service;
      occ[a.pos]++;
      leave(a);
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
    const hours = (t * TICK_SECONDS) / 3600 || 1;
    const per = (v, n, d = 1) => (n ? +((v * TICK_SECONDS) / n).toFixed(d) : 0);
    return {
      simMinutes: +(t * TICK_SECONDS / 60).toFixed(1),
      arrived: stats.arrived,
      inStore,
      completed: stats.completed,
      avgTimeInStoreMin: stats.arrived ? +((timeSum * TICK_SECONDS) / stats.arrived / 60).toFixed(2) : 0,
      avgQueueWaitSec: per(waitSum, waitN),
      peakQueue: stats.peakQueue,
      walkouts: stats.walkouts,
      promoExposurePct: promoCell < 0 ? null : stats.arrived ? +((stats.exposures / stats.arrived) * 100).toFixed(1) : 0,
      impulseBuys: stats.impulseBuys,
      avgWalkM: stats.completed ? +(stats.walked / stats.completed).toFixed(1) : 0,
      lostItems: stats.lostItems,
      wrongAisleVisits: stats.wrongAisleVisits,
      searchMinutes: +((stats.searchTicks * TICK_SECONDS) / 60).toFixed(1),
      deadLaneDetours: stats.deadLaneDetours,
      revenuePerHour: Math.round(stats.revenue / hours),
      revenueAtRiskPerHour: Math.round((stats.lostValue + stats.walkoutValue) / hours),
      crowdingCellMin: +((stats.crowdedTicks * TICK_SECONDS) / 60).toFixed(1),
    };
  }

  return {
    step, runToEnd, metrics,
    get tick() { return t; },
    get finished() { return t >= durationTicks; },
    durationTicks, grid, layout, planogram, promoCell, agents, lanes, deadLanes, collectLane, heat, occ,
  };
}
