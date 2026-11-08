/**
 * Engine and data tests. Run with: npm test
 * No dependencies: uses Node's built-in test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSimulation, validateMasterData, parseGrid, distanceField, mulberry32 } from '../src/engine.js';
import { applyDefects, applyPatch } from '../src/defects.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', `${f}.json`), 'utf8'));
const location = load('location-master');
const products = load('product-master');
const segments = load('customer-segments');
const planogram = load('planogram');
const registers = load('pos-registers');
const catalogue = load('defects');

const BASE = { openCheckouts: 3, arrivalsPerMin: 3, promoSlot: 'front', durationMin: 60 };

/** Data for one layout with the given defects patched in. */
function dataFor(layoutId = 'grid', defectIds = []) {
  const m = applyDefects({ location, products }, catalogue, defectIds);
  const layout = m.location.layouts.find((l) => l.id === layoutId);
  return { layout, products: m.products, segments, planogram, registers };
}
const run = (data, params = {}, seed = 1989) =>
  createSimulation({ data, params: { ...BASE, ...params }, seed }).runToEnd();

/** Mean of a metric across seeds. */
function meanOver(data, key, params = {}, seeds = 10) {
  let s = 0;
  for (let i = 0; i < seeds; i++) s += run(data, params, 1000 + i)[key];
  return s / seeds;
}

test('PRNG is deterministic for a seed', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('the engine has no clean/dirty switch: defects exist only as data', () => {
  const code = readFileSync(join(root, 'src', 'engine.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .replace(/\/\/.*$/gm, ''); // strip line comments
  assert.doesNotMatch(code, /dirty|clean|dataQuality|defect|stale|zombie|phantom/i);
});

test('defect patches touch only system-of-record files', () => {
  for (const d of catalogue.defects) {
    for (const p of d.patches) assert.match(p.path, /^(location|products)\./, `${d.id}: ${p.path}`);
  }
});

test('applyDefects does not mutate the originals', () => {
  const before = JSON.stringify({ location, products });
  applyDefects({ location, products }, catalogue, ['stale-aisle', 'zombie-lane']);
  assert.equal(JSON.stringify({ location, products }), before);
});

test('applyPatch supports key filters and wildcards, and reports misses', () => {
  const doc = { a: [{ id: 'x', v: 1 }, { id: 'y', v: 2 }], b: [{ c: [{ id: 'x', v: 0 }] }, { c: [{ id: 'x', v: 0 }] }] };
  assert.equal(applyPatch(doc, 'a[id=y].v', 9), 1);
  assert.equal(doc.a[1].v, 9);
  assert.equal(applyPatch(doc, 'b[*].c[id=x].v', 5), 2);
  assert.equal(applyPatch(doc, 'a[id=zzz].v', 1), 0);
  assert.throws(() => applyDefects({ location, products }, catalogue, ['no-such-defect']), /Unknown defect/);
});

test('clean data passes every check in both tiers, on both layouts', () => {
  for (const layout of location.layouts) {
    const { structural, operational } = validateMasterData(dataFor(layout.id));
    assert.deepEqual([...structural, ...operational].filter((r) => !r.ok), [], layout.id);
  }
});

test('each defect passes Tier 1 but is caught by exactly one Tier 2 check', () => {
  const expected = { 'stale-aisle': 'Aisle signage matches the planogram', 'zombie-lane': 'No lane is open without a POS register' };
  for (const [id, check] of Object.entries(expected)) {
    const { structural, operational } = validateMasterData(dataFor('grid', [id]));
    assert.equal(structural.filter((r) => !r.ok).length, 0, `${id} should pass structural checks`);
    const failed = operational.filter((r) => !r.ok).map((r) => r.check);
    assert.deepEqual(failed, [check], id);
  }
});

test('Tier 1 catches a ragged grid and an unplanned fixture', () => {
  const d = dataFor();
  const ragged = { ...d, layout: { ...d.layout, grid: d.layout.grid.map((r, i) => (i === 3 ? r.slice(0, -1) : r)) } };
  const r1 = validateMasterData(ragged).structural;
  assert.equal(r1[0].ok, false);
  assert.match(r1[0].detail, /row 3/);

  const plan = { ...planogram, fixtures: planogram.fixtures.filter((f) => f.code !== '6') };
  const r2 = validateMasterData({ ...d, planogram: plan }).structural;
  assert.equal(r2.find((r) => r.check.startsWith('Every fixture group')).ok, false);
});

test('Tier 1 catches segment shares that do not sum to 100%', () => {
  const bad = { segments: segments.segments.map((s, i) => (i === 0 ? { ...s, share: s.share + 0.1 } : s)) };
  const r = validateMasterData({ ...dataFor(), segments: bad }).structural;
  assert.equal(r.find((x) => x.check.startsWith('Customer segment')).ok, false);
});

test('distance field is zero at the source and grows by one per step', () => {
  const grid = parseGrid(['#####', '#...#', '#####']);
  const d = distanceField(grid, [6]);
  assert.deepEqual([d[6], d[7], d[8]], [0, 1, 2]);
});

test('same seed and parameters give identical results', () => {
  for (const layout of location.layouts) assert.deepEqual(run(dataFor(layout.id)), run(dataFor(layout.id)));
});

test('every defect combination faces the same arriving shoppers', () => {
  const combos = [[], ['stale-aisle'], ['zombie-lane'], ['stale-aisle', 'zombie-lane']];
  const arrivals = combos.map((c) => run(dataFor('grid', c)).arrived);
  assert.equal(new Set(arrivals).size, 1);
});

test('clean data produces no lost items, dead-lane detours or revenue from defects', () => {
  for (const layout of location.layouts) {
    const m = run(dataFor(layout.id));
    assert.equal(m.lostItems, 0);
    assert.equal(m.deadLaneDetours, 0);
    assert.equal(m.wrongAisleVisits, 0);
  }
});

test('stale aisle loses items and revenue (mean of 10 seeds)', () => {
  for (const layout of location.layouts) {
    const clean = dataFor(layout.id);
    const stale = dataFor(layout.id, ['stale-aisle']);
    assert.ok(meanOver(stale, 'lostItems') > 10, layout.id);
    assert.ok(meanOver(stale, 'revenuePerHour') < meanOver(clean, 'revenuePerHour'), layout.id);
  }
});

test('zombie lane costs queue time, and walkouts under load (mean of 10 seeds)', () => {
  for (const layout of location.layouts) {
    const clean = dataFor(layout.id);
    const zombie = dataFor(layout.id, ['zombie-lane']);
    assert.ok(meanOver(zombie, 'avgQueueWaitSec') > meanOver(clean, 'avgQueueWaitSec') * 1.5, `${layout.id} wait`);
    const load = { openCheckouts: 2, arrivalsPerMin: 4 };
    assert.ok(meanOver(zombie, 'walkouts', load) > meanOver(clean, 'walkouts', load), `${layout.id} walkouts`);
  }
});

test('opening more checkouts reduces queue wait under load', () => {
  const d = dataFor();
  assert.ok(run(d, { openCheckouts: 5, arrivalsPerMin: 4 }).avgQueueWaitSec < run(d, { openCheckouts: 2, arrivalsPerMin: 4 }).avgQueueWaitSec);
});

test('no gridlock: almost everyone who arrives has left by the end', () => {
  for (const layout of location.layouts) {
    for (const ids of [[], ['stale-aisle', 'zombie-lane']]) {
      const m = run(dataFor(layout.id, ids), { openCheckouts: 2, arrivalsPerMin: 4 });
      assert.ok(m.inStore / m.arrived < 0.15, `${layout.id} ${ids}: ${m.inStore} of ${m.arrived} still in store`);
    }
  }
});

test('promo reach is reported only when a stand is placed', () => {
  const d = dataFor();
  assert.equal(run(d, { promoSlot: 'none' }).promoExposurePct, null);
  assert.ok(run(d, { promoSlot: 'front' }).promoExposurePct > 0);
});

test('unknown promo slot is rejected with a clear error', () => {
  assert.throws(() => createSimulation({ data: dataFor(), params: { ...BASE, promoSlot: 'roof' }, seed: 1 }), /Unknown promo slot 'roof'/);
});
