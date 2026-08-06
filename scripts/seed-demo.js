'use strict';

/**
 * Legt in einem beliebigen Ordner eine data.json mit realistischen Beispieldaten an,
 * damit man das Dashboard mit gefüllten Diagrammen ansehen kann.
 *
 * Aufruf: node scripts/seed-demo.js <zielordner>
 */

const fs = require('fs');
const path = require('path');
const { dayKey, emptyDay } = require('../src/main/store');

const target = process.argv[2];
if (!target) {
  console.error('Bitte einen Zielordner angeben.');
  process.exit(1);
}

const days = {};
const now = new Date();

// 14 Tage Verlauf mit etwas Streuung, damit die Diagramme lebendig aussehen.
for (let i = 13; i >= 0; i--) {
  const d = new Date(now);
  d.setDate(now.getDate() - i);
  const day = emptyDay();

  const wobble = Math.sin(i * 1.3) * 0.35 + 1;
  day.productive = Math.round(3600 * 3.4 * wobble);
  day.neutral = Math.round(3600 * 1.1 * wobble);
  day.wasted = Math.round(3600 * 0.9 * (2 - wobble));
  day.inactive = Math.round(3600 * 1.6);
  day.total = day.productive + day.neutral + day.wasted;

  // Auf einen typischen Arbeitstag von 9 bis 19 Uhr verteilen.
  for (let h = 9; h <= 19; h++) {
    const share = h >= 12 && h <= 14 ? 0.6 : 1;
    day.hours[h] = {
      p: Math.round((day.productive / 11) * share),
      n: Math.round((day.neutral / 11) * share),
      w: Math.round((day.wasted / 11) * (2 - share)),
      i: Math.round((day.inactive / 11) * share),
    };
  }

  day.apps = {
    'Final Cut Pro': { sec: Math.round(day.productive * 0.55), cat: 'productive' },
    'Visual Studio Code': { sec: Math.round(day.productive * 0.3), cat: 'productive' },
    Safari: { sec: Math.round(day.neutral * 0.7), cat: 'neutral' },
    Slack: { sec: Math.round(day.neutral * 0.3), cat: 'neutral' },
    TikTok: { sec: Math.round(day.wasted * 0.25), cat: 'wasted' },
  };
  day.domains = {
    'youtube.com': { sec: Math.round(day.wasted * 0.55), cat: 'wasted' },
    'github.com': { sec: Math.round(day.productive * 0.12), cat: 'productive' },
    'instagram.com': { sec: Math.round(day.wasted * 0.2), cat: 'wasted' },
    'mail.google.com': { sec: Math.round(day.neutral * 0.25), cat: 'neutral' },
  };
  day.youtube = {
    '4Ktg1QWLEvI': { sec: Math.round(day.wasted * 0.3), title: 'Ich habe eine App mit Claude gebaut' },
    dQw4w9WgXcQ: { sec: Math.round(day.wasted * 0.15), title: 'Never Gonna Give You Up' },
  };

  days[dayKey(d)] = day;
}

const data = {
  days,
  overrides: { 'app:slack': 'neutral' },
  goals: { productiveMinutes: 180, maxWasteMinutes: 60 },
  settings: {
    miniCorner: 'bottom-right',
    notifications: true,
    nudgeMinutes: 10,
    tracking: true,
    idleThresholdSeconds: 60,
  },
};

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'data.json'), JSON.stringify(data), 'utf8');
console.log('Demo-Daten geschrieben nach', path.join(target, 'data.json'));
