'use strict';

/* Mini-Fenster: dieselben Daten wie das Dashboard, nur auf das Nötigste gekürzt. */

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
  return m === 0 ? `${h} Std` : `${h}:${String(m).padStart(2, '0')} Std`;
}

function render(s) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const ring = $('ring');
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - Math.min(1, s.today.score / 100)));

  $('score').textContent = String(s.today.score);
  $('productive').textContent = fmt(s.today.productive);
  $('wasted').textContent = fmt(s.today.wasted);

  const cur = s.current || {};
  const cat = cur.idle ? 'inactive' : (cur.category || 'neutral');
  const pill = $('pill');
  pill.textContent = CAT_LABEL[cat] || 'NEUTRAL';
  pill.className = 'pill is-' + (cat === 'inactive' ? 'idle' : cat);

  $('now').textContent = cur.idle
    ? 'Nicht am PC'
    : (cur.domain || cur.app || 'Warte auf Aktivität …');

  $('goalBar').style.width = `${Math.min(100, s.goals.productiveProgress * 100)}%`;

  for (const btn of document.querySelectorAll('.corners button')) {
    btn.classList.toggle('active', btn.dataset.corner === s.settings.miniCorner);
  }
}

$('btnClose').addEventListener('click', () => window.copilot.closeMini());
$('btnOpen').addEventListener('click', () => window.copilot.openDashboard());

for (const btn of document.querySelectorAll('.corners button')) {
  btn.addEventListener('click', () => window.copilot.setMiniCorner(btn.dataset.corner));
}

window.copilot.onSnapshot(render);
window.copilot.getSnapshot().then(render);
