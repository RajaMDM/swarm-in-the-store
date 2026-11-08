/**
 * Swarm in the Store — browser app.
 *
 * Loads the system-of-record files (location, product, segments), the
 * physical-reality files (planogram, POS registers) and the defect catalogue.
 * Defects are applied as data patches before the engine sees anything.
 * Every setting lives in the URL hash so a link reproduces a run.
 */
import { createSimulation, validateMasterData } from './engine.js';
import { applyDefects } from './defects.js';
import { StoreRenderer } from './renderer.js';

const DEFAULTS = Object.freeze({
  layout: 'grid', openCheckouts: 3, arrivalsPerMin: 3, promoSlot: 'front',
  defects: '', durationMin: 60, seed: 1989, speed: 8, heat: 0,
});
const RUNS_KEY = 'swarm-in-the-store.runs.v2';
const MATRIX_SEEDS = 10;

/** Comparison columns: label, metric key, which direction is better. */
const RUN_COLUMNS = [
  { key: 'avgTimeInStoreMin', label: 'Time in store (min)', better: 'low', digits: 2 },
  { key: 'avgQueueWaitSec', label: 'Queue wait (s)', better: 'low', digits: 1 },
  { key: 'walkouts', label: 'Walkouts', better: 'low', digits: 1 },
  { key: 'lostItems', label: 'Lost items', better: 'low', digits: 1 },
  { key: 'deadLaneDetours', label: 'Dead-lane detours', better: 'low', digits: 1 },
  { key: 'revenueAtRiskPerHour', label: 'Revenue at risk ($/hr)', better: 'low', digits: 0 },
  { key: 'promoExposurePct', label: 'Promo reach %', better: 'high', digits: 1 },
];

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

const activeDefects = () => state.defects.split(',').filter(Boolean);

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
  state.defects = p.get('defects') ?? DEFAULTS.defects;
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

/** Masters with the chosen defects patched in, plus the untouched reality files. */
function buildData(defectIds = activeDefects()) {
  const known = new Set(data.defects.defects.map((d) => d.id));
  const ids = defectIds.filter((id) => known.has(id));
  const patched = applyDefects({ location: data.location, products: data.products }, data.defects, ids);
  const layout = patched.location.layouts.find((l) => l.id === state.layout) ?? patched.location.layouts[0];
  return { layout, products: patched.products, segments: data.segments, planogram: data.planogram, registers: data.registers };
}

function currentLayoutDef() {
  return data.location.layouts.find((l) => l.id === state.layout) ?? data.location.layouts[0];
}

function simParams() {
  return { openCheckouts: state.openCheckouts, arrivalsPerMin: state.arrivalsPerMin, promoSlot: state.promoSlot, durationMin: state.durationMin };
}

function checkItems(list, kind) {
  return list.map((r) => `
    <li class="${r.ok ? 'ok' : kind}"><span class="mark">${r.ok ? '✓' : kind === 'bad' ? '✕' : '!'}</span>
      <span><strong>${esc(r.check)}</strong><br><small>${esc(r.detail)}</small></span></li>`).join('');
}

function renderChecks() {
  const { structural, operational } = validateMasterData(buildData());
  const sPass = structural.filter((r) => r.ok).length;
  const oPass = operational.filter((r) => r.ok).length;
  $('tier1-summary').textContent = `${sPass} of ${structural.length} passed`;
  $('tier1-summary').className = `tier-badge ${sPass === structural.length ? 'ok' : 'bad'}`;
  $('tier2-summary').textContent = oPass === operational.length ? `${oPass} of ${operational.length} in sync` : `${operational.length - oPass} out of sync`;
  $('tier2-summary').className = `tier-badge ${oPass === operational.length ? 'ok' : 'warn'}`;
  $('tier1-list').innerHTML = checkItems(structural, 'bad');
  $('tier2-list').innerHTML = checkItems(operational, 'warn');
  $('governance-verdict').hidden = !(sPass === structural.length && oPass < operational.length);
  return sPass === structural.length;
}

function renderDefectToggles() {
  const active = new Set(activeDefects());
  $('defects').innerHTML = data.defects.defects.map((d) => `
    <label class="defect">
      <input type="checkbox" value="${esc(d.id)}" ${active.has(d.id) ? 'checked' : ''}>
      <span><strong>${esc(d.name)}</strong> <span class="domain">${esc(d.domain)}</span><br>
      <small>${esc(d.summary)} ${esc(d.howItReachesShoppers)}</small></span>
    </label>`).join('');
}

function syncControls() {
  const layout = currentLayoutDef();
  state.layout = layout.id;
  $('layout').value = layout.id;
  $('layout-desc').textContent = layout.description;
  const promo = $('promo');
  promo.innerHTML = '<option value="none">No promo stand</option>' + Object.entries(layout.promoSlots)
    .map(([k, s]) => `<option value="${esc(k)}">${esc(s.label)}</option>`).join('');
  if (state.promoSlot !== 'none' && !layout.promoSlots[state.promoSlot]) state.promoSlot = DEFAULTS.promoSlot;
  promo.value = state.promoSlot;
  const maxLanes = data.registers.registers.length;
  state.openCheckouts = Math.min(state.openCheckouts, maxLanes);
  $('checkouts').max = String(maxLanes);
  $('checkouts').value = String(state.openCheckouts);
  $('checkouts-out').textContent = state.openCheckouts;
  $('arrivals').value = String(state.arrivalsPerMin);
  $('arrivals-out').textContent = state.arrivalsPerMin;
  $('duration').value = String(state.durationMin);
  $('seed').value = String(state.seed);
  $('speed').value = String(state.speed);
  $('speed-out').textContent = `${state.speed}×`;
  $('heat').checked = state.heat === 1;
  renderDefectToggles();
}

function resetSimulation() {
  running = false;
  const ok = renderChecks();
  $('play').disabled = !ok;
  if (!ok) { sim = null; updatePlayButton(); return; }
  sim = createSimulation({ data: buildData(), params: simParams(), seed: state.seed });
  renderer.setSimulation(sim);
  renderer.draw({ showHeat: state.heat === 1 });
  updateMetrics();
  updatePlayButton();
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
  set('m-shoppers-sub', `${m.completed} left · ${m.inStore} in store`);
  set('m-time', m.avgTimeInStoreMin.toFixed(1));
  set('m-wait', m.avgQueueWaitSec.toFixed(0));
  set('m-walkouts', m.walkouts);
  set('m-lost', m.lostItems);
  set('m-dead', m.deadLaneDetours);
  set('m-promo', m.promoExposurePct === null ? '—' : `${m.promoExposurePct.toFixed(0)}%`);
  set('m-risk', `$${m.revenueAtRiskPerHour.toLocaleString()}`);
  set('m-risk-sub', `of $${m.revenuePerHour.toLocaleString()}/hr captured`);
  $('m-walkouts-card').classList.toggle('alert', m.walkouts > 0);
  $('m-lost-card').classList.toggle('alert', m.lostItems > 0);
  $('m-dead-card').classList.toggle('alert', m.deadLaneDetours > 0);
  $('m-risk-card').classList.toggle('alert', m.revenueAtRiskPerHour > 0);
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

function defectLabel(ids) {
  if (!ids.length) return 'Clean master data';
  return ids.map((id) => data.defects.defects.find((d) => d.id === id)?.name ?? id).join(' + ');
}

function setupSummary(ids, seeds) {
  const layout = currentLayoutDef();
  const promo = state.promoSlot === 'none' ? 'none' : layout.promoSlots[state.promoSlot].label;
  return `${layout.name} · ${state.openCheckouts} lanes · ${state.arrivalsPerMin}/min · promo: ${promo} · ${seeds}`;
}

/** Run one scenario across several seeds; return mean, min and max per metric. */
function runAcrossSeeds(ids, seeds) {
  const d = buildData(ids);
  const results = seeds.map((seed) => createSimulation({ data: d, params: simParams(), seed }).runToEnd());
  const agg = {};
  for (const c of RUN_COLUMNS) {
    const vals = results.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined);
    agg[c.key] = vals.length
      ? { mean: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) }
      : null;
  }
  return agg;
}

function saveSingleRun() {
  if (!sim) return;
  const m = sim.metrics();
  const metrics = Object.fromEntries(RUN_COLUMNS.map((c) => [c.key, m[c.key] === null ? null : { mean: m[c.key], min: m[c.key], max: m[c.key] }]));
  runs.push({ id: String(Date.now()), tag: defectLabel(activeDefects()), defects: activeDefects(),
    setup: setupSummary(activeDefects(), `seed ${state.seed} · ${Math.round(sim.tick / 60)} min`), metrics });
  persistRuns();
  renderRuns();
}

function runDefectMatrix() {
  const ids = data.defects.defects.map((d) => d.id);
  const combos = [[]];
  for (const id of ids) combos.push([id]);
  if (ids.length > 1) combos.push(ids);
  const seeds = Array.from({ length: MATRIX_SEEDS }, (_, i) => state.seed + i);
  const group = String(Date.now());
  for (const combo of combos) {
    runs.push({ id: `${group}-${combo.join('+') || 'clean'}`, group, tag: defectLabel(combo), defects: combo,
      setup: setupSummary(combo, `${MATRIX_SEEDS} seeds from ${state.seed} · ${state.durationMin} min`), metrics: runAcrossSeeds(combo, seeds) });
  }
  persistRuns();
  renderRuns();
  $('compare-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * For the latest matrix: compare the combined effect of all defects with the
 * sum of their individual effects. Tells you whether defects compound,
 * simply add up, or mask each other.
 */
function interactionNote() {
  const group = [...runs].reverse().find((r) => r.group)?.group;
  if (!group) return '';
  const g = runs.filter((r) => r.group === group);
  const clean = g.find((r) => r.defects.length === 0);
  const singles = g.filter((r) => r.defects.length === 1);
  const both = g.find((r) => r.defects.length > 1);
  if (!clean || !both || singles.length < 2) return '';
  const line = (key, unit, digits) => {
    const base = clean.metrics[key].mean;
    const sum = singles.reduce((s, r) => s + (r.metrics[key].mean - base), 0);
    const actual = both.metrics[key].mean - base;
    const f = (v) => `${v >= 0 ? '+' : '−'}${unit === '$' ? '$' : ''}${Math.abs(v).toFixed(digits)}${unit === '$' ? '' : unit}`;
    let verdict = 'roughly add up';
    if (Math.abs(sum) > 1e-9) {
      const ratio = actual / sum;
      if (ratio > 1.15) verdict = 'compound: the whole is worse than the parts';
      else if (ratio < 0.85) verdict = 'partly mask each other';
    }
    return `<li><strong>${RUN_COLUMNS.find((c) => c.key === key).label}:</strong> both defects ${f(actual)} vs ${f(sum)} if the effects simply added. They <em>${verdict}</em>.</li>`;
  };
  return `<p><strong>Do the defects interact?</strong> (latest matrix, mean of ${MATRIX_SEEDS} seeds)</p><ul>
    ${line('avgQueueWaitSec', 's', 1)}${line('revenueAtRiskPerHour', '$', 0)}${line('walkouts', '', 1)}</ul>`;
}

function renderRuns() {
  const table = $('runs');
  $('runs-empty').hidden = runs.length > 0;
  table.hidden = runs.length === 0;
  $('clear-runs').hidden = runs.length === 0;
  $('interaction').innerHTML = interactionNote();
  $('interaction').hidden = !$('interaction').innerHTML;
  if (!runs.length) return;
  const extremes = Object.fromEntries(RUN_COLUMNS.map((c) => {
    const vals = runs.map((r) => r.metrics[c.key]?.mean).filter((v) => v !== null && v !== undefined).map((v) => +v.toFixed(c.digits));
    return [c.key, { min: Math.min(...vals), max: Math.max(...vals), varies: new Set(vals).size > 1 }];
  }));
  const cell = (c, m) => {
    if (!m) return '<td class="num">—</td>';
    const v = +m.mean.toFixed(c.digits);
    const e = extremes[c.key];
    let cls = 'num';
    if (e.varies) {
      if (v === (c.better === 'low' ? e.min : e.max)) cls += ' best';
      else if (v === (c.better === 'low' ? e.max : e.min)) cls += ' worst';
    }
    const range = m.min !== m.max ? `<br><small class="range">${m.min}–${m.max}</small>` : '';
    return `<td class="${cls}">${v.toLocaleString()}${range}</td>`;
  };
  table.innerHTML = `
    <thead><tr><th>#</th><th>Scenario</th>${RUN_COLUMNS.map((c) => `<th class="num">${c.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>${runs.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td><strong class="${r.defects.length ? 'dq-dirty' : ''}">${esc(r.tag)}</strong><br><small>${esc(r.setup)}</small></td>
        ${RUN_COLUMNS.map((c) => cell(c, r.metrics[c.key])).join('')}
        <td><button class="link" data-remove="${esc(r.id)}" aria-label="Remove run ${i + 1}">✕</button></td>
      </tr>`).join('')}</tbody>`;
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
  $('defects').addEventListener('change', onChange(() => {
    state.defects = [...$('defects').querySelectorAll('input:checked')].map((i) => i.value).join(',');
  }));
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
  $('save').addEventListener('click', saveSingleRun);
  $('matrix').addEventListener('click', runDefectMatrix);
  $('clear-runs').addEventListener('click', () => { runs = []; persistRuns(); renderRuns(); });
  $('runs').addEventListener('click', (e) => {
    const id = e.target?.dataset?.remove;
    if (!id) return;
    runs = runs.filter((r) => r.id !== id);
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
    resizeTimer = setTimeout(() => { if (sim) { renderer.resize(); renderer.draw({ showHeat: state.heat === 1 }); } }, 120);
  });
}

function renderLegend() {
  $('legend-missions').innerHTML = data.segments.segments.map((s) => `
    <li><span class="swatch round" style="background:${esc(s.color)}"></span>${esc(s.name)}<small>${Math.round(s.share * 100)}%</small></li>`).join('');
  $('legend-categories').innerHTML = data.products.categories.map((c) => `
    <li><span class="swatch" style="background:${esc(c.color)}"></span>${esc(c.name)}</li>`).join('');
  $('layout').innerHTML = data.location.layouts.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
}

async function main() {
  try {
    const files = ['location-master', 'product-master', 'customer-segments', 'planogram', 'pos-registers', 'defects'];
    const [location, products, segments, planogram, registers, defects] = await Promise.all(files.map((f) => loadJson(`data/${f}.json`)));
    data = { location, products, segments, planogram, registers, defects };
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
