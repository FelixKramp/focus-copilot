'use strict';

const { dayKey, parseDayKey } = require('./store');
const { focusScore, scoreTrend } = require('./score');

/**
 * Baut den kompletten Snapshot, den Dashboard und Menüleisten-Vorschau rendern.
 * Die gesamte Rechnerei passiert hier im Main-Prozess, damit der Renderer
 * reines Zeichnen bleibt.
 */

const WORK_DAYS_PER_YEAR = 365;

/** Hochrechnung einer Tagesmenge auf Woche / Monat / Jahr / Jahrzehnt. */
function project(secondsPerDay) {
  const perWeek = secondsPerDay * 7;
  const perMonth = secondsPerDay * 30;
  const perYear = secondsPerDay * WORK_DAYS_PER_YEAR;
  return {
    perDay: secondsPerDay,
    perWeek,
    perMonth,
    perYear,
    daysPerYear: perYear / 86400,
    daysPerDecade: (perYear * 10) / 86400,
  };
}

function topList(map, limit = 6) {
  return Object.entries(map || {})
    .map(([name, rec]) => ({ name, seconds: rec.sec, category: rec.cat }))
    .filter((e) => e.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit);
}

function topYoutube(map, limit = 5) {
  return Object.entries(map || {})
    .map(([id, rec]) => ({
      id,
      title: rec.title || 'YouTube-Video',
      seconds: rec.sec,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    }))
    .filter((e) => e.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit);
}

/**
 * Was in jeder Stunde lief, größter Posten zuerst. `null` heisst: die Stunde
 * stammt von vor dem Update und kennt nur Summen, keine Einträge.
 */
function hourItems(hours) {
  return hours.map((h) => {
    if (!h.items) return null;
    return Object.entries(h.items)
      .map(([itemKey, rec]) => {
        const sep = itemKey.indexOf(':');
        return {
          kind: itemKey.slice(0, sep),
          name: itemKey.slice(sep + 1),
          seconds: rec.sec,
          category: rec.cat,
        };
      })
      .filter((e) => e.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
  });
}

/** Wie viele Apps das Spurband der Scheibe einzeln zeigt; der Rest wird zusammengefasst. */
const LANE_COUNT = 6;

/**
 * Die meistgenutzten Apps und Websites des Tages mit ihren Minuten je Stunde,
 * für das Spurband der Scheibe. Die Kategorie einer App ist die ihres größten
 * Stunden-Eintrags. Alte Stunden ohne Einträge tragen nichts bei.
 */
function appLanes(hours) {
  const byKey = new Map();
  hours.forEach((h, hour) => {
    for (const [itemKey, rec] of Object.entries(h.items || {})) {
      if (!(rec.sec > 0)) continue;
      let lane = byKey.get(itemKey);
      if (!lane) {
        const sep = itemKey.indexOf(':');
        lane = {
          kind: itemKey.slice(0, sep),
          name: itemKey.slice(sep + 1),
          category: rec.cat,
          total: 0,
          byHour: new Array(24).fill(0),
          biggest: 0,
        };
        byKey.set(itemKey, lane);
      }
      lane.total += rec.sec;
      lane.byHour[hour] += rec.sec;
      if (rec.sec > lane.biggest) { lane.biggest = rec.sec; lane.category = rec.cat; }
    }
  });
  const ranked = [...byKey.values()]
    .sort((a, b) => b.total - a.total)
    .map(({ biggest, ...lane }) => lane);
  const rest = ranked.slice(LANE_COUNT);
  return {
    lanes: ranked.slice(0, LANE_COUNT),
    rest: { names: rest.map((l) => l.name), total: rest.reduce((sum, l) => sum + l.total, 0) },
  };
}

/** Zeitstempel → "15:44" in lokaler Zeit, oder null. */
function clockTime(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Serie: wie viele Tage in Folge (bis gestern, plus heute falls schon
 * erreicht) wurde das Produktiv-Ziel geschafft?
 */
function computeStreak(store) {
  const goalSeconds = store.data.goals.productiveMinutes * 60;
  if (goalSeconds <= 0) return 0;

  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const rec = store.data.days[dayKey(d)];
    const productive = rec ? rec.productive : 0;
    if (productive >= goalSeconds) {
      streak++;
    } else if (i === 0) {
      // Heute läuft noch — das bricht die Serie noch nicht.
      continue;
    } else {
      break;
    }
  }
  return streak;
}

function buildSnapshot(store, tracker, dateKey) {
  const key = dateKey || dayKey();
  const isToday = key === dayKey();
  const viewed = store.day(key);
  // Manche Felder (projection.wasted) müssen an den echten heutigen Tag
  // gebunden bleiben, unabhängig vom angeforderten dateKey. Wenn der
  // angezeigte Tag bereits heute ist, ist `viewed` identisch — sonst wird
  // der echte heutige Tagesdatensatz separat geladen.
  const todayData = isToday ? viewed : store.day();
  const goals = store.data.goals;
  const settings = store.data.settings;
  const current = tracker.current || {};

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
    current,
    today: {
      total: viewed.total,
      productive: viewed.productive,
      neutral: viewed.neutral,
      wasted: viewed.wasted,
      inactive: viewed.inactive,
      score: focusScore(viewed),
      // Wohin die laufende Taetigkeit den Score zieht. Nur heute und nur bei
      // laufendem Tracking bewegt sich ueberhaupt etwas.
      trend: isToday && tracker.running ? scoreTrend(viewed, current.category) : null,
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
      wasted: project(todayData.wasted),
      // Was das gesetzte Limit über ein Jahr bedeuten würde.
      limitDaysPerYear: (budgetSeconds * WORK_DAYS_PER_YEAR) / 86400,
      goalHoursPerYear: (goalSeconds * WORK_DAYS_PER_YEAR) / 3600,
    },
    // Die Einträge stehen separat in hourItems, damit hours schlank bleibt.
    hours: viewed.hours.map(({ p, n, w, i }) => ({ p, n, w, i })),
    hourItems: hourItems(viewed.hours),
    // Erste Stunde des Tagesverlaufs; ältere Tage liefen noch ab Mitternacht.
    dayStart: viewed.dayStart || 0,
    appLanes: appLanes(viewed.hours),
    // Uhrzeit, zu der Ziel bzw. Budget erreicht wurde; null, wenn noch nicht
    // oder wenn der Zeitpunkt nicht bekannt ist (dann zeigt goals, dass ja).
    milestones: {
      goalAt: clockTime((viewed.milestones || {}).goalAt),
      budgetAt: clockTime((viewed.milestones || {}).budgetAt),
    },
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

module.exports = { buildSnapshot, focusScore, scoreTrend, project, appLanes };
