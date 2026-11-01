const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuery, normalizeCatalog, searchCatalog, validatePackagedTarget, createAppCatalog, readCatalogCache, writeCatalogCache } = require('../src/app-catalog.cjs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateAction } = require('../src/core.cjs');

function app(name, target, source = 'app-paths', extra = {}) {
  return { name, target, args: '', source, ...extra };
}
const icon = 'data:image/png;base64,aWNvbg==';

test('app-name search normalizes Unicode case, width and surrounding whitespace', () => {
  assert.equal(normalizeQuery('  ІЛЮСТРАТОР   2026 '), 'ілюстратор 2026');
  assert.equal(normalizeQuery('Ａｄｏｂｅ'), 'adobe');
  const index = normalizeCatalog([app('Adobe Illustrator 2026', 'C:\\Adobe\\2026\\Illustrator.exe'), app('Ілюстратор', 'C:\\Apps\\Other.exe')]);
  assert.equal(searchCatalog(index, '  ILLUSTRATOR ').total, 1);
  assert.equal(searchCatalog(index, 'ІЛЮСТРАТОР').total, 1);
});

test('catalog deduplicates resolved launch targets, prefers shortcuts and preserves versions', () => {
  const index = normalizeCatalog([
    app('Illustrator', 'c:\\adobe\\2026\\illustrator.exe'),
    app('Adobe Illustrator 2026', 'C:\\Start Menu\\Illustrator 2026.lnk', 'start-menu', { resolvedTarget: 'C:\\Adobe\\2026\\Illustrator.exe', resolvedArgs: '' }),
    app('Adobe Illustrator 2025', 'C:\\Adobe\\2025\\Illustrator.exe'),
  ]);
  assert.equal(index.length, 2);
  const current = searchCatalog(index, '2026').apps[0];
  assert.equal(current.source, 'start-menu');
  assert.equal(current.target, 'C:\\Start Menu\\Illustrator 2026.lnk');
  assert.equal(current.args, '');
  assert.equal(searchCatalog(index, 'illustrator').total, 2);
  assert.equal(new Set(index.map(entry => entry.id)).size, 2);
});

test('different shortcut arguments remain distinct and alternate app names stay searchable', () => {
  const index = normalizeCatalog([
    app('Chrome Registry Name', 'C:\\Chrome\\chrome.exe'),
    app('Google Chrome', 'C:\\Start\\Chrome.lnk', 'start-menu', { resolvedTarget: 'C:\\Chrome\\chrome.exe', resolvedArgs: '' }),
    app('Chrome Work', 'C:\\Start\\Chrome Work.lnk', 'start-menu', { resolvedTarget: 'C:\\Chrome\\chrome.exe', resolvedArgs: '--profile-directory="Work"' }),
  ]);
  assert.equal(index.length, 2);
  assert.equal(searchCatalog(index, 'registry').apps[0].name, 'Google Chrome');
  assert.equal(searchCatalog(index, 'work').apps[0].target, 'C:\\Start\\Chrome Work.lnk');
});

test('packaged targets require a bounded family!application ID and reject additional arguments', () => {
  const target = 'app-id:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
  assert.equal(validatePackagedTarget(target), 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App');
  for (const invalid of ['app-id:', 'app-id:someapp', 'app-id:Family!App & calc', 'app-id:Family!../App', 'app-id:Family!App\\Other', 'app-id:Family!App!Other', 'app-id:' + 'x'.repeat(128) + '!App', 'APP-ID:Family!App']) {
    assert.throws(() => validatePackagedTarget(invalid));
  }
  assert.throws(() => validatePackagedTarget(target, '--argument'));
  assert.equal(normalizeCatalog([app('Calculator', target, 'windows-app')]).length, 1);
  assert.equal(normalizeCatalog([app('Bad', 'app-id:Family!App&bad', 'windows-app')]).length, 0);
});

test('packaged action validation keeps existing manual app targets compatible', () => {
  const base = { id: 'app', name: 'App', kind: 'app', target: '', args: '', icon: '', children: [] };
  for (const target of ['C:\\Apps\\Editor.exe', 'C:\\Start\\Editor.lnk', 'https://example.com', 'app-id:Family_123!App']) assert.equal(validateAction({ ...base, target }).target, target);
  assert.throws(() => validateAction({ ...base, target: 'app-id:Family_123!App', args: '--bad' }));
  assert.throws(() => validateAction({ ...base, kind: 'folder', target: 'app-id:Family_123!App' }));
});

test('invalid discovery entries and nonlocal icon targets are ignored', async () => {
  assert.equal(normalizeCatalog([
    app('Relative', 'app.exe'), app('URL', 'https://example.com'), app('Network', '\\\\server\\share\\app.exe'),
    app('Script', 'C:\\App.ps1'), app('Unknown source', 'C:\\App.exe', 'other'),
    app('', 'C:\\App.exe'), null,
  ]).length, 0);
  let icons = 0;
  const catalog = createAppCatalog({ discover: async () => [], loadIcon: async () => { icons++; return icon; } });
  for (const target of ['app.exe', 'https://example.com', 'app-id:Family!App', '\\\\server\\app.exe']) assert.equal(await catalog.getAppIcon(target), null);
  assert.equal(icons, 0);
  catalog.dispose();
});

test('concurrent searches share one index and icons are lazy, cached and refreshed', async () => {
  let discoveries = 0, icons = 0;
  const rows = Array.from({ length: 60 }, (_, index) => app(`Editor ${index}`, `C:\\Apps\\Editor${index}.exe`));
  const catalog = createAppCatalog({ discover: async () => { discoveries++; await new Promise(resolve => setImmediate(resolve)); return rows; }, loadIcon: async () => { icons++; return icon; } });
  const first = catalog.searchApps('');
  const matching = catalog.searchApps('Editor 59');
  const [result, one] = await Promise.all([first, matching]);
  assert.equal(discoveries, 1);
  assert.equal(result.total, 60); assert.equal(result.apps.length, 30);
  assert.equal(one.total, 1);
  assert.equal(icons, 31);
  assert.equal(result.apps[0].icon, icon);
  assert.equal('_terms' in result.apps[0], false);
  await catalog.searchApps(''); assert.equal(icons, 31);
  await catalog.searchApps('', true); assert.equal(discoveries, 2); assert.equal(icons, 61);
  catalog.dispose();
});

test('discovery errors stay actionable without exposing diagnostic paths and can be refreshed', async () => {
  let attempts = 0;
  const catalog = createAppCatalog({ discover: async () => { if (++attempts === 1) throw new Error('private path C:\\Secret'); return [app('Editor', 'C:\\Apps\\Editor.exe')]; } });
  const failed = await catalog.searchApps('Editor');
  assert.equal(failed.total, 0); assert.ok(failed.error); assert.equal(failed.error.includes('Secret'), false);
  const retry = await catalog.searchApps('Editor', true);
  assert.equal(retry.total, 1); assert.equal(retry.error, undefined);
  catalog.dispose();
});

test('disposing the catalog aborts in-flight discovery', async () => {
  let aborted = false;
  const catalog = createAppCatalog({ discover: ({ signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(new Error('canceled')); }, { once: true }); }) });
  const pending = catalog.warm(); await new Promise(resolve => setImmediate(resolve));
  catalog.dispose(); await pending;
  assert.equal(aborted, true);
});

test('local cache retains launch dedupe metadata and excludes icons with a 24h age bound', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-catalog-test-'));
  const file = path.join(directory, 'app-catalog.json');
  try {
    const index = normalizeCatalog([app('Editor', 'C:\\Start\\Editor.lnk', 'start-menu', { resolvedTarget: 'C:\\Apps\\Editor.exe', resolvedArgs: '' })]);
    index[0].icon = icon;
    await writeCatalogCache(file, index, 1000000);
    const data = await fsp.readFile(file, 'utf8');
    assert.equal(data.includes('data:image'), false);
    const loaded = await readCatalogCache(file, 1000001);
    assert.equal(loaded[0].id, index[0].id);
    assert.equal(loaded[0].target, index[0].target);
    assert.equal(await readCatalogCache(file, 1000000 + 24 * 60 * 60 * 1000 + 1), null);
    await fsp.writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    assert.equal(await readCatalogCache(file), null);
  } finally { await fsp.unlink(file).catch(() => {}); await fsp.rmdir(directory); }
});

test('cached apps are returned while background refresh is pending', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-catalog-test-'));
  const file = path.join(directory, 'app-catalog.json');
  let completeRefresh;
  const refresh = new Promise(resolve => { completeRefresh = resolve; });
  const catalog = createAppCatalog({ cachePath: file, discover: () => refresh });
  try {
    await writeCatalogCache(file, normalizeCatalog([app('Cached Editor', 'C:\\Apps\\Old.exe')]));
    const result = await catalog.searchApps('cached');
    assert.equal(result.total, 1);
    completeRefresh([app('New Editor', 'C:\\Apps\\New.exe')]);
    await catalog.searchApps('', true);
    assert.equal((await catalog.searchApps('new')).total, 1);
  } finally { catalog.dispose(); await fsp.unlink(file).catch(() => {}); await fsp.unlink(file + '.tmp').catch(() => {}); await fsp.rmdir(directory); }
});

test('catalog finds the shortcut behind a running executable and popular apps by name', async () => {
  const rows = [
    app('Google Chrome', 'C:\\Start Menu\\Google Chrome.lnk', 'start-menu', { resolvedTarget: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', resolvedArgs: '' }),
    app('Telegram Desktop', 'C:\\Users\\Me\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe'),
    app('Visual Studio Code', 'C:\\Start Menu\\Visual Studio Code.lnk', 'start-menu', { resolvedTarget: 'C:\\VS Code\\Code.exe', resolvedArgs: '' }),
  ];
  const catalog = createAppCatalog({ discover: async () => rows });
  const chrome = await catalog.findExecutable('c:\\program files\\google\\chrome\\application\\CHROME.EXE');
  assert.deepEqual(chrome, { name: 'Google Chrome', target: 'C:\\Start Menu\\Google Chrome.lnk', args: '' });
  assert.equal(await catalog.findExecutable('C:\\Other\\unknown.exe'), null);
  const named = await catalog.findNamed(['Firefox', 'Telegram', 'Visual Studio Code', 'Google Chrome']);
  assert.deepEqual(named.map(entry => entry.name), ['Telegram Desktop', 'Visual Studio Code', 'Google Chrome']);
  catalog.dispose();
});
