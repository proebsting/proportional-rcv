# proportional-rcv

Interactive demonstrations that STV is not as proportional as it is often assumed to be,
under (possibly contrived) scenarios on a one-dimensional political spectrum.

There are no tie-break rules: any configuration that produces a tie, in a voter's ranking
or in the count, is reported as invalid.

## Files

The site is four static pieces, with no build step and no server code:

- `index.html` — the page (UI and rendering)
- `engine.js` — voter model, rankings, the exact-arithmetic STV count and proportionality
  measures; pure functions shared by the page and the tests
- `examples.js` — the built-in examples
- `vendor/` — D3 v7.9.0 (ISC license), bundled so the site works offline

Development only:

- `examples/` — saved configurations with their recorded results, used as test fixtures
- `tests/` — engine tests and headless-browser tests

## Built-in examples

Each example in `examples.js` has an `id`, a `title`, an HTML `description` and a `config`.
They appear in the page's "Load example…" menu, and each can be linked to directly:

    index.html?example=3-of-6

Loading an example shows its description and link above the controls; choosing one from
the menu also puts its link in the address bar. An unknown name lists the available ones.
Once a link is shared, don't rename its `id`.

To add one: set up the scenario in the page, download it, copy the downloaded `config`
into a new entry in `examples.js`, and write its description. `npm test` checks that every
example has a unique URL-safe id and no ties.

## Running

Open `index.html` directly, or serve it on the local network:

    npm run serve        # http://<this machine's IP>:8000/

## Testing

    npm install
    npx playwright install chromium   # once
    npm test

## Publishing

The site is published at https://proportional-rcv.electionmath.com/ by GitHub Pages.

Every push to `main` runs `.github/workflows/pages.yml`: it runs `npm test` and, if that
passes, publishes only `index.html`, `engine.js`, `examples.js` and `vendor/`. A failed
test leaves the previous version live. Progress is in the repo's Actions tab.

To publish a new file, add it to the `cp` line in the workflow.

One-time settings this depends on:

- Repo Settings → Pages → Source: **GitHub Actions**; Custom domain:
  `proportional-rcv.electionmath.com`; **Enforce HTTPS** on
- Squarespace DNS for electionmath.com: CNAME `proportional-rcv` → `proebsting.github.io`,
  plus the TXT record GitHub issued when the domain was verified (account Settings → Pages)
