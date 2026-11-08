/**
 * Swarm in the Store — browser app.
 *
 * Loads the three master-data files, runs the governance checks, wires the
 * levers to the engine, animates the run and keeps a comparison table of
 * saved runs. Every setting lives in the URL hash so a link reproduces a run.
 */
import { createSimulation, validateMasterData } from './engine.js';
import { StoreRenderer } from './renderer.js';

const DEFAULTS = Object.freeze({
  layout: 'grid', openCheckouts: 3, arrivalsPerMin: 3, promoSlot: 'front',
  dataQuality: 'clean', durationMin: 60, seed: 1989, speed: 8, heat: 0,
});
const RUNS_KEY = 'swarm-in-the-store.runs.v1';

/** Comparison columns: label, metric key, which direction is better. */
const RUN_COLUMNS = [
  { key: 'avgTimeInStoreMin', label: 'Time in store (min)', better: 'low' },
  { key: 'avgQueueWaitSec', label: 'Queue wait (s)', better: 'low' },
  { key: 'peakQueue', label: 'Peak queue', better: 'low' },
  { key: 'avgWalkM', label: 'Walk (m)', better: 'low' },
  { key: 'promoExposurePct', label: 'Promo reach %', better: 'high' },
  { key: 'lostItems', label: 'Lost items', better: 'low' },
  { key: 'phantomDetours', label: 'Phantom detours', better: 'low' },
];

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
};

const state = { ...DEFAULTS };
let data = null;
let sim = null;
let renderer = null;
let running = false;
let frame = 0;
let runs = loadRuns();

function loadRuns() {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistRuns() {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); } catch { /* storage unavailable: keep in memory */ }
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k, lo, hi) => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
  };
  state.layout = p.get('layout') || DEFAULTS.layout;
  state.openCheckouts = num('openCheckouts', 1, 6);
  state.arrivalsPerMin = num('arrivalsPerMin', 0.5, 8);
  state.promoSlot = p.get('promoSlot') || DEFAULTS.promoSlot;
  state.dataQuality = p.get('dataQuality') === 'dirty' ? 'dirty' : 'clean';
  state.durationMin = num('durationMin', 15, 120);
  state.seed = Math.round(num('seed', 0, 2 ** 31 - 1));
  state.speed = num('speed', 1, 60);
  state.heat = num('heat', 0, 1);
}

function writeHash() {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) p.set(k, String(state[k]));
  history.replaceState(null, '', `#${p.toString()}`);
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json();
}

function currentLayout() {
  return data.location.layouts.find((l) => l.id === state.layout) ?? data.location.layouts[0];
}

function simData() {
  return { layout: currentLayout(), products: data.products, segments: data.segments };
}

function simParams(overrides = {}) {
  return {
    openCheckouts: state.openCheckouts, arrivalsPerMin: state.arrivalsPerMin,
    promoSlot: state.promoSlot, dataQuality: state.dataQuality, durationMin: state.durationMin,
    ...overrides,
  };
}

function renderChecks() {
  const results = validateMasterData(simData());
  const passed = results.filter((r) => r.ok).length;
  $('checks-summary').textContent = `${passed} of ${results.length} checks passed`;
  $('checks-summary').className = passed === results.length ? 'ok' : 'bad';
  $('checks-list').innerHTML = results.map((r) => `
    <li class="${r.ok ? 'ok' : 'bad'}"><span class="mark">${r.ok ? '✓' : '✕'}</span>
      <span><strong>${r.check}</strong><br><small>${r.detail}</small></span></li>`).join('');
  return passed === results.length;
}

function syncControls() {
  const layout = currentLayout();
  state.layout = layout.id;
  $('layout').value = layout.id;
  $('layout-desc').textContent = layout.description;
  const promo = $('promo');
  promo.innerHTML = '<option value="none">No promo stand</option>' + Object.entries(layout.promoSlots)
    .map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  if (state.promoSlot !== 'none' && !layout.promoSlots[state.promoSlot]) state.promoSlot = DEFAULTS.promoSlot;
  promo.value = state.promoSlot;
  $('checkouts').max = String(layout.checkouts.length);
  $('checkouts').value = String(state.openCheckouts);
  $('checkouts-out').textContent = state.openCheckouts;
  $('arrivals').value = String(state.arrivalsPerMin);
  $('arrivals-out').textContent = state.arrivalsPerMin;
  $('duration').value = String(state.durationMin);
  $('seed').value = String(state.seed);
  $('speed').value = String(state.speed);
  $('speed-out').textContent = `${state.speed}×`;
  $('heat').checked = state.heat === 1;
  document.querySelectorAll('input[name="dq"]').forEach((r) => { r.checked = r.value === state.dataQuality; });
  $('dq-explainer').hidden = state.dataQuality !== 'dirty';
}

function resetSimulation() {
  running = false;
  updatePlayButton();
  const ok = renderChecks();
  $('play').disabled = !ok;
  if (!ok) { sim = null; return; }
  sim = createSimulation({ data: simData(), params: simParams(), seed: state.seed });
  renderer.setSimulation(sim);
  renderer.draw({ showHeat: state.heat === 1 });
  updateMetrics();
  writeHash();
}

function fmtClock(ticks) {
  const m = Math.floor(ticks / 60);
  const s = ticks % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateMetrics() {
  if (!sim) return;
  const m = sim.metrics();
  $('clock').textContent = `${fmtClock(sim.tick)} / ${fmtClock(sim.durationTicks)}`;
  $('progress').style.width = `${(sim.tick / sim.durationTicks) * 100}%`;
  const set = (id, v) => { $(id).textContent = v; };
  set('m-shoppers', `${m.arrived}`);
  set('m-shoppers-sub', `${m.completed} done · ${m.inStore} in store`);
  set('m-time', m.avgTimeInStoreMin.toFixed(1));
  set('m-wait', m.avgQueueWaitSec.toFixed(0));
  set('m-peak', m.peakQueue);
  set('m-walk', m.avgWalkM.toFixed(0));
  set('m-promo', m.promoExposurePct === null ? '—' : `${m.promoExposurePct.toFixed(0)}%`);
  set('m-lost', m.lostItems);
  set('m-phantom', m.phantomDetours);
  $('m-lost-card').classList.toggle('alert', m.lostItems > 0);
  $('m-phantom-card').classList.toggle('alert', m.phantomDetours > 0);
}

function updatePlayButton() {
  $('play').textContent = running ? 'Pause' : sim?.finished ? 'Finished' : 'Run';
}

function loop() {
  if (running && sim) {
    for (let k = 0; k < state.speed; k++) {
      if (!sim.step()) { running = false; break; }
    }
    renderer.draw({ showHeat: state.heat === 1 });
    if (++frame % 4 === 0 || !running) updateMetrics();
    if (!running) updatePlayButton();
  }
  requestAnimationFrame(loop);
}

function describeRun(params, seed, layoutId) {
  const layout = data.location.layouts.find((l) => l.id === layoutId);
  const promo = params.promoSlot === 'none' ? 'None' : layout.promoSlots[params.promoSlot].label;
  return { layout: layout.name, lanes: params.openCheckouts, arrivals: params.arrivalsPerMin,
    promo, data: params.dataQuality, seed, minutes: params.durationMin };
}

function saveRun(metrics, params, seed, layoutId, tag) {
  runs.push({ id: Date.now() + Math.random(), tag, setup: describeRun(params, seed, layoutId), metrics });
  persistRuns();
  renderRuns();
}

function renderRuns() {
  const table = $('runs');
  $('runs-empty').hidden = runs.length > 0;
  table.hidden = runs.length === 0;
  $('clear-runs').hidden = runs.length === 0;
  if (!runs.length) return;
  const extremes = Object.fromEntries(RUN_COLUMNS.map((c) => {
    const vals = runs.map((r) => r.metrics[c.key]).filter((v) => v !== null && v !== undefined);
    return [c.key, { min: Math.min(...vals), max: Math.max(...vals), varies: new Set(vals).size > 1 }];
  }));
  const cell = (c, v) => {
    if (v === null || v === undefined) return '<td class="num">—</td>';
    const e = extremes[c.key];
    let cls = 'num';
    if (e.varies) {
      const best = c.better === 'low' ? e.min : e.max;
      const worst = c.better === 'low' ? e.max : e.min;
      if (v === best) cls += ' best';
      else if (v === worst) cls += ' worst';
    }
    return `<td class="${cls}">${v}</td>`;
  };
  table.innerHTML = `
    <thead><tr><th>#</th><th>Setup</th>${RUN_COLUMNS.map((c) => `<th class="num">${c.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>${runs.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td><strong>${r.tag ?? r.setup.layout}</strong><br><small>${r.setup.layout} · ${r.setup.lanes} lanes · ${r.setup.arrivals}/min ·
          promo: ${r.setup.promo} · <span class="dq-${r.setup.data}">${r.setup.data} data</span> · seed ${r.setup.seed}</small></td>
        ${RUN_COLUMNS.map((c) => cell(c, r.metrics[c.key])).join('')}
        <td><button class="link" data-remove="${r.id}" aria-label="Remove run ${i + 1}">✕</button></td>
      </tr>`).join('')}</tbody>`;
}

function compareCleanDirty() {
  const layout = currentLayout();
  for (const dq of ['clean', 'dirty']) {
    const params = simParams({ dataQuality: dq });
    const s = createSimulation({ data: simData(), params, seed: state.seed });
    saveRun(s.runToEnd(), params, state.seed, layout.id, dq === 'clean' ? 'Clean master data' : 'Dirty master data');
  }
  document.getElementById('compare-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindControls() {
  const onChange = (fn) => () => { fn(); syncControls(); resetSimulation(); };
  $('layout').addEventListener('change', onChange(() => { state.layout = $('layout').value; }));
  $('promo').addEventListener('change', onChange(() => { state.promoSlot = $('promo').value; }));
  $('checkouts').addEventListener('input', onChange(() => { state.openCheckouts = Number($('checkouts').value); }));
  $('arrivals').addEventListener('input', onChange(() => { state.arrivalsPerMin = Number($('arrivals').value); }));
  $('duration').addEventListener('change', onChange(() => { state.durationMin = Number($('duration').value); }));
  $('seed').addEventListener('change', onChange(() => {
    const v = Math.abs(Math.round(Number($('seed').value)));
    state.seed = Number.isFinite(v) ? v : DEFAULTS.seed;
  }));
  document.querySelectorAll('input[name="dq"]').forEach((r) => r.addEventListener('change', onChange(() => {
    state.dataQuality = r.value;
  })));
  $('speed').addEventListener('input', () => {
    state.speed = Number($('speed').value);
    $('speed-out').textContent = `${state.speed}×`;
    writeHash();
  });
  $('heat').addEventListener('change', () => {
    state.heat = $('heat').checked ? 1 : 0;
    renderer.draw({ showHeat: state.heat === 1 });
    writeHash();
  });
  $('play').addEventListener('click', () => {
    if (!sim || sim.finished) return;
    running = !running;
    updatePlayButton();
  });
  $('reset').addEventListener('click', () => resetSimulation());
  $('save').addEventListener('click', () => {
    if (!sim) return;
    saveRun(sim.metrics(), simParams(), state.seed, state.layout, null);
  });
  $('compare').addEventListener('click', compareCleanDirty);
  $('clear-runs').addEventListener('click', () => { runs = []; persistRuns(); renderRuns(); });
  $('runs').addEventListener('click', (e) => {
    const id = e.target?.dataset?.remove;
    if (!id) return;
    runs = runs.filter((r) => String(r.id) !== id);
    persistRuns();
    renderRuns();
  });
  $('copy-link').addEventListener('click', async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      $('copy-link').textContent = 'Link copied';
    } catch {
      $('copy-link').textContent = 'Copy from the address bar';
    }
    setTimeout(() => { $('copy-link').textContent = 'Copy link to this setup'; }, 2000);
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { renderer.resize(); renderer.draw({ showHeat: state.heat === 1 }); }, 120);
  });
}

function renderLegend() {
  $('legend-missions').innerHTML = data.segments.segments.map((s) => `
    <li><span class="swatch round" style="background:${s.color}"></span>${s.name}<small>${Math.round(s.share * 100)}%</small></li>`).join('');
  $('legend-categories').innerHTML = data.products.categories.map((c) => `
    <li><span class="swatch" style="background:${c.color}"></span>${c.name}</li>`).join('');
  $('layout').innerHTML = data.location.layouts.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
}

async function main() {
  try {
    const [location, products, segments] = await Promise.all([
      loadJson('data/location-master.json'),
      loadJson('data/product-master.json'),
      loadJson('data/customer-segments.json'),
    ]);
    data = { location, products, segments };
  } catch (err) {
    $('load-error').hidden = false;
    $('load-error').textContent = `${err.message}. If you opened index.html directly from disk, serve the folder instead (see README).`;
    return;
  }
  readHash();
  renderer = new StoreRenderer($('store'), data.products);
  renderLegend();
  syncControls();
  bindControls();
  resetSimulation();
  renderRuns();
  requestAnimationFrame(loop);
}

main();
