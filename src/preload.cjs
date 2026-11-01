const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('orbit', Object.freeze({
  getState: () => ipcRenderer.invoke('orbit:get-state'),
  getRuntime: () => ipcRenderer.invoke('orbit:get-runtime'),
  getUpdateStatus: () => ipcRenderer.invoke('orbit:get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('orbit:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('orbit:download-update'),
  installUpdate: () => ipcRenderer.invoke('orbit:install-update'),
  openUpdateRepository: () => ipcRenderer.invoke('orbit:open-update-repository'),
  saveState: state => ipcRenderer.invoke('orbit:save-state', state),
  showWheel: () => ipcRenderer.invoke('orbit:show-wheel'),
  closeWheel: () => ipcRenderer.invoke('orbit:close-wheel'),
  executeAction: action => ipcRenderer.invoke('orbit:execute-action', action),
  pickTarget: kind => ipcRenderer.invoke('orbit:pick-target', kind),
  searchApps: (query = '', refresh = false) => ipcRenderer.invoke('orbit:search-apps', query, refresh),
  getAppIcon: target => ipcRenderer.invoke('orbit:get-app-icon', target),
  minimize: () => ipcRenderer.invoke('orbit:minimize'),
  maximize: () => ipcRenderer.invoke('orbit:maximize'),
  closeWindow: () => ipcRenderer.invoke('orbit:close-window'),
  importState: () => ipcRenderer.invoke('orbit:import-state'),
  exportState: () => ipcRenderer.invoke('orbit:export-state'),
  onWheelOpen: callback => subscribe('orbit:wheel-open', callback),
  onWheelClosed: callback => subscribe('orbit:wheel-closed', callback),
  onActionError: callback => subscribe('orbit:action-error', callback),
  onTriggerRelease: callback => subscribe('orbit:trigger-release', callback),
  onStateChanged: callback => subscribe('orbit:state-changed', callback),
  onRuntimeChanged: callback => subscribe('orbit:runtime-changed', callback),
  onUpdateStatus: callback => subscribe('orbit:update-status', callback),
  onNavigate: callback => subscribe('orbit:navigate', callback),
}));
