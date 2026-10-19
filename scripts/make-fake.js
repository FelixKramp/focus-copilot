'use strict';

/**
 * Legt Testdaten für die Vorschau in einem eigenen HOME-Ordner an, ohne die
 * echte data.json anzufassen: heute (logisch) mit Einträgen je Stunde und
 * Meilensteinen, dazu ein alter Tag von vor dem Update (ohne Einträge, mit
 * Mitternacht als Tageswechsel).
 *
 *   node scripts/make-fake.js <ordner>
 *   HOME=<ordner> ./node_modules/.bin/electron scripts/preview.js --view disc
 */

const fs = require('fs');
const path = require('path');
const { emptyDay, dayKey } = require('../src/main/store');

const home = process.argv[2];
if (!home) {
  console.error('Aufruf: node scripts/make-fake.js <ordner>');
  process.exit(1);
}

// [Stunde, Name, Kategorie, Minuten]
const ITEMS = [
  [8, 'Obsidian', 'productive', 5], [8, 'Finder', 'neutral', 3],
  [9, 'Logic Pro', 'productive', 35], [9, 'youtube.com', 'wasted', 12], [9, 'Finder', 'neutral', 4],
  [10, 'Logic Pro', 'productive', 40], [10, 'Finder', 'neutral', 6],
  [11, 'github.com', 'productive', 22], [11, 'Mail', 'neutral', 10], [11, 'instagram.com', 'wasted', 8],
  [12, 'Mail', 'neutral', 8], [12, 'youtube.com', 'wasted', 14],
  [13, 'Obsidian', 'productive', 10], [13, 'Mail', 'neutral', 6], [13, 'instagram.com', 'wasted', 20],
  [14, 'github.com', 'productive', 22], [14, 'Visual Studio Code', 'productive', 18],
  [14, 'instagram.com', 'wasted', 9], [14, 'Obsidian', 'productive', 6],
  [15, 'Visual Studio Code', 'productive', 30], [15, 'Finder', 'neutral', 5],
  [16, 'Mail', 'neutral', 4], [16, 'youtube.com', 'wasted', 6],
  [18, 'Obsidian', 'productive', 12], [18, 'Mail', 'neutral', 14],
  [19, 'Mail', 'neutral', 10], [19, 'youtube.com', 'wasted', 30],
  [20, 'youtube.com', 'wasted', 40],
  [21, 'Logic Pro', 'productive', 38], [21, 'Finder', 'neutral', 4],
  [22, 'Logic Pro', 'productive', 45], [22, 'Spotify', 'neutral', 3], [22, 'Messages', 'neutral', 2],
];
const FIELD = { productive: 'p', neutral: 'n', wasted: 'w' };

const now = new Date();
const day = emptyDay();
for (const [h, name, cat, m] of ITEMS) {
  const sec = m * 60;
  const kind = name.includes('.') ? 'domain' : 'app';
  day.hours[h][FIELD[cat]] += sec;
  day.hours[h].items[`${kind}:${name}`] = { sec, cat };
  day[cat] += sec;
  day.total += sec;
  const map = kind === 'domain' ? day.domains : day.apps;
  map[name] = map[name] || { sec: 0, cat };
  map[name].sec += sec;
}
const at = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.getTime(); };
day.milestones = { goalAt: at(15, 44), budgetAt: at(14, 40) };

const legacy = emptyDay();
delete legacy.dayStart;
legacy.hours = legacy.hours.map(() => ({ p: 0, n: 0, w: 0, i: 0 }));
for (const [h, p, n, w] of [[9, 1800, 600, 300], [10, 2400, 300, 0], [14, 900, 900, 1200], [20, 0, 600, 2400], [23, 1500, 0, 0]]) {
  Object.assign(legacy.hours[h], { p, n, w });
  legacy.productive += p;
  legacy.neutral += n;
  legacy.wasted += w;
  legacy.total += p + n + w;
}
const old = new Date(now);
old.setDate(old.getDate() - 3);

const dir = path.join(home, 'Library/Application Support/Focus Co-Pilot');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
  days: { [dayKey()]: day, [dayKey(old)]: legacy },
}));
console.log(`Testdaten: heute ${dayKey()}, alter Tag ${dayKey(old)}`);
