const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findRedirectedCopy } = require('../src/redirect-check.cjs');

async function profile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-redirect-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const appData = path.join(dir, 'Roaming'), localAppData = path.join(dir, 'Local');
  await fs.mkdir(appData, { recursive: true });
  await fs.mkdir(path.join(localAppData, 'Packages', 'Other_123', 'LocalCache', 'Roaming'), { recursive: true });
  return { appData, localAppData, folder: path.join(appData, 'Orbit') };
}

test('writes that reach the real folder are not reported and leave no probe behind', async t => {
  const paths = await profile(t);
  assert.equal(await findRedirectedCopy(paths.folder, paths), null);
  assert.deepEqual(await fs.readdir(paths.folder), []);
});

test('writes that land in a packaged app\'s private copy report that copy', async t => {
  const paths = await profile(t);
  // A junction stands in for the virtualization: what is written to Roaming\Orbit appears in the package copy.
  const copy = path.join(paths.localAppData, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Orbit');
  await fs.mkdir(copy, { recursive: true });
  await fs.symlink(copy, paths.folder, 'junction');
  assert.equal(await findRedirectedCopy(paths.folder, paths), copy);
  assert.deepEqual(await fs.readdir(copy), []);
});

test('folders outside AppData and a missing Packages folder are not checked', async t => {
  const paths = await profile(t);
  assert.equal(await findRedirectedCopy(path.join(os.tmpdir(), 'elsewhere'), paths), null);
  await fs.rm(path.join(paths.localAppData, 'Packages'), { recursive: true });
  assert.equal(await findRedirectedCopy(paths.folder, paths), null);
});
