'use strict';

const { execFile } = require('child_process');
const { BROWSERS } = require('./classify');

/** Führt ein osascript aus und liefert stdout (oder '' bei Fehler). */
function osascript(script, timeout = 4000) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || '').trim());
    });
  });
}

const BROWSER_SET = new Set(BROWSERS);

/**
 * Chromium-basierte Browser sprechen alle denselben AppleScript-Dialekt.
 * Safari benutzt "front document", Firefox unterstützt gar kein URL-Scripting.
 */
const CHROMIUM = new Set([
  'google chrome', 'chrome', 'brave browser', 'microsoft edge', 'arc',
  'vivaldi', 'opera', 'dia', 'zen browser',
]);

/**
 * Liest die aktive App und — falls es ein Browser ist — Titel und URL des
 * aktiven Tabs. Ein einziger osascript-Aufruf, damit der Poll günstig bleibt.
 *
 * @returns {Promise<{app: string, title: string, url: string}>}
 */
async function getFrontmost() {
  const appName = await osascript(
    'tell application "System Events" to get name of first application process whose frontmost is true'
  );
  if (!appName) return { app: '', title: '', url: '' };

  const lower = appName.toLowerCase();
  let title = '';
  let url = '';

  if (BROWSER_SET.has(lower)) {
    if (lower === 'safari' || lower === 'orion') {
      const out = await osascript(
        `tell application "${appName}"
           set theURL to ""
           set theTitle to ""
           try
             set theURL to URL of front document
             set theTitle to name of front document
           end try
           return theURL & "\\n" & theTitle
         end tell`
      );
      [url = '', title = ''] = out.split('\n');
    } else if (CHROMIUM.has(lower)) {
      const out = await osascript(
        `tell application "${appName}"
           set theURL to ""
           set theTitle to ""
           try
             set theURL to URL of active tab of front window
             set theTitle to title of active tab of front window
           end try
           return theURL & "\\n" & theTitle
         end tell`
      );
      [url = '', title = ''] = out.split('\n');
    } else {
      // Firefox & Co.: kein URL-Scripting, nur der Fenstertitel.
      title = await osascript(
        `tell application "System Events" to tell process "${appName}"
           try
             return name of front window
           on error
             return ""
           end try
         end tell`
      );
    }
  } else {
    title = await osascript(
      `tell application "System Events" to tell process "${appName}"
         try
           return name of front window
         on error
           return ""
         end try
       end tell`
    );
  }

  return { app: appName, title: title.trim(), url: url.trim() };
}

/**
 * Prüft, ob gerade ein Medien-Playback läuft.
 *
 * macOS hält währenddessen eine "PreventUserIdleDisplaySleep"-Assertion —
 * genau daran erkennen wir zuverlässig, ob ein Video spielt, während der
 * Nutzer nichts tut. Damit landet ein laufendes Video als Prokrastination und
 * nicht als Inaktivität.
 *
 * @returns {Promise<boolean>}
 */
function isMediaPlaying() {
  return new Promise((resolve) => {
    execFile('pmset', ['-g', 'assertions'], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(false);
      const text = String(stdout || '');
      // Zeilen der Form: "  pid 123(Google Chrome): [0x...] 00:12:34 PreventUserIdleDisplaySleep named: ..."
      const lines = text.split('\n').filter((l) => l.includes('PreventUserIdleDisplaySleep'));
      if (!lines.length) return resolve(false);

      // Assertions von Systemprozessen (z. B. während eines Updates) ignorieren.
      const systemOwners = /\((coreaudiod|powerd|WindowServer|backupd|softwareupdated|mediaanalysisd)\)/i;
      const relevant = lines.some((l) => /pid \d+\(/.test(l) && !systemOwners.test(l));
      resolve(relevant);
    });
  });
}

module.exports = { getFrontmost, isMediaPlaying };
