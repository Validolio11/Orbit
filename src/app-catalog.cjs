const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const SOURCES = new Set(['start-menu', 'app-paths', 'windows-app']);
const SOURCE_PRIORITY = { 'start-menu': 0, 'app-paths': 1, 'windows-app': 2 };
const DISCOVERY_ERROR = 'Не вдалося прочитати список застосунків. Натисніть «Оновити» або виберіть файл вручну.';

function normalizeQuery(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('uk-UA').trim().replace(/\s+/g, ' ');
}

function isPackagedTarget(target) {
  try { validatePackagedTarget(target); return true; } catch { return false; }
}

function validatePackagedTarget(target, args = '') {
  if (typeof target !== 'string' || !target.startsWith('app-id:')) throw new Error('Неправильний ідентифікатор застосунку Windows.');
  const appId = target.slice(7);
  if (appId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*![A-Za-z0-9][A-Za-z0-9._-]*$/.test(appId)) throw new Error('Неправильний ідентифікатор застосунку Windows.');
  if (typeof args !== 'string' || args.trim()) throw new Error('Застосунки Windows з каталогу не підтримують додаткові аргументи.');
  return appId;
}

function isLocalAppPath(target) {
  return typeof target === 'string' && target.length <= 4096 && !/[\0\r\n]/.test(target) && /^[a-z]:[\\/]/i.test(target) && /\.(?:exe|lnk)$/i.test(target);
}

function targetKey(target) {
  return /^app-id:/i.test(target) ? target.toLowerCase() : path.win32.normalize(target).toLowerCase();
}

// Start menu uninstall shortcuts ("Видалити Telegram", "Uninstall Zoom") are noise in a launcher.
function isUninstaller(name, ...targets) {
  // \b only knows ASCII word characters, so the end of the word is matched explicitly for Cyrillic.
  if (/^(uninstall|видалити|удалить|деінсталювати|деинсталлировать)(?=\s|$)/iu.test(name.trim())) return true;
  return targets.some(target => typeof target === 'string' && /(^|[\\/])(unins\d*|uninstall[^\\/]*)\.exe$/i.test(target));
}

function normalizeCatalog(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid app discovery result.');
  const unique = new Map();
  for (const row of rows.slice(0, 5000)) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string' || typeof row.target !== 'string' || !SOURCES.has(row.source)) continue;
    const name = row.name.replace(/[\0\r\n]/g, ' ').trim().slice(0, 100);
    const target = row.target.trim();
    const args = typeof row.args === 'string' && row.args.length <= 4096 && !row.args.includes('\0') ? row.args : '';
    if (!name || isUninstaller(name, row.target, row.resolvedTarget)) continue;
    if (/^app-id:/i.test(target)) { try { validatePackagedTarget(target, args); } catch { continue; } }
    else if (!isLocalAppPath(target)) continue;
    const resolvedTarget = isLocalAppPath(row.resolvedTarget) ? row.resolvedTarget : target;
    const resolvedArgs = resolvedTarget !== target && typeof row.resolvedArgs === 'string' && row.resolvedArgs.length <= 4096 && !row.resolvedArgs.includes('\0') ? row.resolvedArgs : args;
    const key = targetKey(resolvedTarget) + '\0' + resolvedArgs.trim();
    const aliases = Array.isArray(row.aliases) ? row.aliases.filter(alias => typeof alias === 'string' && alias.length <= 100).slice(0, 20) : [];
    const entry = { id: createHash('sha256').update(key).digest('hex').slice(0, 20), name, target, args, source: row.source,
      _terms: new Set([name, ...aliases].map(normalizeQuery)), _normalizedName: normalizeQuery(name), _key: key, _resolvedTarget: resolvedTarget, _resolvedArgs: resolvedArgs };
    const previous = unique.get(key);
    if (!previous) unique.set(key, entry);
    else {
      for (const term of previous._terms) entry._terms.add(term);
      if (SOURCE_PRIORITY[row.source] < SOURCE_PRIORITY[previous.source]) unique.set(key, entry);
      else previous._terms.add(normalizeQuery(name));
    }
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, 'uk', { sensitivity: 'base', numeric: true }));
}

function searchCatalog(entries, query = '', limit = 30) {
  const normalized = normalizeQuery(query);
  // Runs on every keystroke over up to 5000 programs, so names are normalized once in normalizeCatalog.
  const matches = normalized ? entries.filter(entry => { for (const term of entry._terms) if (term.includes(normalized)) return true; return false; }) : entries.slice();
  if (normalized) {
    const prefix = entry => (entry._normalizedName ?? normalizeQuery(entry.name)).startsWith(normalized);
    matches.sort((left, right) => Number(prefix(right)) - Number(prefix(left)));
  }
  return { apps: matches.slice(0, limit).map(({ id, name, target, args, source }) => ({ id, name, target, args, source })), total: matches.length };
}

async function discoverWindowsApps({ signal } = {}) {
  if (process.platform !== 'win32') return [];
  const script = await fsp.readFile(path.join(__dirname, '..', 'scripts', 'discover-apps.ps1'), 'utf8');
  if (signal?.aborted) throw new Error('App discovery canceled.');
  const executable = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal });
    let bytes = 0, chunks = [], settled = false;
    const finish = (error, rows) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(rows); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('App discovery timed out.')); }, 12000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 5 * 1024 * 1024) { child.kill(); chunks = []; finish(new Error('App discovery output limit exceeded.')); }
      else chunks.push(chunk);
    });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) { finish(new Error('App discovery failed.')); return; }
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim())); }
      catch { finish(new Error('Invalid app discovery output.')); }
    });
  });
}

async function readCatalogCache(file, now = Date.now()) {
  if (!file) return null;
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const data = await fsp.readFile(file);
    if (data.length > 1024 * 1024) return null;
    const saved = JSON.parse(data.toString('utf8'));
    if (saved.version !== 1 || !Number.isFinite(saved.savedAt) || saved.savedAt > now + 5 * 60 * 1000 || now - saved.savedAt > 24 * 60 * 60 * 1000 || !Array.isArray(saved.apps) || saved.apps.length > 5000) return null;
    return normalizeCatalog(saved.apps);
  } catch { return null; }
}

async function writeCatalogCache(file, entries, now = Date.now()) {
  if (!file) return;
  const apps = entries.map(entry => ({ name: entry.name, target: entry.target, args: entry.args, source: entry.source,
    resolvedTarget: entry._resolvedTarget, resolvedArgs: entry._resolvedArgs, aliases: [...entry._terms].slice(0, 20) }));
  const data = JSON.stringify({ version: 1, savedAt: now, apps });
  if (Buffer.byteLength(data, 'utf8') > 1024 * 1024) return;
  const temp = file + '.tmp';
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(temp, data, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temp, file);
  } catch { try { await fsp.unlink(temp); } catch { } }
}

function createAppCatalog({ discover = discoverWindowsApps, loadIcon = async () => null, cachePath = null, now = Date.now } = {}) {
  let entries = null, pending = null, refreshing = null, error = null, controller = null, disposed = false;
  const icons = new Map();
  const cacheFile = () => typeof cachePath === 'function' ? cachePath() : cachePath;
  async function refreshIndex(explicit = false) {
    if (disposed) return;
    if (explicit) icons.clear();
    if (refreshing) return refreshing;
    controller = new AbortController();
    refreshing = Promise.resolve().then(() => discover({ signal: controller.signal })).then(async rows => {
      if (disposed) return;
      entries = normalizeCatalog(rows); error = null;
      await writeCatalogCache(cacheFile(), entries, now());
    }).catch(() => { if (!entries) entries = []; if (!disposed) error = DISCOVERY_ERROR; }).finally(() => { refreshing = null; controller = null; });
    return refreshing;
  }
  async function ensureIndex(refresh = false) {
    if (disposed) return;
    if (refresh) { if (pending) await pending; return refreshIndex(true); }
    if (entries && !refresh) return;
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      const cached = await readCatalogCache(cacheFile(), now());
      if (disposed) return;
      if (cached) { entries = cached; error = null; refreshIndex(); }
      else await refreshIndex();
    }).finally(() => { pending = null; });
    return pending;
  }
  async function getAppIcon(target) {
    if (disposed || !(isLocalAppPath(target) || isPackagedTarget(target))) return null;
    const key = targetKey(target);
    if (!icons.has(key)) {
      if (icons.size >= 300) icons.delete(icons.keys().next().value);
      icons.set(key, Promise.resolve().then(() => loadIcon(target)).then(value => typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length < 256 * 1024 ? value : null).catch(() => null));
    }
    return icons.get(key);
  }
  return {
    warm: () => ensureIndex(),
    // The add dialog's grid asks for more programs without icons and loads each icon as its tile appears.
    async searchApps(query = '', refresh = false, { limit = 30, icons = true } = {}) {
      if (typeof query !== 'string' || query.length > 200 || typeof refresh !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 120 || typeof icons !== 'boolean') return { apps: [], total: 0, error: 'Неправильний пошуковий запит.' };
      await ensureIndex(refresh);
      const result = searchCatalog(entries || [], query, limit);
      // Icons are requested only for visible search results, never for the whole index.
      for (let offset = 0; icons && offset < result.apps.length; offset += 6) {
        await Promise.all(result.apps.slice(offset, offset + 6).map(async entry => { const icon = await getAppIcon(entry.target); if (icon) entry.icon = icon; }));
      }
      return error ? { ...result, error } : result;
    },
    getAppIcon,
    // Matches a running executable to its catalog entry so the action keeps the shortcut's name and arguments.
    async findExecutable(target) {
      if (disposed || !isLocalAppPath(target)) return null;
      await ensureIndex();
      const key = targetKey(target), matches = (entries || []).filter(item => targetKey(item._resolvedTarget) === key);
      const entry = matches.find(item => !item._resolvedArgs.trim()) || matches[0];
      return entry ? { name: entry.name, target: entry.target, args: entry.args } : null;
    },
    // First catalog entry whose name equals or starts with each wanted name, in the given order.
    async findNamed(names) {
      if (disposed) return [];
      await ensureIndex();
      const found = [], keys = new Set();
      for (const wanted of names) {
        const query = normalizeQuery(wanted);
        const entry = (entries || []).find(item => !keys.has(item._key) && (normalizeQuery(item.name) === query || normalizeQuery(item.name).startsWith(query + ' ')));
        if (entry) { keys.add(entry._key); found.push({ name: entry.name, target: entry.target, args: entry.args }); }
      }
      return found;
    },
    dispose() { disposed = true; controller?.abort(); icons.clear(); },
  };
}

module.exports = { normalizeQuery, normalizeCatalog, searchCatalog, validatePackagedTarget, isLocalAppPath, discoverWindowsApps, createAppCatalog, readCatalogCache, writeCatalogCache };
