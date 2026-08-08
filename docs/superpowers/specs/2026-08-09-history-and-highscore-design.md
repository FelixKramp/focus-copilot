# Datumsnavigation & Wochen-Highscore

## Kontext

Das Dashboard zeigt aktuell ausschließlich den heutigen Tag. Alle Tagesdaten
werden in `store.data.days` bereits dauerhaft gespeichert (ein Eintrag pro
`YYYY-MM-DD`), aber es gibt keinen Weg, einen früheren Tag anzuschauen — die
Datumsanzeige oben rechts (`.datepill` mit `‹`/`›`) ist rein dekorativ und
nicht verdrahtet. Auslöser: kurz nach Mitternacht möchte man auf den
gerade abgeschlossenen Vortag zurückspringen können, statt nur den frischen,
fast leeren neuen Tag zu sehen.

Zusätzlich soll sichtbar werden, wie sich der Fokus-Score über die letzten 7
Tage verteilt hat, inklusive bestem Einzeltag und bester Wochen-Durchschnitt
("Highscore"), mit einer kleinen Feier-Animation, wenn ein neuer Rekord
erreicht wurde.

## 1. Datumsnavigation

### Datenfluss
- `buildSnapshot(store, tracker, dateKey)` in `src/main/stats.js` bekommt
  einen dritten, optionalen Parameter. Ohne Angabe verhält sich alles wie
  bisher (heutiger Tag).
- Alle tagesbezogenen Snapshot-Felder (`today`, `hours`, `apps`, `domains`,
  `youtube`, `goals.productiveProgress`, `goals.budgetProgress`,
  `goals.budgetExceeded`) beziehen sich auf den angeforderten Tag statt
  immer auf `store.day()`.
- `date.key`/`date.label` zeigen das Datum des angeforderten Tages.
- Neues Feld `date.isToday: boolean`.
- Felder, die inhärent "jetzt" bedeuten, bleiben unverändert an echt-heute
  gebunden: `tracking` (Tracker läuft/pausiert), `current` (aktuell aktive
  App/Domain), `last7`, `last14`, `projection`, `goals.streak`,
  `records`/`pendingRecord` (siehe unten). Diese hängen nicht vom
  angezeigten Tag ab.
- IPC: `ipcMain.handle('snapshot:get', (_e, dateKey) => buildSnapshot(store, tracker, dateKey))`
  in `src/main/main.js`. `preload.js` reicht den optionalen Parameter durch.

### Renderer
- `dashboard.js` hält einen Renderer-State `viewedDate` (Date-Objekt,
  Default: heute).
- `.chev`-Spans bekommen IDs (`prevDay`/`nextDay`) und Klick-Handler:
  - `‹`: `viewedDate` einen Tag zurück, **maximal 29 Tage vor heute**
    (feste Grenze, unabhängig davon ob für den Tag Daten existieren).
    Bei Erreichen der Grenze wird `‹` deaktiviert (`disabled`/`aria-disabled`
    + visuell abgeblendet wie bestehende deaktivierte Buttons).
  - `›`: `viewedDate` einen Tag vor, niemals über den heutigen Tag hinaus;
    bei `viewedDate === heute` deaktiviert.
  - Jeder Klick ruft `window.copilot.getSnapshot(dayKey(viewedDate))` neu ab
    und rendert alle tagesbezogenen Karten neu (Reaktor, Verteilung,
    Meter/Ziele, Apps/YouTube/Websites-Ranglisten, Tagesverlauf).
  - "HEUTE"-Button (`btnToday`, bereits vorhanden) setzt `viewedDate` auf
    heute zurück und ruft den Snapshot ohne Parameter ab.
- Wenn `date.isToday === false`:
  - "Aktueller Kontext"-Streifen (`#currentStrip`) wird ausgeblendet
    (`hidden`), da "was gerade läuft" für einen vergangenen Tag keinen Sinn
    ergibt.
  - Der Pause/Tracking-Button bleibt unverändert nutzbar — er steuert den
    Tracker global, unabhängig vom angezeigten Tag.
  - Die "HEUTE"-Kartenüberschrift (`#cardToday h2`) und `#todayHint` bleiben
    textlich unverändert (Ziel-Fortschritt bezieht sich weiterhin sinnvoll
    auf den angezeigten Tag), da Klick-Einstufung (Kontextmenü) weiterhin
    global über alle Tage wirkt (bestehendes Verhalten von `reclassify`,
    unverändert).
- Auto-Refresh: Das bestehende Live-Update-Intervall (Poll auf
  `snapshot:get`) ruft künftig `getSnapshot(dayKey(viewedDate))` auf (statt
  immer ohne Parameter), damit ein offen gelassener vergangener Tag nicht
  plötzlich auf heute zurückspringt. `current`/`tracking`/`records`-Felder
  bleiben trotzdem aktuell, da sie serverseitig unabhängig vom angefragten
  `dateKey` immer aus dem echten Heute berechnet werden (siehe oben).

## 2. Layout-Änderung

- `TAGESVERLAUF`-Karte (`src/renderer/index.html`) wechselt von `span-12`
  auf `span-6`.
- Neue Karte `WOCHEN-SCORE` (`span-6`) direkt danach in derselben Zeile.
- `dashboard.css`: neue Klasse `.span-6 { grid-column: span 6; }`, inklusive
  Aufnahme in die bestehende Mobile-Breakpoint-Regel
  (`.span-4, .span-8, .span-6 { grid-column: span 12; }`).

## 3. Neue Karte "WOCHEN-SCORE"

Unabhängig vom angezeigten Tag (bezieht sich immer auf die letzten 7 Tage
ab echt-heute, konsistent mit der bestehenden "LETZTE 7 TAGE"-Karte).

- Großer Wert: Ø-Fokus-Score der letzten 7 Tage (aus `last7`, gewichtet wie
  `focusScore()`, aber über die Summe der 7 Tage statt pro Tag).
- Kompakter 7-Balken-Chart mit dem Tages-Score jedes der letzten 7 Tage
  (gleiche visuelle Sprache wie `chart--trend`, nur schmaler/7 Balken statt
  14).
- Zwei Badges:
  - "BESTER TAG" — `records.bestDayScore.score` % + Datum
    (`records.bestDayScore.key`, formatiert wie andere Datumslabels).
  - "BESTE WOCHE" — `records.bestWeekAvg.score` % (Ø).
- Ein Badge bekommt einen dezenten Glow/Highlight-Zustand, wenn er dem
  Typ des aktuellen `pendingRecord` entspricht (siehe Animation unten),
  auch nach Bestätigung des pendingRecord noch für die laufende
  Session sichtbar (kein Re-Fetch nötig, rein clientseitig).

## 4. Highscore-Tracking (Datenmodell)

`src/main/store.js`:

```js
data.records = {
  bestDayScore: { score: 0, key: null },   // key = "YYYY-MM-DD"
  bestWeekAvg:  { score: 0, key: null },    // key = dayKey des letzten Tages der 7-Tage-Periode
};
data.pendingRecord = null; // { type: 'day' | 'week', score, key } | null
```

- Nach jedem `store.record(...)`-Aufruf (Ende der Methode, vor `save()`):
  neue Methode `checkRecords()`:
  - Berechnet `todayScore = focusScore(this.day())` und
    `weekAvg = focusScore der Summe der letzten 7 Tage` (gleiche Formel wie
    `focusScore`, aber auf aufsummierten `productive`/`neutral`/`wasted`
    aus `lastDays(7)`).
  - Ein Rekord wird nur gewertet, wenn `today.total > 0` (keine leeren
    Tage) und ein vorheriger Rekord `> 0` bereits existierte (der
    allererste erfasste Tag setzt still die Baseline, ohne Feier — sonst
    würde Tag 1 immer sofort "Rekord" feiern).
  - Übertrifft `todayScore` den gespeicherten `bestDayScore.score`:
    aktualisieren + `pendingRecord = { type: 'day', score, key: dayKey() }`.
  - Übertrifft `weekAvg` den gespeicherten `bestWeekAvg.score`:
    aktualisieren + `pendingRecord = { type: 'week', score, key: dayKey() }`
    (überschreibt ggf. einen gleichzeitig gesetzten Tages-Rekord — pro
    Zeitpunkt wird nur ein `pendingRecord` gehalten; das ist bewusst
    einfach gehalten, da beide selten exakt im selben Tick fallen und ein
    verlorener Alt-Rekord nicht kritisch ist, da die Zahl trotzdem
    dauerhaft in `records` steht).
- `pendingRecord` wird in `buildSnapshot()` unverändert durchgereicht
  (unabhängig vom angezeigten Tag, siehe oben).

## 5. Rekord-Animation

- Neuer IPC-Call `records:acknowledge`, der `store.data.pendingRecord = null`
  setzt und `flush()` aufruft.
- `src/main/main.js`: Im bestehenden `dashboard:open`-Handler ändert sich
  nichts an der Fensterlogik; der Snapshot, den der Renderer beim Laden
  ohnehin abruft, enthält `pendingRecord`.
- `dashboard.js`: Beim ersten Render nach Fenster-/App-Start, falls
  `snapshot.pendingRecord` gesetzt ist:
  - Kurze Partikel-Animation um den Fokus-Reaktor (`#cardReactor`) —
    reine CSS-Keyframes + eine Handvoll erzeugter `<span>`/SVG-Partikel in
    den bestehenden Akzentfarben (Cyan/Amber, siehe `dashboard.css`
    Custom Properties), ca. 1,5–2 Sekunden, plus ein kurz einblendender
    Text "NEUER REKORD" (Tag) bzw. "NEUE BESTE WOCHE" (Woche).
  - Nach Ablauf der Animation: `window.copilot.acknowledgeRecord()` (neue
    preload-Methode), damit die Animation nicht bei jedem weiteren
    Poll/Öffnen erneut abspielt.
  - Der passende Badge in der WOCHEN-SCORE-Karte bekommt für den Rest der
    Session eine Highlight-Klasse.

## Nicht enthalten (bewusst außerhalb des Scopes)

- Keine Änderung an `reclassify()`/Override-Verhalten — bleibt global über
  alle Tage, wie bisher.
- Keine Persistenz der zuletzt angezeigten `viewedDate` über App-Neustarts
  hinweg — jeder App-Start beginnt wieder bei heute.
- Kein Ranking/Historie vergangener Rekorde, nur der jeweils aktuelle Bestwert.
