'use strict';

/**
 * Smoke-Test für die Kernlogik ohne Electron.
 * Aufruf: node scripts/smoke-test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classify, domainFromUrl, youtubeIdFromUrl, isIgnoredProcess,
} = require('../src/main/classify');
const { Store, dayKey, emptyDay } = require('../src/main/store');
const { buildSnapshot, focusScore } = require('../src/main/stats');
const { scoreTrend } = require('../src/main/score');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.message);
    process.exitCode = 1;
  }
}

console.log('\nURL-Auswertung');
check('Domain wird ohne www extrahiert', () => {
  assert.strictEqual(domainFromUrl('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assert.strictEqual(domainFromUrl('https://github.com/foo/bar'), 'github.com');
  assert.strictEqual(domainFromUrl('kaputt'), '');
});

check('YouTube-ID aus allen üblichen Formen', () => {
  assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/watch?v=4Ktg1QWLEvI'), '4Ktg1QWLEvI');
  assert.strictEqual(youtubeIdFromUrl('https://youtu.be/4Ktg1QWLEvI'), '4Ktg1QWLEvI');
  assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/shorts/4Ktg1QWLEvI'), '4Ktg1QWLEvI');
  assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/'), null);
});

console.log('\nEinstufung');
check('Apps werden automatisch einsortiert', () => {
  assert.strictEqual(classify({ app: 'Final Cut Pro' }).category, 'productive');
  assert.strictEqual(classify({ app: 'Visual Studio Code' }).category, 'productive');
  assert.strictEqual(classify({ app: 'TikTok' }).category, 'wasted');
  assert.strictEqual(classify({ app: 'Finder' }).category, 'neutral');
  assert.strictEqual(classify({ app: 'Irgendwas Unbekanntes' }).category, 'neutral');
});

check('Im Browser zählt die Domain, nicht der Browser', () => {
  assert.strictEqual(classify({ app: 'Safari', domain: 'youtube.com' }).category, 'wasted');
  assert.strictEqual(classify({ app: 'Safari', domain: 'github.com' }).category, 'productive');
  // Subdomains erben die Einstufung.
  assert.strictEqual(classify({ app: 'Arc', domain: 'gist.github.com' }).category, 'productive');
});

check('Manuelle Einstufung schlägt die automatische', () => {
  const overrides = { 'domain:youtube.com': 'productive', 'app:final cut pro': 'wasted' };
  const a = classify({ app: 'Safari', domain: 'youtube.com' }, overrides);
  assert.strictEqual(a.category, 'productive');
  assert.strictEqual(a.auto, false);
  assert.strictEqual(classify({ app: 'Final Cut Pro' }, overrides).category, 'wasted');
});

check('Hintergrund-Hilfsprozesse werden ignoriert', () => {
  // app_mode_loader ist KEIN Hilfsprozess, sondern der (irreführende) Prozess-
  // name jeder "Als Fenster öffnen"-Website-Verknüpfung (z. B. YouTube als
  // eigene App) — der wird in monitor.js aufgelöst, nicht verworfen.
  assert.strictEqual(isIgnoredProcess('app_mode_loader'), false);
  assert.strictEqual(isIgnoredProcess('Dock'), true);
  assert.strictEqual(isIgnoredProcess('Control Center'), true);
  assert.strictEqual(isIgnoredProcess(''), true);
  assert.strictEqual(isIgnoredProcess('Final Cut Pro'), false);
  assert.strictEqual(isIgnoredProcess('Finder'), false, 'Finder ist echte Nutzung');
});

check('Ohne App-Namen wird keine App-Zeile angelegt', () => {
  // So verbucht der Tracker Medienzeit, wenn vorne nur ein Hilfsprozess steht:
  // Die Zeit zählt, landet aber in keiner Rangliste.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-anon-'));
  const s = new Store(dir);
  s.record(30, 'wasted', { app: undefined, domain: undefined });
  assert.strictEqual(s.day().wasted, 30, 'Zeit muss trotzdem zählen');
  assert.deepStrictEqual(s.day().apps, {}, 'aber ohne App-Eintrag');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('Der Override-Schlüssel passt zum UI-Format', () => {
  assert.strictEqual(classify({ app: 'Final Cut Pro' }).key, 'app:final cut pro');
  assert.strictEqual(classify({ app: 'Safari', domain: 'youtube.com' }).key, 'domain:youtube.com');
});

console.log('\nSpeicher');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
const store = new Store(tmp);

check('Ticks landen in Tages-, App- und Stundenwerten', () => {
  store.record(60, 'productive', { app: 'Final Cut Pro' });
  store.record(30, 'wasted', { domain: 'youtube.com', youtube: { id: 'abc12345678', title: 'Test' } });
  store.record(15, 'neutral', { app: 'Finder' });

  const day = store.day();
  assert.strictEqual(day.productive, 60);
  assert.strictEqual(day.wasted, 30);
  assert.strictEqual(day.neutral, 15);
  assert.strictEqual(day.total, 105);
  assert.strictEqual(day.apps['Final Cut Pro'].sec, 60);
  assert.strictEqual(day.domains['youtube.com'].sec, 30);
  assert.strictEqual(day.youtube['abc12345678'].sec, 30);

  const hour = new Date().getHours();
  assert.strictEqual(day.hours[hour].p, 60);
  assert.strictEqual(day.hours[hour].w, 30);
});

check('Inaktivität zählt nicht zur Zeit am Rechner', () => {
  const before = store.day().total;
  store.record(120, 'inactive');
  assert.strictEqual(store.day().total, before, 'total darf sich nicht ändern');
  assert.strictEqual(store.day().inactive, 120);
});

check('Speichern und erneutes Laden erhält die Daten', () => {
  store.flush();
  const reloaded = new Store(tmp);
  assert.strictEqual(reloaded.day().productive, 60);
  assert.strictEqual(reloaded.day().apps['Final Cut Pro'].sec, 60);
});

check('Overrides und Ziele werden gespeichert', () => {
  store.setOverride('domain:youtube.com', 'productive');
  store.setGoals({ productiveMinutes: 240, maxWasteMinutes: 45 });
  const reloaded = new Store(tmp);
  assert.strictEqual(reloaded.data.overrides['domain:youtube.com'], 'productive');
  assert.strictEqual(reloaded.data.goals.productiveMinutes, 240);
  // "auto" entfernt den Eintrag wieder.
  store.setOverride('domain:youtube.com', 'auto');
  assert.strictEqual(new Store(tmp).data.overrides['domain:youtube.com'], undefined);
});

check('Ein Override färbt schon erfasste Zeit rückwirkend um', () => {
  // Eigene, isolierte Store-Instanz — der gemeinsame "store" wird von
  // späteren Tests weiterverwendet (u. a. die App-Rangliste), die sollen
  // von diesem Testfall nichts mitbekommen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);

  // Nachstellung des realen Falls: "Pianoteq 9" (Original-Schreibweise mit
  // Großbuchstaben, wie macOS den Prozessnamen meldet) lief schon eine Weile
  // als Zeitverschwendung, bevor die Einstufung auf Produktiv gesetzt wird.
  s.record(600, 'wasted', { app: 'Pianoteq 9' });
  assert.strictEqual(s.day().apps['Pianoteq 9'].cat, 'wasted');

  // Der Override-Schlüssel kommt aus der Oberfläche immer kleingeschrieben —
  // das darf die Suche im Bucket (Original-Schreibweise) nicht verhindern.
  s.setOverride('app:pianoteq 9', 'productive');

  assert.strictEqual(s.day().apps['Pianoteq 9'].cat, 'productive', 'Kategorie im Bucket muss sich ändern');
  assert.strictEqual(s.day().wasted, 0, 'Zeitverschwendung muss um die 600s sinken');
  assert.strictEqual(s.day().productive, 600, 'Produktiv muss um die 600s steigen');

  // "Automatisch einstufen" rechnet wieder zurück — Pianoteq 9 steht in
  // keiner Liste, landet also bei Neutral (nicht wieder bei Wasted: das war
  // ja nie die automatische Einstufung, nur der künstliche Ausgangswert oben).
  s.setOverride('app:pianoteq 9', 'auto');
  assert.strictEqual(s.day().apps['Pianoteq 9'].cat, 'neutral');
  assert.strictEqual(s.day().wasted, 0, 'Zeitverschwendung bleibt bei 0 -- die Kategorie wandert nach Neutral');
  assert.strictEqual(s.day().productive, 0);
  assert.strictEqual(s.day().neutral, 600);

  fs.rmSync(dir, { recursive: true, force: true });
});

check('Bestehende Overrides greifen automatisch beim nächsten Start', () => {
  // Simuliert genau die Situation aus dem Fehlerbericht: eine Version vor
  // diesem Fix hat den Override gespeichert, aber die alte Kategorie steht
  // noch in den Tagesdaten. Ein Neustart (= neue Store-Instanz) muss das
  // korrigieren, ohne dass irgendwer den Override erneut anklickt.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const stale = new Store(dir);
  stale.record(600, 'wasted', { app: 'Pianoteq 9' });
  stale.data.overrides['app:pianoteq 9'] = 'productive'; // direkt setzen, ohne reclassify auszulösen
  stale.flush();

  const restarted = new Store(dir);
  assert.strictEqual(restarted.day().apps['Pianoteq 9'].cat, 'productive');
  assert.strictEqual(restarted.day().wasted, 0);
  assert.strictEqual(restarted.day().productive, 600);
  fs.rmSync(dir, { recursive: true, force: true });
});

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

check('setOverride() prüft Bestwerte erneut, statt auf den nächsten record() zu warten', () => {
  // Deckt den Fall ab: Tracking pausiert (kein weiterer record()-Tick), Nutzer
  // stuft eine App über das Kontextmenü um, und der Schub reißt den heutigen
  // Score über den gespeicherten Tages-Rekord. Ohne checkRecords() in
  // setOverride() bliebe der Bestwert bis zum nächsten Tick veraltet.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-test-'));
  const s = new Store(dir);
  s.data.records.bestDayScore = { score: 60, key: '2020-01-01' };
  s.data.records.bestWeekAvg = { score: 100, key: '2020-01-01' }; // schon am Maximum, damit nur der Tages-Rekord auslöst

  s.record(600, 'wasted', { app: 'Pianoteq 9' }); // heutiger Score: 0 % — unter dem Bestwert, löst noch nichts aus
  assert.strictEqual(s.data.records.bestDayScore.score, 60, 'record() allein darf hier noch nichts ändern');
  assert.strictEqual(s.data.pendingRecord, null);

  s.setOverride('app:pianoteq 9', 'productive'); // schiebt die 600s rückwirkend auf Produktiv -> heutiger Score 100 %

  assert.strictEqual(s.data.records.bestDayScore.score, 100, 'setOverride() muss den Bestwert selbst aktualisieren');
  assert.strictEqual(s.data.records.bestDayScore.key, dayKey());
  assert.ok(s.data.pendingRecord, 'ein Rekord muss als unbestätigt markiert sein');
  assert.strictEqual(s.data.pendingRecord.type, 'day');
  assert.strictEqual(s.data.pendingRecord.score, 100);

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

console.log('\nStatistik');
check('Fokus-Score gewichtet neutral halb', () => {
  assert.strictEqual(focusScore({ productive: 0, neutral: 0, wasted: 0 }), 0);
  assert.strictEqual(focusScore({ productive: 100, neutral: 0, wasted: 0 }), 100);
  assert.strictEqual(focusScore({ productive: 0, neutral: 0, wasted: 100 }), 0);
  assert.strictEqual(focusScore({ productive: 50, neutral: 0, wasted: 50 }), 50);
  assert.strictEqual(focusScore({ productive: 0, neutral: 100, wasted: 0 }), 50);
});

check('Der Trendpfeil zeigt, wohin die laufende Tätigkeit den Score zieht', () => {
  const day = (productive, neutral, wasted) => ({ productive, neutral, wasted });

  // Frischer Tag: der Score steht auf 0, alles außer Prokrastination hebt ihn.
  assert.strictEqual(scoreTrend(day(0, 0, 0), 'productive'), 'up');
  assert.strictEqual(scoreTrend(day(0, 0, 0), 'neutral'), 'up');
  assert.strictEqual(scoreTrend(day(0, 0, 0), 'wasted'), 'flat');

  // Score 50: Neutral hält ihn genau, Produktiv hebt, Prokrastination senkt.
  const halb = day(50, 0, 50);
  assert.strictEqual(focusScore(halb), 50);
  assert.strictEqual(scoreTrend(halb, 'productive'), 'up');
  assert.strictEqual(scoreTrend(halb, 'neutral'), 'flat');
  assert.strictEqual(scoreTrend(halb, 'wasted'), 'down');

  // Der Fall, auf den es ankommt: dieselbe neutrale Tätigkeit, zwei Richtungen.
  assert.strictEqual(scoreTrend(day(80, 0, 20), 'neutral'), 'down', 'Score 80 wird von Neutral heruntergezogen');
  assert.strictEqual(scoreTrend(day(30, 0, 70), 'neutral'), 'up', 'Score 30 wird von Neutral hochgezogen');

  // An den Rändern gibt es keine Richtung mehr.
  assert.strictEqual(scoreTrend(day(100, 0, 0), 'productive'), 'flat', '100 kann nicht weiter steigen');
  assert.strictEqual(scoreTrend(day(0, 0, 100), 'wasted'), 'flat', '0 kann nicht weiter fallen');
});

check('Der Trend rechnet mit dem ungerundeten Score', () => {
  // Angezeigt werden hier 50, tatsächlich sind es 49,5 — eine neutrale
  // Tätigkeit zieht also noch nach oben, auch wenn die Zahl erst später springt.
  const knapp = { productive: 99, neutral: 0, wasted: 101 };
  assert.strictEqual(focusScore(knapp), 50);
  assert.strictEqual(scoreTrend(knapp, 'neutral'), 'up');
});

check('Ohne zählende Tätigkeit gibt es keinen Pfeil', () => {
  // Inaktive Zeit geht gar nicht in den Score ein, der Score bewegt sich also nicht.
  const day = { productive: 60, neutral: 0, wasted: 0 };
  assert.strictEqual(scoreTrend(day, 'inactive'), null);
  assert.strictEqual(scoreTrend(day, undefined), null);
  assert.strictEqual(scoreTrend(day, ''), null);
});

check('Der Snapshot trägt den Trend nur für heute und nur bei laufendem Tracking', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-trend-'));
  const s = new Store(dir);
  s.record(600, 'productive', { app: 'Xcode' }); // Score 100

  const laeuft = { running: true, current: { app: 'Xcode', category: 'productive' } };
  assert.strictEqual(buildSnapshot(s, laeuft).today.trend, 'flat', '100 haltend');

  s.record(600, 'wasted', { app: 'TikTok' }); // Score 50
  assert.strictEqual(buildSnapshot(s, laeuft).today.trend, 'up');

  const pausiert = { running: false, current: { app: '', category: 'neutral' } };
  assert.strictEqual(buildSnapshot(s, pausiert).today.trend, null, 'pausiert bewegt nichts');

  const abwesend = { running: true, current: { category: 'inactive', idle: true } };
  assert.strictEqual(buildSnapshot(s, abwesend).today.trend, null, 'abwesend bewegt nichts');

  // Ein vergangener Tag bewegt sich nicht mehr.
  assert.strictEqual(buildSnapshot(s, laeuft, '2020-01-01').today.trend, null);

  fs.rmSync(dir, { recursive: true, force: true });
});

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

  // Felder, die an den echten heutigen Tag gebunden sein müssen (projection.wasted
  // & Co.), dürfen sich nicht ändern, wenn ein vergangener Tag angezeigt wird.
  const todayWasted = s.day().wasted; // 0 bislang — es wurde nur productive gebucht
  const pastKey = '2020-01-01';
  s.day(pastKey).wasted = 9999; // deutlich andere "wasted"-Sekunden als heute

  const fakeTracker = { running: true, current: { app: 'Foo' } };
  const pastSnap = buildSnapshot(s, fakeTracker, pastKey);

  assert.strictEqual(pastSnap.date.key, pastKey);
  assert.strictEqual(pastSnap.date.isToday, false);
  assert.strictEqual(
    pastSnap.projection.wasted.perDay,
    todayWasted,
    'projection.wasted muss an heute gebunden bleiben, nicht am angezeigten Tag',
  );
  assert.notStrictEqual(pastSnap.projection.wasted.perDay, 9999);

  // current, tracking, last7/last14-Länge und der Streak hängen nicht vom
  // angeforderten dateKey ab.
  assert.strictEqual(pastSnap.current, fakeTracker.current);
  assert.strictEqual(pastSnap.tracking, true);
  assert.strictEqual(pastSnap.last7.length, 7);
  assert.strictEqual(pastSnap.last14.length, 14);
  assert.strictEqual(pastSnap.goals.streak, snap.goals.streak);

  fs.rmSync(dir, { recursive: true, force: true });
});

check('Snapshot enthält alles, was die Oberfläche braucht', () => {
  const fakeTracker = { running: true, current: { app: 'Safari', category: 'neutral', idle: false } };
  const snap = buildSnapshot(store, fakeTracker);

  assert.ok(snap.date.label, 'Datum fehlt');
  assert.strictEqual(snap.tracking, true);
  assert.strictEqual(snap.last7.length, 7);
  assert.strictEqual(snap.last14.length, 14);
  assert.strictEqual(snap.hours.length, 24);
  assert.ok(Array.isArray(snap.apps) && Array.isArray(snap.domains) && Array.isArray(snap.youtube));
  assert.strictEqual(snap.apps[0].name, 'Final Cut Pro');
  assert.strictEqual(snap.youtube[0].thumbnail, 'https://i.ytimg.com/vi/abc12345678/mqdefault.jpg');
  // Der heutige Tag ist immer der letzte Eintrag der Wochenreihe.
  assert.strictEqual(snap.last7[6].key, snap.date.key);
});

check('Hochrechnung skaliert linear auf Woche, Jahr und Jahrzehnt', () => {
  const snap = buildSnapshot(store, { running: true, current: {} });
  const p = snap.projection.wasted;
  assert.strictEqual(p.perDay, 30);
  assert.strictEqual(p.perWeek, 210);
  assert.strictEqual(p.perYear, 30 * 365);
  assert.ok(Math.abs(p.daysPerDecade - (30 * 365 * 10) / 86400) < 1e-9);
});

check('Zielfortschritt wird gedeckelt und Budget-Überschreitung erkannt', () => {
  store.setGoals({ productiveMinutes: 1, maxWasteMinutes: 0 });   // 60 s Ziel, 0 Budget
  const snap = buildSnapshot(store, { running: true, current: {} });
  assert.strictEqual(snap.goals.productiveProgress, 1, 'darf nicht über 100 % gehen');
  assert.strictEqual(snap.goals.budgetProgress, 0, 'ohne Budget kein Fortschritt');
  store.setGoals({ productiveMinutes: 180, maxWasteMinutes: 60 }); // zurücksetzen
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} Prüfungen bestanden.${process.exitCode ? ' ES GAB FEHLER.' : ''}\n`);
