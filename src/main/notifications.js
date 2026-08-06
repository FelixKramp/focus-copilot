'use strict';

const { Notification } = require('electron');

/**
 * Push-Nachrichten, die wehtun sollen — mit Variationen, damit man sie nicht
 * nach zwei Tagen ausblendet.
 */

const NUDGES = [
  { title: 'Sind dir deine Ziele nicht wichtig genug?', body: 'Seit {min} Minuten auf {where}. Hör auf zu prokrastinieren.' },
  { title: 'Das war jetzt {min} Minuten.', body: '{where} zahlt dir kein Gehalt. Zurück an die Arbeit.' },
  { title: 'Fokus verloren.', body: '{min} Minuten auf {where}. Hochgerechnet sind das {perYear} pro Jahr.' },
  { title: 'Ehrliche Frage:', body: 'Wolltest du wirklich {min} Minuten auf {where} verbringen?' },
  { title: 'Dein Zukunfts-Ich schaut zu.', body: '{min} Minuten {where}. Es ist nicht beeindruckt.' },
  { title: 'Kurz mal aufwachen.', body: 'Du bist seit {min} Minuten auf {where}. Das Budget läuft.' },
  { title: 'Immer noch {where}.', body: '{min} Minuten weg. Ein Tab schließen reicht schon.' },
];

const GOAL_MESSAGES = [
  { title: 'Produktiv-Ziel erreicht.', body: '{min} Minuten echte Arbeit heute. Genau so.' },
  { title: 'Tagesziel steht.', body: 'Du hast dein Produktiv-Ziel geknackt: {min} Minuten. Serie läuft.' },
  { title: 'Geschafft.', body: '{min} Minuten produktiv. Alles ab hier ist Bonus.' },
];

const BUDGET_MESSAGES = [
  { title: 'Prokrastinations-Budget aufgebraucht.', body: 'Dein Limit für heute ist durch. Jede Minute ab jetzt zählt doppelt.' },
  { title: 'Budget überzogen.', body: 'Du bist über deinem Tageslimit. Zeit, den Rest des Tages zu retten.' },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? vars[key] : ''));
}

function humanHours(seconds) {
  const hours = seconds / 3600;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} Tage`;
  return `${Math.round(hours)} Stunden`;
}

function show(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

function nudge({ minutes, where }, onClick) {
  const msg = pick(NUDGES);
  const vars = {
    min: minutes,
    where: where || 'Prokrastination',
    perYear: humanHours(minutes * 60 * 365),
  };
  show(fill(msg.title, vars), fill(msg.body, vars), onClick);
}

function goalReached({ minutes }, onClick) {
  const msg = pick(GOAL_MESSAGES);
  const vars = { min: minutes };
  show(fill(msg.title, vars), fill(msg.body, vars), onClick);
}

function budgetBlown(onClick) {
  const msg = pick(BUDGET_MESSAGES);
  show(msg.title, msg.body, onClick);
}

module.exports = { nudge, goalReached, budgetBlown };
