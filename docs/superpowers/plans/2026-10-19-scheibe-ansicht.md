# Scheibe-Ansicht (Tachoscheibe mit Spurband) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Arbeite die Tasks der Reihe nach ab; jeder Task endet mit grünen Tests.

**Goal:** Neben dem bestehenden Dashboard gibt es eine zweite Ansicht „Scheibe". Links zeigt sie den Tag als 24-Stunden-Scheibe von 4 bis 4 Uhr: eine Speiche pro Stunde, nach außen gestapelt nach Kategorie, mit einem Zeiger auf jetzt. Rechts stehen die vier Summen, wann das Ziel erreicht und das Budget aufgebraucht war, ein Spurband mit den sechs meistgenutzten Apps über die 24 Stunden und die Aufschlüsselung der gewählten Stunde. Ein Klick auf eine Stunde im Spurband rahmt dieselbe Speiche ein und zeigt darunter die Apps; mit ‹ und › geht es stundenweise weiter. Das Dashboard bleibt unverändert und ist weiter die Startansicht, bis die Scheibe sich im Alltag bewährt hat.

**Vorlage:** Artboard „Mix A + C: Tachoscheibe mit Spurband (klickbar)" auf der Seite „Grundlegende Umbauten" der Leinwand https://claude.ai/artifact/4gm9Fods36c27vjZKhPGuy. Maße, Farben, Schrift und Texte von dort übernehmen; die Geometrie der Scheibe (`wedge()`, R0 92 / R1 248 in einer 600er viewBox, 0,9° Spalt je Seite, 1,5 px Fuge zwischen Kategorien) steht dort im `renderVals()` und kann fast wörtlich übernommen werden.

**Architecture:** Wie bisher rechnet der Main-Prozess, der Renderer zeichnet. Der Snapshot bekommt zwei neue Felder (`appLanes`, `milestones`); die Stunden-Einträge (`hourItems`) und `dayStart` gibt es schon. Die Scheiben-Geometrie kommt in ein eigenes, reines Modul, damit der Smoke-Test sie ohne Electron prüfen kann. Die Ansicht ist ein zweiter Container in `index.html`, umgeschaltet über einen Schalter „Übersicht | Scheibe" in der Kopfzeile; die Wahl wird als `settings.view` gespeichert. Die Stundenauswahl (`selectedHour`, `selectedDayKey`) teilen sich Tagesverlauf und Scheibe, damit beide Ansichten dieselbe Stunde zeigen.

**Tech Stack:** Electron, Vanilla JS, kein Framework. Tests: `npm test` (`scripts/smoke-test.js`). Sichtprüfung: `npx electron scripts/preview.js` mit `--click`, `--theme`, `--dump` und Testdaten über `HOME=<ordner>` (siehe unten).

## Global Constraints

- **Ausgangspunkt:** Der Branch `design-umschalter` (Design-Umschalter JARVIS/Mischpult) ist noch nicht in `main`. Zuerst dort einen PR machen und mergen, dann für diese Arbeit einen neuen Branch `scheibe-ansicht` von `main` ziehen. Sonst gibt es Konflikte in `dashboard.css`, `dashboard.js` und `index.html`.
- **Tag von 4 bis 4 Uhr:** Die Scheibe beginnt oben mit `snapshot.dayStart`. Bei neuen Tagen ist das 4, bei Tagen von vor der Umstellung 0. Nie fest 4 annehmen.
- **Ehrliche Daten:** Pro Stunde ist nur die Summe je App bekannt, nicht die genaue Uhrzeit. Spurband-Balken beginnen am Stundenanfang und sind so lang wie die Minuten. Stunden von vor dem Update haben `hourItems[h] === null`; dort bleibt das Spurband leer, und die Aufschlüsselung sagt wie im Tagesverlauf, dass es dafür keine Daten gibt.
- **Zeiger nur heute:** Bei vergangenen Tagen gibt es keinen Zeiger und keinen Satz „Jetzt ist es …".
- **Design der Ansicht:** Version 1 hat ihre eigene helle Palette aus dem Entwurf (Grund `#e9ece9`, Fläche `#f7f8f6`, Tinte `#16202a`, Grau `#55606b`, produktiv `#1f4fd1`, neutral `#a3abb3`, Prokrastination `#e0661c`, Spur `#dfe3df`, Linie `#d3d8d3`) und die Schrift Archivo. Ob sie später JARVIS- und Mischpult-Varianten bekommt, ist eine offene Frage (unten), nicht Teil dieses Plans. Archivo muss lokal mitgeliefert werden (`assets/fonts/`, OFL-Lizenz beilegen), die App lädt nichts aus dem Netz; die CSP erlaubt nur `'self'`.
- **Die Live-Updates** kommen alle 3 Sekunden. Die Scheibe darf neu gezeichnet werden (ein paar Pfade, billig), die Auswahl darf dabei aber nicht verloren gehen. Wie beim Tagesverlauf: `selectedDayKey` vergleichen und nur bei Tageswechsel zurücksetzen.
- **Bewegung** nur als Rückmeldung: Speichen-Auswahl und Aufschlüsselung mit denselben Tokens wie im Dashboard (`--ease-out`, `--t-standard`). Keine Einblend-Animation der Scheibe beim Laden. `prefers-reduced-motion` respektieren.

---

## Task 0: Vorbereitung

- [ ] PR für `design-umschalter` aufmachen, mergen, lokal `main` aktualisieren.
- [ ] `git switch -c scheibe-ansicht`
- [ ] `npm test` muss grün sein, bevor etwas geändert wird.
- [ ] Archivo (Variable Font mit `wdth`- und `wght`-Achse) von Google Fonts herunterladen, nach `assets/fonts/Archivo[wdth,wght].ttf` legen, `OFL.txt` daneben. In `package.json` prüfen, ob `assets/` ins Build kommt (`build.files`), sonst ergänzen.

## Task 1: Meilensteine im Store

Das Dashboard weiß bisher nicht, *wann* das Ziel erreicht oder das Budget aufgebraucht war. Das wird beim Tick festgehalten, in dem die Schwelle überschritten wird.

**Files:** `src/main/store.js`, `scripts/smoke-test.js`

- [ ] In `record()` nach dem Hochzählen prüfen: Wenn `day.productive` gerade über `goals.productiveMinutes * 60` gestiegen ist und `day.milestones.goalAt` fehlt, `goalAt = Date.now()` setzen. Dasselbe für `day.wasted` über `goals.maxWasteMinutes * 60` → `budgetAt`. `emptyDay()` bekommt `milestones: {}`; `load()` ergänzt es bei alten Tagen.
- [ ] Ändert sich das Ziel (`setGoals`), werden die Meilensteine des heutigen Tages gelöscht und ab dem nächsten Tick neu bestimmt. Bei einem höheren Ziel wäre ein alter Zeitpunkt sonst falsch.
- [ ] Umstufen (`reclassify`) kann Minuten zwischen Kategorien verschieben: danach ebenfalls die Meilensteine des betroffenen Tages löschen. Bei vergangenen Tagen bleiben sie dann leer; das ist ehrlich.
- [ ] Tests: Ziel 1 Min, zwei Ticks à 40 s produktiv → `goalAt` gesetzt, ein weiterer Tick ändert ihn nicht. `setGoals` löscht ihn. Budget analog.

## Task 2: Snapshot-Felder `appLanes` und `milestones`

**Files:** `src/main/stats.js`, `scripts/smoke-test.js`

- [ ] `appLanes(hours)`: aus allen `hours[h].items` je App die Minuten pro Stunde sammeln (Schlüssel `app:` oder `domain:` wie in `hourItems`), nach Gesamtzeit sortieren. Rückgabe `{ lanes: [{ kind, name, category, total, byHour: [24 Zahlen in Sekunden] }], rest: { names: [...], total } }` mit höchstens sechs Lanes; alles Weitere landet in `rest`. Die Kategorie einer App ist die ihres größten Stunden-Eintrags.
- [ ] `milestones`: `{ goalAt, budgetAt }` des angezeigten Tages als Uhrzeit `"15:44"` (lokal) oder `null`.
- [ ] Beides in `buildSnapshot()` aufnehmen.
- [ ] Tests: Summe aller `byHour` plus `rest.total` gleich der Summe aller Stunden-Einträge. Bei sieben Apps genau sechs Lanes und eine App in `rest`. Alte Stunden ohne `items` liefern leere Lanes, keinen Fehler.

## Task 3: Geometrie-Modul

**Files:** neu `src/renderer/disc-geometry.js`, `scripts/smoke-test.js`, `src/renderer/index.html`

- [ ] Reine Funktionen ohne DOM: `wedge(k, ra, rb)`, `discPaths(hours, dayStart)` → `{ track, p, n, w }` als Pfad-Strings, `selectionPath(hour, dayStart)`, `needle(date, dayStart)` → Linienkoordinaten, `hourLabels(dayStart)` → acht Positionen alle drei Stunden ab Tagesbeginn. Übernahme aus dem Entwurf, aber mit `dayStart` statt fest 4.
- [ ] Am Dateiende `if (typeof module !== 'undefined') module.exports = { … };`, im Browser hängt es an `window.DiscGeometry`. In `index.html` vor `dashboard.js` einbinden.
- [ ] Tests: `discPaths` mit einer Stunde 60 Min produktiv → `p` reicht bis R1; leere Stunden → nur Spur. Der Zeiger um 4:00 zeigt bei `dayStart` 4 nach oben (x = Mitte), um 0:40 bei 20,67 Positionen. `dayStart` 0 verschiebt alles um vier Positionen.

## Task 4: Ansicht bauen (statisch)

**Files:** `src/renderer/index.html`, neu `src/renderer/disc.css`, `src/renderer/dashboard.js`

- [ ] `index.html`: Das bisherige `<main class="grid">` bekommt `id="viewOverview"`. Daneben kommt neu `<main id="viewDisc" hidden>` mit dem Aufbau aus dem Entwurf: links die Scheibe (SVG mit den Pfaden und den acht Beschriftungen, darüber Score und „Fokus heute"), rechts die Überschrift mit Datum, die zwei Sätze zu Ziel und Budget, die vier Summen, das Spurband und die Aufschlüsselung. Texte wörtlich aus dem Entwurf.
- [ ] `disc.css`: eigene Tokens unter `#viewDisc` (siehe Global Constraints), `@font-face` für Archivo aus `assets/fonts/`. Zahlen mit `font-stretch: 75%` und `tabular-nums`.
- [ ] `dashboard.js`: `renderDisc(s)` füllt alles aus dem Snapshot. Die Sätze zu Ziel und Budget erscheinen nur, wenn der jeweilige Meilenstein gesetzt ist. Ohne Meilenstein: „Produktiv-Ziel: noch 1 Std 12 Min" bzw. „Budget: noch 20 Min übrig".
- [ ] Leere Zustände: Tag ohne Daten → Scheibe nur mit Spur, rechts „Noch nichts erfasst." Stunde ohne Einträge → „Nicht am Mac." Alte Stunde → derselbe Satz wie im Tagesverlauf.
- [ ] Prüfen mit Testdaten: `scripts/make-fake.js` aus der Vorschau-Session nachbauen (Tag mit `items` pro Stunde unter `$HOME/Library/Application Support/Focus Co-Pilot/data.json` in einem Temp-Ordner), dann `HOME=<temp> npx electron scripts/preview.js --date <tag> --out scheibe.png` mit vorübergehend sichtbarer Ansicht.

## Task 5: Interaktion

**Files:** `src/renderer/dashboard.js`, `src/renderer/disc.css`

- [ ] Über dem Spurband liegt eine Reihe von 24 echten `<button>`s (eine pro Stunde, `aria-label="14 bis 15 Uhr anzeigen"`, `aria-pressed`). Klick ruft dieselbe `selectHour(h)` auf wie der Tagesverlauf; die Scheibe zeichnet `selectionPath` neu, die Aufschlüsselung füllt sich.
- [ ] ‹ und › als Buttons neben der Stundenüberschrift, an den Tagesgrenzen deaktiviert. Pfeiltasten links und rechts machen dasselbe, solange die Scheibe sichtbar ist und kein Eingabefeld den Fokus hat.
- [ ] Klick auf eine Speiche in der Scheibe selbst: die Pfade sind ein großes SVG; den Winkel aus der Mausposition relativ zur Mitte berechnen, daraus die Stunde. Nur wenn der Abstand zur Mitte zwischen R0 und R1 liegt.
- [ ] Hover über eine Speiche zeigt den bestehenden Tooltip (`dayTooltipHtml`).

## Task 6: Umschalter Übersicht | Scheibe

**Files:** `src/renderer/index.html`, `src/renderer/dashboard.js`, `src/renderer/dashboard.css`, `src/main/store.js`, `scripts/smoke-test.js`

- [ ] In der Kopfzeile links neben dem Datum ein Segment-Schalter mit zwei echten Buttons „Übersicht" und „Scheibe" (`aria-pressed`). Er passt sich den Designs JARVIS und Mischpult an, so wie die übrigen Knöpfe.
- [ ] `DEFAULT_SETTINGS.view = 'overview'`, `setSettings` lässt nur `'overview'` und `'disc'` zu (wie bei `theme`). Test dazu.
- [ ] Wechsel als View Transition wie beim Designwechsel, ohne Animation bei „Bewegung reduzieren".
- [ ] Das Menüleisten-Fenster bleibt, wie es ist.

## Task 7: Prüfen und ausliefern

- [ ] `npm test` grün.
- [ ] Vorschau beider Ansichten in beiden Designs, die Scheibe mit Testdaten, mit gewählter Stunde und mit einem alten Tag (`dayStart` 0, ohne `items`).
- [ ] Inspector aus `design-taste-frontend`: Seite mit `scripts/preview.js --dump <ordner>` ablegen und `node ~/.claude/skills/design-taste-frontend/scripts/inspect.mjs --app <ordner>/index.html` laufen lassen; 0 FAIL.
- [ ] Commit, `npm run install-app`, ein paar Tage benutzen. Erst danach entscheiden, ob die Scheibe die Startansicht wird.

## Offene Fragen (nicht in diesem Plan)

- Soll die Scheibe auch in JARVIS und Mischpult erscheinen, oder bleibt sie bewusst hell?
- Die Wochen-Ringe aus Entwurf A sind aus Platzgründen weggefallen. Gehören sie unter die Scheibe?
- Wird die Scheibe die Startansicht, und braucht dann das Menüleisten-Fenster eine Mini-Scheibe?

**Umfang:** etwa zwei Sessions. Sinnvoller Schnitt: Session 1 bis einschließlich Task 4 (die Ansicht steht mit echten Daten), Session 2 Interaktion, Umschalter, Prüfen.
