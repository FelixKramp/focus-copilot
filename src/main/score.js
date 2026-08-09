'use strict';

/** Fokus-Score: Produktiv zählt voll, neutral halb, Prokrastination gar nicht. */
function focusScore(day) {
  const base = day.productive + day.neutral + day.wasted;
  if (base <= 0) return 0;
  return Math.round(((day.productive + day.neutral * 0.5) / base) * 100);
}

module.exports = { focusScore };
