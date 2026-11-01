const { app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu, nativeImage, nativeTheme, globalShortcut } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const SMOKE = process.argv.includes('--smoke-test');
const E2E = process.argv.includes('--e2e');
const ISOLATED = SMOKE || E2E;
const NATIVE = app.isPackaged && __dirname.includes('app.asar')
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'Orbit.Input.exe')
  : path.join(__dirname, '..', 'native', 'Orbit.Input.exe');
const PAGE = path.join(__dirname, 'renderer', 'index.html');
const APP_ICON = path.join(__dirname, '..', 'assets', 'orbit.ico');
const { validateAction, validateState, parseArguments, wheelGeometry, wheelMountSize, shouldCloseWheelOnClick } = require('./core.cjs');
const { createAppCatalog, validatePackagedTarget, isLocalAppPath } = require('./app-catalog.cjs');
const { createUpdater } = require('./updater.cjs');
const UPDATE_REPOSITORY = 'Validolio11/Orbit';
const UPDATE_REPOSITORY_URL = 'https://github.com/' + UPDATE_REPOSITORY;
let iconWorkers = 0;
const waitingIcons = [];

async function readHighResolutionIcon(target) {
  // Shell extraction runs in short-lived native processes rather than blocking Electron.
  if (iconWorkers < 2) iconWorkers++;
  else await new Promise(resolve => waitingIcons.push(resolve));
  try {
    return await new Promise(resolve => {
      const child = spawn(NATIVE, [`--icon=${target}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let chunks = [], bytes = 0, settled = false;
      const finish = image => { if (settled) return; settled = true; clearTimeout(timer); resolve(image); };
      const timer = setTimeout(() => { child.kill(); finish(null); }, 4000);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1500 * 1024) { child.kill(); chunks = []; finish(null); }
        else chunks.push(chunk);
      });
      child.once('error', () => finish(null));
      child.once('close', code => {
        if (settled || code !== 0) { finish(null); return; }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.width > 512 || value.height < 1 || value.height > 512 || typeof value.pixels !== 'string') { finish(null); return; }
          const bitmap = Buffer.from(value.pixels, 'base64');
          if (bitmap.length !== value.width * value.height * 4) { finish(null); return; }
          const image = nativeImage.createFromBitmap(bitmap, { width: value.width, height: value.height, scaleFactor: 1 });
          finish(image.isEmpty() ? null : image);
        } catch { finish(null); }
      });
    });
  } finally {
    const next = waitingIcons.shift();
    if (next) next();
    else iconWorkers--;
  }
}

const appCatalog = createAppCatalog({ cachePath: () => path.join(app.getPath('userData'), 'app-catalog.json'), loadIcon: async target => {
  if (!isLocalAppPath(target)) return null;
  if (!(await fsp.stat(target).catch(() => null))?.isFile()) return null;
  let iconTarget = target;
  if (/\.lnk$/i.test(target)) {
    try { const shortcut = shell.readShortcutLink(target); if (isLocalAppPath(shortcut.target) && (await fsp.stat(shortcut.target).catch(() => null))?.isFile()) iconTarget = shortcut.target; } catch { }
  }
  const image = await app.getFileIcon(iconTarget, { size: 'large' });
  if (image.isEmpty()) return null;
  const representation = image.getScaleFactors().reduce((best, factor) => {
    const buffer = image.toPNG({ scaleFactor: factor });
    return !best || buffer.readUInt32BE(16) > best.readUInt32BE(16) ? buffer : best;
  }, null) || image.toPNG();
  // Electron's Windows icon API can stop at 48 px. Ask the Shell for its original
  // 256 px frame when necessary; never enlarge a smaller bitmap to invent detail.
  if (process.platform === 'win32' && representation.readUInt32BE(16) < 128) {
    const shellIcon = await readHighResolutionIcon(iconTarget);
    if (shellIcon && shellIcon.getSize().width > representation.readUInt32BE(16)) return shellIcon.toDataURL();
  }
  return 'data:image/png;base64,' + representation.toString('base64');
} });
let mainWindow, overlayWindow, tray, state, statePath, quitting = false, hookProcess = null;
let overlayReady, wheelVisible = false, wheelSession = 0, pendingMouseOpen = false, pendingMouseRelease = null, configQueue = Promise.resolve();
let appliedWheelSize = 520;
let updater;
let runtime = { hookReady: false, outsideWatcherReady: false, hookError: null, shortcutRegistered: false };

function adobeExecutable(product, executable) {
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const adobe = path.join(root, 'Adobe');
    let children = [];
    try { children = fs.readdirSync(adobe, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(product)).map(entry => entry.name).sort().reverse(); } catch { }
    for (const child of children) {
      for (const suffix of [executable, path.join('Support Files', executable), path.join('Support Files', 'Contents', 'Windows', executable)]) {
        const candidate = path.join(adobe, child, suffix);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return '';
}

function defaultState() {
  const action = (id, name, kind, target, icon, children = []) => ({ id, name, kind, target, args: '', icon, children });
  return { version: 1, theme: 'dark', triggerButton: 4, activationMode: 'hover', hoverDelay: 350, enabled: true, reducedMotion: false, closeOnOutsideClick: true, wheelSize: 520,
    activeMenuId: 'main', menus: [{ id: 'main', name: 'Головне меню', icon: 'orbit', items: [
      action('adobe', 'Adobe', 'group', '', 'adobe', [
        action('illustrator', 'Illustrator', 'app', adobeExecutable('Adobe Illustrator', 'Illustrator.exe'), 'illustrator'),
        action('after-effects', 'After Effects', 'app', adobeExecutable('Adobe After Effects', 'AfterFX.exe'), 'after-effects'),
        action('photoshop', 'Photoshop', 'app', adobeExecutable('Adobe Photoshop', 'Photoshop.exe'), 'photoshop'),
      ]),
      action('documents', 'Документи', 'folder', app.getPath('documents'), 'folder'),
      action('browser', 'Вебпошук', 'app', 'https://www.google.com', 'globe'),
      action('explorer', 'Провідник', 'system', 'explorer', 'files'),
      action('screenshot', 'Знімок екрана', 'system', 'screenshot', 'screenshot'),
      action('task-manager', 'Диспетчер завдань', 'system', 'task-manager', 'activity'),
      action('mute', 'Вимкнути звук', 'system', 'mute', 'volume'),
      action('settings', 'Параметри Windows', 'system', 'settings', 'settings'),
    ] }] };
}

async function loadState() {
  try { return validateState(JSON.parse(await fsp.readFile(statePath, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('Orbit: configuration could not be loaded; using defaults.', error.message);
    return defaultState();
  }
}

function sendAll(channel, value) {
  for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function updateRuntime(patch) { runtime = { ...runtime, ...patch }; sendAll('orbit:runtime-changed', runtime); }

async function persistState(value) {
  const next = validateState(value);
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  const temp = statePath + '.tmp';
  await fsp.writeFile(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(temp, statePath);
  const hookChanged = state.triggerButton !== next.triggerButton || state.enabled !== next.enabled;
  state = next;
  nativeTheme.themeSource = state.theme;
  if (!state.enabled) closeWheel();
  sendAll('orbit:state-changed', state);
  if (hookChanged && !ISOLATED) { await stopHook(); startHook(); }
  updateTray();
  return state;
}

function saveState(value) {
  const result = configQueue.then(() => persistState(value));
  configQueue = result.catch(() => {});
  return result;
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && wheelVisible) { event.preventDefault(); closeWheel(); }
  });
}

function createWindows() {
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({ width: Math.min(1260, area.width), height: Math.min(860, area.height),
    minWidth: Math.min(1050, area.width), minHeight: Math.min(720, area.height), show: false, frame: false,
    title: 'Orbit', icon: APP_ICON, backgroundColor: state.theme === 'light' ? '#fafafa' : '#0a0a0a',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  overlayWindow = new BrowserWindow({ width: 600, height: 600, show: false, frame: false, transparent: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, icon: APP_ICON, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  secureWindow(mainWindow); secureWindow(overlayWindow);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('close', event => { if (!quitting && !ISOLATED) { event.preventDefault(); mainWindow.hide(); } });
  overlayWindow.on('close', event => { if (!quitting) { event.preventDefault(); closeWheel(); } });
  overlayReady = overlayWindow.loadFile(PAGE, { query: { overlay: '1' } });
  const mainReady = mainWindow.loadFile(PAGE);
  mainReady.then(() => { if (!SMOKE && !quitting) mainWindow.show(); }).catch(reportStartupError);
  overlayReady.catch(reportStartupError);
  return Promise.all([mainReady, overlayReady]);
}

function reportStartupError(error) {
  console.error('Orbit startup error:', error);
  if (!ISOLATED) dialog.showErrorBox('Orbit', `Не вдалося відкрити інтерфейс: ${error.message}`);
}

async function showWheel(physicalPoint, trigger = 'preview') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false, error: 'Wheel unavailable.' };
  const session = ++wheelSession;
  pendingMouseOpen = trigger === 'mouse';
  pendingMouseRelease = null;
  const point = physicalPoint ? screen.screenToDipPoint(physicalPoint) : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const requestedWheelSize = state.wheelSize ?? 520;
  const { bounds } = wheelGeometry(point, area, requestedWheelSize);
  await overlayReady;
  if (session !== wheelSession || quitting) return { ok: false };
  overlayWindow.setBounds(bounds);
  const appliedBounds = overlayWindow.getBounds();
  const center = { x: appliedBounds.width / 2, y: appliedBounds.height / 2 };
  appliedWheelSize = wheelMountSize(appliedBounds, requestedWheelSize);
  wheelVisible = true;
  overlayWindow.webContents.send('orbit:wheel-open', { center, trigger, size: appliedWheelSize });
  if (trigger === 'mouse') overlayWindow.showInactive();
  else overlayWindow.show();
  pendingMouseOpen = false;
  if (pendingMouseRelease) { overlayWindow.webContents.send('orbit:trigger-release', pendingMouseRelease); pendingMouseRelease = null; }
  if (!ISOLATED) globalShortcut.register('Escape', closeWheel);
  return { ok: true };
}

function closeWheel() {
  wheelSession++;
  wheelVisible = false;
  pendingMouseOpen = false;
  pendingMouseRelease = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  sendAll('orbit:wheel-closed', {});
  if (!ISOLATED) globalShortcut.unregister('Escape');
  return { ok: true };
}

function startHook() {
  if (quitting || ISOLATED || hookProcess) return;
  if (!fs.existsSync(NATIVE)) { updateRuntime({ hookReady: false, hookError: 'Модуль миші не зібрано. Виконайте npm run native.' }); return; }
  const child = spawn(NATIVE, [`--button=${state.enabled ? state.triggerButton : 0}`, `--parent-pid=${process.pid}`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  hookProcess = child;
  let buffer = '', errorText = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (hookProcess !== child) continue;
      if (event.type === 'ready') updateRuntime({ hookReady: state.enabled && event.button === state.triggerButton, outsideWatcherReady: true, hookError: null });
      else if (event.type === 'down' && state.enabled) showWheel({ x: event.x, y: event.y }, 'mouse').catch(error => updateRuntime({ hookError: error.message }));
      else if (event.type === 'click' && wheelVisible && state.closeOnOutsideClick && overlayWindow && !overlayWindow.isDestroyed()) {
        if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
          const point = screen.screenToDipPoint({ x: event.x, y: event.y });
          if (shouldCloseWheelOnClick({ ...event, ...point }, wheelVisible, state.closeOnOutsideClick, overlayWindow.getBounds(), appliedWheelSize)) closeWheel();
        }
      }
      else if (event.type === 'up') {
        if (pendingMouseOpen) pendingMouseRelease = { button: event.button };
        else if (wheelVisible) overlayWindow.webContents.send('orbit:trigger-release', { button: event.button });
      }
    }
    if (buffer.length > 65536) buffer = '';
  });
  child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-2000); });
  child.on('error', error => { if (hookProcess === child) { hookProcess = null; updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: error.message }); } });
  child.on('exit', code => {
    if (hookProcess === child) { hookProcess = null; updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: quitting ? null : errorText.trim() || `Модуль миші завершив роботу (${code}).` }); }
  });
}

async function stopHook() {
  const child = hookProcess;
  hookProcess = null;
  updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: null });
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 1500);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    try { child.stdin.end('quit\n'); } catch { child.kill(); }
  });
}

function startProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function nativeAction(target) {
  return new Promise((resolve, reject) => {
    const child = spawn(NATIVE, [`--action=${target}`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Windows не виконав дію (${code}).`)));
  });
}

async function executeAction(input) {
  let action, executing = false;
  try {
    action = validateAction(input);
    if (action.kind === 'group') return { ok: false, error: 'Відкрийте групу в колесі.' };
    closeWheel();
    if (ISOLATED) return { ok: false, error: 'Actions are disabled during isolated tests.' };
    executing = true;
    if (!action.target.trim()) throw new Error('Спочатку виберіть шлях до застосунку або файлу в налаштуваннях дії.');
    if (action.kind === 'system') {
      const windows = process.env.WINDIR || 'C:\\Windows';
      if (action.target === 'explorer') await startProcess(path.join(windows, 'explorer.exe'), []);
      else if (action.target === 'task-manager') await startProcess(path.join(windows, 'System32', 'Taskmgr.exe'), []);
      else if (action.target === 'settings') await shell.openExternal('ms-settings:');
      else { await new Promise(resolve => setTimeout(resolve, 100)); await nativeAction(action.target); }
    } else if (action.kind === 'app' && action.target.startsWith('app-id:')) {
      const appId = validatePackagedTarget(action.target, action.args);
      await startProcess(path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), ['shell:AppsFolder\\' + appId]);
    } else if (action.kind === 'app' && /^https?:\/\//i.test(action.target)) {
      const url = new URL(action.target);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Непідтримуваний протокол.');
      await shell.openExternal(url.href);
    } else {
      if (!path.isAbsolute(action.target)) throw new Error('Виберіть повний шлях до файлу.');
      const stat = await fsp.stat(action.target).catch(() => { throw new Error('Файл або папку не знайдено. Оновіть шлях до дії.'); });
      const extension = path.extname(action.target).toLowerCase();
      const args = parseArguments(action.args);
      if (action.kind === 'folder') {
        if (!stat.isDirectory()) throw new Error('Вибраний шлях не є папкою.');
        const error = await shell.openPath(action.target); if (error) throw new Error(error);
      } else if (action.kind === 'script') {
        if (!stat.isFile()) throw new Error('Виберіть файл скрипту.');
        if (extension === '.ps1') await startProcess(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-File', action.target, ...args], { cwd: path.dirname(action.target) });
        else if (extension === '.py') await startProcess('py.exe', [action.target, ...args], { cwd: path.dirname(action.target) });
        else if (extension === '.js' || extension === '.cjs') await startProcess(process.execPath, [action.target, ...args], { cwd: path.dirname(action.target), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        else throw new Error('Підтримуються скрипти .ps1, .py, .js та .cjs.');
      } else if (extension === '.exe') await startProcess(action.target, args, { cwd: path.dirname(action.target) });
      else if (extension === '.lnk') {
        if (args.length) throw new Error('Додайте аргументи у властивостях ярлика або виберіть .exe.');
        const error = await shell.openPath(action.target); if (error) throw new Error(error);
      } else throw new Error('Для застосунку виберіть файл .exe або .lnk.');
    }
    return { ok: true };
  } catch (error) {
    if (executing) {
      showMain('menus');
      sendAll('orbit:action-error', { error: error.message, actionId: action.id });
    }
    return { ok: false, error: error.message };
  }
}

function requireSender(event) {
  if (![mainWindow, overlayWindow].some(window => window && !window.isDestroyed() && window.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender.');
}

function registerIPC() {
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => { requireSender(event); return fn(...args); });
  handle('orbit:get-state', () => state);
  handle('orbit:get-runtime', () => runtime);
  handle('orbit:get-update-status', () => updater.getStatus());
  const updateAction = (channel, fn) => ipcMain.handle(channel, (event) => {
    requireSender(event);
    if (event.sender !== mainWindow.webContents) throw new Error('Updates require the main Orbit window.');
    return fn();
  });
  updateAction('orbit:check-updates', () => updater.check());
  updateAction('orbit:download-update', () => updater.download());
  updateAction('orbit:install-update', () => updater.install());
  updateAction('orbit:open-update-repository', () => shell.openExternal(UPDATE_REPOSITORY_URL));
  handle('orbit:save-state', saveState);
  handle('orbit:show-wheel', () => showWheel());
  handle('orbit:close-wheel', closeWheel);
  handle('orbit:execute-action', executeAction);
  handle('orbit:search-apps', (query = '', refresh = false) => appCatalog.searchApps(query, refresh));
  handle('orbit:get-app-icon', target => appCatalog.getAppIcon(target));
  handle('orbit:minimize', () => mainWindow.minimize());
  handle('orbit:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  handle('orbit:close-window', () => mainWindow.close());
  handle('orbit:pick-target', async kind => {
    if (!['app', 'folder', 'script'].includes(kind)) throw new Error('Invalid picker kind.');
    const result = await dialog.showOpenDialog(mainWindow, { title: kind === 'folder' ? 'Виберіть папку' : 'Виберіть файл',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      filters: kind === 'folder' ? [] : [{ name: kind === 'app' ? 'Застосунки Windows' : 'Скрипти', extensions: kind === 'app' ? ['exe', 'lnk'] : ['ps1', 'py', 'js', 'cjs'] }] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('orbit:export-state', async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Експортувати налаштування Orbit', defaultPath: 'orbit-settings.json', filters: [{ name: 'Orbit JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fsp.writeFile(result.filePath, JSON.stringify(state, null, 2), 'utf8'); return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  handle('orbit:import-state', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Імпортувати налаштування Orbit', properties: ['openFile'], filters: [{ name: 'Orbit JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const stat = await fsp.stat(result.filePaths[0]);
    if (stat.size > 1024 * 1024) throw new Error('Файл налаштувань завеликий.');
    return saveState(JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8')));
  });
}

function showMain(page) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  if (page) mainWindow.webContents.send('orbit:navigate', page);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Orbit · ${state.enabled ? 'Увімкнено' : 'Призупинено'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Відкрити Orbit', click: () => showMain() },
    { label: 'Показати колесо', click: () => showWheel().catch(console.error) },
    { label: 'Увімкнено', type: 'checkbox', checked: state.enabled, click: item => saveState({ ...state, enabled: item.checked }).catch(console.error) },
    { type: 'separator' }, { label: 'Вийти з Orbit', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(APP_ICON));
  tray.on('double-click', () => showMain());
  updateTray();
}

async function smokeTest() {
  const iconLoaded = !nativeImage.createFromPath(APP_ICON).isEmpty();
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.getElementById('app')?.textContent.trim()) resolve(true);
      else if (Date.now() > deadline) reject(new Error('Renderer did not render the main interface.'));
      else setTimeout(check, 50);
    };
    check();
  })`);
  const probe = await mainWindow.webContents.executeJavaScript('({ title: document.title, bridge: typeof window.orbit?.getState === "function", body: document.body.innerText.slice(0, 160) })');
  const overlay = await overlayWindow.webContents.executeJavaScript('({ overlay: new URLSearchParams(location.search).get("overlay"), bridge: typeof window.orbit?.onWheelOpen === "function" })');
  const native = await new Promise((resolve, reject) => {
    const child = spawn(NATIVE, ['--self-test'], { windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(JSON.parse(output.trim())) : reject(new Error('Native self-test failed.')));
  });
  const result = { ok: probe.bridge && overlay.bridge && native.ok && iconLoaded, main: probe, overlay, native, iconLoaded, menus: state.menus.length, actions: state.menus[0].items.length };
  console.log('ORBIT_SMOKE ' + JSON.stringify(result));
  if (!result.ok) throw new Error('Orbit smoke-test validation failed.');
}

app.setName('Orbit');
if (process.platform === 'win32') app.setAppUserModelId('com.creationsoft.orbit');
if (!ISOLATED) app.setPath('userData', path.join(app.getPath('appData'), 'Orbit'));
if (!ISOLATED && !app.requestSingleInstanceLock()) app.quit();
else {
  app.setName('Orbit');
  if (ISOLATED) app.setPath('userData', path.join(os.tmpdir(), `orbit-${SMOKE ? 'smoke' : 'e2e'}-${process.pid}`));
  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain());
  app.on('window-all-closed', () => { if (quitting || ISOLATED) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; closeWheel(); globalShortcut.unregisterAll();
    appCatalog.dispose();
    Promise.all([configQueue, stopHook(), updater?.dispose()]).finally(() => { if (tray) { tray.destroy(); tray = null; } app.quit(); });
  });
  app.whenReady().then(async () => {
    statePath = path.join(app.getPath('userData'), 'settings.json');
    state = await loadState(); nativeTheme.themeSource = state.theme;
    updater = createUpdater({
      version: app.getVersion(), repo: UPDATE_REPOSITORY,
      installDir: path.dirname(process.execPath),
      updatesDir: path.join(app.getPath('userData'), 'updates'),
      helperPath: path.join(path.dirname(NATIVE), 'Update.ps1'),
      isolated: ISOLATED || !app.isPackaged,
      getNativePid: () => hookProcess?.pid,
      onStatus: status => sendAll('orbit:update-status', status),
      beforeInstall: async () => { closeWheel(); await configQueue; await stopHook(); },
      onInstallReady: () => app.quit(),
    });
    registerIPC(); await createWindows();
    if (SMOKE) { await smokeTest(); app.quit(); return; }
    appCatalog.warm();
    if (E2E) return;
    createTray();
    updateRuntime({ shortcutRegistered: globalShortcut.register('Control+Space', () => wheelVisible ? closeWheel() : showWheel().catch(console.error)) });
    startHook();
  }).catch(async error => { console.error(error); quitting = true; appCatalog.dispose(); await stopHook(); globalShortcut.unregisterAll(); if (tray) tray.destroy(); app.exit(1); });
}
