'use strict';

/**
 * Gewicht jeder Kategorie im Fokus-Score. Inaktive Zeit taucht hier bewusst
 * nicht auf — sie zählt gar nicht mit, weder im Zähler noch im Nenner.
 */
const WEIGHTS = { productive: 1, neutral: 0.5, wasted: 0 };

/** Der ungerundete Anteil in Prozent — Grundlage für Score und Trend. */
function exactScore(day) {
  const base = day.productive + day.neutral + day.wasted;
  if (base <= 0) return 0;
  return ((day.productive + day.neutral * 0.5) / base) * 100;
}

/** Fokus-Score: Produktiv zählt voll, neutral halb, Prokrastination gar nicht. */
function focusScore(day) {
  return Math.round(exactScore(day));
}

/**
 * Richtung, in die die laufende Tätigkeit den Tagesscore zieht:
 * 'up' | 'down' | 'flat' — oder null, wenn gerade nichts in den Score einzahlt
 * (Inaktivität, pausiertes Tracking, ein vergangener Tag).
 *
 * Der Score ist ein gewichteter Anteil, jeder Tick zieht ihn also auf das
 * Gewicht seiner Kategorie zu. Damit steht die Richtung sofort fest, ganz ohne
 * Verlauf. Verglichen wird bewusst mit dem ungerundeten Score: sonst zeigte der
 * Pfeil 'flat', während sich die Zahl im Hintergrund längst auf den nächsten
 * Sprung zubewegt.
 */
function scoreTrend(day, category) {
  const weight = WEIGHTS[category];
  if (weight === undefined) return null;

  const target = weight * 100;
  const current = exactScore(day);

  if (target > current) return 'up';
  if (target < current) return 'down';
  return 'flat';
}

module.exports = { focusScore, scoreTrend };
