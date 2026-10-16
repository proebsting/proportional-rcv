# proportional-rcv

Interactive demonstrations that STV is not as proportional as it is often assumed to be,
under (possibly contrived) scenarios on a one-dimensional political spectrum.

There are no tie-break rules: any configuration that produces a tie, in a voter's ranking
or in the count, is reported as invalid.

## Files

- `index.html` — the page (UI and rendering)
- `engine.js` — voter model, rankings and the exact-arithmetic STV count; pure functions
  shared by the page and the tests
- `examples/` — saved configurations with their recorded results, used as test fixtures
- `tests/` — engine tests and headless-browser tests

## Running

Open `index.html` directly, or serve it on the local network:

    npm run serve        # http://<this machine's IP>:8000/

## Testing

    npm install
    npx playwright install chromium   # once
    npm test
