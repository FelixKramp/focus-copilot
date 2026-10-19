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
 *                trayScore, theme, view, dockIcon }
 */

const DEFAULT_GOALS = { productiveMinutes: 180, maxWasteMinutes: 60 };

const DEFAULT_SETTINGS = {
  notifications: true,
  nudgeMinutes: 10,
  tracking: true,
  idleThresholdSeconds: 60,
  // Score und Trendpfeil neben dem Menueleisten-Icon.
  trayScore: true,
  theme: 'jarvis',
  // Ansicht des Dashboards: 'overview' (Karten) oder 'disc' (Scheibe).
  view: 'overview',
  // Aus: die App lebt nur in der Menüleiste, ohne Dock-Icon und Cmd-Tab-Eintrag.
  dockIcon: false,
};

const VIEWS = ['overview', 'disc'];

/** Die Designs zur Auswahl, mit der Fensterfarbe, die vor dem ersten
    Zeichnen sichtbar ist (sonst blitzt beim Öffnen das falsche Theme auf). */
const THEMES = {
  jarvis: { label: 'JARVIS', background: '#050d11' },
  'jarvis-hell': { label: 'JARVIS hell', background: '#eaf3f6' },
  mischpult: { label: 'Mischpult', background: '#141312' },
  // Tacho: das Design der Scheibe, hell wie Papier oder dunkel für abends.
  tacho: { label: 'Tacho', background: '#e9ece9' },
  'tacho-dunkel': { label: 'Tacho dunkel', background: '#101418' },
};

function defaultRecords() {
  return {
    bestDayScore: { score: 0, key: null },
    bestWeekAvg: { score: 0, key: null },
  };
}

/**
 * Der Tag wechselt um 4 Uhr morgens, nicht um Mitternacht. Wer um 23:30 noch
 * arbeitet und um 0:30 aufhört, hat einen Abend gehabt, keine zwei Tage —
 * mit Mitternacht als Grenze stand der Score um 0:00 plötzlich wieder auf 0.
 */
const DAY_START_HOUR = 4;

/** Eine Stunde im Tagesverlauf. `items` hält, was in der Stunde lief:
    { "app:Logic Pro": { sec, cat }, "domain:github.com": { sec, cat } }. */
function emptyHour() {
  return { p: 0, n: 0, w: 0, i: 0, items: {} };
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
    hours: Array.from({ length: 24 }, emptyHour),
    // Ab welcher Uhrzeit dieser Tag läuft. Tage von vor der 4-Uhr-Umstellung
    // haben das Feld nicht und liefen von 0 bis 24 Uhr.
    dayStart: DAY_START_HOUR,
    // Wann heute das Produktiv-Ziel erreicht (goalAt) und das Budget
    // aufgebraucht war (budgetAt), als Zeitstempel in ms.
    milestones: {},
  };
}

/** Kalenderdatum als YYYY-MM-DD, ohne Tageswechsel-Verschiebung. */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Zu welchem Tag ein Zeitpunkt gehört, als YYYY-MM-DD in lokaler Zeit (nicht
 * UTC — der Tag soll dem Nutzer entsprechen). Vor DAY_START_HOUR zählt noch
 * zum Vortag: Montag 1:30 Uhr → "Sonntag".
 *
 * Über die Uhrzeit statt über "minus 4 Stunden" gerechnet, damit die
 * Zeitumstellung nicht eine Stunde falsch zuordnet.
 */
function dayKey(d = new Date()) {
  const x = new Date(d);
  if (x.getHours() < DAY_START_HOUR) x.setDate(x.getDate() - 1);
  return dateKey(x);
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
          day.hours = Array.from({ length: 24 }, emptyHour);
        }
        day.youtube = day.youtube || {};
        day.apps = day.apps || {};
        day.domains = day.domains || {};
        day.milestones = day.milestones || {};
      }
    } catch {
      // Erster Start oder beschädigte Datei — mit Defaults weitermachen.
    }

    this.migrateDayStart();

    // Jeden gesetzten Override erneut anwenden. Deckt zwei Fälle ab: Daten,
    // die vor einem Fix an reclassify() geschrieben wurden, und den Fall,
    // dass der letzte Tick vor dem Neustart schon unter dem Override hätte
    // laufen sollen, aber noch die alte Kategorie trug.
    for (const [key, category] of Object.entries(this.data.overrides)) {
      this.reclassify(key, category);
    }
  }

  /**
   * Umstieg auf den 4-Uhr-Tageswechsel. Läuft bei jedem Start, tut aber nur
   * beim ersten etwas:
   *
   * - Ein Tag "aus der Zukunft" kann nur entstehen, wenn die alte Version
   *   nach Mitternacht schon den neuen Tag angelegt hat. Nach der neuen Regel
   *   gehört diese Zeit noch zu heute, also wird sie dort aufaddiert.
   * - Ist der laufende Tag noch im alten Format, aber zwischen 0 und 4 Uhr
   *   leer, kann er ohne Konflikt auf den neuen Start umgestellt werden.
   *   Sonst bleibt er bis zum nächsten Tageswechsel im alten Format.
   */
  migrateDayStart() {
    const today = dayKey();
    for (const key of Object.keys(this.data.days)) {
      if (key <= today) continue;
      mergeDay(this.day(today), this.data.days[key]);
      delete this.data.days[key];
    }

    const current = this.data.days[today];
    if (current && current.dayStart === undefined) {
      const earlyEmpty = current.hours
        .slice(0, DAY_START_HOUR)
        .every((h) => !(h.p || h.n || h.w || h.i));
      if (earlyEmpty) current.dayStart = DAY_START_HOUR;
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

    const before = { productive: day.productive, wasted: day.wasted };

    // "total" ist die Zeit aktiv am Rechner — Inaktivität zählt bewusst nicht mit.
    day.total += seconds;
    if (category === 'productive') { day.productive += seconds; bucket.p += seconds; }
    else if (category === 'wasted') { day.wasted += seconds; bucket.w += seconds; }
    else { day.neutral += seconds; bucket.n += seconds; }

    // Pro Stunde zählt pro Tick genau ein Eintrag: im Browser die Website,
    // sonst die App — so summieren sich die Einträge zur Stunde auf, statt
    // Browserzeit doppelt zu führen. Stunden von vor dem Update haben noch
    // kein items-Feld; das entsteht dann hier.
    const itemKey = ctx.domain ? `domain:${ctx.domain}` : ctx.app ? `app:${ctx.app}` : null;
    if (itemKey) {
      const items = bucket.items || (bucket.items = {});
      const rec = items[itemKey] || (items[itemKey] = { sec: 0, cat: category });
      rec.sec += seconds;
      rec.cat = category;
    }

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
    this.checkMilestones(day, before);

    if (ctx.youtube && ctx.youtube.id) {
      const rec = day.youtube[ctx.youtube.id] || (day.youtube[ctx.youtube.id] = { sec: 0, title: '' });
      rec.sec += seconds;
      if (ctx.youtube.title) rec.title = ctx.youtube.title;
    }

    this.checkRecords();
    this.save();
  }

  /**
   * Merkt sich den Zeitpunkt, an dem das Ziel bzw. das Budget erreicht wurde —
   * nur im Tick, der die Schwelle überschreitet. Wird ein Meilenstein gelöscht
   * (neues Ziel, Umstufung), während die Schwelle schon überschritten ist,
   * bleibt er leer: Dann weiß man, dass, aber nicht wann. Das ist ehrlicher als
   * ein Zeitpunkt, der nur dem nächsten Tick entspricht.
   */
  checkMilestones(day, before) {
    const ms = day.milestones || (day.milestones = {});
    const goal = this.data.goals.productiveMinutes * 60;
    const budget = this.data.goals.maxWasteMinutes * 60;
    if (!ms.goalAt && goal > 0 && before.productive < goal && day.productive >= goal) {
      ms.goalAt = Date.now();
    }
    if (!ms.budgetAt && budget > 0 && before.wasted < budget && day.wasted >= budget) {
      ms.budgetAt = Date.now();
    }
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
   * Der Tagesverlauf wird mit angepasst, soweit die Stunde weiss, was in ihr
   * lief (seit dem Update mit den Stunden-Details). Ältere Stunden haben nur
   * Summen und bleiben, wie sie sind.
   */
  reclassify(key, category) {
    const sep = key.indexOf(':');
    if (sep === -1) return;
    const kind = key.slice(0, sep);
    const wanted = key.slice(sep + 1); // schon kleingeschrieben, siehe Schlüssel-Erzeugung
    const bucketName = kind === 'domain' ? 'domains' : 'apps';

    for (const day of Object.values(this.data.days)) {
      // Verschobene Minuten machen die gemerkten Zeitpunkte falsch.
      if (reclassifyHours(day, kind, wanted, category, this.data.overrides)) day.milestones = {};

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
      day.milestones = {};
    }
  }

  setGoals(goals) {
    const prev = this.data.goals;
    this.data.goals = { ...prev, ...goals };
    // Mit einem anderen Ziel stimmt der alte Zeitpunkt nicht mehr.
    const ms = this.day().milestones;
    if (this.data.goals.productiveMinutes !== prev.productiveMinutes) delete ms.goalAt;
    if (this.data.goals.maxWasteMinutes !== prev.maxWasteMinutes) delete ms.budgetAt;
    this.flush();
  }

  setSettings(settings) {
    const next = { ...settings };
    if ('theme' in next && !THEMES[next.theme]) delete next.theme;
    if ('view' in next && !VIEWS.includes(next.view)) delete next.view;
    this.data.settings = { ...this.data.settings, ...next };
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
      // date aus dem Schlüssel, nicht d: um 1 Uhr ist d schon Dienstag, der
      // Tag aber noch Montag — sonst stimmt die Wochentag-Beschriftung nicht.
      out.push({ key, date: parseDayKey(key), data: this.data.days[key] || emptyDay() });
    }
    return out;
  }
}

/** Addiert einen Tagesdatensatz in einen anderen (für migrateDayStart()). */
function mergeDay(into, from) {
  for (const f of ['total', 'productive', 'neutral', 'wasted', 'inactive']) {
    into[f] += from[f] || 0;
  }
  for (const map of ['apps', 'domains']) {
    for (const [name, rec] of Object.entries(from[map] || {})) {
      const target = into[map][name] || (into[map][name] = { sec: 0, cat: rec.cat });
      target.sec += rec.sec;
    }
  }
  for (const [id, rec] of Object.entries(from.youtube || {})) {
    const target = into.youtube[id] || (into.youtube[id] = { sec: 0, title: rec.title });
    target.sec += rec.sec;
  }
  (from.hours || []).forEach((h, i) => {
    const target = into.hours[i];
    for (const f of ['p', 'n', 'w', 'i']) target[f] += h[f] || 0;
    for (const [itemKey, rec] of Object.entries(h.items || {})) {
      const items = target.items || (target.items = {});
      const t = items[itemKey] || (items[itemKey] = { sec: 0, cat: rec.cat });
      t.sec += rec.sec;
    }
  });
}

const HOUR_FIELD = { productive: 'p', neutral: 'n', wasted: 'w' };

/** Teil von Store.reclassify(): verschiebt die Zeit eines Eintrags in jeder
    Stunde, in der er vorkommt, in die neue Kategorie. Gibt zurück, ob sich
    etwas geändert hat. */
function reclassifyHours(day, kind, wanted, category, overrides) {
  let changed = false;
  for (const hour of day.hours || []) {
    if (!hour.items) continue;
    for (const [itemKey, rec] of Object.entries(hour.items)) {
      const sep = itemKey.indexOf(':');
      if (itemKey.slice(0, sep) !== kind) continue;
      const name = itemKey.slice(sep + 1);
      if (name.toLowerCase() !== wanted) continue;

      const targetCat = category === 'auto'
        ? classify(kind === 'domain' ? { domain: name } : { app: name }, overrides).category
        : category;
      if (rec.cat === targetCat || !HOUR_FIELD[rec.cat] || !HOUR_FIELD[targetCat]) continue;
      hour[HOUR_FIELD[rec.cat]] -= rec.sec;
      hour[HOUR_FIELD[targetCat]] += rec.sec;
      rec.cat = targetCat;
      changed = true;
    }
  }
  return changed;
}

/** Kehrt dayKey() um: "2026-08-06" → lokales Date-Objekt um Mitternacht. */
function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = {
  Store, dayKey, parseDayKey, emptyDay, DAY_START_HOUR, DEFAULT_GOALS, DEFAULT_SETTINGS, THEMES,
};
