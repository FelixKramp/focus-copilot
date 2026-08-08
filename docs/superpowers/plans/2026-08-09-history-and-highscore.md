# Datumsnavigation & Wochen-Highscore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Dashboard kann bis zu 29 Tage in die Vergangenheit navigiert werden, und eine neue "WOCHEN-SCORE"-Karte zeigt die Score-Verteilung der letzten 7 Tage inklusive Highscores (bester Einzeltag, beste Wochen-Durchschnitt) mit einer einmaligen Feier-Animation bei neuem Rekord.

**Architecture:** Alle Berechnungen bleiben im Main-Prozess (`store.js`/`stats.js`), der Renderer zeichnet nur. `buildSnapshot()` bekommt einen optionalen `dateKey`-Parameter; das Dashboard-Fenster merkt sich modulweit in `main.js`, welchen Tag es zuletzt angefragt hat, damit die alle 3 Sekunden gepushten Live-Updates (`pushSnapshot()`) den angezeigten Tag nicht zurück auf heute überschreiben. Highscores werden nach jedem Tracker-Tick in `store.js` geprüft und als unbestätigter Rekord (`pendingRecord`) gehalten, bis der Renderer sie einmalig gefeiert und quittiert hat.

**Tech Stack:** Electron (Main/Renderer/Preload), Vanilla JS, kein Framework, Tests über `node scripts/smoke-test.js` (custom `assert`-basierter Runner, kein Jest).

## Global Constraints

- Datumsformat überall `YYYY-MM-DD`, lokale Zeit (nicht UTC) — wie im bestehenden `dayKey()`.
- Navigation zurück maximal 29 Tage vor heute; das ist eine reine UI-Beschränkung im Renderer. `buildSnapshot()`/`snapshot:get` akzeptieren jeden `dateKey` ohne eigene Prüfung — `store.day()` liefert für unbekannte Tage einfach einen leeren Tag, das ist unkritisch.
- Die Menüleisten-Vorschau (`panelWindow`) zeigt immer heute, unabhängig davon, welchen Tag das Dashboard-Fenster gerade anzeigt.
- `current`, `tracking`, `last7`, `last14`, `projection`, `goals.streak`, `records`, `pendingRecord` beziehen sich immer auf den echten heutigen Tag / die letzten 7 bzw. 14 Tage ab heute — nie auf den im Dashboard angezeigten Tag.
- Ein neuer Highscore wird nur gefeiert (gilt als "Rekord"), wenn vorher schon ein Bestwert > 0 existierte — der allererste erfasste Tag setzt still die Baseline.
- Ø-Wochen-Score = `focusScore()` auf die **aufsummierten** `productive`/`neutral`/`wasted`-Werte der letzten 7 Tage (dauer-gewichtet), nicht der einfache Mittelwert der 7 Tages-Scores.
- Farb-/Stilsprache konsequent aus den bestehenden CSS-Variablen (`--cyan`, `--green`, `--green-bright`, `--red`, `--idle`) — keine neuen Farben einführen.

---

## Task 1: Highscore-Tracking in `store.js`, `focusScore` nach `score.js` ausgelagert

**Files:**
- Create: `src/main/score.js`
- Modify: `src/main/store.js`
- Modify: `src/main/stats.js` (nur der Import/Export von `focusScore`, siehe Interfaces — Rest bleibt in Task 2)
- Test: `scripts/smoke-test.js`

**Interfaces:**
- Produces: `focusScore(day)` in `src/main/score.js`, Signatur unverändert: nimmt `{productive, neutral, wasted}`, gibt `0`–`100` zurück.
- Produces: `Store#checkRecords()` (privat genutzt von `record()`), `Store#acknowledgeRecord()`.
- Produces: `store.data.records = { bestDayScore: {score, key}, bestWeekAvg: {score, key} }`, `store.data.pendingRecord = { type: 'day'|'week', score, key } | null`.
- Produces: `parseDayKey(key)` in `src/main/store.js`, exportiert neben `dayKey` — kehrt `dayKey()` um (`"2026-08-06"` → lokales `Date`-Objekt um Mitternacht).
- Consumes: nichts Neues aus anderen Tasks.

`stats.js` importiert `focusScore` bisher als eigene Funktion und exportiert sie weiter (`smoke-test.js` nutzt `require('../src/main/stats').focusScore`). Das muss nach dem Verschieben weiter funktionieren — `stats.js` re-exportiert `focusScore`, nur die Definition wandert.

Grund für die Auslagerung: `store.js` braucht `focusScore` für `checkRecords()`, aber `stats.js` requires bereits `store.js` (`dayKey`) — ein direkter Require von `stats.js` in `store.js` wäre ein zirkulärer Import. `score.js` hat keine Abhängigkeiten und kann von beiden genutzt werden.

- [ ] **Step 1: `focusScore` nach `src/main/score.js` verschieben**

Neue Datei:

```js
'use strict';

/** Fokus-Score: Produktiv zählt voll, neutral halb, Prokrastination gar nicht. */
function focusScore(day) {
  const base = day.productive + day.neutral + day.wasted;
  if (base <= 0) return 0;
  return Math.round(((day.productive + day.neutral * 0.5) / base) * 100);
}

module.exports = { focusScore };
```

In `src/main/stats.js`: die bestehende Definition von `focusScore` (Zeilen 13–18) entfernen und stattdessen importieren:

```js
const { dayKey } = require('./store');
const { focusScore } = require('./score');
```

Der bestehende Export-Aufruf am Dateiende bleibt unverändert:

```js
module.exports = { buildSnapshot, focusScore, project };
```

- [ ] **Step 2: Bestehende Tests laufen lassen, um sicherzustellen, dass die Verschiebung nichts kaputt macht**

Run: `npm test`
Expected: Alle bisherigen Prüfungen bestehen weiterhin (der "Fokus-Score gewichtet neutral halb"-Test importiert `focusScore` weiterhin aus `../src/main/stats`, das muss unverändert funktionieren).

- [ ] **Step 3: Commit**

```bash
git add src/main/score.js src/main/stats.js
git commit -m "Fokus-Score-Berechnung nach score.js auslagern"
```

- [ ] **Step 4: Fehlschlagenden Test für `checkRecords()` schreiben**

In `scripts/smoke-test.js`, Import-Zeile für Store erweitern (aktuell `const { Store } = require('../src/main/store');`):

```js
const { Store, dayKey, emptyDay } = require('../src/main/store');
```

Neuen Abschnitt nach der bestehenden "Speicher"-Sektion einfügen (vor `console.log('\nStatistik');`):

```js
console.log('\nHighscores');
check('Der allererste erfasste Tag setzt die Baseline, ohne zu feiern', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);

  s.record(600, 'productive', { app: 'Xcode' }); // Score 100 %, aber erster Tag

  assert.strictEqual(s.data.records.bestDayScore.score, 100);
  assert.strictEqual(s.data.records.bestWeekAvg.score, 100);
  assert.strictEqual(s.data.pendingRecord, null, 'der allererste Tag feiert nicht');

  fs.rmSync(dir, { recursive: true, force: true });
});

check('Ein geschlagener Tages-Rekord wird aktualisiert und als unbestätigt markiert', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);
  // Wochen-Bestwert schon am Maximum, damit nur der Tages-Rekord auslöst.
  s.data.records.bestDayScore = { score: 50, key: '2026-01-01' };
  s.data.records.bestWeekAvg = { score: 100, key: '2026-01-01' };

  s.record(600, 'productive', { app: 'Xcode' }); // heutiger Score: 100 %

  assert.strictEqual(s.data.records.bestDayScore.score, 100);
  assert.strictEqual(s.data.records.bestDayScore.key, dayKey());
  assert.ok(s.data.pendingRecord, 'ein Rekord muss als unbestätigt markiert sein');
  assert.strictEqual(s.data.pendingRecord.type, 'day');
  assert.strictEqual(s.data.pendingRecord.score, 100);

  fs.rmSync(dir, { recursive: true, force: true });
});

check('acknowledgeRecord() löscht den unbestätigten Rekord', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);
  s.data.records.bestDayScore = { score: 50, key: '2026-01-01' };
  s.data.records.bestWeekAvg = { score: 100, key: '2026-01-01' };
  s.record(600, 'productive', { app: 'Xcode' });
  assert.ok(s.data.pendingRecord);

  s.acknowledgeRecord();

  assert.strictEqual(s.data.pendingRecord, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

check('Bestwerte und unbestätigter Rekord überleben Speichern und Neuladen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);
  s.data.records.bestDayScore = { score: 50, key: '2026-01-01' };
  s.data.records.bestWeekAvg = { score: 100, key: '2026-01-01' };
  s.record(600, 'productive', { app: 'Xcode' });
  s.flush();

  const reloaded = new Store(dir);
  assert.strictEqual(reloaded.data.records.bestDayScore.score, 100);
  assert.ok(reloaded.data.pendingRecord, 'pendingRecord muss erhalten bleiben');

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 5: Testlauf, um das Fehlschlagen zu bestätigen**

Run: `npm test`
Expected: FAIL — `s.data.records` ist `undefined` (Property existiert noch nicht), der Prozess bricht mit einem Fehler wie `Cannot read properties of undefined (reading 'bestDayScore')` ab.

- [ ] **Step 6: `records`/`pendingRecord` und `checkRecords()`/`acknowledgeRecord()` in `store.js` implementieren**

Am Dateianfang, Import ergänzen:

```js
const { focusScore } = require('./score');
```

Nach `const DEFAULT_SETTINGS = {...};` eine Fabrikfunktion ergänzen (kein geteiltes Objekt, damit mehrere `Store`-Instanzen sich nicht gegenseitig verändern):

```js
function defaultRecords() {
  return {
    bestDayScore: { score: 0, key: null },
    bestWeekAvg: { score: 0, key: null },
  };
}
```

Im Konstruktor (`constructor(dir) { ... this.data = { ... }; ... }`) `records`/`pendingRecord` ergänzen:

```js
this.data = {
  days: {},
  overrides: {},
  goals: { ...DEFAULT_GOALS },
  settings: { ...DEFAULT_SETTINGS },
  records: defaultRecords(),
  pendingRecord: null,
};
```

In `load()`, im Erfolgsfall (`this.data = { days: parsed.days || {}, ... };`) ebenfalls ergänzen — mit Fallback auf Defaults, falls eine ältere `data.json` die Felder noch nicht kennt:

```js
this.data = {
  days: parsed.days || {},
  overrides: parsed.overrides || {},
  goals: { ...DEFAULT_GOALS, ...(parsed.goals || {}) },
  settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
  records: {
    bestDayScore: { ...defaultRecords().bestDayScore, ...((parsed.records || {}).bestDayScore || {}) },
    bestWeekAvg: { ...defaultRecords().bestWeekAvg, ...((parsed.records || {}).bestWeekAvg || {}) },
  },
  pendingRecord: parsed.pendingRecord || null,
};
```

In `record(seconds, category, ctx = {})`: `this.checkRecords();` jeweils direkt vor `this.save();` einfügen — einmal im frühen `inactive`-Zweig, einmal am Ende der Methode:

```js
if (category === 'inactive') {
  day.inactive += seconds;
  bucket.i += seconds;
  this.checkRecords();
  this.save();
  return;
}
```

```js
    if (ctx.youtube && ctx.youtube.id) {
      const rec = day.youtube[ctx.youtube.id] || (day.youtube[ctx.youtube.id] = { sec: 0, title: '' });
      rec.sec += seconds;
      if (ctx.youtube.title) rec.title = ctx.youtube.title;
    }

    this.checkRecords();
    this.save();
  }
```

Direkt nach `record()` (vor `setOverride()`) zwei neue Methoden einfügen:

```js
  /**
   * Prüft nach einem Tick, ob ein neuer Bestwert erreicht wurde (Tages-Score
   * oder Ø-Score der letzten 7 Tage), und merkt ihn als unbestätigten Rekord.
   * Der allererste erfasste Tag setzt still die Baseline, ohne zu feiern —
   * sonst würde Tag 1 immer sofort als "Rekord" gelten.
   */
  checkRecords() {
    const today = this.day();
    if (today.total <= 0) return;

    const todayScore = focusScore(today);
    const bestDay = this.data.records.bestDayScore;
    if (todayScore > bestDay.score) {
      const hadBaseline = bestDay.score > 0;
      this.data.records.bestDayScore = { score: todayScore, key: dayKey() };
      if (hadBaseline) this.data.pendingRecord = { type: 'day', score: todayScore, key: dayKey() };
    }

    const weekSum = this.lastDays(7).reduce((acc, { data }) => ({
      productive: acc.productive + data.productive,
      neutral: acc.neutral + data.neutral,
      wasted: acc.wasted + data.wasted,
    }), { productive: 0, neutral: 0, wasted: 0 });
    const weekAvg = focusScore(weekSum);
    const bestWeek = this.data.records.bestWeekAvg;
    if (weekAvg > bestWeek.score) {
      const hadBaseline = bestWeek.score > 0;
      this.data.records.bestWeekAvg = { score: weekAvg, key: dayKey() };
      if (hadBaseline) this.data.pendingRecord = { type: 'week', score: weekAvg, key: dayKey() };
    }
  }

  /** Markiert den aktuell unbestätigten Rekord als gesehen (Renderer hat die Animation gezeigt). */
  acknowledgeRecord() {
    this.data.pendingRecord = null;
    this.flush();
  }
```

Am Dateiende `parseDayKey` ergänzen (Gegenstück zu `dayKey()`, für Task 2 gebraucht) und exportieren:

```js
/** Kehrt dayKey() um: "2026-08-06" → lokales Date-Objekt um Mitternacht. */
function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
```

```js
module.exports = {
  Store, dayKey, parseDayKey, emptyDay, DEFAULT_GOALS, DEFAULT_SETTINGS,
};
```

- [ ] **Step 7: Testlauf, um das Bestehen zu bestätigen**

Run: `npm test`
Expected: PASS — alle vier neuen "Highscores"-Prüfungen und alle bisherigen Prüfungen sind grün.

- [ ] **Step 8: Commit**

```bash
git add src/main/store.js scripts/smoke-test.js
git commit -m "Highscore-Tracking (bester Tag / beste Woche) in store.js"
```

---

## Task 2: `buildSnapshot()` um Datumsnavigation und Highscore-Daten erweitern

**Files:**
- Modify: `src/main/stats.js`
- Test: `scripts/smoke-test.js`

**Interfaces:**
- Consumes: `focusScore` aus `./score` (Task 1), `dayKey`/`parseDayKey` aus `./store` (Task 1).
- Produces: `buildSnapshot(store, tracker, dateKey?)` — dritter Parameter optional, Verhalten ohne ihn unverändert (heutiger Tag). Neue/geänderte Snapshot-Felder:
  - `date.isToday: boolean`
  - `today.*`, `hours`, `apps`, `domains`, `youtube`, `goals.productiveProgress`, `goals.budgetProgress`, `goals.budgetExceeded` beziehen sich jetzt auf den angeforderten Tag statt immer auf heute.
  - `weekScore: { avg: number }` — Ø-Score der letzten 7 Tage, dauer-gewichtet.
  - `records: store.data.records`, `pendingRecord: store.data.pendingRecord` — Durchreichung, immer bezogen auf echt-heute.
  - `last7`/`last14`/`current`/`tracking`/`projection`/`goals.streak` unverändert bezogen auf echt-heute.

- [ ] **Step 1: Fehlschlagenden Test für den `dateKey`-Parameter schreiben**

In `scripts/smoke-test.js`, Import um `emptyDay` ergänzen war schon Teil von Task 1. Im "Statistik"-Abschnitt, vor der bestehenden Prüfung "Snapshot enthält alles, was die Oberfläche braucht", einfügen:

```js
check('buildSnapshot() zeigt einen vergangenen Tag, wenn dateKey übergeben wird', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = dayKey(yesterday);
  s.data.days[yKey] = { ...emptyDay(), productive: 900, total: 900 };
  s.flush();

  const past = buildSnapshot(s, { running: true, current: {} }, yKey);
  assert.strictEqual(past.date.key, yKey);
  assert.strictEqual(past.date.isToday, false);
  assert.strictEqual(past.today.productive, 900);

  const today = buildSnapshot(s, { running: true, current: {} });
  assert.strictEqual(today.date.isToday, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

check('Snapshot enthält Wochen-Score und Highscores unabhängig vom angezeigten Tag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);
  s.record(600, 'productive', { app: 'Xcode' }); // Score 100 % heute

  const snap = buildSnapshot(s, { running: true, current: {} });
  assert.strictEqual(snap.weekScore.avg, 100);
  assert.strictEqual(snap.records.bestDayScore.score, 100);
  assert.strictEqual(snap.pendingRecord, null);

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Testlauf, um das Fehlschlagen zu bestätigen**

Run: `npm test`
Expected: FAIL — `past.date.isToday` ist `undefined` bzw. `snap.weekScore` ist `undefined`.

- [ ] **Step 3: `buildSnapshot()` in `src/main/stats.js` anpassen**

Import-Zeile am Dateianfang ersetzen (siehe auch Task 1):

```js
const { dayKey, parseDayKey } = require('./store');
const { focusScore } = require('./score');
```

Die bisherige `focusScore`-Definition (Zeilen 13–18 im Original) ist bereits in Task 1 entfernt worden.

`buildSnapshot` komplett ersetzen durch:

```js
function buildSnapshot(store, tracker, dateKey) {
  const key = dateKey || dayKey();
  const isToday = key === dayKey();
  const viewed = store.day(key);
  const goals = store.data.goals;
  const settings = store.data.settings;

  const goalSeconds = goals.productiveMinutes * 60;
  const budgetSeconds = goals.maxWasteMinutes * 60;

  const last7 = store.lastDays(7).map(({ key: k, date, data }) => ({
    key: k,
    label: date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''),
    productive: data.productive,
    neutral: data.neutral,
    wasted: data.wasted,
    goalReached: goalSeconds > 0 && data.productive >= goalSeconds,
  }));

  const last14 = store.lastDays(14).map(({ key: k, date, data }) => ({
    key: k,
    label: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    score: focusScore(data),
    hasData: data.total > 0,
  }));

  const weekSum = store.lastDays(7).reduce((acc, { data }) => ({
    productive: acc.productive + data.productive,
    neutral: acc.neutral + data.neutral,
    wasted: acc.wasted + data.wasted,
  }), { productive: 0, neutral: 0, wasted: 0 });

  return {
    generatedAt: Date.now(),
    date: {
      key,
      isToday,
      label: parseDayKey(key)
        .toLocaleDateString('de-DE', {
          weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
        })
        .replace(',', ''),
    },
    tracking: tracker.running,
    current: tracker.current,
    today: {
      total: viewed.total,
      productive: viewed.productive,
      neutral: viewed.neutral,
      wasted: viewed.wasted,
      inactive: viewed.inactive,
      score: focusScore(viewed),
    },
    goals: {
      productiveMinutes: goals.productiveMinutes,
      maxWasteMinutes: goals.maxWasteMinutes,
      productiveProgress: goalSeconds > 0 ? Math.min(1, viewed.productive / goalSeconds) : 0,
      budgetProgress: budgetSeconds > 0 ? Math.min(1, viewed.wasted / budgetSeconds) : 0,
      budgetExceeded: budgetSeconds > 0 && viewed.wasted > budgetSeconds,
      streak: computeStreak(store),
    },
    projection: {
      wasted: project(viewed.wasted),
      // Was das gesetzte Limit über ein Jahr bedeuten würde.
      limitDaysPerYear: (budgetSeconds * WORK_DAYS_PER_YEAR) / 86400,
      goalHoursPerYear: (goalSeconds * WORK_DAYS_PER_YEAR) / 3600,
    },
    hours: viewed.hours,
    last7,
    last14,
    weekScore: {
      avg: focusScore(weekSum),
    },
    records: store.data.records,
    pendingRecord: store.data.pendingRecord,
    apps: topList(viewed.apps, 6),
    domains: topList(viewed.domains, 6),
    youtube: topYoutube(viewed.youtube, 5),
    overrides: store.data.overrides,
    settings,
  };
}
```

- [ ] **Step 4: Testlauf, um das Bestehen zu bestätigen**

Run: `npm test`
Expected: PASS — alle Prüfungen inklusive der zwei neuen sind grün. Insbesondere bleibt `snap.last7[6].key === snap.date.key` in der bestehenden Prüfung "Snapshot enthält alles, was die Oberfläche braucht" wahr, weil ohne `dateKey`-Argument `key === dayKey()` weiterhin gilt.

- [ ] **Step 5: Commit**

```bash
git add src/main/stats.js scripts/smoke-test.js
git commit -m "buildSnapshot(): optionaler dateKey, Wochen-Score und Highscores"
```

---

## Task 3: IPC-Verdrahtung für Datumsnavigation und Rekord-Bestätigung

**Files:**
- Modify: `src/main/main.js`
- Modify: `src/preload/preload.js`

**Interfaces:**
- Consumes: `buildSnapshot(store, tracker, dateKey?)` (Task 2), `store.acknowledgeRecord()` (Task 1).
- Produces: `window.copilot.getSnapshot(dateKey?)`, `window.copilot.acknowledgeRecord()` — für Task 5 im Renderer.
- Produces (main-intern): Modulvariable `viewedDateKey` in `main.js`, die verfolgt, welchen Tag das Dashboard-Fenster zuletzt angefragt hat.

Kein automatisierter Test möglich (Electron-IPC braucht ein laufendes Fenster) — Verifikation manuell in Task 6.

- [ ] **Step 1: `viewedDateKey` einführen und beim Schließen des Dashboard-Fensters zurücksetzen**

In `src/main/main.js`, bei den bestehenden Modul-Variablen (`let mainWindow = null;`) ergänzen:

```js
let mainWindow = null;
let viewedDateKey = null; // Tag, den das Dashboard-Fenster gerade anzeigt; null = heute
```

In `createMainWindow()`, die bestehende Zeile

```js
mainWindow.on('closed', () => { mainWindow = null; });
```

ersetzen durch:

```js
mainWindow.on('closed', () => { mainWindow = null; viewedDateKey = null; });
```

- [ ] **Step 2: `pushSnapshot()` pro Fenster den richtigen Tag schicken lassen**

Die bestehende Funktion

```js
function pushSnapshot() {
  if (!store || !tracker) return;
  const snapshot = buildSnapshot(store, tracker);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('snapshot', snapshot);
  }
}
```

ersetzen durch:

```js
function pushSnapshot() {
  if (!store || !tracker) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // Nur das Dashboard-Fenster darf einen vergangenen Tag angezeigt bekommen —
    // die Menüleisten-Vorschau zeigt immer heute.
    const dateKey = win === mainWindow ? (viewedDateKey || undefined) : undefined;
    win.webContents.send('snapshot', buildSnapshot(store, tracker, dateKey));
  }
}
```

- [ ] **Step 3: `snapshot:get` und die schreibenden IPC-Handler den angezeigten Tag respektieren lassen**

Die bestehenden Handler in `registerIpc()` ersetzen:

```js
ipcMain.handle('snapshot:get', (e, dateKey) => {
  if (mainWindow && e.sender === mainWindow.webContents) viewedDateKey = dateKey || null;
  return buildSnapshot(store, tracker, dateKey);
});

ipcMain.handle('override:set', (_e, { key, category }) => {
  store.setOverride(key, category);
  return buildSnapshot(store, tracker, viewedDateKey || undefined);
});

ipcMain.handle('goals:set', (_e, goals) => {
  store.setGoals(goals);
  return buildSnapshot(store, tracker, viewedDateKey || undefined);
});

ipcMain.handle('settings:set', (_e, settings) => {
  store.setSettings(settings);
  return buildSnapshot(store, tracker, viewedDateKey || undefined);
});

ipcMain.handle('tracking:toggle', () => {
  if (tracker.running) tracker.stop(); else tracker.start();
  refreshTray();
  return buildSnapshot(store, tracker, viewedDateKey || undefined);
});
```

(Alle anderen Handler in `registerIpc()` — `panel:close`, `app:quit`, `dashboard:open`, `icon:app`, `link:open` — bleiben unverändert.)

- [ ] **Step 4: Neuen Handler `records:acknowledge` ergänzen**

Direkt nach dem `tracking:toggle`-Handler einfügen:

```js
ipcMain.handle('records:acknowledge', () => {
  store.acknowledgeRecord();
  return true;
});
```

- [ ] **Step 5: `preload.js` um die neuen Aufrufe erweitern**

In `src/preload/preload.js`:

```js
getSnapshot: (dateKey) => ipcRenderer.invoke('snapshot:get', dateKey),
```

(ersetzt die bisherige `getSnapshot: () => ipcRenderer.invoke('snapshot:get'),`)

Und nach `toggleTracking`:

```js
toggleTracking: () => ipcRenderer.invoke('tracking:toggle'),
acknowledgeRecord: () => ipcRenderer.invoke('records:acknowledge'),
```

- [ ] **Step 6: `npm test` laufen lassen, um sicherzustellen, dass die Kernlogik nicht betroffen ist**

Run: `npm test`
Expected: PASS — `main.js`/`preload.js` werden vom Smoke-Test nicht importiert, das bestätigt nur, dass Task 1/2 weiterhin intakt sind.

- [ ] **Step 7: Commit**

```bash
git add src/main/main.js src/preload/preload.js
git commit -m "IPC: Datumsnavigation und Rekord-Bestätigung verdrahten"
```

---

## Task 4: Markup und Styles für Datumsnavigation und die WOCHEN-SCORE-Karte

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/dashboard.css`

**Interfaces:**
- Produces: DOM-IDs, die Task 5 anspricht: `btnPrevDay`, `btnNextDay`, `dateLabel` (bestehend), `cardWeekScore`, `weekScoreAvg`, `weekScoreChart`, `badgeBestDay`, `bestDayScore`, `bestDayDate`, `badgeBestWeek`, `bestWeekScore`, `recordBurst`, `recordBurstText`.
- Produces: CSS-Klassen `.span-6`, `.record-badge`, `.record-badge.is-fresh`, `.burst-particle`, `.record-burst`, `.chart--week-score`.

Kein automatisierter Test — rein strukturell, Verifikation visuell in Task 6.

- [ ] **Step 1: Datumsnavigation im Markup verdrahtbar machen**

In `src/renderer/index.html`, den bestehenden Block

```html
<div class="datepill">
  <span class="chev" aria-hidden="true">‹</span>
  <span id="dateLabel">—</span>
  <span class="chev" aria-hidden="true">›</span>
</div>
```

ersetzen durch:

```html
<div class="datepill">
  <button class="chev" id="btnPrevDay" aria-label="Vorheriger Tag">‹</button>
  <span id="dateLabel">—</span>
  <button class="chev" id="btnNextDay" aria-label="Nächster Tag">›</button>
</div>
```

- [ ] **Step 2: TAGESVERLAUF verkleinern und die neue Karte danach einfügen**

Die bestehende Zeile

```html
    <section class="card span-12">
      <div class="card-head">
        <h2>TAGESVERLAUF</h2>
```

ändern zu `class="card span-6"`. Direkt nach dem schließenden `</section>` dieser Karte (nach `<div class="chart chart--day" id="day"></div>` und dem `</section>`) die neue Karte einfügen:

```html
    <section class="card span-6" id="cardWeekScore">
      <div class="card-head"><h2>WOCHEN-SCORE</h2><span class="card-sub">letzte 7 Tage</span></div>
      <div class="week-score-avg">
        <strong id="weekScoreAvg">0</strong><span>%</span>
        <label>Ø DIESE WOCHE</label>
      </div>
      <div class="chart chart--trend chart--week-score" id="weekScoreChart"></div>
      <div class="records">
        <div class="record-badge" id="badgeBestDay">
          <label>BESTER TAG</label>
          <strong id="bestDayScore">—</strong>
          <span id="bestDayDate"></span>
        </div>
        <div class="record-badge" id="badgeBestWeek">
          <label>BESTE WOCHE</label>
          <strong id="bestWeekScore">—</strong>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Overlay für die Rekord-Animation am Fokus-Reaktor ergänzen**

In `src/renderer/index.html`, innerhalb der bestehenden `<section class="card span-4" id="cardReactor">`, direkt nach dem öffnenden `<div class="reactor">`-Tag (vor `<div class="gauge">`) einfügen:

```html
      <div class="record-burst" id="recordBurst" hidden>
        <span class="record-burst-text" id="recordBurstText"></span>
      </div>
```

- [ ] **Step 4: `.span-6` und Grid-Breakpoint ergänzen**

In `src/renderer/dashboard.css`, die bestehenden Zeilen

```css
.span-4 { grid-column: span 4; }
.span-8 { grid-column: span 8; }
.span-12 { grid-column: span 12; }

@media (max-width: 1080px) {
  .span-4, .span-8 { grid-column: span 12; }
}
```

ersetzen durch:

```css
.span-4 { grid-column: span 4; }
.span-6 { grid-column: span 6; }
.span-8 { grid-column: span 8; }
.span-12 { grid-column: span 12; }

@media (max-width: 1080px) {
  .span-4, .span-6, .span-8 { grid-column: span 12; }
}
```

- [ ] **Step 5: Chevrons als klickbare Buttons stylen**

Die bestehende Regel

```css
.datepill .chev { color: var(--muted-dim); }
```

ersetzen durch:

```css
.datepill .chev {
  color: var(--muted-dim);
  background: transparent;
  border: none;
  font: inherit;
  cursor: pointer;
  padding: 2px 4px;
  transition: color 0.15s;
}
.datepill .chev:hover:not(:disabled) { color: var(--cyan); }
.datepill .chev:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 6: Styles für die WOCHEN-SCORE-Karte ergänzen**

Nach dem bestehenden Block `.bar-group.is-dim { opacity: 0.38; }` (Ende des Diagramm-Abschnitts) einfügen:

```css
/* ------------------------------------------------------- Wochen-Score */

.week-score-avg { display: flex; align-items: baseline; gap: 4px; margin-bottom: 10px; }
.week-score-avg strong { font-family: var(--mono); font-size: 26px; font-weight: 600; color: #eafcff; }
.week-score-avg span { font-size: 13px; color: var(--muted); }
.week-score-avg label { font-size: 9.5px; letter-spacing: 0.13em; color: var(--muted-dim); margin-left: 8px; }

.chart--week-score { height: 80px; margin-bottom: 14px; }

.records { display: flex; gap: 12px; }
.record-badge {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(8, 24, 31, 0.5);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.record-badge label { display: block; font-size: 9px; letter-spacing: 0.12em; color: var(--muted-dim); margin-bottom: 3px; }
.record-badge strong { font-family: var(--mono); font-size: 17px; font-weight: 600; color: var(--cyan); }
.record-badge span { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }
.record-badge.is-fresh { border-color: var(--green); box-shadow: 0 0 10px rgba(34, 197, 94, 0.35); }
.record-badge.is-fresh strong { color: var(--green-bright); }
```

- [ ] **Step 7: Styles für die Rekord-Animation ergänzen**

Direkt danach einfügen:

```css
/* ------------------------------------------------------ Rekord-Animation */

.record-burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}
.record-burst-text {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--green-bright);
  text-shadow: 0 0 16px rgba(34, 197, 94, 0.8);
  opacity: 0;
  animation: recordBurstText 1.8s ease-out forwards;
}
.burst-particle {
  position: absolute;
  top: 50%; left: 50%;
  width: 5px; height: 5px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  opacity: 0;
  animation: burstParticle 1.2s ease-out forwards;
}
@keyframes recordBurstText {
  0% { opacity: 0; transform: translateY(6px) scale(0.9); }
  15% { opacity: 1; transform: translateY(0) scale(1); }
  75% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-4px) scale(1.02); }
}
@keyframes burstParticle {
  0% { opacity: 1; transform: translate(-50%, -50%) translate(0, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) scale(0.4); }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/index.html src/renderer/dashboard.css
git commit -m "Markup und Styles: Datumsnavigation und Wochen-Score-Karte"
```

---

## Task 5: Renderer-Logik — Datumsnavigation, Wochen-Score-Karte, Rekord-Animation

**Files:**
- Modify: `src/renderer/dashboard.js`

**Interfaces:**
- Consumes: `window.copilot.getSnapshot(dateKey?)`, `window.copilot.acknowledgeRecord()` (Task 3); DOM-IDs aus Task 4; Snapshot-Felder `date.isToday`, `weekScore.avg`, `records.bestDayScore`, `records.bestWeekAvg`, `pendingRecord`, `last14` (Task 2).
- Produces: nichts, das andere Tasks konsumieren — Endpunkt der Kette.

Kein automatisierter Test (Renderer-Code läuft nur im Electron-Fenster) — Verifikation manuell in Task 6.

- [ ] **Step 1: Lokale Datums-Helfer und Navigations-State ergänzen**

Nach der bestehenden Zeile `let pendingGoals = null;` einfügen:

```js
let viewedDate = new Date();
const MAX_DAYS_BACK = 29;

/** Spiegelt store.js' dayKey() — der Renderer hat keinen Zugriff auf Node/Main-Code. */
function dayKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Gegenstück zu dayKeyLocal(). */
function parseDayKeyLocal(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSameDay(a, b) {
  return dayKeyLocal(a) === dayKeyLocal(b);
}
```

- [ ] **Step 2: Navigationsfunktionen ergänzen**

Direkt danach:

```js
function clampViewedDate(d) {
  const today = new Date();
  const earliest = new Date(today);
  earliest.setDate(today.getDate() - MAX_DAYS_BACK);
  if (d > today) return today;
  if (d < earliest) return earliest;
  return d;
}

async function loadDay(date) {
  const target = clampViewedDate(date);
  render(await window.copilot.getSnapshot(dayKeyLocal(target)));
}

function updateDateNavButtons() {
  const today = new Date();
  const earliest = new Date(today);
  earliest.setDate(today.getDate() - MAX_DAYS_BACK);
  $('btnPrevDay').disabled = !(viewedDate > earliest);
  $('btnNextDay').disabled = isSameDay(viewedDate, today);
}
```

- [ ] **Step 3: `render()` um Datumsnavigation, "Aktueller Kontext"-Sichtbarkeit und die neuen Aufrufe erweitern**

Am Anfang von `render(s)`, direkt nach `snapshot = s;`, einfügen:

```js
  viewedDate = parseDayKeyLocal(s.date.key);
  updateDateNavButtons();
```

Im Abschnitt "Aktueller Kontext" (beginnt mit `// Aktueller Kontext` / `const cur = s.current || {};`), direkt davor einfügen:

```js
  $('currentStrip').hidden = !s.date.isToday;
```

Am Ende von `render()`, nach `renderTicker(s);`, ergänzen. Reihenfolge wichtig:
`maybeCelebrateRecord()` setzt `freshRecordType` synchron (vor seinem einzigen
`await`), muss also vor `renderWeekScore()` laufen, damit das Badge im selben
Render-Durchlauf schon hervorgehoben ist, in dem die Animation startet:

```js
  maybeCelebrateRecord(s);
  renderWeekScore(s);
```

- [ ] **Step 4: Wochen-Score-Chart und Highscore-Badges rendern**

Nach der bestehenden Funktion `renderTrend()` (vor `function trendTooltipHtml(p) {`) eine eigene, nicht-interaktive Mini-Chart-Funktion einfügen — bewusst getrennt von `renderTrend()`, weil dieses eine feste DOM-ID (`#trend`) und ein eigenes Hover-Tracking (`lastTrendPoints`) hat, das nicht für eine zweite Chart wiederverwendbar ist:

```js
function renderWeekScoreChart(points) {
  const W = 320;
  const H = 80;
  const padX = 6;
  const padTop = 8;
  const padBottom = 6;
  const usable = H - padTop - padBottom;

  if (!points.length) { $('weekScoreChart').innerHTML = ''; return; }

  const step = points.length > 1 ? (W - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [
    padX + step * i,
    padTop + usable * (1 - Math.min(100, Math.max(0, p.score)) / 100),
  ]);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  svg += `<path d="${path}" class="trend-line" />`;
  coords.forEach(([x, y], i) => {
    if (points[i].hasData) {
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" class="trend-point" />`;
    }
  });
  svg += '</svg>';
  $('weekScoreChart').innerHTML = svg;
}
```

Dann, z. B. direkt nach `renderDay()`, die Zusammenfassungsfunktion für die ganze Karte:

```js
let freshRecordType = null; // 'day' | 'week' | null — bleibt für den Rest der Sitzung markiert

function renderWeekScore(s) {
  $('weekScoreAvg').textContent = String(s.weekScore.avg);
  renderWeekScoreChart(s.last14.slice(-7));

  const bestDay = s.records.bestDayScore;
  $('bestDayScore').textContent = bestDay.key ? `${bestDay.score} %` : '—';
  $('bestDayDate').textContent = bestDay.key
    ? parseDayKeyLocal(bestDay.key).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    : '';

  const bestWeek = s.records.bestWeekAvg;
  $('bestWeekScore').textContent = bestWeek.key ? `${bestWeek.score} %` : '—';

  $('badgeBestDay').classList.toggle('is-fresh', freshRecordType === 'day');
  $('badgeBestWeek').classList.toggle('is-fresh', freshRecordType === 'week');
}
```

- [ ] **Step 5: Rekord-Animation implementieren**

Nach `renderWeekScore()` einfügen:

```js
let celebratingRecord = false; // verhindert doppeltes Feiern, während acknowledgeRecord() läuft

async function maybeCelebrateRecord(s) {
  if (!s.pendingRecord || celebratingRecord) return;
  celebratingRecord = true;
  freshRecordType = s.pendingRecord.type;
  playRecordBurst(s.pendingRecord);
  try {
    await window.copilot.acknowledgeRecord();
  } finally {
    celebratingRecord = false;
  }
}

function playRecordBurst({ type }) {
  const host = $('recordBurst');
  const text = $('recordBurstText');
  text.textContent = type === 'week' ? 'NEUE BESTE WOCHE' : 'NEUER REKORD';

  host.querySelectorAll('.burst-particle').forEach((p) => p.remove());

  const colors = ['var(--cyan)', 'var(--green-bright)'];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const distance = 70 + Math.random() * 30;
    const particle = document.createElement('span');
    particle.className = 'burst-particle';
    particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    particle.style.color = colors[i % colors.length];
    particle.style.background = colors[i % colors.length];
    host.appendChild(particle);
  }

  host.hidden = false;
  setTimeout(() => {
    host.hidden = true;
    host.querySelectorAll('.burst-particle').forEach((p) => p.remove());
  }, 1800);
}
```

- [ ] **Step 6: Buttons verdrahten**

Die bestehende Zeile

```js
$('btnToday').addEventListener('click', async () => render(await window.copilot.getSnapshot()));
```

ersetzen durch:

```js
$('btnToday').addEventListener('click', () => loadDay(new Date()));
$('btnPrevDay').addEventListener('click', () => {
  const prev = new Date(viewedDate);
  prev.setDate(prev.getDate() - 1);
  loadDay(prev);
});
$('btnNextDay').addEventListener('click', () => {
  const next = new Date(viewedDate);
  next.setDate(next.getDate() + 1);
  loadDay(next);
});
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/dashboard.js
git commit -m "Renderer: Datumsnavigation, Wochen-Score-Karte, Rekord-Animation"
```

---

## Task 6: Manuelle End-to-End-Verifikation mit Demo-Daten

**Files:** keine Code-Änderungen — reine Verifikation.

**Interfaces:**
- Consumes: alle vorherigen Tasks vollständig.

- [ ] **Step 1: Automatisierte Tests ein letztes Mal laufen lassen**

Run: `npm test`
Expected: Alle Prüfungen bestehen (Highscores, buildSnapshot mit `dateKey`, alle bisherigen).

- [ ] **Step 2: App mit 14 Tagen Demo-Daten starten**

Run:
```bash
npm run seed /tmp/fcp-demo
npm start -- --user-data-dir=/tmp/fcp-demo
```

- [ ] **Step 3: Datumsnavigation prüfen**

- `‹` mehrfach klicken: Reaktor, Verteilung, Ranglisten (Apps/YouTube/Websites) und Tagesverlauf wechseln auf den jeweils vorherigen Tag; die "Aktueller Kontext"-Leiste verschwindet, sobald nicht mehr heute angezeigt wird.
- Nach 29 Klicks ist `‹` deaktiviert (ausgegraut, nicht mehr klickbar).
- `›` bringt wieder einen Tag näher an heute; auf dem heutigen Tag ist `›` deaktiviert.
- "HEUTE" springt aus jeder Position sofort zurück auf den aktuellen Tag, "Aktueller Kontext" ist wieder sichtbar.
- Während ein vergangener Tag angezeigt wird, ein paar Sekunden warten (Live-Tick alle 3 s): die Ansicht bleibt auf dem gewählten Tag, springt nicht von selbst auf heute zurück.
- Bei einem vergangenen Tag eine App in der Rangliste anklicken und umklassifizieren: die Ansicht bleibt auf dem vergangenen Tag (springt nicht auf heute).

- [ ] **Step 4: WOCHEN-SCORE-Karte prüfen**

- Die Karte "WOCHEN-SCORE" steht neben "TAGESVERLAUF" (je halbe Breite), zeigt einen Ø-Wert, eine kleine Score-Kurve über 7 Punkte und zwei Badges ("BESTER TAG" mit Datum, "BESTE WOCHE").
- Werte sind mit den vorhandenen Demo-Daten plausibel (Ø ungefähr im Bereich der sichtbaren "Fokus-Trend"-Kurve für die letzten 7 Tage).

- [ ] **Step 5: Rekord-Animation manuell auslösen**

- In `/tmp/fcp-demo/data.json` bei laufender App (kurz beenden, Datei bearbeiten, neu starten) `records.bestDayScore.score` künstlich auf einen niedrigen Wert wie `10` setzen (mit passendem `key`, z. B. `"2020-01-01"`).
- App neu starten (`npm start -- --user-data-dir=/tmp/fcp-demo`): Sobald der nächste Tick läuft und der heutige Score über 10 % liegt (mit den Demo-Daten fast sicher der Fall), erscheint einmalig die Partikel-Animation am Fokus-Reaktor mit dem Text "NEUER REKORD", verschwindet nach ca. 2 Sekunden von selbst und erscheint bei weiteren Ticks nicht erneut. Das "BESTER TAG"-Badge zeigt danach für den Rest der Sitzung einen grünen Rahmen/Glow.

- [ ] **Step 6: Aufräumen**

```bash
rm -rf /tmp/fcp-demo
```

Kein Commit — dieser Task ändert keinen Code.
