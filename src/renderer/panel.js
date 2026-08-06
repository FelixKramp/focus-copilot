'use strict';

/* Menüleisten-Vorschau: dieselben Daten wie das Dashboard, auf einen Blick. */

const $ = (id) => document.getElementById(id);

const CAT_LABEL = {
  productive: 'PRODUKTIV',
  neutral: 'NEUTRAL',
  wasted: 'PROKRASTINATION',
  inactive: 'NICHT AM PC',
};

function fmt(seconds) {
  const min = Math.round((seconds || 0) / 60);
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} Std` : `${h} Std ${m} Min`;
}

/**
 * Was gerade läuft, in einem Satz. Wenn ein Video ohne Interaktion spielt,
 * steht vorne oft kein sinnvoller Prozess — dann sagen wir das auch so,
 * statt eine leere Zeile zu zeigen.
 */
function describeCurrent(cur) {
  if (cur.idle) return 'Nicht am PC';
  if (cur.domain || cur.app) return cur.domain || cur.app;
  if (cur.media) return 'Video läuft im Hintergrund';
  return 'Warte auf Aktivität …';
}

function render(s) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const ring = $('ring');
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - Math.min(1, s.today.score / 100)));
  $('score').textContent = String(s.today.score);

  $('statusText').textContent = s.tracking ? 'System online' : 'Aufzeichnung pausiert';
  $('statusDot').classList.toggle('is-paused', !s.tracking);
  $('btnTracking').textContent = s.tracking ? 'PAUSE' : 'START';

  $('total').textContent = fmt(s.today.total);
  $('productive').textContent = fmt(s.today.productive);
  $('wasted').textContent = fmt(s.today.wasted);
  $('idle').textContent = fmt(s.today.inactive);

  $('goalLabel').textContent = `Produktiv-Ziel ${fmt(s.goals.productiveMinutes * 60)}`;
  $('goalPct').textContent = `${Math.round(s.goals.productiveProgress * 100)} %`;
  $('goalBar').style.width = `${Math.min(100, s.goals.productiveProgress * 100)}%`;

  // Meistgenutzte App des Tages
  const top = s.apps && s.apps[0];
  const icon = $('topIcon');
  if (top) {
    $('topApp').textContent = top.name;
    $('topTime').textContent = fmt(top.seconds);
    window.copilot.getAppIcon(top.name).then((dataUrl) => {
      if (dataUrl) { icon.src = dataUrl; icon.hidden = false; } else { icon.hidden = true; }
    });
  } else {
    $('topApp').textContent = 'Noch nichts erfasst';
    $('topTime').textContent = '';
    icon.hidden = true;
  }

  // Aktueller Kontext
  const cur = s.current || {};
  const cat = cur.idle ? 'inactive' : (cur.category || 'neutral');
  $('currentName').textContent = describeCurrent(cur);
  const pill = $('currentPill');
  pill.textContent = CAT_LABEL[cat] || 'NEUTRAL';
  pill.className = 'pill is-' + (cat === 'inactive' ? 'idle' : cat);
}

$('btnDashboard').addEventListener('click', () => window.copilot.openDashboard());
$('btnTracking').addEventListener('click', () => window.copilot.toggleTracking());
$('btnQuit').addEventListener('click', () => window.copilot.quitApp());

// Escape schließt die Vorschau, wie man es von Menüleisten-Fenstern kennt.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.copilot.closePanel();
});

window.copilot.onNotch((left) => {
  document.querySelector('.notch').style.left = `${left}px`;
});

window.copilot.onSnapshot(render);
window.copilot.getSnapshot().then(render);
