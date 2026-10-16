// Built-in examples, shown in the "Load example…" menu and loadable by URL:
//
//   index.html?example=<id>
//
// Fields:
//   id           URL name: lowercase letters, digits and hyphens; must be unique and should
//                never change once shared, since links depend on it
//   title        shown in the menu and as the heading of the explanation panel
//   description  HTML shown in the explanation panel when the example is loaded
//   config       same format as the "config" object of an uploaded or downloaded file
//
// Shared by index.html (as a classic script, so EXAMPLES is a global) and the tests.

const EXAMPLES = [
  {
    id: '2-of-4',
    title: 'Two equal blocs, four candidates, two seats',
    description: `
      <p>Two equal blocs of voters, centered at 25 and 75, each with two candidates. Two seats.</p>
      <p>The result is proportional: each bloc wins one seat. But on the left, the seat goes to
      B rather than A, even though A has more first preferences (540 to 453). C, the right
      bloc's moderate, is eliminated first; most of C's votes go to D, who is elected with a
      large surplus. That surplus comes from right-bloc voters whose next choice is B, the left's
      moderate, and it lifts B past A (790 to 540). The right bloc chooses which left candidate
      wins.</p>`,
    config: {
      distributions: [{ mean: 25, sd: 12, n: 1000 }, { mean: 75, sd: 12, n: 1000 }],
      candidates: [18.5, 34.5, 64.5, 80.5],
      seats: 2,
    },
  },
  {
    id: '3-of-6',
    title: 'A one-third bloc wins no seats',
    description: `
      <p>A left bloc of 1,000 voters (one third of the electorate) and a right bloc of 2,000,
      each with three candidates. Three seats.</p>
      <p>The left bloc holds a full Droop quota, so a proportional result gives it one seat. It
      wins none. Its first preferences split almost evenly among A, B and C (319, 293 and 329),
      so none of them gets close to the quota. After E and F are elected, B and then C are
      eliminated. C's votes split almost evenly between A and the centrist D, which leaves D
      ahead, and D takes the last seat (789 to A's 708).</p>
      <p>STV's proportionality guarantee doesn't apply because the left bloc isn't a solid
      coalition: its voters rank by distance, and many rank D above some of the left
      candidates.</p>`,
    config: {
      distributions: [{ mean: 30, sd: 12, n: 1000 }, { mean: 70, sd: 12, n: 2000 }],
      candidates: [20.5, 28.5, 38.5, 52.5, 66.5, 82.5],
      seats: 3,
    },
  },
];

if (typeof module !== 'undefined') module.exports = { EXAMPLES };
