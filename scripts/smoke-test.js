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
const { Store } = require('../src/main/store');
const { buildSnapshot, focusScore } = require('../src/main/stats');

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
  assert.strictEqual(isIgnoredProcess('app_mode_loader'), true);
  assert.strictEqual(isIgnoredProcess('Dock'), true);
  assert.strictEqual(isIgnoredProcess('Control Center'), true);
  assert.strictEqual(isIgnoredProcess(''), true);
  assert.strictEqual(isIgnoredProcess('Final Cut Pro'), false);
  assert.strictEqual(isIgnoredProcess('Finder'), false, 'Finder ist echte Nutzung');
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

console.log('\nStatistik');
check('Fokus-Score gewichtet neutral halb', () => {
  assert.strictEqual(focusScore({ productive: 0, neutral: 0, wasted: 0 }), 0);
  assert.strictEqual(focusScore({ productive: 100, neutral: 0, wasted: 0 }), 100);
  assert.strictEqual(focusScore({ productive: 0, neutral: 0, wasted: 100 }), 0);
  assert.strictEqual(focusScore({ productive: 50, neutral: 0, wasted: 50 }), 50);
  assert.strictEqual(focusScore({ productive: 0, neutral: 100, wasted: 0 }), 50);
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
