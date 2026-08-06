'use strict';

const EventEmitter = require('events');
const { powerMonitor } = require('electron');
const { getFrontmost, isMediaPlaying } = require('./monitor');
const {
  classify, domainFromUrl, youtubeIdFromUrl, isIgnoredProcess, BROWSERS,
} = require('./classify');

const TICK_SECONDS = 3;
const BROWSER_SET = new Set(BROWSERS);

/**
 * Der Tracker pollt im Sekundentakt, was gerade vorne ist, stuft es ein und
 * schreibt es in den Store.
 *
 * Kernregel aus dem Konzept: Wenn ich nichts tue, zählt das als "nicht am PC"
 * — ES SEI DENN, es läuft ein Video. Dann ist es Prokrastination, keine
 * Inaktivität.
 */
class Tracker extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.timer = null;
    this.busy = false;

    /** Aktueller Zustand für Mini-Fenster und Kopfzeile. */
    this.current = { app: '', title: '', domain: '', category: 'neutral', idle: false };

    /** Zusammenhängende Prokrastinations-Sekunden (für die Push-Nachricht). */
    this.wasteStreakSeconds = 0;
    this.lastNudgeAt = 0;
    this.goalNotifiedForDay = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_SECONDS * 1000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current = { app: '', title: '', domain: '', category: 'neutral', idle: false };
    this.emit('update');
  }

  get running() {
    return Boolean(this.timer);
  }

  async tick() {
    if (this.busy) return; // Ein langsamer osascript-Aufruf soll sich nicht stapeln.
    this.busy = true;
    try {
      await this.sample();
    } catch (err) {
      console.error('[tracker] tick fehlgeschlagen:', err.message);
    } finally {
      this.busy = false;
    }
  }

  async sample() {
    const settings = this.store.data.settings;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const front = await getFrontmost();

    // Dock, Kontrollzentrum & Co. übernehmen kurz den Vordergrund — das ist
    // keine Nutzung, also lassen wir den Tick einfach fallen.
    if (isIgnoredProcess(front.app) && idleSeconds < settings.idleThresholdSeconds) return;

    const domain = domainFromUrl(front.url);
    const isBrowser = BROWSER_SET.has(String(front.app).toLowerCase());
    // Nur im Browser zählt die Domain; sonst die App selbst.
    const ctxDomain = isBrowser ? domain : '';

    if (idleSeconds >= settings.idleThresholdSeconds) {
      // Läuft trotz Untätigkeit ein Video? Dann ist es Prokrastination.
      const media = await isMediaPlaying();
      if (media) {
        const { category } = classify({ app: front.app, domain: ctxDomain }, this.store.data.overrides);
        // Ein laufendes Video ohne Interaktion ist Prokrastination — auch wenn
        // die Domain sonst als produktiv gelten würde.
        const effective = category === 'productive' ? 'productive' : 'wasted';
        this.commit(effective, front, ctxDomain, { idle: false, media: true });
        return;
      }
      this.store.record(TICK_SECONDS, 'inactive');
      this.current = {
        app: front.app, title: front.title, domain: ctxDomain,
        category: 'inactive', idle: true,
      };
      this.wasteStreakSeconds = 0;
      this.emit('update');
      return;
    }

    const { category } = classify({ app: front.app, domain: ctxDomain }, this.store.data.overrides);
    this.commit(category, front, ctxDomain, { idle: false, media: false });
  }

  commit(category, front, ctxDomain, flags) {
    const ctx = { app: front.app || undefined, domain: ctxDomain || undefined };

    const ytId = youtubeIdFromUrl(front.url);
    if (ytId) {
      // Der Fenstertitel endet meist auf " - YouTube" — das schneiden wir weg.
      const title = String(front.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
      ctx.youtube = { id: ytId, title };
    }

    this.store.record(TICK_SECONDS, category, ctx);

    this.current = {
      app: front.app,
      title: front.title,
      domain: ctxDomain,
      category,
      idle: false,
      media: Boolean(flags.media),
    };

    this.trackWasteStreak(category);
    this.checkGoalReached();
    this.emit('update');
  }

  /** Zusammenhängende Prokrastination beobachten und ggf. anstupsen. */
  trackWasteStreak(category) {
    const settings = this.store.data.settings;
    if (category !== 'wasted') {
      this.wasteStreakSeconds = 0;
      return;
    }
    this.wasteStreakSeconds += TICK_SECONDS;

    if (!settings.notifications) return;
    const threshold = settings.nudgeMinutes * 60;
    if (this.wasteStreakSeconds < threshold) return;

    // Höchstens alle 10 Minuten nerven.
    const now = Date.now();
    if (now - this.lastNudgeAt < 10 * 60 * 1000) return;
    this.lastNudgeAt = now;
    this.emit('nudge', {
      minutes: Math.round(this.wasteStreakSeconds / 60),
      app: this.current.domain || this.current.app,
    });
  }

  /** Einmal pro Tag melden, wenn das Produktiv-Ziel erreicht ist. */
  checkGoalReached() {
    const settings = this.store.data.settings;
    if (!settings.notifications) return;

    const day = this.store.day();
    const goalSeconds = this.store.data.goals.productiveMinutes * 60;
    if (goalSeconds <= 0 || day.productive < goalSeconds) return;

    const { dayKey } = require('./store');
    const key = dayKey();
    if (this.goalNotifiedForDay === key) return;
    this.goalNotifiedForDay = key;
    this.emit('goal-reached', { minutes: Math.round(day.productive / 60) });
  }
}

module.exports = { Tracker, TICK_SECONDS };
