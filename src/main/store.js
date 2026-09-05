'use strict';

const fs = require('fs');
const path = require('path');
const { classify } = require('./classify');
const { focusScore } = require('./score');

/**
 * Persistenz. Alles bleibt lokal in einer einzigen JSON-Datei unter
 * ~/Library/Application Support/Focus Co-Pilot/data.json
 *
 * Aufbau:
 *   days:      { "2026-08-06": DayRecord }
 *   overrides: { "app:final cut pro": "productive", "domain:youtube.com": "wasted" }
 *   goals:     { productiveMinutes, maxWasteMinutes }
 *   settings:  { notifications, nudgeMinutes, tracking, idleThresholdSeconds,
 *                trayScore }
 */

const DEFAULT_GOALS = { productiveMinutes: 180, maxWasteMinutes: 60 };

const DEFAULT_SETTINGS = {
  notifications: true,
  nudgeMinutes: 10,
  tracking: true,
  idleThresholdSeconds: 60,
  // Score und Trendpfeil neben dem Menueleisten-Icon.
  trayScore: true,
};

function defaultRecords() {
  return {
    bestDayScore: { score: 0, key: null },
    bestWeekAvg: { score: 0, key: null },
  };
}

function emptyDay() {
  return {
    total: 0,
    productive: 0,
    neutral: 0,
    wasted: 0,
    inactive: 0,
    apps: {},
    domains: {},
    youtube: {},
    hours: Array.from({ length: 24 }, () => ({ p: 0, n: 0, w: 0, i: 0 })),
  };
}

/** Lokales Datum als YYYY-MM-DD (nicht UTC — der Tag soll dem Nutzer entsprechen). */
function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'data.json');
    this.dir = dir;
    this.data = {
      days: {},
      overrides: {},
      goals: { ...DEFAULT_GOALS },
      settings: { ...DEFAULT_SETTINGS },
      records: defaultRecords(),
      pendingRecord: null,
    };
    this._saveTimer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
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
      // Ältere Datensätze könnten das hours-Array noch nicht haben.
      for (const day of Object.values(this.data.days)) {
        if (!Array.isArray(day.hours) || day.hours.length !== 24) {
          day.hours = Array.from({ length: 24 }, () => ({ p: 0, n: 0, w: 0, i: 0 }));
        }
        day.youtube = day.youtube || {};
        day.apps = day.apps || {};
        day.domains = day.domains || {};
      }
    } catch {
      // Erster Start oder beschädigte Datei — mit Defaults weitermachen.
    }

    // Jeden gesetzten Override erneut anwenden. Deckt zwei Fälle ab: Daten,
    // die vor einem Fix an reclassify() geschrieben wurden, und den Fall,
    // dass der letzte Tick vor dem Neustart schon unter dem Override hätte
    // laufen sollen, aber noch die alte Kategorie trug.
    for (const [key, category] of Object.entries(this.data.overrides)) {
      this.reclassify(key, category);
    }
  }

  /** Gepufferter Schreibvorgang, damit wir nicht bei jedem Tick auf die Platte gehen. */
  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 4000);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file); // atomar — kein halb geschriebener Stand
    } catch (err) {
      console.error('[store] Speichern fehlgeschlagen:', err.message);
    }
  }

  day(key = dayKey()) {
    if (!this.data.days[key]) this.data.days[key] = emptyDay();
    return this.data.days[key];
  }

  /**
   * Schreibt einen Tick in den Tagesdatensatz.
   *
   * @param {number} seconds   Dauer des Ticks
   * @param {'productive'|'neutral'|'wasted'|'inactive'} category
   * @param {{app?: string, domain?: string, youtube?: {id: string, title: string}}} ctx
   */
  record(seconds, category, ctx = {}) {
    const day = this.day();
    const hour = new Date().getHours();
    const bucket = day.hours[hour];

    if (category === 'inactive') {
      day.inactive += seconds;
      bucket.i += seconds;
      this.checkRecords();
      this.save();
      return;
    }

    // "total" ist die Zeit aktiv am Rechner — Inaktivität zählt bewusst nicht mit.
    day.total += seconds;
    if (category === 'productive') { day.productive += seconds; bucket.p += seconds; }
    else if (category === 'wasted') { day.wasted += seconds; bucket.w += seconds; }
    else { day.neutral += seconds; bucket.n += seconds; }

    if (ctx.app) {
      const rec = day.apps[ctx.app] || (day.apps[ctx.app] = { sec: 0, cat: category });
      rec.sec += seconds;
      rec.cat = category;
    }
    if (ctx.domain) {
      const rec = day.domains[ctx.domain] || (day.domains[ctx.domain] = { sec: 0, cat: category });
      rec.sec += seconds;
      rec.cat = category;
    }
    if (ctx.youtube && ctx.youtube.id) {
      const rec = day.youtube[ctx.youtube.id] || (day.youtube[ctx.youtube.id] = { sec: 0, title: '' });
      rec.sec += seconds;
      if (ctx.youtube.title) rec.title = ctx.youtube.title;
    }

    this.checkRecords();
    this.save();
  }

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

  setOverride(key, category) {
    if (category === 'auto') delete this.data.overrides[key];
    else this.data.overrides[key] = category;
    this.reclassify(key, category);
    this.checkRecords();
    this.flush();
  }

  /**
   * Wendet eine geänderte Einstufung rückwirkend auf bereits erfasste Zeit an.
   * Ohne das würde z. B. eine App, die man gerade erst auf "Produktiv" gesetzt
   * hat, für den Rest des Tages weiter als Zeitverschwendung geführt — der
   * Override würde nur für künftige Ticks greifen, nicht für die schon
   * gezählten Minuten.
   *
   * Einschränkung: Die stündliche Tagesverlauf-Grafik speichert nicht, welche
   * App in welcher Stunde lief — nur die Tagessumme pro App. Sie wird darum
   * bewusst nicht rückwirkend angepasst; alle anderen Ansichten (Heute,
   * Fokus-Reaktor, Verteilung, Ranglisten, Wochen-/Trend-Charts) schon, weil
   * die auf den Tagessummen basieren.
   */
  reclassify(key, category) {
    const sep = key.indexOf(':');
    if (sep === -1) return;
    const kind = key.slice(0, sep);
    const wanted = key.slice(sep + 1); // schon kleingeschrieben, siehe Schlüssel-Erzeugung
    const bucketName = kind === 'domain' ? 'domains' : 'apps';

    for (const day of Object.values(this.data.days)) {
      const bucket = day[bucketName];
      if (!bucket) continue;

      // Bucket-Schlüssel behalten die Original-Schreibweise (z. B. "Pianoteq 9"),
      // der Override-Schlüssel ist dagegen immer kleingeschrieben — deshalb hier
      // case-insensitiv suchen statt direkt zu indizieren.
      const actualName = Object.keys(bucket).find((n) => n.toLowerCase() === wanted);
      if (!actualName) continue;
      const rec = bucket[actualName];

      const targetCat = category === 'auto'
        ? classify(kind === 'domain' ? { domain: actualName } : { app: actualName }, this.data.overrides).category
        : category;

      if (rec.cat === targetCat) continue;
      day[rec.cat] -= rec.sec;
      day[targetCat] += rec.sec;
      rec.cat = targetCat;
    }
  }

  setGoals(goals) {
    this.data.goals = { ...this.data.goals, ...goals };
    this.flush();
  }

  setSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
    this.flush();
  }

  /** Die letzten n Tage (ältester zuerst), immer inklusive heute. */
  lastDays(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = dayKey(d);
      out.push({ key, date: d, data: this.data.days[key] || emptyDay() });
    }
    return out;
  }
}

/** Kehrt dayKey() um: "2026-08-06" → lokales Date-Objekt um Mitternacht. */
function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = {
  Store, dayKey, parseDayKey, emptyDay, DEFAULT_GOALS, DEFAULT_SETTINGS,
};
