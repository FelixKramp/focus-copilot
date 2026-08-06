'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, powerMonitor,
} = require('electron');

const { Store } = require('./store');
const { Tracker } = require('./tracker');
const { buildSnapshot } = require('./stats');
const notifications = require('./notifications');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

let store = null;
let tracker = null;
let mainWindow = null;
let miniWindow = null;
let tray = null;
let quitting = false;

/* ------------------------------------------------------------------ Fenster */

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: 'Focus Co-Pilot',
    backgroundColor: '#050d11',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Wenn die Oberfläche nicht lädt, soll das nicht stumm in einem leeren
  // Fenster enden, sondern im Log stehen.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Focus Co-Pilot] Oberfläche konnte nicht laden (${code} ${desc}): ${url}`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[Focus Co-Pilot] preload fehlgeschlagen:', preloadPath, error);
  });

  mainWindow.loadFile(path.join(RENDERER, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Externe Links im Standardbrowser öffnen, nicht in der App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    // Die App lebt in der Menüleiste weiter — Schließen heißt nur verstecken.
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

/** Positioniert das Mini-Fenster in der gewählten Bildschirmecke. */
function positionMini(win, corner) {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  const margin = 16;
  const positions = {
    'top-left': [workArea.x + margin, workArea.y + margin],
    'top-right': [workArea.x + workArea.width - w - margin, workArea.y + margin],
    'bottom-left': [workArea.x + margin, workArea.y + workArea.height - h - margin],
    'bottom-right': [
      workArea.x + workArea.width - w - margin,
      workArea.y + workArea.height - h - margin,
    ],
  };
  const [x, y] = positions[corner] || positions['bottom-right'];
  win.setPosition(Math.round(x), Math.round(y), false);
}

function createMiniWindow() {
  if (miniWindow) {
    miniWindow.show();
    return miniWindow;
  }

  miniWindow = new BrowserWindow({
    width: 296,
    height: 128,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Über Vollbild-Apps und auf allen Schreibtischen sichtbar bleiben.
  miniWindow.setAlwaysOnTop(true, 'floating');
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  miniWindow.loadFile(path.join(RENDERER, 'mini.html'));
  miniWindow.once('ready-to-show', () => {
    positionMini(miniWindow, store.data.settings.miniCorner);
    miniWindow.show();
  });
  miniWindow.on('closed', () => { miniWindow = null; });
  return miniWindow;
}

function toggleMini() {
  if (miniWindow) {
    miniWindow.close();
    miniWindow = null;
  } else {
    createMiniWindow();
  }
  rebuildTrayMenu();
}

/* -------------------------------------------------------------- Menüleiste */

function trayImage() {
  const file = path.join(ASSETS, 'trayTemplate.png');
  if (fs.existsSync(file)) {
    const img = nativeImage.createFromPath(file);
    img.setTemplateImage(true); // folgt hell/dunkel der Menüleiste
    return img;
  }
  return nativeImage.createEmpty();
}

function formatShort(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const day = store.day();
  const running = tracker.running;

  const menu = Menu.buildFromTemplate([
    { label: `Produktiv heute: ${formatShort(day.productive)}`, enabled: false },
    { label: `Prokrastination: ${formatShort(day.wasted)}`, enabled: false },
    { type: 'separator' },
    { label: 'Dashboard öffnen', click: () => createMainWindow() },
    {
      label: miniWindow ? 'Mini-Fenster ausblenden' : 'Mini-Fenster anzeigen',
      click: () => toggleMini(),
    },
    { type: 'separator' },
    {
      label: running ? 'Tracking pausieren' : 'Tracking fortsetzen',
      click: () => {
        if (tracker.running) tracker.stop(); else tracker.start();
        rebuildTrayMenu();
        pushSnapshot();
      },
    },
    { type: 'separator' },
    { label: 'Focus Co-Pilot beenden', click: () => { quitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`Focus Co-Pilot — ${formatShort(day.productive)} produktiv`);
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', () => rebuildTrayMenu());
  rebuildTrayMenu();
}

/* --------------------------------------------------------- App-Icons lesen */

const iconCache = new Map();

/** Findet den Bundle-Pfad einer App über die üblichen Orte. */
function findAppBundle(appName) {
  const candidates = [
    `/Applications/${appName}.app`,
    `/System/Applications/${appName}.app`,
    `/System/Applications/Utilities/${appName}.app`,
    `/Applications/Utilities/${appName}.app`,
    path.join(app.getPath('home'), 'Applications', `${appName}.app`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Fallback: den Pfad eines laufenden Prozesses über System Events erfragen. */
function bundleViaAppleScript(appName) {
  return new Promise((resolve) => {
    const script =
      `tell application "System Events" to get POSIX path of application file of ` +
      `(first application process whose name is "${appName.replace(/"/g, '')}")`;
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const p = String(stdout || '').trim();
      resolve(p && fs.existsSync(p) ? p : null);
    });
  });
}

async function getAppIconDataUrl(appName) {
  if (!appName) return null;
  if (iconCache.has(appName)) return iconCache.get(appName);

  let bundle = findAppBundle(appName);
  if (!bundle) bundle = await bundleViaAppleScript(appName);

  let dataUrl = null;
  if (bundle) {
    try {
      const img = await app.getFileIcon(bundle, { size: 'normal' });
      if (img && !img.isEmpty()) {
        dataUrl = img.resize({ width: 32, height: 32 }).toDataURL();
      }
    } catch {
      /* ohne Icon weiter */
    }
  }
  iconCache.set(appName, dataUrl);
  return dataUrl;
}

/* --------------------------------------------------------------- Snapshots */

function pushSnapshot() {
  if (!store || !tracker) return;
  const snapshot = buildSnapshot(store, tracker);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('snapshot', snapshot);
  }
}

/* --------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('snapshot:get', () => buildSnapshot(store, tracker));

  ipcMain.handle('override:set', (_e, { key, category }) => {
    store.setOverride(key, category);
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('goals:set', (_e, goals) => {
    store.setGoals(goals);
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('settings:set', (_e, settings) => {
    store.setSettings(settings);
    if (miniWindow && settings.miniCorner) {
      positionMini(miniWindow, settings.miniCorner);
    }
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('tracking:toggle', () => {
    if (tracker.running) tracker.stop(); else tracker.start();
    rebuildTrayMenu();
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('mini:toggle', () => { toggleMini(); return true; });
  ipcMain.handle('mini:close', () => {
    if (miniWindow) { miniWindow.close(); miniWindow = null; rebuildTrayMenu(); }
    return true;
  });
  ipcMain.handle('mini:corner', (_e, corner) => {
    store.setSettings({ miniCorner: corner });
    if (miniWindow) positionMini(miniWindow, corner);
    return true;
  });

  ipcMain.handle('dashboard:open', () => { createMainWindow(); return true; });
  ipcMain.handle('icon:app', (_e, appName) => getAppIconDataUrl(appName));
  ipcMain.handle('link:open', (_e, url) => { shell.openExternal(url); return true; });
}

/* ---------------------------------------------------------------- Lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createMainWindow());

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    tracker = new Tracker(store);

    registerIpc();
    createTray();
    createMainWindow();

    let lastTrayRefresh = 0;
    tracker.on('update', () => {
      pushSnapshot();
      // Das Tray-Menü nur etwa einmal pro Minute neu bauen.
      const now = Date.now();
      if (now - lastTrayRefresh > 60000) {
        lastTrayRefresh = now;
        rebuildTrayMenu();
      }
    });

    tracker.on('nudge', ({ minutes, app: where }) => {
      notifications.nudge({ minutes, where }, () => createMainWindow());
    });
    tracker.on('goal-reached', ({ minutes }) => {
      notifications.goalReached({ minutes }, () => createMainWindow());
    });

    if (store.data.settings.tracking) tracker.start();
    if (store.data.settings.miniVisible) createMiniWindow();

    // Nach dem Aufwachen kurz durchatmen, dann sofort neu messen.
    powerMonitor.on('resume', () => { if (tracker.running) tracker.tick(); });

    app.on('activate', () => createMainWindow());
  });

  app.on('window-all-closed', () => {
    // Menüleisten-App: läuft weiter, auch ohne offenes Fenster.
  });

  app.on('before-quit', () => {
    quitting = true;
    if (tracker) tracker.stop();
    if (store) {
      store.setSettings({ miniVisible: Boolean(miniWindow) });
      store.flush();
    }
  });
}
