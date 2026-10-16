// Builds the published site with scripts/build-site.sh (as the Pages workflow does) and
// checks that it is complete and works on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

test('the built site has only the site files, with versioned script URLs, and works', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  try {
    execFileSync('sh', [path.join(ROOT, 'scripts/build-site.sh'), out, 'test123']);
    const files = execFileSync('find', ['.', '-type', 'f'], { cwd: out, encoding: 'utf8' }).trim().split('\n').sort();
    assert.deepEqual(files, ['./engine.js', './examples.js', './index.html', './vendor/d3.LICENSE', './vendor/d3.min.js']);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.deepEqual(html.match(/<script src="[^"]+"/g),
      ['<script src="vendor/d3.min.js?v=test123"', '<script src="engine.js?v=test123"', '<script src="examples.js?v=test123"']);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href + '?example=3-of-6');
    assert.equal(await page.textContent('.stv-summary'), 'Elected: E, F, D');
    await browser.close();
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the build refuses unsafe arguments', () => {
  for (const args of [['.', 'v1'], ['/', 'v1'], [path.join(os.tmpdir(), 'x'), 'bad version']]) {
    assert.throws(() => execFileSync('sh', [path.join(ROOT, 'scripts/build-site.sh'), ...args], { stdio: 'pipe' }), `${args}`);
  }
});
