const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeDurable, readWithBackup } = require('../src/settings-file.cjs');

async function folder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}
const parse = text => { const value = JSON.parse(text); if (value.version !== 1) throw new Error('bad version'); return value; };

test('saves keep the previous good file as a backup and leave no temp file', async t => {
  const file = await folder(t);
  await writeDurable(file, JSON.stringify({ version: 1, n: 1 }));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).n, 1);
  await assert.rejects(fs.access(file + '.bak'));
  await writeDurable(file, JSON.stringify({ version: 1, n: 2 }));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).n, 2);
  assert.equal(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).n, 1);
  await assert.rejects(fs.access(file + '.tmp'));
});

test('a damaged or emptied settings file is read from the backup', async t => {
  const file = await folder(t);
  await writeDurable(file, JSON.stringify({ version: 1, n: 1 }));
  await writeDurable(file, JSON.stringify({ version: 1, n: 2 }));
  assert.deepEqual(await readWithBackup(file, parse), { value: { version: 1, n: 2 }, source: 'main' });
  // What a power cut can leave behind: an empty file, or one that no longer validates.
  for (const damaged of ['', '{"version":1,"n":', JSON.stringify({ version: 9 })]) {
    await fs.writeFile(file, damaged);
    const result = await readWithBackup(file, parse);
    assert.equal(result.source, 'backup');assert.equal(result.value.n, 1);assert.ok(result.error);
  }
  await fs.rm(file);
  assert.equal((await readWithBackup(file, parse)).source, 'backup');
});

test('without any usable copy the main file error is thrown, ENOENT meaning a first run', async t => {
  const file = await folder(t);
  await assert.rejects(readWithBackup(file, parse), error => error.code === 'ENOENT');
  await fs.writeFile(file, 'not json');
  await assert.rejects(readWithBackup(file, parse), SyntaxError);
});
