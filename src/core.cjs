const SYSTEM_ACTIONS = new Set(['explorer', 'task-manager', 'screenshot', 'mute', 'volume-up', 'volume-down', 'desktop', 'settings', 'lock', 'media-play',
  'control-panel', 'recycle-bin', 'search', 'run', 'task-view', 'clipboard', 'emoji', 'dictation', 'notifications', 'sound-settings', 'bluetooth',
  'media-prev', 'media-next', 'calculator', 'notepad']);
const ACTION_KINDS = new Set(['app', 'folder', 'script', 'system', 'group']);
const { validatePackagedTarget } = require('./app-catalog.cjs');

function string(value, name, maximum = 4096) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new Error(`Invalid ${name}.`);
  return value;
}

function validateAction(value, depth = 0, ids = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action.');
  if (depth > 4) throw new Error('Groups can have at most four nested levels.');
  const id = string(value.id, 'action ID', 100);
  if (!id || ids.has(id)) throw new Error('Action IDs must be unique and nonempty.');
  ids.add(id);
  if (!ACTION_KINDS.has(value.kind)) throw new Error('Unsupported action kind.');
  const result = { id, name: string(value.name, 'action name', 100).trim(), kind: value.kind,
    target: string(value.target ?? '', 'target'), args: string(value.args ?? '', 'arguments'), icon: string(value.icon ?? '', 'icon', 100), children: [] };
  if (!result.name) throw new Error('An action needs a name.');
  if (/^app-id:/i.test(result.target)) {
    if (value.kind !== 'app') throw new Error('Ідентифікатор застосунку Windows можна використовувати лише для застосунків.');
    validatePackagedTarget(result.target, result.args);
  }
  if (value.kind === 'system' && !SYSTEM_ACTIONS.has(result.target)) throw new Error('Unsupported Windows action.');
  if (value.kind === 'group') {
    if (!Array.isArray(value.children) || value.children.length > 12) throw new Error('A group can contain up to 12 actions.');
    result.children = value.children.map(child => validateAction(child, depth + 1, ids));
  }
  return result;
}

function validateState(value) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 1024 * 1024) throw new Error('Invalid or oversized configuration.');
  if (value.version !== 1) throw new Error('Unsupported configuration version.');
  if (!['dark', 'light', 'system'].includes(value.theme)) throw new Error('Invalid theme.');
  if (![4, 5].includes(value.triggerButton)) throw new Error('Choose mouse button 4 or 5.');
  if (!['release', 'hover', 'click'].includes(value.activationMode)) throw new Error('Invalid activation mode.');
  if (value.groupOpenMode !== undefined && !['hover', 'click'].includes(value.groupOpenMode)) throw new Error('Invalid group open mode.');
  if (!Number.isInteger(value.hoverDelay) || value.hoverDelay < 150 || value.hoverDelay > 2000) throw new Error('Hover delay must be between 150 and 2000 ms.');
  if (typeof value.enabled !== 'boolean' || typeof value.reducedMotion !== 'boolean') throw new Error('Invalid preference values.');
  if (value.closeOnOutsideClick !== undefined && typeof value.closeOnOutsideClick !== 'boolean') throw new Error('Invalid outside-click preference.');
  if (value.launchAtLogin !== undefined && typeof value.launchAtLogin !== 'boolean') throw new Error('Invalid start-with-Windows preference.');
  if (value.wheelSize !== undefined && (!Number.isInteger(value.wheelSize) || value.wheelSize < 312 || value.wheelSize > 780)) throw new Error('Wheel size must be an integer between 312 and 780 DIP.');
  if (!Array.isArray(value.menus) || !value.menus.length || value.menus.length > 20) throw new Error('Create between 1 and 20 menus.');
  const ids = new Set();
  const menus = value.menus.map(menu => {
    if (!menu || typeof menu !== 'object') throw new Error('Invalid menu.');
    const id = string(menu.id, 'menu ID', 100);
    if (!id || ids.has(id)) throw new Error('Menu IDs must be unique.');
    ids.add(id);
    if (!Array.isArray(menu.items) || menu.items.length > 12) throw new Error('Each wheel can have up to 12 actions.');
    const name = string(menu.name, 'menu name', 100).trim();
    if (!name) throw new Error('A menu needs a name.');
    return { id, name, icon: string(menu.icon ?? 'orbit', 'menu icon', 100), items: menu.items.map(item => validateAction(item, 0, ids)) };
  });
  if (!menus.some(menu => menu.id === value.activeMenuId)) throw new Error('The active menu does not exist.');
  return { version: 1, theme: value.theme, triggerButton: value.triggerButton, activationMode: value.activationMode, groupOpenMode: value.groupOpenMode ?? 'hover',
    hoverDelay: value.hoverDelay, enabled: value.enabled, reducedMotion: value.reducedMotion, closeOnOutsideClick: value.closeOnOutsideClick ?? true, launchAtLogin: value.launchAtLogin ?? true, wheelSize: value.wheelSize ?? 520, menus, activeMenuId: value.activeMenuId };
}

function parseArguments(value) {
  const args = []; let current = '', quoted = false, started = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') {
      let slashes = 1;
      while (value[index + 1] === '\\') { slashes++; index++; }
      if (value[index + 1] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) { current += '"'; index++; }
        else { quoted = !quoted; index++; }
      } else current += '\\'.repeat(slashes);
      started = true;
    }
    else if (char === '"') {
      if (quoted && value[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
      started = true;
    }
    else if (/\s/.test(char) && !quoted) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += char; started = true; }
  }
  if (quoted) throw new Error('Закрийте лапки в аргументах.');
  if (started) args.push(current);
  return args;
}

function wheelGeometry(point, area, wheelSize = 520) {
  const side = Math.max(600, wheelSize + 80);
  const width = Math.min(side, area.width), height = Math.min(side, area.height);
  const x = Math.round(Math.max(area.x, Math.min(point.x - width / 2, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(point.y - height / 2, area.y + area.height - height)));
  return { bounds: { x, y, width, height }, center: { x: width / 2, y: height / 2 } };
}

function wheelMountSize(bounds, wheelSize = 520) {
  return Math.max(0, Math.min(wheelSize, bounds.width - 30, bounds.height - 60));
}

function pointIsOutsideWheel(point, bounds, wheelSize = 520) {
  if (![point?.x, point?.y, bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return false;
  const mountSize = wheelMountSize(bounds, wheelSize);
  const radius = 207 / 480 * mountSize;
  const x = point.x - bounds.x - bounds.width / 2;
  const y = point.y - bounds.y - bounds.height / 2;
  return Math.hypot(x, y) > radius;
}

function shouldCloseWheelOnClick(event, visible, closeOnOutsideClick, bounds, wheelSize = 520) {
  return visible === true && closeOnOutsideClick === true && event?.type === 'click' && ['left', 'right', 'middle'].includes(event.button) && pointIsOutsideWheel(event, bounds, wheelSize);
}

// Turns a path dragged in from Explorer into an action, or null when Orbit cannot launch it.
function droppedAction(filePath, isDirectory) {
  const base = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || filePath;
  if (isDirectory) return { kind: 'folder', name: base, target: filePath };
  const extension = (/\.[^.\\/]+$/.exec(base)?.[0] || '').toLowerCase();
  const name = base.slice(0, base.length - extension.length) || base;
  if (['.exe', '.lnk'].includes(extension)) return { kind: 'app', name, target: filePath };
  if (['.ps1', '.py', '.js', '.cjs'].includes(extension)) return { kind: 'script', name, target: filePath };
  return null;
}

module.exports = { droppedAction, validateAction, validateState, parseArguments, wheelGeometry, wheelMountSize, pointIsOutsideWheel, shouldCloseWheelOnClick };
