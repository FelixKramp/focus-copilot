'use strict';

/**
 * Automatische Einstufung von Apps und Websites in:
 *   'productive' | 'neutral' | 'wasted'
 *
 * Alles wird per Default automatisch eingestuft. Der Nutzer kann jede App und
 * jede Domain manuell überschreiben (siehe overrides im Store) — die manuelle
 * Einstufung gewinnt immer.
 */

const PRODUCTIVE_APPS = [
  'final cut pro', 'final cut', 'motion', 'compressor', 'adobe premiere pro',
  'after effects', 'davinci resolve', 'logic pro', 'ableton live', 'photoshop',
  'illustrator', 'indesign', 'lightroom', 'affinity photo', 'affinity designer',
  'blender', 'cinema 4d', 'sketch', 'figma', 'framer',
  'xcode', 'visual studio code', 'code', 'cursor', 'zed', 'sublime text',
  'intellij idea', 'webstorm', 'pycharm', 'android studio', 'nova',
  'terminal', 'iterm2', 'iterm', 'warp', 'ghostty', 'alacritty',
  'notion', 'obsidian', 'bear', 'craft', 'things', 'omnifocus', 'todoist',
  'pages', 'numbers', 'keynote', 'microsoft word', 'microsoft excel',
  'microsoft powerpoint', 'scrivener', 'ulysses', 'devonthink', 'anki',
  'preview', 'pdf expert', 'zotero', 'mendeley', 'tableau', 'rstudio',
  'claude', 'chatgpt', 'linear', 'jira', 'postman', 'tower', 'fork', 'sourcetree',
];

const NEUTRAL_APPS = [
  'finder', 'systemeinstellungen', 'system settings', 'system preferences',
  'mail', 'spark', 'airmail', 'outlook', 'nachrichten', 'messages',
  'kalender', 'calendar', 'fantastical', 'kontakte', 'contacts',
  'slack', 'microsoft teams', 'zoom', 'zoom.us', 'google meet', 'webex',
  'spotify', 'apple music', 'musik', 'music', 'podcasts', 'überwachung',
  'activity monitor', 'aktivitätsanzeige', 'rechner', 'calculator',
  'notizen', 'notes', 'erinnerungen', 'reminders', 'karten', 'maps',
  'raycast', 'alfred', 'shottr', 'cleanshot x', '1password', 'bitwarden',
  'focus co-pilot', 'transmit', 'cyberduck', 'the unarchiver', 'keka',
];

const WASTED_APPS = [
  'tiktok', 'instagram', 'facebook', 'twitter', 'x', 'reddit', 'snapchat',
  'netflix', 'disney+', 'prime video', 'twitch', 'youtube', 'tv',
  'steam', 'epic games launcher', 'battle.net', 'league of legends',
  'minecraft', 'roblox', 'discord', 'whatsapp', 'telegram', 'signal',
  'photo booth', 'game center', 'solitär', 'chess', 'schach',
];

const PRODUCTIVE_DOMAINS = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
  'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'npmjs.com',
  'notion.so', 'linear.app', 'figma.com', 'miro.com', 'canva.com',
  'docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com',
  'claude.ai', 'chatgpt.com', 'chat.openai.com', 'perplexity.ai',
  'overleaf.com', 'scholar.google.com', 'arxiv.org', 'wikipedia.org',
  'coursera.org', 'udemy.com', 'shopify.com', 'stripe.com', 'vercel.com',
  'aws.amazon.com', 'console.cloud.google.com', 'anthropic.com', 'openai.com',
  'atlassian.net', 'asana.com', 'trello.com', 'basecamp.com', 'obsidian.md',
];

const NEUTRAL_DOMAINS = [
  'mail.google.com', 'gmail.com', 'outlook.com', 'outlook.office.com',
  'calendar.google.com', 'web.whatsapp.com', 'app.slack.com',
  'amazon.de', 'amazon.com', 'ebay.de', 'paypal.com', 'dhl.de',
  'google.com', 'duckduckgo.com', 'bing.com', 'ecosia.org',
  'apple.com', 'icloud.com', 'deepl.com', 'translate.google.com',
  'wetter.com', 'bahn.de', 'maps.google.com', 'open.spotify.com',
];

const WASTED_DOMAINS = [
  'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'tiktok.com',
  'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com',
  '9gag.com', 'pinterest.com', 'tumblr.com', 'snapchat.com', 'threads.net',
  'twitch.com', 'disneyplus.com', 'primevideo.com', 'joyn.de', 'rtlplus.de',
  'bild.de', 'spiegel.de', 'focus.de', 'n-tv.de', 'gala.de', 'promiflash.de',
  'kicker.de', 'transfermarkt.de', 'sport1.de', 'chip.de', 'computerbild.de',
  'onlyfans.com', 'pornhub.com', 'xvideos.com', 'xhamster.com',
  'coolmathgames.com', 'poki.com', 'chess.com', 'lichess.org',
];

/** Domains, auf denen typischerweise Videos laufen (für die Inaktivitäts-Logik). */
const MEDIA_DOMAINS = [
  'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'disneyplus.com',
  'primevideo.com', 'vimeo.com', 'dailymotion.com', 'joyn.de', 'ardmediathek.de',
  'zdf.de', 'rtlplus.de', 'crunchyroll.com', 'tiktok.com', 'instagram.com',
  'wakanim.tv', 'mubi.com', 'skyshowtime.com', 'wowtv.de',
];

/** Apps, in denen typischerweise Videos laufen. */
const MEDIA_APPS = [
  'vlc', 'iina', 'quicktime player', 'infuse', 'plex', 'tv', 'netflix',
  'movist', 'mpv', 'elmedia player', 'kodi',
];

/**
 * Prozesse, die kurz den Vordergrund übernehmen, aber keine Nutzung sind
 * (Dock, Kontrollzentrum, Launcher-Helfer …). Ticks darauf werden verworfen.
 */
const IGNORED_PROCESSES = [
  'loginwindow', 'dock', 'systemuiserver', 'spotlight',
  'controlcenter', 'control center', 'notificationcenter', 'notification center',
  'windowmanager', 'screensaverengine', 'coreservicesuiagent', 'universalaccessd',
  'textinputmenuagent', 'airplayuiagent', 'wallpaper', 'finder ', 'talagent',
  'quicklookuiservice', 'securityagent', 'installer progress',
];

const norm = (s) => String(s || '').trim().toLowerCase();

/** Soll dieser Prozess komplett ignoriert werden? */
function isIgnoredProcess(appName) {
  const n = norm(appName);
  if (!n) return true;
  return IGNORED_PROCESSES.includes(n);
}

/** Exakter oder Präfix-Treffer in einer Liste. */
function matchApp(list, appName) {
  const n = norm(appName);
  if (!n) return false;
  return list.some((entry) => n === entry || n.startsWith(entry + ' '));
}

/** Domain-Treffer inklusive Subdomains (www.youtube.com → youtube.com). */
function matchDomain(list, domain) {
  const d = norm(domain);
  if (!d) return false;
  return list.some((entry) => d === entry || d.endsWith('.' + entry));
}

/** Extrahiert die Domain aus einer URL. */
function domainFromUrl(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Zieht die YouTube-Video-ID aus einer URL (für Thumbnails). */
function youtubeIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* ignoriert */
  }
  return null;
}

/** Ist das gerade ein Kontext, in dem ein Video laufen könnte? */
function isMediaContext({ app, domain }) {
  return matchApp(MEDIA_APPS, app) || matchDomain(MEDIA_DOMAINS, domain);
}

/**
 * Einstufung einer Aktivität.
 * @param {{app: string, domain: string}} ctx
 * @param {Record<string,string>} overrides  Schlüssel: "app:<name>" / "domain:<domain>"
 * @returns {{category: 'productive'|'neutral'|'wasted', auto: boolean, key: string}}
 */
function classify(ctx, overrides = {}) {
  const app = norm(ctx.app);
  const domain = norm(ctx.domain);

  // Im Browser zählt die Website, nicht der Browser selbst.
  if (domain) {
    const key = 'domain:' + domain;
    if (overrides[key]) return { category: overrides[key], auto: false, key };
    if (matchDomain(WASTED_DOMAINS, domain)) return { category: 'wasted', auto: true, key };
    if (matchDomain(PRODUCTIVE_DOMAINS, domain)) return { category: 'productive', auto: true, key };
    if (matchDomain(NEUTRAL_DOMAINS, domain)) return { category: 'neutral', auto: true, key };
    return { category: 'neutral', auto: true, key };
  }

  const key = 'app:' + app;
  if (overrides[key]) return { category: overrides[key], auto: false, key };
  if (matchApp(WASTED_APPS, app)) return { category: 'wasted', auto: true, key };
  if (matchApp(PRODUCTIVE_APPS, app)) return { category: 'productive', auto: true, key };
  if (matchApp(NEUTRAL_APPS, app)) return { category: 'neutral', auto: true, key };
  return { category: 'neutral', auto: true, key };
}

module.exports = {
  classify,
  domainFromUrl,
  youtubeIdFromUrl,
  isMediaContext,
  isIgnoredProcess,
  BROWSERS: [
    'safari', 'google chrome', 'chrome', 'arc', 'brave browser', 'microsoft edge',
    'firefox', 'opera', 'vivaldi', 'orion', 'zen browser', 'dia',
  ],
};
