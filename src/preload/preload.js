'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Schmale, explizite Brücke zwischen Renderer und Main.
 * Der Renderer bekommt keinen Node-Zugriff — nur diese Funktionen.
 */
contextBridge.exposeInMainWorld('copilot', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  onSnapshot: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },

  setOverride: (key, category) => ipcRenderer.invoke('override:set', { key, category }),
  setGoals: (goals) => ipcRenderer.invoke('goals:set', goals),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  toggleTracking: () => ipcRenderer.invoke('tracking:toggle'),

  closePanel: () => ipcRenderer.invoke('panel:close'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openDashboard: () => ipcRenderer.invoke('dashboard:open'),

  /** Verschiebt die Spitze der Vorschau, damit sie aufs Icon zeigt. */
  onNotch: (handler) => {
    const listener = (_event, left) => handler(left);
    ipcRenderer.on('panel:notch', listener);
    return () => ipcRenderer.removeListener('panel:notch', listener);
  },

  getAppIcon: (appName) => ipcRenderer.invoke('icon:app', appName),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
});
