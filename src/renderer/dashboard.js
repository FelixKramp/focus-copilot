'use strict';

/* Focus Co-Pilot — Dashboard-Renderer.
   Rechnen passiert im Main-Prozess; hier wird nur gezeichnet und reagiert. */

const $ = (id) => document.getElementById(id);

let snapshot = null;
let pendingGoals = null;

const MAX_DAYS_BACK = 29;

/** Spiegelt store.js' DAY_START_HOUR — der Renderer hat keinen Zugriff auf
    Node/Main-Code. Bis 4 Uhr morgens läuft noch der Vortag. */
const DAY_START_HOUR = 4;

/** Der laufende Tag als Datum um Mitternacht — um 1:30 Uhr also noch gestern. */
function logicalToday() {
  const d = new Date();
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

let viewedDate = logicalToday();

/** Datum (Mitternacht) → "YYYY-MM-DD". Anders als store.js' dayKey() ohne
    4-Uhr-Verschiebung, weil der Renderer nur mit Tagesdaten rechnet, die
    schon aus logicalToday() bzw. einem Schlüssel stammen. */
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

function clampViewedDate(d) {
  const today = logicalToday();
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
  const today = logicalToday();
  const earliest = new Date(today);
  earliest.setDate(today.getDate() - MAX_DAYS_BACK);
  $('btnPrevDay').disabled = !(viewedDate > earliest);
  $('btnNextDay').disabled = isSameDay(viewedDate, today);
}

/* ------------------------------------------------------------ Formatierung */

/** 4520 → "1 Std 15 Min", 900 → "15 Min" */
function fmt(seconds) {
  const min = Math.round((seconds || 0) / 60);
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} Std` : `${h} Std ${m} Min`;
}

/** Für Monats- und Jahreswerte: immer in Stunden, das trifft härter als Tage. */
function fmtHours(seconds) {
  const hours = (seconds || 0) / 3600;
  if (hours >= 1) return `${Math.round(hours)} Std`;
  return `${Math.round((seconds || 0) / 60)} Min`;
}

/** Kompakt für sehr lange Zeiträume: ab 100 Stunden wird auf Tage gewechselt. */
function fmtLong(seconds) {
  const hours = (seconds || 0) / 3600;
  if (hours >= 100) return `${(hours / 24).toFixed(1)} Tage`;
  return fmtHours(seconds);
}

function pct(value) {
  return `${Math.round((value || 0) * 100)} %`;
}

const CAT_LABEL = {
  productive: 'Produktiv',
  neutral: 'Neutral',
  wasted: 'Prokrastination',
  inactive: 'Nicht am PC',
};

/* ---------------------------------------------------------------- Diagramme */

function renderGauge(score) {
  const r = 82;
  const circumference = 2 * Math.PI * r;
  const ring = $('gaugeValue');
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - Math.min(1, score / 100)));
  $('scoreValue').textContent = String(score);
  renderLeds(score);
}

/**
 * Score als LED-Pegel (nur im Mischpult sichtbar). 20 Zellen à 5 %, von unten
 * nach oben; die Zonen sind fest, damit man am Pegel ablesen kann, ob der Tag
 * im roten, gelben oder grünen Bereich läuft — wie die Aussteuerung am Pult.
 */
const LED_COUNT = 20;
const LED_ZONES = [{ until: 8, cls: 'zone-low' }, { until: 14, cls: 'zone-mid' }, { until: LED_COUNT, cls: 'zone-high' }];

function renderLeds(score) {
  const host = $('ledMeter');
  if (!host.children.length) {
    for (let i = 0; i < LED_COUNT; i++) {
      const led = document.createElement('i');
      led.className = `led ${LED_ZONES.find((z) => i < z.until).cls}`;
      led.style.setProperty('--i', String(i));
      host.appendChild(led);
    }
  }
  const lit = Math.round((Math.max(0, Math.min(100, score)) / 100) * LED_COUNT);
  Array.from(host.children).forEach((led, i) => led.classList.toggle('is-lit', i < lit));
}

/* ------------------------------------------------------------------ Design */

const THEMES = ['jarvis', 'mischpult'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Setzt das Design. Beim ersten Snapshot sofort, danach als Überblendung. */
function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : 'jarvis';
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const swap = () => {
    root.dataset.theme = theme;
    for (const btn of $('themeMenu').querySelectorAll('[data-theme]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.theme === theme));
    }
  };
  if (root.dataset.theme && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

function renderDonut(today) {
  const r = 78;
  const circumference = 2 * Math.PI * r;
  const total = today.productive + today.neutral + today.wasted;
  const segments = [
    { value: today.productive, color: 'var(--green)' },
    { value: today.neutral, color: 'var(--neutral)' },
    { value: today.wasted, color: 'var(--red)' },
  ];

  let offset = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const length = total > 0 ? (s.value / total) * circumference : 0;
      const el =
        `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${s.color}" stroke-width="13" ` +
        `stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" ` +
        `class="donut-arc" style="--c:${s.color}" />`;
      offset += length;
      return el;
    })
    .join('');

  $('donutArcs').innerHTML = arcs;
  $('donutTotal').textContent = String(Math.round(total / 60));
  $('donutProductive').textContent = fmt(today.productive);
  $('donutNeutral').textContent = fmt(today.neutral);
  $('donutWasted').textContent = fmt(today.wasted);
}

/** Geometrie der Wochen-Balken, damit Zeichnen und Hover dieselben Zahlen nutzen. */
const WEEK_GEOMETRY = { W: 320, H: 132, padBottom: 22, padTop: 14 };
let lastWeekDays = [];

/** Gestapelte Balken: grün unten, cyan darüber, rot oben. */
function renderWeek(days) {
  const { W, H, padBottom, padTop } = WEEK_GEOMETRY;
  const usable = H - padBottom - padTop;
  const max = Math.max(60, ...days.map((d) => d.productive + d.neutral + d.wasted));
  const slot = W / days.length;
  const barW = Math.min(20, slot * 0.42);
  lastWeekDays = days;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="0" y1="${H - padBottom}" x2="${W}" y2="${H - padBottom}" class="grid-line" />`;

  days.forEach((d, i) => {
    const cx = slot * i + slot / 2;
    const x = cx - barW / 2;
    let y = H - padBottom;

    svg += `<g class="bar-group" data-i="${i}">`;
    const stack = [
      { v: d.productive, c: 'var(--green)' },
      { v: d.neutral, c: 'var(--neutral)' },
      { v: d.wasted, c: 'var(--red)' },
    ];
    for (const part of stack) {
      if (part.v <= 0) continue;
      const h = (part.v / max) * usable;
      y -= h;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${part.c}" rx="1.5" opacity="0.92" />`;
    }

    if (d.goalReached) {
      svg += `<circle cx="${cx}" cy="${y - 7}" r="2.6" class="goal-dot" />`;
    }
    svg += `<text x="${cx}" y="${H - 7}" text-anchor="middle" class="axis-label">${d.label}</text>`;
    // Unsichtbare, großzügige Trefferfläche über die ganze Spalte — sonst
    // müsste man exakt den schmalen Balken treffen.
    svg += `<rect class="bar-hit" data-i="${i}" x="${slot * i}" y="0" width="${slot}" height="${H}" />`;
    svg += '</g>';
  });

  svg += '</svg>';
  $('week').innerHTML = svg;
}

function weekTooltipHtml(d) {
  const total = d.productive + d.neutral + d.wasted;
  return `
    <div class="tt-title">${escapeHtml(d.label)}</div>
    <div class="tt-row"><i class="dot dot-productive"></i>Produktiv<b>${fmt(d.productive)}</b></div>
    <div class="tt-row"><i class="dot dot-neutral"></i>Neutral<b>${fmt(d.neutral)}</b></div>
    <div class="tt-row"><i class="dot dot-wasted"></i>Prokrastination<b>${fmt(d.wasted)}</b></div>
    <div class="tt-total"><span>Gesamt</span><b>${fmt(total)}</b></div>
  `;
}

const TREND_GEOMETRY = { W: 320, H: 132, padX: 8, padTop: 12, padBottom: 20 };
let lastTrendPoints = [];

function renderTrend(points) {
  const { W, H, padX, padTop, padBottom } = TREND_GEOMETRY;
  const usable = H - padTop - padBottom;

  if (!points.length) { $('trend').innerHTML = ''; lastTrendPoints = []; return; }

  const step = points.length > 1 ? (W - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [
    padX + step * i,
    padTop + usable * (1 - Math.min(100, Math.max(0, p.score)) / 100),
  ]);
  lastTrendPoints = points.map((p, i) => ({ x: coords[i][0], y: coords[i][1], label: p.label, score: p.score, hasData: p.hasData }));

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color: var(--trend-fill)" />
            <stop offset="100%" style="stop-color: var(--trend-fill); stop-opacity: 0" />
          </linearGradient></defs>`;

  // Waagerechte Hilfslinien bei 0 / 50 / 100.
  for (const level of [0, 0.5, 1]) {
    const y = padTop + usable * level;
    svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="grid-line" />`;
  }

  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${padTop + usable} L${coords[0][0].toFixed(1)},${padTop + usable} Z`;

  svg += `<path d="${area}" class="trend-area" />`;
  svg += `<path d="${path}" class="trend-line" />`;
  coords.forEach(([x, y], i) => {
    if (points[i].hasData) {
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" class="trend-point" data-i="${i}" />`;
    }
  });

  svg += `<text x="0" y="${H - 5}" class="axis-label">${points[0].label}</text>`;
  svg += `<text x="${W}" y="${H - 5}" text-anchor="end" class="axis-label">${points[points.length - 1].label}</text>`;
  // Eine breite, unsichtbare Trefferfläche über die ganze Fläche — das
  // Auflegen auf einen 2px-Punkt wäre sonst zu fummelig.
  svg += `<rect class="trend-hit" x="0" y="0" width="${W}" height="${H}" />`;
  svg += '</svg>';
  $('trend').innerHTML = svg;
}

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

function trendTooltipHtml(p) {
  if (!p.hasData) {
    return `<div class="tt-title">${escapeHtml(p.label)}</div><div class="tt-row">Keine Daten erfasst</div>`;
  }
  return `<div class="tt-title">${escapeHtml(p.label)}</div><div class="tt-row">Fokus-Score<b>${Math.round(p.score)} %</b></div>`;
}

const HOUR_SECONDS = 3600;
let lastDayHours = [];
/** Angeklickte Stunde (echte Uhrzeit 0–23) oder null. */
let selectedHour = null;
/** Für welchen Tag selectedHour gilt — beim Tageswechsel schliesst das Detail. */
let selectedDayKey = null;
/** Zuletzt gezeichneter Inhalt des Details. Der Live-Push kommt alle paar
    Sekunden; ohne Vergleich würden die App-Icons jedes Mal neu laden. */
let lastDetailSignature = '';

/**
 * Tagesverlauf: eine Spur je Stunde, immer volle 60 Minuten hoch.
 *
 * Früher war "nicht am PC" ein eigener Balken im Stapel. Weil man den grössten
 * Teil des Tages nicht am Rechner sitzt, war die Grafik damit eine Wand aus
 * Grau, die ausserdem die Skala bestimmte — die paar Minuten, um die es
 * eigentlich geht, wurden zu Strichen zusammengedrückt. Jetzt ist Abwesenheit
 * der *leere* Teil der Spur: sichtbar, aber still. Und weil jede Spur für
 * dieselben 60 Minuten steht, sind die Stunden direkt vergleichbar, statt
 * relativ zur jeweils vollsten Stunde des Tages.
 */
function renderDay(hours, isToday, dayStart = 0) {
  lastDayHours = hours;
  const currentHour = isToday ? new Date().getHours() : -1;
  // Der Tag läuft von dayStart bis dayStart, also z. B. 4 … 23, 0 … 3.
  // data-i bleibt die echte Uhrzeit, nur die Reihenfolge ändert sich.
  const order = Array.from({ length: 24 }, (_, k) => (dayStart + k) % 24);

  const parts = [
    { key: 'p', cls: 'seg-productive' },
    { key: 'n', cls: 'seg-neutral' },
    { key: 'w', cls: 'seg-wasted' },
  ];

  let grid = '';
  for (const i of order) {
    const h = hours[i] || {};
    let segs = '';
    for (const part of parts) {
      const value = h[part.key] || 0;
      if (value <= 0) continue;
      // Eine einzelne Minute darf nicht unsichtbar sein, deshalb die Untergrenze.
      const pct = Math.max(2, Math.min(100, (value / HOUR_SECONDS) * 100));
      segs += `<i class="seg ${part.cls}" style="height:${pct.toFixed(2)}%"></i>`;
    }
    const classes = ['day-hour'];
    if (i === currentHour) classes.push('is-now');
    if (i === selectedHour) classes.push('is-selected');
    if (!segs) classes.push('is-empty');
    grid += `<div class="${classes.join(' ')}" data-i="${i}">`
      + `<div class="day-track">${segs}</div></div>`;
  }

  // Alle drei Stunden ab Tagesbeginn beschriften, damit die erste Spur
  // zeigt, wann der Tag anfängt (04, 07, 10 … statt 06, 09, 12 …).
  let axis = '';
  order.forEach((i, k) => {
    axis += `<span>${k % 3 === 0 ? String(i).padStart(2, '0') : ''}</span>`;
  });

  $('day').innerHTML = `<div class="day-grid">${grid}</div><div class="day-axis">${axis}</div>`;
}

function dayTooltipHtml(i, h, hint) {
  const from = String(i).padStart(2, '0');
  const to = String((i + 1) % 24).padStart(2, '0');
  const head = `<div class="tt-title">${from}:00 – ${to}:00</div>`;

  if ((h.p || 0) + (h.n || 0) + (h.w || 0) <= 0) {
    return `${head}<div class="tt-row">Nicht am Mac</div>`;
  }

  // In Minuten runden und den Rest daraus ableiten, statt jeden der vier Werte
  // einzeln zu runden — sonst steht in einer Stunde schon mal 61 Minuten.
  const min = (seconds) => Math.round((seconds || 0) / 60);
  const p = min(h.p);
  const n = min(h.n);
  const w = min(h.w);
  const away = Math.max(0, 60 - p - n - w);

  return `
    ${head}
    <div class="tt-row"><i class="dot dot-productive"></i>Produktiv<b>${p} Min</b></div>
    <div class="tt-row"><i class="dot dot-neutral"></i>Neutral<b>${n} Min</b></div>
    <div class="tt-row"><i class="dot dot-wasted"></i>Prokrastination<b>${w} Min</b></div>
    <div class="tt-total"><span>Nicht am Mac</span><b>${away} Min</b></div>
    <div class="tt-hint">${hint || (i === selectedHour ? 'Klicken zum Schliessen' : 'Klicken für die Apps')}</div>
  `;
}

const HOUR_DETAIL_LIMIT = 8;
const appIconCache = new Map();

function appIconRow(row, appName) {
  const img = row.querySelector('.rank-icon');
  if (appIconCache.has(appName)) {
    const cached = appIconCache.get(appName);
    if (cached) img.src = cached;
    return;
  }
  window.copilot.getAppIcon(appName).then((dataUrl) => {
    appIconCache.set(appName, dataUrl || null);
    if (dataUrl) img.src = dataUrl;
  });
}

/**
 * Aufschlüsselung der angeklickten Stunde: welche Apps und Websites liefen,
 * als Rangliste wie unten bei "Apps" — inklusive Klick zum Umstufen.
 */
function renderHourDetail() {
  const box = $('dayDetail');
  if (selectedHour === null || !snapshot) {
    // Inhalt stehen lassen, damit er beim Zuklappen sichtbar mit schrumpft.
    box.hidden = true;
    lastDetailSignature = '';
    return;
  }

  const i = selectedHour;
  const h = snapshot.hours[i] || {};
  const items = (snapshot.hourItems || [])[i];
  const active = (h.p || 0) + (h.n || 0) + (h.w || 0);

  const signature = JSON.stringify([snapshot.date.key, i, active, items]);
  if (signature === lastDetailSignature && !box.hidden) return;
  lastDetailSignature = signature;

  const from = String(i).padStart(2, '0');
  const to = String((i + 1) % 24).padStart(2, '0');
  box.innerHTML = `
    <div class="day-detail-head">
      <span class="day-detail-title">${from}:00 – ${to}:00</span>
      <span class="day-detail-sub">${fmt(active)} am Mac</span>
      <button class="day-detail-close" type="button" aria-label="Schliessen">×</button>
    </div>
    <ul class="ranklist" id="listHour"></ul>
  `;
  box.hidden = false;
  const list = $('listHour');

  if (!items) {
    // Stunde von vor dem Update: es gibt nur die Summen.
    list.innerHTML = '<li class="empty">Für diese Stunde gibt es keine Aufschlüsselung — '
      + 'die App merkt sich erst seit dem Update, was in welcher Stunde lief.</li>';
    return;
  }
  if (!items.length) {
    list.innerHTML = '<li class="empty">Nicht am Mac.</li>';
    return;
  }

  const shown = items.slice(0, HOUR_DETAIL_LIMIT);
  const max = shown[0].seconds;
  for (const item of shown) {
    const isApp = item.kind === 'app';
    const row = rankRow({
      key: `${item.kind}:${item.name.toLowerCase()}`,
      name: item.name,
      seconds: item.seconds,
      category: item.category,
      max,
      iconHtml: isApp
        ? '<img class="rank-icon" alt="" />'
        : `<img class="rank-icon" alt="" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(item.name)}.ico" onerror="this.style.visibility='hidden'" />`,
    });
    row.style.setProperty('--i', String(list.children.length));
    list.appendChild(row);
    if (isApp) appIconRow(row, item.name);
  }

  // Was nicht in die Liste passt oder keinem Eintrag zugeordnet ist (z. B.
  // Zeit von vor dem Update in derselben Stunde), steht als Rest darunter.
  const rest = items.slice(HOUR_DETAIL_LIMIT);
  const listed = items.reduce((sum, e) => sum + e.seconds, 0);
  const notes = [];
  if (rest.length) {
    notes.push(`+ ${rest.length} weitere · ${fmt(rest.reduce((sum, e) => sum + e.seconds, 0))}`);
  }
  if (active - listed >= 60) notes.push(`${fmt(active - listed)} ohne Zuordnung`);
  if (notes.length) {
    const li = document.createElement('li');
    li.className = 'day-detail-note';
    li.textContent = notes.join('  ·  ');
    list.appendChild(li);
  }
}

function selectHour(i) {
  const opening = selectedHour !== i;
  selectedHour = selectedHour === i ? null : i;
  // Nur beim Öffnen bzw. Wechseln der Stunde staffeln — der Live-Push alle
  // drei Sekunden zeichnet die Liste der laufenden Stunde sonst jedes Mal neu
  // ein und sie würde ständig nachwippen.
  $('dayDetail').classList.toggle('is-opening', opening && selectedHour !== null);
  clearTimeout(selectHour.timer);
  selectHour.timer = setTimeout(() => $('dayDetail').classList.remove('is-opening'), 500);
  selectedDayKey = selectedHour === null ? null : snapshot.date.key;
  for (const cell of $('day').querySelectorAll('.day-hour')) {
    cell.classList.toggle('is-selected', Number(cell.dataset.i) === selectedHour);
  }
  renderHourDetail();
  if (snapshot) renderDiscSelection(snapshot, opening);
}

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
  text.textContent = type === 'week' ? 'Neue beste Woche' : 'Neuer Rekord';

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

/* --------------------------------------------------------------- Ranglisten */

function rankRow({ key, name, seconds, category, max, iconHtml, isVideo, url }) {
  const li = document.createElement('li');
  li.className = 'rank';
  li.dataset.key = key || '';
  li.dataset.name = name;
  if (url) li.dataset.url = url;

  const width = max > 0 ? Math.max(3, (seconds / max) * 100) : 0;
  li.innerHTML = `
    <i class="rank-cat ${category || 'neutral'}"></i>
    ${iconHtml}
    <div class="rank-body">
      <div class="rank-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="rank-bar"><i class="${category || 'neutral'}" style="width:${width}%"></i></div>
    </div>
    <span class="rank-time">${fmt(seconds)}</span>
    ${isVideo ? '' : '<span class="rank-chev">›</span>'}
  `;
  return li;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderApps(apps) {
  const list = $('listApps');
  list.innerHTML = '';
  if (!apps.length) {
    list.innerHTML = '<li class="empty">Noch nichts erfasst.</li>';
    return;
  }
  const max = apps[0].seconds;
  for (const item of apps) {
    const row = rankRow({
      key: 'app:' + item.name.toLowerCase(),
      name: item.name,
      seconds: item.seconds,
      category: item.category,
      max,
      iconHtml: '<img class="rank-icon" alt="" />',
    });
    list.appendChild(row);

    // App-Icon aus dem Bundle nachladen.
    const img = row.querySelector('.rank-icon');
    window.copilot.getAppIcon(item.name).then((dataUrl) => {
      if (dataUrl) img.src = dataUrl;
    });
  }
}

function renderSites(domains) {
  const list = $('listSites');
  list.innerHTML = '';
  if (!domains.length) {
    list.innerHTML = '<li class="empty">Noch nichts erfasst.</li>';
    return;
  }
  const max = domains[0].seconds;
  for (const item of domains) {
    list.appendChild(rankRow({
      key: 'domain:' + item.name.toLowerCase(),
      name: item.name,
      seconds: item.seconds,
      category: item.category,
      max,
      iconHtml: `<img class="rank-icon" alt="" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(item.name)}.ico" onerror="this.style.visibility='hidden'" />`,
    }));
  }
}

function renderYoutube(videos) {
  const list = $('listYoutube');
  list.innerHTML = '';
  $('ytSub').textContent = videos.length
    ? `${videos.length} ${videos.length === 1 ? 'Video' : 'Videos'} heute`
    : 'heute geschaut';

  if (!videos.length) {
    list.innerHTML = '<li class="empty">Kein YouTube heute. Stark.</li>';
    return;
  }
  const max = videos[0].seconds;
  for (const v of videos) {
    list.appendChild(rankRow({
      name: v.title,
      seconds: v.seconds,
      category: 'wasted',
      max,
      isVideo: true,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      iconHtml: `<img class="rank-thumb" alt="" src="${v.thumbnail}" onerror="this.style.visibility='hidden'" />`,
    }));
  }
}

/* ------------------------------------------------------------------ Ticker */

function renderTicker(s) {
  const parts = [
    `FOKUS ${s.today.score} %`,
    `PRODUKTIV ${fmt(s.today.productive)}`,
    `PROKRASTINATION ${fmt(s.today.wasted)}`,
    `ZIEL ${pct(s.goals.productiveProgress)} ERREICHT`,
    `BUDGET ${pct(s.goals.budgetProgress)} VERBRAUCHT`,
    s.goals.streak > 0 ? `SERIE ${s.goals.streak} TAGE` : 'KEINE SERIE AKTIV',
    s.tracking ? 'AUFZEICHNUNG LÄUFT' : 'AUFZEICHNUNG PAUSIERT',
    'ALLE DATEN BLEIBEN LOKAL',
  ];
  $('tickerText').textContent = parts.join('  ·  ') + '  ·  ';
}

/* ------------------------------------------------------------------ Scheibe */

const DG = window.DiscGeometry;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DISC_DETAIL_LIMIT = 5;
/** Für welchen Tagesbeginn Beschriftung und Stunden-Knöpfe gebaut sind. Die
    Knöpfe bleiben bei Live-Updates stehen, sonst ginge der Tastaturfokus
    alle drei Sekunden verloren. */
let discBuiltFor = null;
let lastDiscDetailSignature = '';
/** Aufsummierter Drehwinkel des Auswahlrahmens, damit er den kurzen Weg nimmt. */
let discSelAngle = null;

/** Wie fmt(), aber ein paar Sekunden sind nicht "0 Min". */
const fmtAtLeast = (seconds) => (seconds > 0 && seconds < 30 ? 'unter 1 Min' : fmt(seconds));
const hourRange = (h) => `${h} bis ${(h + 1) % 24} Uhr`;
const clockNow = () => {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Ohne Auswahl zeigt die Scheibe heute die laufende Stunde, sonst die vollste. */
function defaultDiscHour(s) {
  if (s.date.isToday) return new Date().getHours();
  let best = s.dayStart || 0;
  let max = 0;
  s.hours.forEach((h, i) => {
    const active = h.p + h.n + h.w;
    if (active > max) { max = active; best = i; }
  });
  return best;
}

function shownDiscHour(s) {
  return selectedHour !== null ? selectedHour : defaultDiscHour(s);
}

/** Stunde in der Scheibe wählen. Anders als im Tagesverlauf schliesst ein
    zweiter Klick nichts — die Scheibe zeigt immer eine Stunde. */
function pickDiscHour(i) {
  if (selectedHour !== i) selectHour(i);
}

function buildDiscStatic(dayStart) {
  if (discBuiltFor === dayStart) return;
  discBuiltFor = dayStart;

  const labels = $('discLabels');
  labels.textContent = '';
  for (const l of DG.hourLabels(dayStart)) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', l.x);
    t.setAttribute('y', l.y);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('class', l.k === 0 ? 'disc-label is-start' : 'disc-label');
    t.textContent = String(l.hour).padStart(2, '0');
    labels.appendChild(t);
  }

  const hits = $('lanesHits');
  hits.textContent = '';
  for (let k = 0; k < 24; k++) {
    const h = DG.hourAt(k, dayStart);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.hour = String(h);
    b.setAttribute('aria-label', `${hourRange(h)} anzeigen`);
    b.setAttribute('aria-pressed', 'false');
    hits.appendChild(b);
  }
  $('discSel').setAttribute('d', DG.wedge(0, DG.R0 - 4, DG.R1 + 4));
  discSelAngle = null;
}

function goalLine(s) {
  const goal = s.goals.productiveMinutes * 60;
  const done = s.today.productive;
  if (goal > 0 && done >= goal) {
    return s.milestones.goalAt
      ? `Produktiv-Ziel von ${fmt(goal)} um ${s.milestones.goalAt} erreicht.`
      : `Produktiv-Ziel von ${fmt(goal)} erreicht.`;
  }
  return s.date.isToday
    ? `Produktiv-Ziel: noch ${fmt(goal - done)}.`
    : `Produktiv-Ziel von ${fmt(goal)} nicht erreicht, es fehlten ${fmt(goal - done)}.`;
}

function budgetLine(s) {
  const budget = s.goals.maxWasteMinutes * 60;
  const used = s.today.wasted;
  if (used >= budget && used > 0) {
    const at = s.milestones.budgetAt;
    let line = at
      ? `Budget von ${fmt(budget)} ${s.date.isToday ? 'schon ' : ''}um ${at} aufgebraucht.`
      : `Budget von ${fmt(budget)} aufgebraucht.`;
    if (used - budget >= 60) line += ` ${fmt(used - budget)} darüber.`;
    return line;
  }
  return s.date.isToday
    ? `Budget: noch ${fmt(budget - used)} übrig.`
    : `Budget von ${fmt(budget)} eingehalten, ${fmt(budget - used)} blieben übrig.`;
}

function renderDisc(s) {
  const dayStart = s.dayStart || 0;
  buildDiscStatic(dayStart);
  const date = parseDayKeyLocal(s.date.key);
  const next = new Date(date);
  next.setDate(date.getDate() + 1);
  const nextName = next.toLocaleDateString('de-DE', { weekday: 'long' });

  // Scheibe
  const d = DG.discPaths(s.hours, dayStart);
  $('discTrack').setAttribute('d', d.track);
  $('discP').setAttribute('d', d.p);
  $('discN').setAttribute('d', d.n);
  $('discW').setAttribute('d', d.w);
  const needle = $('discNeedle');
  needle.style.display = s.date.isToday ? '' : 'none';
  if (s.date.isToday) {
    const n = DG.needle(new Date(), dayStart);
    const line = $('discNeedleLine');
    line.setAttribute('x1', n.x1); line.setAttribute('y1', n.y1);
    line.setAttribute('x2', n.x2); line.setAttribute('y2', n.y2);
    $('discNeedleTip').setAttribute('cx', n.x2);
    $('discNeedleTip').setAttribute('cy', n.y2);
  }
  $('discScore').textContent = String(s.today.score);
  $('discScoreLabel').textContent = s.date.isToday ? 'Fokus heute' : 'Fokus an diesem Tag';
  const span = dayStart === 0 ? 'von 0 bis 24 Uhr' : `von ${dayStart} bis ${dayStart} Uhr`;
  $('discCaption').textContent = `Jede Speiche ist eine Stunde, ${span} im Uhrzeigersinn. `
    + 'Je weiter sie nach außen reicht, desto länger warst du am Mac.'
    + (s.date.isToday ? ' Der Zeiger steht auf jetzt.' : '');

  // Kopf
  $('discTitle').textContent = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  if (s.date.isToday) {
    $('discSubtitle').textContent = dayStart === 0
      ? `Läuft noch bis Mitternacht. Jetzt ist es ${clockNow()}.`
      : `Läuft noch bis ${nextName}, ${dayStart} Uhr. Jetzt ist es ${clockNow()}.`;
  } else {
    $('discSubtitle').textContent = dayStart === 0
      ? 'Von 0 bis 24 Uhr, noch mit Mitternacht als Tageswechsel.'
      : `Von ${dayStart} Uhr bis ${nextName}, ${dayStart} Uhr.`;
  }

  const empty = s.today.total <= 0;
  $('discEmpty').hidden = !empty;
  $('discBody').hidden = empty;
  if (empty) {
    $('discEmpty').textContent = s.date.isToday
      ? 'Noch nichts erfasst. Sobald du am Mac bist, füllt sich die Scheibe.'
      : 'An diesem Tag wurde nichts erfasst.';
  }

  $('discGoalLine').textContent = goalLine(s);
  $('discBudgetLine').textContent = budgetLine(s);
  $('discTotP').textContent = fmt(s.today.productive);
  $('discTotN').textContent = fmt(s.today.neutral);
  $('discTotW').textContent = fmt(s.today.wasted);
  $('discTotAll').textContent = fmt(s.today.productive + s.today.neutral + s.today.wasted);

  // Spurband: Balken beginnen am Stundenanfang und sind so lang wie die
  // Minuten — wann genau in der Stunde, weiss die App nicht.
  const { lanes, rest } = s.appLanes || { lanes: [], rest: { names: [], total: 0 } };
  const order = Array.from({ length: 24 }, (_, k) => DG.hourAt(k, dayStart));
  $('lanesNames').innerHTML = lanes.map((l) => (
    `<span title="${escapeHtml(l.name)}"><i class="disc-cat-${l.category || 'neutral'}"></i>${escapeHtml(l.name)}</span>`
  )).join('');
  $('lanesRows').innerHTML = lanes.map((l) => {
    const cells = order.map((h) => {
      const sec = l.byHour[h] || 0;
      const w = Math.min(100, (sec / HOUR_SECONDS) * 100);
      return `<span class="lanes-cell">${sec > 0 ? `<i class="disc-cat-${l.category || 'neutral'}" style="width:${Math.max(4, w).toFixed(1)}%"></i>` : ''}</span>`;
    }).join('');
    return `<div class="lanes-row">${cells}</div>`;
  }).join('') || '<div class="lanes-row"></div>';
  $('lanesNone').hidden = lanes.length > 0;
  const n = rest.names.length;
  $('lanesMore').textContent = n === 0 ? ''
    : n <= 2 ? `Dazu ${rest.names.join(' und ')} mit zusammen ${fmtAtLeast(rest.total)}.`
      : `Dazu ${rest.names.slice(0, 2).join(', ')} und ${n - 2} weitere mit zusammen ${fmtAtLeast(rest.total)}.`;

  renderDiscSelection(s, false);
}

/** Alles, was an der gewählten Stunde hängt: Rahmen, Lineal, Knöpfe, Liste. */
function renderDiscSelection(s, opening) {
  const dayStart = s.dayStart || 0;
  if (discBuiltFor !== dayStart) return;
  const h = shownDiscHour(s);
  const k = DG.posOf(h, dayStart);

  // Rahmen um die Speiche: den kürzeren Weg herum drehen.
  const target = k * 15;
  const sel = $('discSel');
  if (discSelAngle === null) {
    // Erste Stellung ohne Drehung von 0 Grad aus.
    discSelAngle = target;
    sel.style.transition = 'none';
    sel.style.transform = `rotate(${discSelAngle}deg)`;
    sel.getBoundingClientRect();
    sel.style.transition = '';
  } else {
    discSelAngle += ((((target - discSelAngle) % 360) + 540) % 360) - 180;
    sel.style.transform = `rotate(${discSelAngle}deg)`;
  }

  $('lanesRuler').innerHTML = Array.from({ length: 24 }, (_, i) => {
    const hour = DG.hourAt(i, dayStart);
    const sel = i === k;
    // Direkt neben der gewählten Stunde keine zweite Zahl, sonst stoßen sie aneinander.
    const show = sel || (i % 3 === 0 && Math.abs(i - k) > 1);
    return `<span${sel ? ' class="is-selected"' : ''}>${show ? String(hour).padStart(2, '0') : ''}</span>`;
  }).join('');
  for (const b of $('lanesHits').children) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.hour) === h));
  }
  $('discPrev').disabled = k === 0;
  $('discNext').disabled = k === 23;

  const hour = s.hours[h] || {};
  const items = (s.hourItems || [])[h];
  const active = (hour.p || 0) + (hour.n || 0) + (hour.w || 0);
  $('discHourLabel').textContent = hourRange(h);
  $('discHourTotal').textContent = active > 0 ? `${fmt(active)} am Mac` : '';

  const signature = JSON.stringify([s.date.key, h, active, items]);
  if (signature === lastDiscDetailSignature) return;
  lastDiscDetailSignature = signature;

  const list = $('discHourList');
  list.classList.toggle('is-opening', !!opening);
  clearTimeout(renderDiscSelection.timer);
  renderDiscSelection.timer = setTimeout(() => list.classList.remove('is-opening'), 500);

  if (!items || !items.length) {
    const legacy = !items && active > 0;
    list.innerHTML = legacy
      ? '<p class="disc-hour-note">Für diese Stunde gibt es keine Aufschlüsselung. Die App merkt sich erst seit dem Update, was in welcher Stunde lief.</p>'
      : '<p class="disc-hour-note">Nicht am Mac.</p>';
    return;
  }

  const shown = items.slice(0, DISC_DETAIL_LIMIT);
  const max = shown[0].seconds;
  let html = shown.map((item, i) => `
    <div class="disc-item" style="--i:${i}" data-key="${escapeHtml(`${item.kind}:${item.name.toLowerCase()}`)}" data-name="${escapeHtml(item.name)}" title="Klicken zum Umstufen">
      <span class="disc-item-name">${escapeHtml(item.name)}</span>
      <span class="disc-item-bar"><i class="disc-cat-${item.category || 'neutral'}" style="width:${Math.max(3, (item.seconds / max) * 100).toFixed(0)}%"></i></span>
      <span class="disc-item-time">${fmtAtLeast(item.seconds)}</span>
    </div>`).join('');

  const restItems = items.slice(DISC_DETAIL_LIMIT);
  const listed = items.reduce((sum, e) => sum + e.seconds, 0);
  const notes = [];
  if (restItems.length) {
    notes.push(`Dazu ${restItems.length} weitere mit zusammen ${fmtAtLeast(restItems.reduce((sum, e) => sum + e.seconds, 0))}.`);
  }
  if (active - listed >= 60) notes.push(`${fmt(active - listed)} ohne Zuordnung.`);
  if (notes.length) html += `<p class="disc-hour-note is-small">${notes.join(' ')}</p>`;
  list.innerHTML = html;
}

function stepDiscHour(delta) {
  if (!snapshot) return;
  const dayStart = snapshot.dayStart || 0;
  const k = DG.posOf(shownDiscHour(snapshot), dayStart) + delta;
  if (k < 0 || k > 23) return;
  pickDiscHour(DG.hourAt(k, dayStart));
}

function attachDisc() {
  $('lanesHits').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-hour]');
    if (b) pickDiscHour(Number(b.dataset.hour));
  });
  $('discPrev').addEventListener('click', () => stepDiscHour(-1));
  $('discNext').addEventListener('click', () => stepDiscHour(1));

  // In der Scheibe selbst: Winkel und Abstand zur Mitte ergeben die Stunde.
  const svg = $('discSvg');
  const hourAtEvent = (e) => {
    const pt = clientToSvgPoint(svg, e.clientX, e.clientY);
    return pt && snapshot ? DG.hourAtPoint(pt.x, pt.y, snapshot.dayStart || 0) : null;
  };
  svg.addEventListener('mousemove', (e) => {
    const h = hourAtEvent(e);
    if (h === null) { hideTooltip(); svg.style.cursor = 'default'; return; }
    svg.style.cursor = 'pointer';
    showTooltip(e.clientX, e.clientY, dayTooltipHtml(h, snapshot.hours[h] || {}, 'Klicken für die Apps'));
  });
  svg.addEventListener('mouseleave', hideTooltip);
  svg.addEventListener('click', (e) => {
    const h = hourAtEvent(e);
    if (h !== null) pickDiscHour(h);
  });

  document.addEventListener('keydown', (e) => {
    if (currentView !== 'disc' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target instanceof Element ? e.target : null;
    if ((t && t.closest('input, textarea, select')) || !$('goalsOverlay').hidden) return;
    e.preventDefault();
    stepDiscHour(e.key === 'ArrowLeft' ? -1 : 1);
  });
}

attachDisc();

/* ------------------------------------------------------------------ Ansicht */

let currentView = null;
/** Gewählte Ansicht, solange das Speichern noch läuft — ein Live-Update mit
    der alten Einstellung soll nicht kurz zurückschalten. */
let pendingView = null;

function applyView(view) {
  const v = view === 'disc' ? 'disc' : 'overview';
  if (currentView === v) return;
  const swap = () => {
    currentView = v;
    $('viewOverview').hidden = v !== 'overview';
    $('viewDisc').hidden = v !== 'disc';
    for (const b of document.querySelectorAll('.viewswitch [data-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.view === v));
    }
    hideTooltip();
    window.scrollTo(0, 0);
  };
  if (currentView && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

document.querySelector('.viewswitch').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  pendingView = b.dataset.view;
  applyView(pendingView);
  try {
    render(await window.copilot.setSettings({ view: pendingView }));
  } finally {
    pendingView = null;
  }
});

/* ------------------------------------------------------------ Gesamtrender */

function render(s) {
  snapshot = s;
  applyTheme(s.settings && s.settings.theme);
  applyView(pendingView || (s.settings && s.settings.view));
  viewedDate = parseDayKeyLocal(s.date.key);
  updateDateNavButtons();

  $('dateLabel').textContent = s.date.label;
  $('statusText').textContent = s.tracking ? 'System online · live' : 'Aufzeichnung pausiert';
  $('statusDot').classList.toggle('is-paused', !s.tracking);
  $('btnTracking').textContent = s.tracking ? 'Pause' : 'Start';

  renderGauge(s.today.score);
  $('legProductive').textContent = fmt(s.today.productive);
  $('legNeutral').textContent = fmt(s.today.neutral);
  $('legWasted').textContent = fmt(s.today.wasted);

  $('statTotal').textContent = fmt(s.today.total);
  $('statProductive').textContent = fmt(s.today.productive);
  $('statWasted').textContent = fmt(s.today.wasted);
  $('statIdle').textContent = fmt(s.today.inactive);

  const goalSeconds = s.goals.productiveMinutes * 60;
  const budgetSeconds = s.goals.maxWasteMinutes * 60;
  $('todayHint').textContent = `${fmt(s.today.productive)} / ${fmt(goalSeconds)}`;
  $('goalLabel').textContent = `Produktiv-Ziel ${fmt(goalSeconds)}`;
  $('goalPct').textContent = pct(s.goals.productiveProgress);
  $('goalBar').style.width = `${Math.min(100, s.goals.productiveProgress * 100)}%`;
  $('budgetLabel').textContent = `Budget max ${fmt(budgetSeconds)}`;
  $('budgetPct').textContent = pct(s.goals.budgetProgress);
  $('budgetBar').style.width = `${Math.min(100, s.goals.budgetProgress * 100)}%`;

  if (s.goals.streak > 0) {
    $('streakNote').textContent =
      `Serie: ${s.goals.streak} ${s.goals.streak === 1 ? 'Tag' : 'Tage'} in Folge das Produktiv-Ziel erreicht.`;
  } else {
    $('streakNote').textContent = 'Erreiche das Produktiv-Ziel, um eine Serie zu starten.';
  }

  renderDonut(s.today);
  renderWeek(s.last7);
  renderTrend(s.last14);
  if (selectedDayKey !== s.date.key) {
    selectedHour = null;
    selectedDayKey = null;
  }
  renderDay(s.hours, s.date.isToday, s.dayStart || 0);
  renderHourDetail();
  renderDisc(s);

  $('currentStrip').hidden = !s.date.isToday;

  // Aktueller Kontext
  const cur = s.current || {};
  // Bei laufendem Video ohne Interaktion steht vorne oft kein sinnvoller
  // Prozess — dann benennen wir das, statt eine leere Zeile zu zeigen.
  let label;
  if (cur.idle) label = 'Nicht am PC';
  else if (cur.domain || cur.app) label = cur.domain || cur.app;
  else if (cur.media) label = 'Video läuft im Hintergrund';
  else label = 'Warte auf Aktivität …';
  $('currentName').textContent = label;
  const pill = $('currentPill');
  const cat = cur.idle ? 'inactive' : (cur.category || 'neutral');
  pill.textContent = CAT_LABEL[cat] || 'Neutral';
  pill.className = 'pill is-' + (cat === 'inactive' ? 'idle' : cat);

  const icon = $('currentIcon');
  if (cur.app && !cur.idle) {
    window.copilot.getAppIcon(cur.app).then((dataUrl) => {
      if (dataUrl) { icon.src = dataUrl; icon.hidden = false; } else { icon.hidden = true; }
    });
  } else {
    icon.hidden = true;
  }

  // Hochrechnung
  const p = s.projection.wasted;
  $('projDay').textContent = fmt(p.perDay);
  $('projWeek').textContent = fmt(p.perWeek);
  $('projMonth').textContent = fmtHours(p.perMonth);
  $('projYear').textContent = fmtHours(p.perYear);
  $('projDecade').textContent = `${p.daysPerDecade.toFixed(1)} Tage`;

  if (s.today.wasted > 0) {
    $('projNote').textContent =
      `Bei diesem Tempo verlierst du ${p.daysPerYear.toFixed(1)} volle Tage pro Jahr und ` +
      `${p.daysPerDecade.toFixed(1)} Tage pro Jahrzehnt. Dein Limit (${s.goals.maxWasteMinutes} Min/Tag) ` +
      `wären ${s.projection.limitDaysPerYear.toFixed(1)} Tage pro Jahr.`;
  } else {
    $('projNote').textContent = 'Noch keine Prokrastination erfasst. Weiter so.';
  }

  renderApps(s.apps);
  renderYoutube(s.youtube);
  renderSites(s.domains);
  renderTicker(s);

  maybeCelebrateRecord(s);
  renderWeekScore(s);
}

/* ------------------------------------------------------------- Chart-Hover */

const chartTooltip = $('chartTooltip');

/** Mausposition (Client-Koordinaten) in SVG-Viewbox-Koordinaten umrechnen. */
function clientToSvgPoint(svg, clientX, clientY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(ctm.inverse());
}

function showTooltip(clientX, clientY, html) {
  chartTooltip.innerHTML = html;
  chartTooltip.hidden = false;

  // Erst positionieren, nachdem die Größe feststeht, sonst rechnet man mit
  // den Maßen vom letzten Aufruf.
  const rect = chartTooltip.getBoundingClientRect();
  const margin = 14;
  let left = clientX + margin;
  let top = clientY + margin;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - margin;
  if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - margin;
  chartTooltip.style.left = `${Math.max(8, left)}px`;
  chartTooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  chartTooltip.hidden = true;
}

/** Hover für "Letzte 7 Tage": Tooltip plus Abdunkeln der übrigen Tage. */
function attachWeekHover() {
  const container = $('week');
  container.addEventListener('mousemove', (e) => {
    const svg = container.querySelector('svg');
    if (!svg || !lastWeekDays.length) return;
    const pt = clientToSvgPoint(svg, e.clientX, e.clientY);
    if (!pt) return;

    const { W } = WEEK_GEOMETRY;
    const slot = W / lastWeekDays.length;
    let i = Math.floor(pt.x / slot);
    i = Math.max(0, Math.min(lastWeekDays.length - 1, i));

    for (const g of svg.querySelectorAll('.bar-group')) {
      g.classList.toggle('is-dim', Number(g.dataset.i) !== i);
    }
    showTooltip(e.clientX, e.clientY, weekTooltipHtml(lastWeekDays[i]));
  });
  container.addEventListener('mouseleave', () => {
    for (const g of container.querySelectorAll('.bar-group')) g.classList.remove('is-dim');
    hideTooltip();
  });
}

/** Hover für "Fokus-Trend": Tooltip plus vergrößerter Punkt am nächsten Tag. */
function attachTrendHover() {
  const container = $('trend');
  let activeCircle = null;

  container.addEventListener('mousemove', (e) => {
    const svg = container.querySelector('svg');
    if (!svg || !lastTrendPoints.length) return;
    const pt = clientToSvgPoint(svg, e.clientX, e.clientY);
    if (!pt) return;

    let nearest = lastTrendPoints[0];
    let best = Infinity;
    for (const p of lastTrendPoints) {
      const d = Math.abs(p.x - pt.x);
      if (d < best) { best = d; nearest = p; }
    }

    if (activeCircle) activeCircle.setAttribute('r', '2');
    activeCircle = svg.querySelector(`.trend-point[data-i="${lastTrendPoints.indexOf(nearest)}"]`);
    if (activeCircle) activeCircle.setAttribute('r', '3.4');

    showTooltip(e.clientX, e.clientY, trendTooltipHtml(nearest));
  });
  container.addEventListener('mouseleave', () => {
    if (activeCircle) { activeCircle.setAttribute('r', '2'); activeCircle = null; }
    hideTooltip();
  });
}

/** Hover für den Tagesverlauf. Trefferfläche ist die ganze Stundenspalte,
    nicht nur der gefüllte Teil — sonst trifft man leere Stunden nie. */
function attachDayHover() {
  const container = $('day');
  container.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('.day-hour');
    if (!cell || !lastDayHours.length) {
      hideTooltip();
      return;
    }
    const i = Number(cell.dataset.i);
    for (const other of container.querySelectorAll('.day-hour')) {
      other.classList.toggle('is-dim', other !== cell);
    }
    showTooltip(e.clientX, e.clientY, dayTooltipHtml(i, lastDayHours[i] || {}));
  });
  container.addEventListener('mouseleave', () => {
    for (const cell of container.querySelectorAll('.day-hour')) cell.classList.remove('is-dim');
    hideTooltip();
  });
  // Klick öffnet die Aufschlüsselung darunter; leere Stunden haben keine.
  container.addEventListener('click', (e) => {
    const cell = e.target.closest('.day-hour');
    if (!cell || !snapshot) return;
    const i = Number(cell.dataset.i);
    if (cell.classList.contains('is-empty') && selectedHour !== i) return;
    selectHour(i);
    showTooltip(e.clientX, e.clientY, dayTooltipHtml(i, lastDayHours[i] || {}));
  });
  $('dayDetail').addEventListener('click', (e) => {
    if (e.target.closest('.day-detail-close')) selectHour(selectedHour);
  });
}

attachWeekHover();
attachTrendHover();
attachDayHover();

/* ------------------------------------------------------- Einstufungs-Menü */

const ctxMenu = $('ctxMenu');
let ctxKey = null;

function openCtx(event, key, name) {
  ctxKey = key;
  $('ctxTitle').textContent = `Wie zählt „${name}"?`;
  ctxMenu.hidden = false;

  // Innerhalb des Fensters halten.
  const rect = ctxMenu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 12);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 12);
  ctxMenu.style.left = `${Math.max(8, x)}px`;
  ctxMenu.style.top = `${Math.max(8, y)}px`;
}

function closeCtx() {
  ctxMenu.hidden = true;
  ctxKey = null;
}

const themeMenu = $('themeMenu');

function closeThemeMenu() {
  if (themeMenu.hidden) return;
  themeMenu.hidden = true;
  $('btnTheme').setAttribute('aria-expanded', 'false');
}

$('btnTheme').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!themeMenu.hidden) { closeThemeMenu(); return; }
  closeCtx();
  // Unter dem Knopf, rechtsbündig, innerhalb des Fensters.
  const r = e.currentTarget.getBoundingClientRect();
  themeMenu.hidden = false;
  const w = themeMenu.getBoundingClientRect().width;
  themeMenu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 12))}px`;
  themeMenu.style.top = `${r.bottom + 6}px`;
  e.currentTarget.setAttribute('aria-expanded', 'true');
  const current = themeMenu.querySelector('[aria-checked="true"]');
  if (current) current.focus();
});

themeMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-theme]');
  if (!btn) return;
  e.stopPropagation();
  closeThemeMenu();
  render(await window.copilot.setSettings({ theme: btn.dataset.theme }));
});

document.addEventListener('click', (e) => {
  const row = e.target.closest('.rank, .disc-item');
  if (row && row.dataset.key) {
    e.stopPropagation();
    openCtx(e, row.dataset.key, row.dataset.name);
    return;
  }
  if (row && row.dataset.url) {
    window.copilot.openLink(row.dataset.url);
    return;
  }
  if (!e.target.closest('.ctx')) { closeCtx(); closeThemeMenu(); }
});

ctxMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn || !ctxKey) return;
  const next = await window.copilot.setOverride(ctxKey, btn.dataset.cat);
  closeCtx();
  render(next);
});

/* ------------------------------------------------------------ Ziele-Dialog */

function syncGoalsModal() {
  const productive = Number($('goalRange').value);
  const waste = Number($('wasteRange').value);
  pendingGoals = { productiveMinutes: productive, maxWasteMinutes: waste };

  // Im Dialog immer ausgeschrieben: "3 Std 0 Min" statt "3 Std", und das
  // Budget bleibt in Minuten, solange es unter zwei Stunden liegt.
  const h = Math.floor(productive / 60);
  $('goalOut').textContent = h > 0 ? `${h} Std ${productive % 60} Min` : `${productive} Min`;
  $('wasteOut').textContent = waste < 120 ? `${waste} Min` : fmt(waste * 60);

  $('tWeekG').textContent = fmt(productive * 60 * 7);
  $('tWeekW').textContent = fmt(waste * 60 * 7);
  $('tMonthG').textContent = fmtHours(productive * 60 * 30);
  $('tMonthW').textContent = fmtHours(waste * 60 * 30);
  $('tYearG').textContent = `${Math.round((productive * 365) / 60)} Std`;
  $('tYearW').textContent = `${Math.round((waste * 365) / 60)} Std`;

  const daysPerYear = (waste * 60 * 365) / 86400;
  $('goalsNote').textContent =
    `Dein Limit entspricht ${daysPerYear.toFixed(1)} vollen Tagen pro Jahr Prokrastination. ` +
    `Dein Produktiv-Ziel baut dir ${Math.round((productive * 365) / 60)} Stunden Lebenswerk pro Jahr.`;
}

function openGoals() {
  if (!snapshot) return;
  $('goalRange').value = String(snapshot.goals.productiveMinutes);
  $('wasteRange').value = String(snapshot.goals.maxWasteMinutes);
  syncGoalsModal();
  $('goalsOverlay').hidden = false;
}

$('btnGoals').addEventListener('click', openGoals);
$('goalsCancel').addEventListener('click', () => { $('goalsOverlay').hidden = true; });
$('goalRange').addEventListener('input', syncGoalsModal);
$('wasteRange').addEventListener('input', syncGoalsModal);

$('goalsSave').addEventListener('click', async () => {
  if (!pendingGoals) return;
  const next = await window.copilot.setGoals(pendingGoals);
  $('goalsOverlay').hidden = true;
  render(next);
});

for (const preset of document.querySelectorAll('.preset')) {
  preset.addEventListener('click', () => {
    $('goalRange').value = preset.dataset.productive;
    $('wasteRange').value = preset.dataset.waste;
    syncGoalsModal();
  });
}

$('goalsOverlay').addEventListener('click', (e) => {
  if (e.target === $('goalsOverlay')) $('goalsOverlay').hidden = true;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('goalsOverlay').hidden = true; closeCtx(); closeThemeMenu(); }
});

/* ----------------------------------------------------------------- Buttons */

$('btnToday').addEventListener('click', async () => render(await window.copilot.getSnapshot()));
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
$('btnTracking').addEventListener('click', async () => render(await window.copilot.toggleTracking()));

/* -------------------------------------------------------------------- Boot */

window.copilot.onSnapshot(render);
window.copilot.getSnapshot().then(render);
