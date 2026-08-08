'use strict';

const { dayKey } = require('./store');
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

function buildSnapshot(store, tracker) {
  const today = store.day();
  const goals = store.data.goals;
  const settings = store.data.settings;

  const goalSeconds = goals.productiveMinutes * 60;
  const budgetSeconds = goals.maxWasteMinutes * 60;

  const last7 = store.lastDays(7).map(({ key, date, data }) => ({
    key,
    label: date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''),
    productive: data.productive,
    neutral: data.neutral,
    wasted: data.wasted,
    goalReached: goalSeconds > 0 && data.productive >= goalSeconds,
  }));

  const last14 = store.lastDays(14).map(({ key, date, data }) => ({
    key,
    label: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    score: focusScore(data),
    hasData: data.total > 0,
  }));

  return {
    generatedAt: Date.now(),
    date: {
      key: dayKey(),
      label: new Date()
        .toLocaleDateString('de-DE', {
          weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
        })
        .replace(',', ''),
    },
    tracking: tracker.running,
    current: tracker.current,
    today: {
      total: today.total,
      productive: today.productive,
      neutral: today.neutral,
      wasted: today.wasted,
      inactive: today.inactive,
      score: focusScore(today),
    },
    goals: {
      productiveMinutes: goals.productiveMinutes,
      maxWasteMinutes: goals.maxWasteMinutes,
      productiveProgress: goalSeconds > 0 ? Math.min(1, today.productive / goalSeconds) : 0,
      budgetProgress: budgetSeconds > 0 ? Math.min(1, today.wasted / budgetSeconds) : 0,
      budgetExceeded: budgetSeconds > 0 && today.wasted > budgetSeconds,
      streak: computeStreak(store),
    },
    projection: {
      wasted: project(today.wasted),
      // Was das gesetzte Limit über ein Jahr bedeuten würde.
      limitDaysPerYear: (budgetSeconds * WORK_DAYS_PER_YEAR) / 86400,
      goalHoursPerYear: (goalSeconds * WORK_DAYS_PER_YEAR) / 3600,
    },
    hours: today.hours,
    last7,
    last14,
    apps: topList(today.apps, 6),
    domains: topList(today.domains, 6),
    youtube: topYoutube(today.youtube, 5),
    overrides: store.data.overrides,
    settings,
  };
}

module.exports = { buildSnapshot, focusScore, project };
