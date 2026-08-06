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
let panelWindow = null;
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

/* ------------------------------------------------ Vorschau am Menüleisten-Icon */

const PANEL_WIDTH = 312;
const PANEL_HEIGHT = 392;

/**
 * Setzt die Vorschau mittig unter das Menüleisten-Icon. Ist das Icon so weit
 * am Rand, dass das Panel überstehen würde, rückt es nach innen; die Spitze
 * wandert dann entsprechend mit.
 */
function positionPanel() {
  if (!panelWindow || !tray) return;
  const iconBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: iconBounds.x, y: iconBounds.y });
  const { workArea } = display;

  const iconCenterX = iconBounds.x + iconBounds.width / 2;
  const margin = 6;
  let x = Math.round(iconCenterX - PANEL_WIDTH / 2);
  x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - PANEL_WIDTH - margin));
  const y = Math.round(iconBounds.y + iconBounds.height);

  panelWindow.setPosition(x, y, false);

  // Die Spitze soll weiterhin auf das Icon zeigen, auch wenn das Panel
  // seitlich verschoben wurde.
  const notchLeft = Math.round(iconCenterX - x);
  panelWindow.webContents.send('panel:notch', notchLeft);
}

function createPanelWindow() {
  if (panelWindow) return panelWindow;

  panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
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

  panelWindow.setAlwaysOnTop(true, 'pop-up-menu');
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.loadFile(path.join(RENDERER, 'panel.html'));

  // Klick daneben schließt die Vorschau — so verhält sich ein Menüleisten-Fenster.
  panelWindow.on('blur', () => hidePanel());

  return panelWindow;
}

function showPanel() {
  createPanelWindow();
  pushSnapshot();
  positionPanel();
  panelWindow.show();
  panelWindow.focus();
}

function hidePanel() {
  if (panelWindow && panelWindow.isVisible()) panelWindow.hide();
}

function togglePanel() {
  if (panelWindow && panelWindow.isVisible()) hidePanel();
  else showPanel();
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

/** Klassisches Menü auf Rechtsklick — die Vorschau liegt auf dem Linksklick. */
function trayContextMenu() {
  const running = tracker.running;
  return Menu.buildFromTemplate([
    { label: 'Dashboard öffnen', click: () => createMainWindow() },
    { type: 'separator' },
    {
      label: running ? 'Tracking pausieren' : 'Tracking fortsetzen',
      click: () => {
        if (tracker.running) tracker.stop(); else tracker.start();
        refreshTray();
        pushSnapshot();
      },
    },
    { type: 'separator' },
    { label: 'Focus Co-Pilot beenden', click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (!tray) return;
  const day = store.day();
  tray.setToolTip(
    `Focus Co-Pilot — ${formatShort(day.productive)} produktiv, ` +
    `${formatShort(day.wasted)} Prokrastination`
  );
}

function createTray() {
  tray = new Tray(trayImage());
  // Kein setContextMenu: sonst würde macOS den Linksklick abfangen und
  // die Vorschau käme nie zum Zug.
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => tray.popUpContextMenu(trayContextMenu()));
  refreshTray();
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
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('tracking:toggle', () => {
    if (tracker.running) tracker.stop(); else tracker.start();
    refreshTray();
    return buildSnapshot(store, tracker);
  });

  ipcMain.handle('panel:close', () => { hidePanel(); return true; });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return true; });

  ipcMain.handle('dashboard:open', () => {
    hidePanel(); // die Vorschau hat ihren Zweck erfüllt
    createMainWindow();
    return true;
  });
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
      // Den Tooltip nur etwa einmal pro Minute neu setzen.
      const now = Date.now();
      if (now - lastTrayRefresh > 60000) {
        lastTrayRefresh = now;
        refreshTray();
      }
    });

    tracker.on('nudge', ({ minutes, app: where }) => {
      notifications.nudge({ minutes, where }, () => createMainWindow());
    });
    tracker.on('goal-reached', ({ minutes }) => {
      notifications.goalReached({ minutes }, () => createMainWindow());
    });

    if (store.data.settings.tracking) tracker.start();
    createPanelWindow(); // im Hintergrund vorbereiten, damit sie sofort aufgeht

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
    if (store) store.flush();
  });
}
