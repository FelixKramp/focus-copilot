'use strict';

/* Designs und Modi, gemeinsam für Main-Prozess, Dashboard und Menüleisten-
   Fenster. Gewählt werden zwei Dinge: das Design (JARVIS, Mischpult, Tacho)
   und der Modus (hell, dunkel oder wie das System). Daraus ergibt sich die
   Variante, die als data-theme am Dokument hängt und die das CSS kennt. */

(function () {
  const DESIGNS = {
    jarvis: {
      label: 'JARVIS',
      dark: { id: 'jarvis', background: '#050d11' },
      light: { id: 'jarvis-hell', background: '#eaf3f6' },
    },
    mischpult: {
      label: 'Mischpult',
      dark: { id: 'mischpult', background: '#141312' },
      light: { id: 'mischpult-hell', background: '#e4e3e0' },
    },
    tacho: {
      label: 'Tacho',
      dark: { id: 'tacho-dunkel', background: '#101418' },
      light: { id: 'tacho', background: '#e9ece9' },
    },
  };

  const MODES = {
    system: 'Wie das System',
    light: 'Hell',
    dark: 'Dunkel',
  };

  /** Varianten ohne HUD-Zierrat: Satzschreibweise, kein Leuchten, keine Laufschrift. */
  const FLAT = ['mischpult', 'mischpult-hell', 'tacho', 'tacho-dunkel'];

  /** Ob dunkel gezeichnet wird. systemDark: ob macOS gerade im Dark Mode ist. */
  function isDark(mode, systemDark) {
    if (mode === 'light') return false;
    if (mode === 'dark') return true;
    return !!systemDark;
  }

  /** Design + Modus → Variante { id, background }. */
  function variant(design, mode, systemDark) {
    const d = DESIGNS[design] || DESIGNS.jarvis;
    return isDark(mode, systemDark) ? d.dark : d.light;
  }

  /** Umkehrung für alte Einstellungen, als die Varianten selbst wählbar waren:
      "tacho-dunkel" → { design: 'tacho', mode: 'dark' }. */
  function fromVariant(id) {
    for (const [design, d] of Object.entries(DESIGNS)) {
      if (d.dark.id === id) return { design, mode: 'dark' };
      if (d.light.id === id) return { design, mode: 'light' };
    }
    return null;
  }

  const api = { DESIGNS, MODES, FLAT, isDark, variant, fromVariant };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.Themes = api;
})();
