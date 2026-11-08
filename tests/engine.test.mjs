/**
 * Engine tests. Run with: node --test tests/
 * No dependencies: uses Node's built-in test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSimulation, validateMasterData, parseGrid, distanceField, mulberry32 } from '../src/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', `${f}.json`), 'utf8'));
const location = load('location-master');
const products = load('product-master');
const segments = load('customer-segments');

const BASE = { openCheckouts: 3, arrivalsPerMin: 3, promoSlot: 'front', dataQuality: 'clean', durationMin: 60 };
const run = (layout, params = {}, seed = 1989) =>
  createSimulation({ data: { layout, products, segments }, params: { ...BASE, ...params }, seed }).runToEnd();

test('PRNG is deterministic for a seed', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('both shipped layouts pass every master data check', () => {
  for (const layout of location.layouts) {
    const failed = validateMasterData({ layout, products, segments }).filter((r) => !r.ok);
    assert.deepEqual(failed, [], `${layout.id}: ${JSON.stringify(failed)}`);
  }
});

test('validation catches a ragged grid', () => {
  const layout = { ...location.layouts[0], grid: [...location.layouts[0].grid] };
  layout.grid[3] = layout.grid[3].slice(0, -1);
  const results = validateMasterData({ layout, products, segments });
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /row 3/);
});

test('validation catches a category with no shelf and an orphan shelf code', () => {
  const extra = { ...products, categories: [...products.categories, { id: 'toys', name: 'Toys', code: '9', color: '#000' }] };
  const r1 = validateMasterData({ layout: location.layouts[0], products: extra, segments });
  assert.equal(r1.find((r) => r.check.startsWith('Every product category')).ok, false);

  const fewer = { ...products, categories: products.categories.filter((c) => c.code !== '6') };
  const r2 = validateMasterData({ layout: location.layouts[0], products: fewer, segments });
  assert.equal(r2.find((r) => r.check.startsWith('Every shelf maps')).ok, false);
});

test('validation catches segment shares that do not sum to 100%', () => {
  const bad = { segments: segments.segments.map((s, i) => (i === 0 ? { ...s, share: s.share + 0.1 } : s)) };
  const r = validateMasterData({ layout: location.layouts[0], products, segments: bad });
  assert.equal(r.find((x) => x.check.startsWith('Customer segment')).ok, false);
});

test('distance field is zero at the source and grows by one per step', () => {
  const grid = parseGrid(['#####', '#...#', '#####']);
  const d = distanceField(grid, [6]);
  assert.deepEqual([d[6], d[7], d[8]], [0, 1, 2]);
});

test('same seed and parameters give identical results', () => {
  for (const layout of location.layouts) {
    assert.deepEqual(run(layout), run(layout));
  }
});

test('a different seed gives a different run', () => {
  const layout = location.layouts[0];
  assert.notDeepEqual(run(layout, {}, 1), run(layout, {}, 2));
});

test('clean and dirty runs face the same arriving shoppers', () => {
  const layout = location.layouts[0];
  assert.equal(run(layout, { dataQuality: 'clean' }).arrived, run(layout, { dataQuality: 'dirty' }).arrived);
});

test('clean master data produces no lost items or phantom detours', () => {
  for (const layout of location.layouts) {
    const m = run(layout);
    assert.equal(m.lostItems, 0);
    assert.equal(m.phantomDetours, 0);
  }
});

test('dirty master data costs shoppers time and queue wait, and loses items', () => {
  for (const layout of location.layouts) {
    for (const [openCheckouts, arrivalsPerMin] of [[2, 4], [3, 3], [6, 6]]) {
      const clean = run(layout, { openCheckouts, arrivalsPerMin, dataQuality: 'clean' });
      const dirty = run(layout, { openCheckouts, arrivalsPerMin, dataQuality: 'dirty' });
      const label = `${layout.id} lanes=${openCheckouts} arrivals=${arrivalsPerMin}`;
      assert.ok(dirty.lostItems > 0, `${label}: lost items`);
      assert.ok(dirty.phantomDetours > 0, `${label}: phantom detours`);
      assert.ok(dirty.avgTimeInStoreMin > clean.avgTimeInStoreMin, `${label}: time in store`);
      assert.ok(dirty.avgQueueWaitSec > clean.avgQueueWaitSec, `${label}: queue wait`);
    }
  }
});

test('opening more checkouts reduces queue wait under load', () => {
  const layout = location.layouts[0];
  const two = run(layout, { openCheckouts: 2, arrivalsPerMin: 4 });
  const five = run(layout, { openCheckouts: 5, arrivalsPerMin: 4 });
  assert.ok(five.avgQueueWaitSec < two.avgQueueWaitSec);
});

test('no gridlock: almost everyone who arrives finishes', () => {
  for (const layout of location.layouts) {
    for (const dataQuality of ['clean', 'dirty']) {
      const m = run(layout, { openCheckouts: 2, arrivalsPerMin: 4, dataQuality });
      assert.ok(m.inStore / m.arrived < 0.15, `${layout.id} ${dataQuality}: ${m.inStore} of ${m.arrived} still in store`);
    }
  }
});

test('promo reach is reported only when a stand is placed', () => {
  const layout = location.layouts[0];
  assert.equal(run(layout, { promoSlot: 'none' }).promoExposurePct, null);
  assert.ok(run(layout, { promoSlot: 'front' }).promoExposurePct > 0);
});

test('unknown promo slot is rejected with a clear error', () => {
  assert.throws(
    () => createSimulation({ data: { layout: location.layouts[0], products, segments }, params: { ...BASE, promoSlot: 'roof' }, seed: 1 }),
    /Unknown promo slot 'roof'/,
  );
});
