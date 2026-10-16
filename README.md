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
- `tests/` — engine tests, headless-browser tests (desktop and phone), and a check of the
  published build
- `scripts/build-site.sh` — collects the published files (used by the Pages workflow)

## Built-in examples

Each example in `examples.js` has an `id`, a `title`, an HTML `description` and a `config`.
They appear in the page's "Load example…" menu, and each can be linked to directly:

    index.html?example=3-of-6

Loading an example shows its description and link above the controls; choosing one from
the menu also puts its link in the address bar. An unknown name lists the available ones.
Once a link is shared, don't rename its `id`.

Any setup can also be shared: "Copy link to this setup" gives a readable link such as

    ?d1=30,12,1000&d2=70,12,2000&c=20.5,28.5,38.5,52.5,66.5,82.5&seats=3

(distributions as mean,sd,voters; `c` the candidate positions; plus `parties`, `lines`,
`cp` and `leak=0` when parties are used). A changed example links as
`?example=<id>&…`, so its description still shows, marked "(modified)".

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

The files are collected by `scripts/build-site.sh`, which also tags each script's URL with
the commit id (`engine.js?v=1a2b3c4`), so right after a deploy no browser combines the new
page with old cached scripts. To publish a new file, add it to that script.
GitHub lets browsers reuse a page for up to 10 minutes, so a hard refresh
(Cmd/Ctrl + Shift + R) shows a new version sooner.

One-time settings this depends on:

- Repo Settings → Pages → Source: **GitHub Actions**; Custom domain:
  `proportional-rcv.electionmath.com`; **Enforce HTTPS** on
- Squarespace DNS for electionmath.com: CNAME `proportional-rcv` → `proebsting.github.io`,
  plus the TXT record GitHub issued when the domain was verified (account Settings → Pages)
