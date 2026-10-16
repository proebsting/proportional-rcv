const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CAND_MIN, CAND_MAX, onGrid, snapToGrid, snapTowardCenter,
  distributeVoters, computeRankings, runSTV,
} = require('../engine.js');

const label = i => String.fromCharCode(65 + i);
const cands = positions => positions.map((pos, i) => ({ pos, label: label(i), party: null }));
const GRID = Array.from({ length: 51 }, (_, k) => CAND_MIN + 2 * k);

function electorate(distributions) {
  const counts = distributions.map(d => distributeVoters(d.mean, d.sd, d.n));
  return counts[0].map((_, i) => counts.reduce((s, c) => s + c[i], 0));
}

function elect(config, positions = config.candidates) {
  const { rankings, ties } = computeRankings(electorate(config.distributions), cands(positions));
  assert.deepEqual(ties, [], 'ranking ties');
  return runSTV(rankings, config.seats);
}

test('grid', async t => {
  await t.test('spans 0.5..100.5 in steps of 2', () => {
    assert.equal(GRID[0], CAND_MIN);
    assert.equal(GRID[GRID.length - 1], CAND_MAX);
    assert.ok(GRID.every(onGrid));
    assert.ok(![1.5, 37.5, 20, 20.3].some(onGrid));
  });
  await t.test('snapToGrid picks the nearest grid point and clamps', () => {
    assert.equal(snapToGrid(37.4), 36.5);
    assert.equal(snapToGrid(37.6), 38.5);
    assert.equal(snapToGrid(-5), CAND_MIN);
    assert.equal(snapToGrid(500), CAND_MAX);
  });
  await t.test('snapTowardCenter moves toward 50.5 and is mirror-symmetric', () => {
    assert.equal(snapTowardCenter(37.5), 38.5);
    assert.equal(snapTowardCenter(53.5), 52.5);
    for (const x of [0.7, 1.5, 19, 37.5, 49.5, 51.5, 63.5, 99.5, 100.4]) {
      assert.ok(onGrid(snapTowardCenter(x)), `${x} lands on grid`);
      assert.equal(snapTowardCenter(101 - x), 101 - snapTowardCenter(x), `${x} mirrors`);
    }
  });
});

test('voter model', async t => {
  await t.test('mirror-image distributions give exactly mirrored counts', () => {
    for (let m = 1; m <= 100; m++) for (const sd of [1, 2, 3, 7, 12, 25, 40]) for (const n of [100, 1000, 2300, 5000]) {
      const a = distributeVoters(m, sd, n), b = distributeVoters(101 - m, sd, n);
      assert.ok(a.every((x, i) => x === b[99 - i]), `mean ${m}, sd ${sd}, n ${n}`);
    }
  });
  await t.test('counts are non-negative integers close to n', () => {
    const c = distributeVoters(30, 12, 1000);
    assert.ok(c.every(x => Number.isInteger(x) && x >= 0));
    assert.ok(Math.abs(c.reduce((a, b) => a + b, 0) - 1000) <= 10);
  });
});

test('rankings', async t => {
  const everywhere = Array(100).fill(1);

  await t.test('no ties for any pair of distinct grid positions', () => {
    for (let a = 0; a < GRID.length; a++) for (let b = a + 1; b < GRID.length; b++) {
      assert.deepEqual(computeRankings(everywhere, cands([GRID[a], GRID[b]])).ties, [], `${GRID[a]} vs ${GRID[b]}`);
    }
  });
  await t.test('coincident candidates tie at every occupied position', () => {
    const { ties, rankings } = computeRankings(everywhere, cands([40.5, 40.5]));
    assert.equal(ties.length, 100);
    assert.equal(rankings[0].ranking, 'A = B');
  });
  await t.test('off-grid candidates tie, including in lower preferences', () => {
    // A 20.5, C 37.5: voters at 29 are 8.5 from both, though B is their first choice
    const totals = Array(100).fill(0); totals[28] = 5;
    const { ties, rankings } = computeRankings(totals, cands([20.5, 28.5, 37.5]));
    assert.deepEqual(ties, [{ position: 29, count: 5, tied: ['A', 'C'] }]);
    assert.equal(rankings[0].ranking, 'B > A = C');
  });
  await t.test('ties at unoccupied positions are ignored', () => {
    const totals = Array(100).fill(0); totals[9] = 50; totals[89] = 50;
    assert.deepEqual(computeRankings(totals, cands([20.5, 41.5])).ties, []);  // midpoint 31 is empty
  });
  await t.test('party ranking: equal distances matter only within a party group', () => {
    const totals = Array(100).fill(0); totals[30] = 10;  // voters at 31, party 1 of lines [50.5]
    const cross = [{ pos: 20.5, label: 'A', party: 1 }, { pos: 41.5, label: 'B', party: 2 }];
    const r1 = computeRankings(totals, cross, [50.5]);
    assert.deepEqual(r1.ties, []);
    assert.equal(r1.rankings[0].ranking, 'A > B');
    const same = [{ pos: 20.5, label: 'A', party: 1 }, { pos: 41.5, label: 'B', party: 1 }];
    assert.deepEqual(computeRankings(totals, same, [50.5]).ties, [{ position: 31, count: 10, tied: ['A', 'B'] }]);
  });
});

test('STV count', async t => {
  await t.test('candidates reaching quota together are elected in one round', () => {
    const res = runSTV([
      { ranking: 'A > B > C', count: 500 },
      { ranking: 'B > A > C', count: 500 },
      { ranking: 'C > A > B', count: 100 },
    ], 2);
    assert.equal(res.quota, 367);
    assert.equal(res.steps.length, 1);
    assert.deepEqual(res.steps[0].candidates, ['A', 'B']);
    const used = res.steps[0].perBallot.reduce((s, p) => s + p.used, 0);
    assert.ok(Math.abs(used - 2 * res.quota) < 1e-9);
  });
  await t.test('a tie for fewest votes stops the count', () => {
    const res = runSTV([
      { ranking: 'A > B > C', count: 10 },
      { ranking: 'B > A > C', count: 6 },
      { ranking: 'C > A > B', count: 6 },
    ], 1);
    assert.deepEqual(res.tie && [res.tie.round, res.tie.candidates, res.tie.votes], [1, ['B', 'C'], 6]);
    assert.deepEqual(res.elected, []);
  });
  await t.test('a one-vote difference is not a tie', () => {
    const res = runSTV([
      { ranking: 'A > B > C', count: 1000000 },
      { ranking: 'B > A > C', count: 999999 },
      { ranking: 'C > B > A', count: 999998 },
    ], 1);
    assert.equal(res.tie, null);
    assert.deepEqual([res.steps[0].type, res.steps[0].candidates], ['eliminate', ['C']]);
  });
  await t.test('ties after fractional transfers are detected exactly', () => {
    // Quota 10; A's surplus of 8 transfers at 4/9, giving B and C exactly 9 * 4/9 + 1 = 5 each
    const res = runSTV([
      { ranking: 'A > B > C', count: 9 },
      { ranking: 'A > C > B', count: 9 },
      { ranking: 'B > C > A', count: 1 },
      { ranking: 'C > B > A', count: 1 },
      { ranking: 'D > B > C', count: 7 },
    ], 2);
    assert.equal(res.quota, 10);
    assert.deepEqual(res.steps.map(s => s.candidates), [['A']]);
    assert.deepEqual(res.tie && [res.tie.candidates, res.tie.votes], [['B', 'C'], 5]);
  });
  await t.test('symmetric electorate: mirror pairs are elected together or tie', () => {
    const config = { distributions: [{ mean: 30, sd: 12, n: 1500 }, { mean: 71, sd: 12, n: 1500 }],
                     candidates: [20.5, 36.5, 50.5, 64.5, 80.5], seats: 3 };
    const res = elect(config);
    assert.deepEqual(res.steps.map(s => [s.type, s.candidates]), [['eliminate', ['C']], ['elect', ['B', 'D']]]);
    assert.deepEqual(res.tie.candidates, ['A', 'E']);
  });
  await t.test('stays fast for large elections', () => {
    const config = { distributions: [{ mean: 30, sd: 15, n: 1500 }, { mean: 70, sd: 15, n: 3500 }],
                     candidates: Array.from({ length: 26 }, (_, i) => snapToGrid((i + 1) / 27 * 100)), seats: 20 };
    const start = performance.now();
    elect(config);
    assert.ok(performance.now() - start < 500);
  });
});

// The example files were made before the grid; moved one unit toward the center, each must
// still produce the winners stored in the file.
test('examples keep their outcomes on the grid', async t => {
  const dir = path.join(__dirname, '..', 'examples');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    await t.test(file, () => {
      const ex = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const positions = ex.config.candidates.map(p => onGrid(p) ? p : snapTowardCenter(p));
      const res = elect(ex.config, positions);
      assert.equal(res.tie, null);
      assert.deepEqual(res.elected, ex.stv.elected);
    });
  }
});
