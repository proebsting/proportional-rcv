// Drives index.html in headless Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

let browser, page, errors;

test.before(async () => {
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
});
test.beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE_URL);
});
test.afterEach(async () => {
  await page.close();
  assert.deepEqual(errors, [], 'no page errors');
});

const summary = () => page.textContent('.stv-summary');
const setSlider = (id, value) => page.$eval(`#${id}`, (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input'));
}, String(value));

test('default configuration renders a valid result', async () => {
  assert.match(await summary(), /^Elected: /);
  assert.equal(await page.isEnabled('#download-btn'), true);
  assert.equal(await page.$('.stv-invalid'), null);
  assert.equal(await page.$$eval('#histogram g.cand-group', g => g.length), 4);
});

test('built-in examples load and reproduce their outcomes', async () => {
  const expected = { '2-of-4': 'Elected: D, B', '3-of-6': 'Elected: E, F, D' };
  for (const [value, text] of Object.entries(expected)) {
    await page.selectOption('#example-select', value);
    assert.equal(await summary(), text);
    assert.equal(await page.textContent('#load-notice'), '');
  }
});

test('loading a 3-seat example with fewer candidates showing keeps 3 seats', async () => {
  await setSlider('num-candidates', 2);
  await page.selectOption('#example-select', '3-of-6');
  assert.equal(await page.inputValue('#seats'), '3');
});

test('candidate sliders step along the 2-unit grid', async () => {
  assert.deepEqual(await page.$eval('#c0-pos', el => [el.min, el.max, el.step]), ['0.5', '100.5', '2']);
  await setSlider('c0-pos', 37.5);  // off-grid: the browser snaps the slider to a grid point
  assert.ok(['36.5', '38.5'].includes(await page.inputValue('#c0-pos')));
});

test('coincident candidates make the configuration invalid', async () => {
  await setSlider('c1-pos', await page.inputValue('#c0-pos'));
  assert.match(await page.textContent('.stv-invalid'), /A and B are both at position 20.5/);
  assert.equal(await page.isEnabled('#download-btn'), false);
  assert.equal(await page.$('.stv-summary'), null);
  assert.match(await page.textContent('#rankings-table-body'), /A = B/);
});

test('an elimination tie makes the configuration invalid', async () => {
  // Symmetric electorate and candidates: C is eliminated, B and D elected, then A and E tie
  await setSlider('d1-mean', 30); await setSlider('d2-mean', 71);
  await setSlider('d1-n', 1500);  await setSlider('d2-n', 1500);
  await setSlider('num-candidates', 5);
  for (const [i, p] of [20.5, 36.5, 50.5, 64.5, 80.5].entries()) await setSlider(`c${i}-pos`, p);
  await setSlider('seats', 3);
  assert.match(await page.textContent('.stv-invalid'), /A and E are tied for fewest votes/);
  assert.equal(await page.isEnabled('#download-btn'), false);
});

test('uploading an off-grid config moves candidates toward the center', async () => {
  await page.setInputFiles('#upload-input', path.join(ROOT, 'examples/3-of-6.json'));
  await page.waitForFunction(() => document.getElementById('load-notice').textContent !== '');
  assert.equal(await page.textContent('#load-notice'), 'Moved to the 2-unit candidate grid: C 37.5→38.5, D 53.5→52.5');
  assert.equal(await summary(), 'Elected: E, F, D');
});

test('a large election updates quickly enough to drag', async () => {
  await setSlider('num-candidates', 26);
  await setSlider('seats', 20);
  const ms = await page.evaluate(() => {
    const el = document.getElementById('d2-mean');
    const start = performance.now();
    for (let i = 0; i < 5; i++) { el.value = String(60 + i); el.dispatchEvent(new Event('input')); }
    return (performance.now() - start) / 5;
  });
  console.log(`    26 candidates / 20 seats: ${ms.toFixed(0)} ms per update`);
  assert.ok(ms < 1000);
});

test('proportionality section for the 3-of-6 example', async () => {
  await page.selectOption('#example-select', '3-of-6');
  const text = await page.textContent('#prop-results');
  assert.match(text, /Distribution 1\s*998\s*33\.3%\s*1\.00\s*0\s*0\.0%/);
  assert.match(text, /Gallagher: 33\.\d\d/);
  assert.match(text, /Distribution 1 \(1 Droop quota\): not a solid coalition/);
});

test('proportionality uses party groups when parties are on', async () => {
  await setSlider('num-parties', 2);
  await page.$eval('#allow-leakage', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
  for (const i of [2, 3]) await page.selectOption(`#c${i}-party`, '2');
  const text = await page.textContent('#prop-results');
  assert.match(text, /Party 1/);
  assert.match(text, /solid coalition for \{A, B\}/);
});

test('proportionality is unavailable for an invalid configuration', async () => {
  await setSlider('c1-pos', await page.inputValue('#c0-pos'));
  assert.match(await page.textContent('#prop-results'), /Not available/);
});

test('?example=<id> loads the example with its explanation', async () => {
  await page.goto(PAGE_URL + '?example=3-of-6');
  assert.equal(await summary(), 'Elected: E, F, D');
  assert.equal(await page.isVisible('#example-panel'), true);
  assert.equal(await page.textContent('#example-title'), 'A one-third bloc wins no seats');
  assert.match(await page.textContent('#example-desc'), /holds a full Droop quota/);
  assert.match(await page.textContent('#example-link'), /index\.html\?example=3-of-6$/);
  assert.equal(await page.isVisible('#example-modified'), false);
});

test('an unknown example name lists the available ones', async () => {
  await page.goto(PAGE_URL + '?example=nope');
  assert.match(await page.textContent('#example-title'), /No example named “nope”/);
  const links = await page.$$eval('#example-desc a', as => as.map(a => a.textContent));
  assert.deepEqual(links, ['2-of-4', '3-of-6']);
  assert.equal(await page.isVisible('#example-actions'), false);
});

test('choosing an example from the menu puts its name in the URL', async () => {
  await page.selectOption('#example-select', '2-of-4');
  assert.match(page.url(), /\?example=2-of-4$/);
});

test('changing a loaded example marks it modified; reset restores it', async () => {
  await page.goto(PAGE_URL + '?example=3-of-6');
  await setSlider('d1-n', 2000);
  assert.equal(await page.isVisible('#example-modified'), true);
  await page.click('#example-reset');
  assert.equal(await page.isVisible('#example-modified'), false);
  assert.equal(await page.inputValue('#d1-n'), '1000');
  assert.equal(await summary(), 'Elected: E, F, D');
});

test('uploading a config replaces the loaded example', async () => {
  await page.goto(PAGE_URL + '?example=3-of-6');
  await page.setInputFiles('#upload-input', path.join(ROOT, 'examples/2-of-4.json'));
  await page.waitForFunction(() => document.getElementById('example-panel').hidden);
  assert.doesNotMatch(page.url(), /example=/);
});
