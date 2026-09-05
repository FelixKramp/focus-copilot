'use strict';

/**
 * Rendert das Dashboard in eine PNG-Datei, ohne die laufende App anzufassen.
 *
 * Gedacht für Design-Arbeit: eine Änderung an dashboard.css lässt sich damit
 * ansehen, statt sie erst zu bauen, zu installieren und zu starten. Die echten
 * Daten werden in ein Temp-Verzeichnis kopiert und nur gelesen — die laufende
 * App und ihre data.json bleiben unberührt.
 *
 *   npx electron scripts/preview.js [--out datei.png] [--clip #day] [--date 2026-08-14]
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { Store, dayKey } = require('../src/main/store');
const { buildSnapshot } = require('../src/main/stats');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(arg('out', 'preview.png'));
const CLIP = arg('clip', '');
const DATE = arg('date', '');
const WIDTH = Number(arg('width', 1320));
const HEIGHT = Number(arg('height', 940));

/** Kopie der echten Daten, damit hier nichts zurückgeschrieben werden kann. */
function stageRealData() {
  const live = path.join(
    os.homedir(),
    'Library/Application Support/Focus Co-Pilot/data.json',
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-preview-'));
  if (fs.existsSync(live)) {
    fs.copyFileSync(live, path.join(dir, 'data.json'));
  }
  return dir;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const dir = stageRealData();
  const store = new Store(dir);
  // Der Tracker wird nur für zwei Felder gebraucht; ein Stub reicht.
  const tracker = { running: true, current: null };
  const snapshot = buildSnapshot(store, tracker, DATE || undefined);

  const stub = path.join(dir, 'preview-preload.js');
  fs.writeFileSync(
    stub,
    `const { contextBridge } = require('electron');
     const snapshot = ${JSON.stringify(snapshot)};
     contextBridge.exposeInMainWorld('copilot', {
       getSnapshot: async () => snapshot,
       onSnapshot: () => () => {},
       setOverride: async () => snapshot,
       setGoals: async () => snapshot,
       setSettings: async () => snapshot,
       toggleTracking: async () => snapshot,
       acknowledgeRecord: async () => snapshot,
       closePanel: async () => {}, quitApp: async () => {},
       openDashboard: async () => {}, onNotch: () => () => {},
       getAppIcon: async () => null, openLink: async () => {},
     });`,
    'utf8',
  );

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    backgroundColor: '#050d11',
    webPreferences: { preload: stub, contextIsolation: true, nodeIntegration: false },
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  // Dem Renderer Zeit geben, den Snapshot zu zeichnen.
  await new Promise((r) => setTimeout(r, 1200));

  // --hover <selector>: Zeiger über ein Element schicken, damit Hover-Zustände
  // und Tooltips mit auf dem Bild landen.
  const HOVER = arg('hover', '');
  if (HOVER) {
    const ok = await win.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector(${JSON.stringify(HOVER)});
         if (!el) return false;
         const r = el.getBoundingClientRect();
         const x = r.left + r.width / 2, y = r.top + r.height / 2;
         for (const type of ['mouseover', 'mousemove']) {
           el.dispatchEvent(new MouseEvent(type, {
             bubbles: true, clientX: x, clientY: y,
           }));
         }
         const tip = document.getElementById('chartTooltip');
         return !!tip && !tip.hidden && tip.textContent.trim().length > 0;
       })()`,
    );
    console.log(`  hover ${HOVER}: ${ok ? 'Tooltip sichtbar' : 'KEIN Tooltip'}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  let rect;
  if (CLIP) {
    // Erst in den Viewport holen: capturePage() liefert nur, was gerendert
    // ist — sonst kommt ein abgeschnittenes Bild zurück und sieht aus wie ein
    // Layout-Fehler, der keiner ist.
    await win.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector(${JSON.stringify(CLIP)});
         if (el) el.scrollIntoView({ block: 'center' });
       })()`,
    );
    await new Promise((r) => setTimeout(r, 400));
    rect = await win.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector(${JSON.stringify(CLIP)});
         if (!el) return null;
         const r = el.getBoundingClientRect();
         return { x: Math.floor(r.x), y: Math.floor(r.y),
                  width: Math.ceil(r.width), height: Math.ceil(r.height) };
       })()`,
    );
    if (!rect) {
      console.error(`Element ${CLIP} nicht gefunden.`);
      app.exit(1);
      return;
    }
  }

  const image = rect
    ? await win.webContents.capturePage(rect)
    : await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toPNG());
  console.log(
    `${OUT}  (${DATE || dayKey()}, ${rect ? `${rect.width}×${rect.height}` : `${WIDTH}×${HEIGHT}`})`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(0);
});
