'use strict';

/* Geometrie der Scheibe: der Tag als 24-Stunden-Kreis wie auf der Scheibe
   eines Fahrtenschreibers. Reine Funktionen ohne DOM, damit der Smoke-Test sie
   ohne Electron prüfen kann. Alle Maße gelten in einer 600er viewBox.

   Oben steht der Tagesbeginn (dayStart, meist 4 Uhr), dann geht es im
   Uhrzeigersinn Stunde für Stunde weiter. "Position" k ist die wievielte
   Stunde des Tages, nicht die Uhrzeit. */

(function () {
  const C = 300;
  const R0 = 92;
  const R1 = 248;
  /** Abstand der Beschriftungen von der Mitte. */
  const R_LABEL = 276;
  /** Halber Spalt zwischen zwei Speichen, in Grad. */
  const GAP_DEG = 0.9;
  /** Fuge zwischen zwei Kategorien in einer Speiche. */
  const SEAM = 1.5;
  const HOUR_SECONDS = 3600;

  const posOf = (hour, dayStart) => (((hour - dayStart) % 24) + 24) % 24;
  const hourAt = (k, dayStart) => (dayStart + k) % 24;

  function pt(r, deg) {
    const a = (deg * Math.PI) / 180;
    return [Number((C + r * Math.cos(a)).toFixed(1)), Number((C + r * Math.sin(a)).toFixed(1))];
  }

  /** Ringsegment der Speiche k zwischen den Radien ra und rb. */
  function wedge(k, ra, rb) {
    const a0 = k * 15 - 90 + GAP_DEG;
    const a1 = (k + 1) * 15 - 90 - GAP_DEG;
    return `M${pt(ra, a0)}L${pt(rb, a0)}A${rb} ${rb} 0 0 1 ${pt(rb, a1)}`
      + `L${pt(ra, a1)}A${ra} ${ra} 0 0 0 ${pt(ra, a0)}Z`;
  }

  /**
   * Pfade für die ganze Scheibe. hours ist nach echter Uhrzeit indiziert
   * (hours[14] = 14 bis 15 Uhr) und trägt Sekunden je Kategorie (p, n, w).
   * Je weiter eine Speiche nach außen reicht, desto länger war man am Mac;
   * eine volle Stunde reicht bis R1. Andere Radien (r0, r1) braucht die
   * Mini-Scheibe im Menüleisten-Fenster, die eine grössere Nabe hat.
   */
  function discPaths(hours, dayStart, { r0 = R0, r1 = R1 } = {}) {
    const d = { track: '', p: '', n: '', w: '' };
    for (let k = 0; k < 24; k++) {
      d.track += wedge(k, r0, r1);
      const h = hours[hourAt(k, dayStart)];
      if (!h) continue;
      let r = r0;
      for (const c of ['p', 'n', 'w']) {
        const sec = h[c] || 0;
        if (sec <= 0 || r >= r1) continue;
        const rb = Math.min(r1, r + (sec / HOUR_SECONDS) * (r1 - r0));
        d[c] += wedge(k, r, rb);
        r = rb + SEAM;
      }
    }
    return d;
  }

  /** Rahmen um die gewählte Stunde, etwas größer als die Speiche. */
  function selectionPath(hour, dayStart) {
    return wedge(posOf(hour, dayStart), R0 - 4, R1 + 4);
  }

  /** Wie weit der Tag zur Uhrzeit date fortgeschritten ist, in Stunden-Positionen. */
  function dayPosition(date, dayStart) {
    return posOf(date.getHours(), dayStart) + date.getMinutes() / 60 + date.getSeconds() / 3600;
  }

  /** Zeiger auf jetzt: eine Linie von innen nach außen. */
  function needle(date, dayStart, { r0 = R0, r1 = R1 } = {}) {
    const deg = dayPosition(date, dayStart) * 15 - 90;
    const [x1, y1] = pt(r0 - 14, deg);
    const [x2, y2] = pt(r1 + 10, deg);
    return { x1, y1, x2, y2 };
  }

  /** Acht Beschriftungen, alle drei Stunden ab Tagesbeginn. */
  function hourLabels(dayStart) {
    const out = [];
    for (let k = 0; k < 24; k += 3) {
      const [x, y] = pt(R_LABEL, k * 15 - 90);
      out.push({ k, hour: hourAt(k, dayStart), x, y });
    }
    return out;
  }

  /** Welche Stunde unter einem Punkt der viewBox liegt, oder null außerhalb der Speichen. */
  function hourAtPoint(x, y, dayStart) {
    const dx = x - C;
    const dy = y - C;
    const r = Math.hypot(dx, dy);
    if (r < R0 - 4 || r > R1 + 4) return null;
    const deg = (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360;
    return hourAt(Math.floor(deg / 15) % 24, dayStart);
  }

  const api = {
    C, R0, R1, posOf, hourAt, wedge, discPaths, selectionPath, dayPosition, needle, hourLabels, hourAtPoint,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DiscGeometry = api;
})();
