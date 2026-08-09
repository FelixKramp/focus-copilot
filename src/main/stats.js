'use strict';

const { dayKey, parseDayKey } = require('./store');
const { focusScore } = require('./score');

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
      wasted: project(todayData.wasted),
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

module.exports = { buildSnapshot, focusScore, project };
