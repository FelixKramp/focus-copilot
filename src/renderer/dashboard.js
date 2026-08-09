'use strict';

/* Focus Co-Pilot — Dashboard-Renderer.
   Rechnen passiert im Main-Prozess; hier wird nur gezeichnet und reagiert. */

const $ = (id) => document.getElementById(id);

let snapshot = null;
let pendingGoals = null;

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
  productive: 'PRODUKTIV',
  neutral: 'NEUTRAL',
  wasted: 'PROKRASTINATION',
  inactive: 'NICHT AM PC',
};

/* ---------------------------------------------------------------- Diagramme */

function renderGauge(score) {
  const r = 82;
  const circumference = 2 * Math.PI * r;
  const ring = $('gaugeValue');
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - Math.min(1, score / 100)));
  $('scoreValue').textContent = String(score);
}

function renderDonut(today) {
  const r = 78;
  const circumference = 2 * Math.PI * r;
  const total = today.productive + today.neutral + today.wasted;
  const segments = [
    { value: today.productive, color: 'var(--green)' },
    { value: today.neutral, color: 'var(--cyan)' },
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
        `style="filter:drop-shadow(0 0 5px ${s.color})" />`;
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
      { v: d.neutral, c: 'var(--cyan)' },
      { v: d.wasted, c: 'var(--red)' },
    ];
    for (const part of stack) {
      if (part.v <= 0) continue;
      const h = (part.v / max) * usable;
      y -= h;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${part.c}" rx="1.5" opacity="0.92" />`;
    }

    if (d.goalReached) {
      svg += `<circle cx="${cx}" cy="${y - 7}" r="2.6" fill="var(--green)" style="filter:drop-shadow(0 0 4px var(--green))" />`;
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
            <stop offset="0%" stop-color="rgba(34,211,238,0.22)" />
            <stop offset="100%" stop-color="rgba(34,211,238,0)" />
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

function renderDay(hours) {
  const W = 480;
  const H = 150;
  const padBottom = 20;
  const padTop = 10;
  const usable = H - padBottom - padTop;
  const max = Math.max(300, ...hours.map((h) => h.p + h.n + h.w + h.i));
  const slot = W / 24;
  const barW = slot * 0.5;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  svg += `<line x1="0" y1="${H - padBottom}" x2="${W}" y2="${H - padBottom}" class="grid-line" />`;

  hours.forEach((h, i) => {
    const cx = slot * i + slot / 2;
    const x = cx - barW / 2;
    let y = H - padBottom;

    const stack = [
      { v: h.p, c: 'var(--green)' },
      { v: h.n, c: 'var(--cyan)' },
      { v: h.w, c: 'var(--red)' },
      { v: h.i, c: 'var(--idle)' },
    ];
    for (const part of stack) {
      if (part.v <= 0) continue;
      const barH = (part.v / max) * usable;
      y -= barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${part.c}" rx="1" opacity="0.9" />`;
    }

    if (i % 3 === 0) {
      svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis-label">${String(i).padStart(2, '0')}</text>`;
    }
  });

  svg += '</svg>';
  $('day').innerHTML = svg;
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

/* ------------------------------------------------------------ Gesamtrender */

function render(s) {
  snapshot = s;
  viewedDate = parseDayKeyLocal(s.date.key);
  updateDateNavButtons();

  $('dateLabel').textContent = s.date.label;
  $('statusText').textContent = s.tracking ? 'SYSTEM ONLINE · LIVE' : 'AUFZEICHNUNG PAUSIERT';
  $('statusDot').classList.toggle('is-paused', !s.tracking);
  $('btnTracking').textContent = s.tracking ? 'PAUSE' : 'START';

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
  renderDay(s.hours);

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
  pill.textContent = CAT_LABEL[cat] || 'NEUTRAL';
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

attachWeekHover();
attachTrendHover();

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

document.addEventListener('click', (e) => {
  const row = e.target.closest('.rank');
  if (row && row.dataset.key) {
    e.stopPropagation();
    openCtx(e, row.dataset.key, row.dataset.name);
    return;
  }
  if (row && row.dataset.url) {
    window.copilot.openLink(row.dataset.url);
    return;
  }
  if (!e.target.closest('.ctx')) closeCtx();
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
  if (e.key === 'Escape') { $('goalsOverlay').hidden = true; closeCtx(); }
});

/* ----------------------------------------------------------------- Buttons */

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
$('btnTracking').addEventListener('click', async () => render(await window.copilot.toggleTracking()));

/* -------------------------------------------------------------------- Boot */

window.copilot.onSnapshot(render);
window.copilot.getSnapshot().then(render);
