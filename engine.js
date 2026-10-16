// Election model and STV count, shared by index.html (as a classic script, so these
// declarations are globals) and the Node tests (via module.exports). Pure functions only:
// no DOM access and no UI state.

// Candidates live on the grid 0.5, 2.5, 4.5, ..., 100.5. Any two grid points are an even
// distance apart, so their midpoint is a half-integer and no integer-positioned voter can be
// equidistant from two candidates. The grid is symmetric about 50.5, the center of 1-100.
const CAND_MIN = 0.5, CAND_MAX = 100.5;
const clampCand = x => Math.max(CAND_MIN, Math.min(CAND_MAX, x));
const onGrid = x => (x - CAND_MIN) % 2 === 0;

// Nearest grid point (for drags and defaults)
function snapToGrid(x) {
  return clampCand(CAND_MIN + 2 * Math.round((x - CAND_MIN) / 2));
}

// Grid point for an off-grid loaded position: always moves toward the center (50.5), so a
// symmetric configuration stays symmetric
function snapTowardCenter(x) {
  const k = (x - CAND_MIN) / 2;
  return clampCand(CAND_MIN + 2 * (x < 50.5 ? Math.ceil(k) : Math.floor(k)));
}

// --- Voter model ---

function normalPDF(x, mean, sd) {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

// Distribute approximately N voters across integer positions 1-100 using a normal
// distribution, clipped to that range. Returns array indexed 0-99 (position = index+1).
// Each position is rounded independently (no largest-remainder allocation, which would
// need a tie-break among equal remainders), so the total may differ slightly from N.
// Summing in sorted order makes the normalization identical for mirror-image
// distributions, so they produce exactly mirrored counts.
function distributeVoters(mean, sd, n) {
  const raw = [];
  for (let v = 1; v <= 100; v++) raw.push(normalPDF(v, mean, sd));
  const sum = [...raw].sort((a, b) => a - b).reduce((a, b) => a + b, 0);
  return raw.map(p => Math.round((p / sum) * n));
}

// --- Rankings ---

// Returns party number (1-indexed) for a voter at position v, based on dividing lines
function getVoterParty(v, divLines) {
  let party = 1;
  for (const line of divLines) { if (v > line) party++; else break; }
  return party;
}

// For each occupied voter position, rank candidates by proximity. When `partyDivLines` is
// given (leakage disabled), each voter ranks own-party candidates first, with parties
// determined by those dividing lines. Candidates the voter is equidistant from are joined
// with " = " and reported as ties; positions with no voters cannot produce ties.
// Returns { rankings: [{ ranking: "A > B > C > D", count }], ties: [{ position, count, tied }],
// byPosition } with rankings in left-to-right order of first appearance (voter position
// 1 → 100); byPosition[i] is the ranking string of voters at position i + 1 (null if none).
function computeRankings(totals, candidates, partyDivLines = null) {
  const seen = new Map(); // ranking string → count
  const order = [];       // insertion order
  const ties = [];
  const byPosition = Array(100).fill(null);

  // Sort a group by distance, splitting it into runs of equal distance
  function runsByDistance(group) {
    const sorted = [...group].sort((a, b) => a.dist - b.dist);
    const runs = [];
    for (const c of sorted) {
      const last = runs[runs.length - 1];
      if (last && last[0].dist === c.dist) last.push(c); else runs.push([c]);
    }
    return runs;
  }

  for (let i = 0; i < 100; i++) {
    const count = totals[i];
    if (count === 0) continue;
    const v = i + 1;
    const withDist = candidates.map(c => ({ ...c, dist: Math.abs(v - c.pos) }));

    let runs;
    if (partyDivLines) {
      const voterParty = getVoterParty(v, partyDivLines);
      runs = [...runsByDistance(withDist.filter(c => c.party === voterParty)),
              ...runsByDistance(withDist.filter(c => c.party !== voterParty))];
    } else {
      runs = runsByDistance(withDist);
    }

    for (const run of runs) {
      if (run.length > 1) ties.push({ position: v, count, tied: run.map(c => c.label) });
    }
    const ranked = runs.map(run => run.map(c => c.label).join(' = ')).join(' > ');
    byPosition[i] = ranked;

    if (!seen.has(ranked)) { seen.set(ranked, 0); order.push(ranked); }
    seen.set(ranked, seen.get(ranked) + count);
  }

  return { rankings: order.map(r => ({ ranking: r, count: seen.get(r) })), ties, byPosition };
}

// --- STV count ---

// Exact rational arithmetic on BigInt numerator/denominator pairs, so that
// "tied" means exactly equal rather than equal within a floating-point tolerance.
function bigGcd(a, b) {
  if (a < 0n) a = -a;
  while (b) [a, b] = [b, a % b];
  return a;
}
function Q(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (d < 0n) { n = -n; d = -d; }
  const g = bigGcd(n, d);
  return { n: n / g, d: d / g };
}
const Q0 = Q(0);
const qadd = (a, b) => a.d === b.d ? Q(a.n + b.n, a.d) : Q(a.n * b.d + b.n * a.d, a.d * b.d);
const qsub = (a, b) => qadd(a, { n: -b.n, d: b.d });
const qmul = (a, b) => Q(a.n * b.n, a.d * b.d);
const qdiv = (a, b) => Q(a.n * b.d, a.d * b.n);
const qcmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
// Convert to a Number for display, scaling first so huge numerators/denominators don't overflow
function qnum(a) {
  const SCALE = 10n ** 12n;
  return Number((a.n * SCALE) / a.d) / 1e12;
}

// Snapshot current ballot groups: collapse identical remaining-candidate prefixes.
function snapshotBallots(ballots, active) {
  const map = new Map();
  for (const b of ballots) {
    if (b.weight.n === 0n) continue;
    const key = b.prefs.filter(c => active.has(c)).join(' > ');
    if (!key) continue;
    map.set(key, qadd(map.get(key) || Q0, b.weight));
  }
  // Return in insertion order (left→right, matches original ranking order)
  return [...map.entries()].map(([ranking, weight]) => ({ ranking, weight: qnum(weight) }));
}

// Runs STV with no tie-break rules. All candidates at or above quota in a round are
// elected together and their surpluses transferred simultaneously, so the result does not
// depend on any ordering among them. If two or more candidates are tied for fewest votes,
// the count stops and `tie` describes it. Arithmetic is exact; the returned steps carry
// Numbers for display.
function runSTV(rankingRows, seats) {
  const totalVotes = rankingRows.reduce((s, r) => s + r.count, 0);
  const quota = Math.floor(totalVotes / (seats + 1)) + 1;
  const quotaQ = Q(quota);

  let ballots = rankingRows.map(r => ({
    prefs: r.ranking.split(' > '),
    weight: Q(r.count),
  }));

  const allCands = [...new Set(rankingRows.flatMap(r => r.ranking.split(' > ')))];
  let active = new Set(allCands);
  let elected = [];
  let steps = [];
  let tie = null;

  const topOf = b => b.prefs.find(c => active.has(c));

  function tally() {
    const t = {};
    for (const c of active) t[c] = Q0;
    for (const b of ballots) {
      const top = topOf(b);
      if (top) t[top] = qadd(t[top], b.weight);
    }
    return t;
  }
  const tallyNums = t => Object.fromEntries(Object.entries(t).map(([c, v]) => [c, qnum(v)]));

  // Elect `winners` (candidate → transfer fraction): each ballot whose current top choice is a
  // winner keeps `fraction` of its weight for later rounds. Records the step.
  function electTogether(type, winners, t, extra) {
    const perBallot = ballots.map(b => {
      const top = topOf(b);
      if (!winners.has(top)) return { used: 0, after: qnum(b.weight) };
      const after = qmul(b.weight, winners.get(top));
      const used = qsub(b.weight, after);
      b.weight = after;
      return { used: qnum(used), after: qnum(after) };
    });
    for (const c of winners.keys()) { active.delete(c); elected.push(c); }
    perBallot.forEach((p, i) => {
      p.rankingAfter = ballots[i].prefs.filter(c => active.has(c)).join(' > ') || '—';
    });
    steps.push({ type, candidates: [...winners.keys()], tally: tallyNums(t), ...extra,
                 ballots: snapshotBallots(ballots, active), perBallot });
  }

  while (elected.length < seats && active.size > 0) {
    const t = tally();
    // Candidates in descending order of votes (equal votes keep their order; display only)
    const byVotes = Object.keys(t).sort((a, b) => qcmp(t[b], t[a]));

    // Auto-elect if remaining active candidates == remaining seats
    if (active.size <= seats - elected.length) {
      electTogether('elect_remaining', new Map(byVotes.map(c => [c, Q0])), t, {});
      break;
    }

    const atQuota = byVotes.filter(c => qcmp(t[c], quotaQ) >= 0);
    if (atQuota.length > 0) {
      // At most (seats - elected) candidates can reach the Droop quota at once
      const winners = new Map(atQuota.map(c => [c, qdiv(qsub(t[c], quotaQ), t[c])]));
      const details = atQuota.map(c => ({
        candidate: c, votes: qnum(t[c]), surplus: qnum(qsub(t[c], quotaQ)), fraction: qnum(winners.get(c)),
      }));
      electTogether('elect', winners, t, { details });
    } else {
      const fewest = t[byVotes[byVotes.length - 1]];
      const losers = byVotes.filter(c => qcmp(t[c], fewest) === 0);
      if (losers.length > 1) {
        tie = { round: steps.length + 1, candidates: losers.sort(), votes: qnum(fewest), tally: tallyNums(t) };
        break;
      }
      const loser = losers[0];
      active.delete(loser);
      const perBallot = ballots.map(b => ({
        weightBefore: qnum(b.weight),
        rankingAfter: b.prefs.filter(c => active.has(c)).join(' > ') || '—',
      }));
      steps.push({ type: 'eliminate', candidates: [loser], votes: qnum(fewest),
                   tally: tallyNums(t), ballots: snapshotBallots(ballots, active), perBallot });
    }
  }

  return { quota, totalVotes, steps, elected, tie };
}

// --- Proportionality ---

// Groups for measuring proportionality: { name, votes, seats, ballots: [{ prefs, count }] }.
// `byPosition` is computeRankings' per-position ranking strings; `winners` are the elected
// candidates ({ label, pos, party }).

// One group per voter distribution. A winner's seat goes to the distribution with the most
// voters at the candidate's position (the integer positions either side of it); distributions
// with exactly equal numbers there share the seat equally.
function distributionGroups(countsList, byPosition, winners) {
  const groups = countsList.map((counts, d) => ({
    name: `Distribution ${d + 1}`,
    votes: counts.reduce((a, b) => a + b, 0),
    seats: 0,
    ballots: counts.flatMap((count, i) => count > 0 ? [{ prefs: byPosition[i].split(' > '), count }] : []),
  }));
  for (const w of winners) {
    const near = [w.pos - 0.5, w.pos + 0.5].filter(v => v >= 1 && v <= 100);
    const local = countsList.map(counts => near.reduce((t, v) => t + counts[v - 1], 0));
    const most = Math.max(...local);
    const holders = local.flatMap((n, d) => n === most ? [d] : []);
    for (const d of holders) groups[d].seats += 1 / holders.length;
  }
  return groups;
}

// One group per party: voters by the dividing lines, seats by the winners' party labels.
function partyGroups(totals, divLines, byPosition, winners) {
  const groups = Array.from({ length: divLines.length + 1 }, (_, p) => ({
    name: `Party ${p + 1}`, votes: 0, seats: 0, ballots: [],
  }));
  totals.forEach((count, i) => {
    if (count === 0) return;
    const g = groups[getVoterParty(i + 1, divLines) - 1];
    g.votes += count;
    g.ballots.push({ prefs: byPosition[i].split(' > '), count });
  });
  for (const w of winners) groups[w.party - 1].seats += 1;
  return groups;
}

// Disproportionality between vote and seat shares (both in percent, same group order)
function gallagherIndex(v, s) {
  return Math.sqrt(0.5 * v.reduce((t, vi, i) => t + (vi - s[i]) ** 2, 0));
}
function loosemoreHanbyIndex(v, s) {
  return 0.5 * v.reduce((t, vi, i) => t + Math.abs(vi - s[i]), 0);
}

// The least disproportionality any whole-seat allocation of `seats` can achieve for these vote
// counts. Largest-remainder (Hamilton) allocation minimizes both indices. Groups with equal
// remainders give the same index values whichever gets the seat, so no tie-break is involved.
function bestDisproportionality(votes, seats) {
  const total = votes.reduce((a, b) => a + b, 0);
  const quotas = votes.map(v => v * seats / total);
  const alloc = quotas.map(Math.floor);
  const byRemainder = quotas.map((_, i) => i).sort((a, b) => (quotas[b] - alloc[b]) - (quotas[a] - alloc[a]));
  const remaining = seats - alloc.reduce((a, b) => a + b, 0);
  for (let k = 0; k < remaining; k++) alloc[byRemainder[k]]++;
  const v = votes.map(x => 100 * x / total), s = alloc.map(x => 100 * x / seats);
  return { gallagher: gallagherIndex(v, s), loosemoreHanby: loosemoreHanbyIndex(v, s) };
}

// Proportionality for solid coalitions (Droop): if a group's voters hold k whole quotas and
// all rank the same j candidates (in any order) above every other candidate, STV guarantees
// that at least min(k, j) of those j are elected. Returns the group's whole quotas and every
// such candidate set with j < numCandidates (j = numCandidates holds trivially).
function solidCoalitions(ballots, quota, numCandidates, elected) {
  const voters = ballots.reduce((t, b) => t + b.count, 0);
  const quotas = Math.floor(voters / quota);
  const coalitions = [];
  for (let j = 1; j < numCandidates && ballots.length; j++) {
    const key = b => [...b.prefs.slice(0, j)].sort().join();
    const first = key(ballots[0]);
    if (ballots.every(b => key(b) === first)) {
      const candidates = first.split(',');
      coalitions.push({
        candidates,
        guaranteed: Math.min(quotas, j),
        won: candidates.filter(c => elected.includes(c)).length,
      });
    }
  }
  return { quotas, coalitions };
}

// Measures for a finished, valid count
function proportionality(groups, seats, quota, numCandidates, elected) {
  const totalVotes = groups.reduce((t, g) => t + g.votes, 0);
  const rows = groups.map(g => ({
    name: g.name,
    votes: g.votes,
    voteShare: 100 * g.votes / totalVotes,
    idealSeats: seats * g.votes / totalVotes,
    seats: g.seats,
    seatShare: 100 * g.seats / seats,
    solid: solidCoalitions(g.ballots, quota, numCandidates, elected),
  }));
  const v = rows.map(r => r.voteShare), s = rows.map(r => r.seatShare);
  return {
    rows,
    gallagher: gallagherIndex(v, s),
    loosemoreHanby: loosemoreHanbyIndex(v, s),
    best: bestDisproportionality(groups.map(g => g.votes), seats),
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    CAND_MIN, CAND_MAX, clampCand, onGrid, snapToGrid, snapTowardCenter,
    normalPDF, distributeVoters, getVoterParty, computeRankings,
    Q, qadd, qsub, qmul, qdiv, qcmp, qnum, runSTV,
    distributionGroups, partyGroups, gallagherIndex, loosemoreHanbyIndex,
    bestDisproportionality, solidCoalitions, proportionality,
  };
}
