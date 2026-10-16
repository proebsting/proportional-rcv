const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CAND_MIN, CAND_MAX, onGrid, snapToGrid, snapTowardCenter,
  DIV_MIN, DIV_MAX, clampDivLine, normalizeDivLines, validDivLines,
  distributeVoters, computeRankings, runSTV,
  distributionGroups, partyGroups, gallagherIndex, loosemoreHanbyIndex,
  bestDisproportionality, solidCoalitions, proportionality,
} = require('../engine.js');
const { EXAMPLES } = require('../examples.js');

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
    assert.ok(performance.now() - start < 2000);  // generous: CI machines are slower
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

test('proportionality', async t => {
  await t.test('indices on a known case', () => {
    assert.equal(gallagherIndex([50, 50], [100, 0]), 50);
    assert.equal(loosemoreHanbyIndex([50, 50], [100, 0]), 50);
    assert.equal(loosemoreHanbyIndex([60, 30, 10], [50, 50, 0]), 20);
    assert.ok(Math.abs(gallagherIndex([60, 30, 10], [50, 50, 0]) - Math.sqrt(300)) < 1e-12);
  });

  await t.test('best achievable equals the brute-force minimum over all allocations', () => {
    // Every way to give `seats` whole seats to n groups
    const allocations = (n, seats) => n === 1 ? [[seats]]
      : Array.from({ length: seats + 1 }, (_, k) => allocations(n - 1, seats - k).map(a => [k, ...a])).flat();
    let rng = 12345;
    const rand = m => (rng = (rng * 1103515245 + 12345) % 2 ** 31) % m;
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + rand(3), seats = 1 + rand(6);
      const votes = Array.from({ length: n }, () => 1 + rand(1000));
      const total = votes.reduce((a, b) => a + b, 0);
      const v = votes.map(x => 100 * x / total);
      let g = Infinity, lh = Infinity;
      for (const a of allocations(n, seats)) {
        const s = a.map(x => 100 * x / seats);
        g = Math.min(g, gallagherIndex(v, s)); lh = Math.min(lh, loosemoreHanbyIndex(v, s));
      }
      const best = bestDisproportionality(votes, seats);
      assert.ok(Math.abs(best.gallagher - g) < 1e-9 && Math.abs(best.loosemoreHanby - lh) < 1e-9, JSON.stringify({ votes, seats }));
    }
  });

  await t.test('3-of-6 example: the one-third distribution wins no seats', () => {
    const config = { distributions: [{ mean: 30, sd: 12, n: 1000 }, { mean: 70, sd: 12, n: 2000 }],
                     candidates: [20.5, 28.5, 38.5, 52.5, 66.5, 82.5], seats: 3 };
    const counts = config.distributions.map(d => distributeVoters(d.mean, d.sd, d.n));
    const totals = counts[0].map((c, i) => c + counts[1][i]);
    const cs = cands(config.candidates);
    const r = computeRankings(totals, cs);
    const res = runSTV(r.rankings, 3);
    const winners = cs.filter(c => res.elected.includes(c.label));
    const p = proportionality(distributionGroups(counts, r.byPosition, winners), 3, res.quota, 6, res.elected);
    assert.deepEqual(p.rows.map(x => x.seats), [0, 3]);
    assert.ok(Math.abs(p.gallagher - 100 / 3) < 0.1);
    assert.ok(p.best.gallagher < 0.1);
    // Distribution 1 holds a quota, but its voters disagree on their top candidates
    assert.equal(p.rows[0].solid.quotas, 1);
    assert.deepEqual(p.rows[0].solid.coalitions, []);
  });

  await t.test('a winner where distributions have equal voters splits the seat', () => {
    const c1 = Array(100).fill(0), c2 = Array(100).fill(0);
    c1[49] = 10; c2[50] = 10;  // 10 voters at 50 and 10 at 51; candidate at 50.5 between them
    const byPosition = Array(100).fill(null); byPosition[49] = byPosition[50] = 'A';
    const groups = distributionGroups([c1, c2], byPosition, [{ label: 'A', pos: 50.5 }]);
    assert.deepEqual(groups.map(g => g.seats), [0.5, 0.5]);
  });

  await t.test('party voters without leakage form solid coalitions', () => {
    const totals = distributeVoters(50, 20, 3000);
    const cs = [20.5, 30.5, 40.5, 60.5, 70.5].map((pos, i) => ({ pos, label: label(i), party: pos < 50 ? 1 : 2 }));
    const r = computeRankings(totals, cs, [50.5]);
    const groups = partyGroups(totals, [50.5], r.byPosition, []);
    const left = solidCoalitions(groups[0].ballots, 1000, 5, []);
    // All left voters rank A-C first, and (as D is nearer than E) A-D first too
    assert.deepEqual(left.coalitions.map(c => c.candidates), [['A', 'B', 'C'], ['A', 'B', 'C', 'D']]);
    // With leakage, the same voters rank by distance alone and are not solid
    const r2 = computeRankings(totals, cs);
    assert.deepEqual(solidCoalitions(partyGroups(totals, [50.5], r2.byPosition, [])[0].ballots, 1000, 5, []).coalitions, []);
  });

  await t.test('STV always meets its solid-coalition guarantee', () => {
    let rng = 777, checked = 0;
    const rand = m => (rng = (rng * 1103515245 + 12345) % 2 ** 31) % m;
    for (let trial = 0; trial < 400; trial++) {
      const positions = [...new Set(Array.from({ length: 3 + rand(5) }, () => GRID[rand(GRID.length)]))];
      if (positions.length < 3) continue;
      const seats = 1 + rand(positions.length - 1);
      const lines = [[30.5, 50.5, 70.5][rand(3)]];
      const cs = positions.map((pos, i) => ({ pos, label: label(i), party: pos < lines[0] ? 1 : 2 }));
      const d = [{ mean: 1 + rand(100), sd: 3 + rand(20), n: 500 + rand(3000) }, { mean: 1 + rand(100), sd: 3 + rand(20), n: 500 + rand(3000) }];
      const counts = d.map(x => distributeVoters(x.mean, x.sd, x.n));
      const totals = counts[0].map((c, i) => c + counts[1][i]);
      const r = computeRankings(totals, cs, rand(2) ? lines : null);
      const res = runSTV(r.rankings, seats);
      if (res.tie) continue;
      const winners = cs.filter(c => res.elected.includes(c.label));
      for (const groups of [partyGroups(totals, lines, r.byPosition, winners), distributionGroups(counts, r.byPosition, winners)]) {
        const p = proportionality(groups, seats, res.quota, cs.length, res.elected);
        assert.ok(Math.abs(p.rows.reduce((t, x) => t + x.seats, 0) - seats) < 1e-9, 'seats add up');
        for (const row of p.rows) for (const c of row.solid.coalitions) {
          checked++;
          assert.ok(c.won >= c.guaranteed, JSON.stringify({ trial, row: row.name, c }));
        }
      }
    }
    assert.ok(checked > 50, `checked ${checked} coalitions`);
  });
});

test('built-in examples', async t => {
  await t.test('ids are unique and URL-safe', () => {
    const ids = EXAMPLES.map(ex => ex.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  for (const ex of EXAMPLES) {
    await t.test(`${ex.id} has text, is on the grid and has no ties`, () => {
      assert.ok(ex.title && ex.description.trim());
      assert.ok(ex.config.candidates.every(onGrid));
      assert.equal(elect(ex.config).tie, null);
    });
  }
});

test('party dividing lines', async t => {
  await t.test('a moved line stops one unit short of its neighbors and the ends', () => {
    const lines = [30.5, 50.5, 70.5];
    assert.equal(clampDivLine(lines, 1, 90), 69.5);
    assert.equal(clampDivLine(lines, 1, 10), 31.5);
    assert.equal(clampDivLine(lines, 1, 60.2), 60.5);
    assert.equal(clampDivLine(lines, 0, -5), DIV_MIN);
    assert.equal(clampDivLine(lines, 2, 500), DIV_MAX);
  });
  await t.test('normalizing leaves valid lines alone and fixes invalid ones minimally', () => {
    assert.deepEqual(normalizeDivLines([20.5, 40.5, 60.5]), [20.5, 40.5, 60.5]);
    assert.deepEqual(normalizeDivLines([80.5, 66.5]), [80.5, 81.5]);             // crossed: pushed apart
    assert.deepEqual(normalizeDivLines([99.5, 99.5, 99.5]), [97.5, 98.5, 99.5]);  // crowded at the end
    assert.deepEqual(normalizeDivLines([0, 0]), [1.5, 2.5]);
  });
  await t.test('normalized lines are always increasing, at least 1 apart and in range', () => {
    let rng = 99;
    const rand = m => (rng = (rng * 1103515245 + 12345) % 2 ** 31) % m;
    for (let trial = 0; trial < 500; trial++) {
      const out = normalizeDivLines(Array.from({ length: 1 + rand(9) }, () => rand(120) - 10 + rand(10) / 10));
      assert.ok(validDivLines(out));
      out.forEach((x, k) => {
        assert.ok(x >= DIV_MIN && x <= DIV_MAX && x % 1 === 0.5);
        if (k > 0) assert.ok(x >= out[k - 1] + 1);
      });
    }
  });
  await t.test('validity', () => {
    assert.ok(validDivLines([50.5]));
    assert.ok(validDivLines([]));
    assert.ok(!validDivLines([60.5, 40.5]));
    assert.ok(!validDivLines([40.5, 40.5]));
    assert.ok(!validDivLines([50]));
  });
});
