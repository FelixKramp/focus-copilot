# Focus Co-Pilot

Ein eigenständiger Zeit- und Fokus-Tracker für macOS im JARVIS-Look. Die App
läuft im Hintergrund, erkennt automatisch, womit du deine Zeit verbringst,
und teilt sie in **produktiv**, **neutral** und **Zeitverschwendung**.

Nachbau der App aus dem Video *„Ich habe eine App mit Claude gebaut"*
(Dominik Lebersorger). Die Haltungs-/Kamera-Funktion ist bewusst **nicht**
enthalten — alles andere ist umgesetzt.

## Installation

```bash
npm install
npm run install-app
```

Baut die App und installiert sie nach `/Programme`. Danach läuft sie wie jedes
andere Mac-Programm — startbar über Finder, Spotlight oder Launchpad, mit
eigenem Icon im Dock und in der Menüleiste. Kein Terminal, kein `npm start`
mehr nötig; das Terminal kann geschlossen werden, ohne die App zu beenden.

Beim ersten Start fragt macOS nach der Berechtigung **Automation → System
Events**. Die braucht die App, um den Namen der aktiven App und die URL des
aktiven Browser-Tabs zu lesen. Ohne diese Freigabe läuft die Oberfläche, aber
es werden keine Daten erfasst. Freigeben unter:
*Systemeinstellungen → Datenschutz & Sicherheit → Automation*.

Für ein Update auf eine neuere Version: `npm run install-app` erneut ausführen
— das Skript beendet eine laufende Instanz, baut neu und ersetzt die alte App.

### Im Entwicklungsmodus starten

```bash
npm start
```

Läuft direkt aus dem Quellcode über Electron, ohne Installation — praktisch
zum Testen von Änderungen, aber an das Terminal-Fenster gebunden.

### Nur bauen, ohne zu installieren

```bash
npm run icons     # Icons erzeugen (einmalig, macOS)
npm run pack       # erzeugt dist/mac-arm64/Focus Co-Pilot.app
npm run dist        # erzeugt zusätzlich ein DMG zum Weitergeben
```

## Was die App macht

**Tracking**
- Erfasst alle 3 Sekunden die aktive App und — im Browser — die aktive Domain.
- Im Browser zählt die **Website**, nicht der Browser. `github.com` ist
  produktiv, `youtube.com` im selben Safari ist es nicht.
- Einzelne YouTube-Videos werden mit Titel und Thumbnail einzeln aufgelistet.

**Inaktivität vs. Prokrastination**
Wenn du länger nichts tust, zählt das als *nicht am PC* und wird **nicht** als
Nutzungszeit gewertet. Läuft aber gerade ein Video, während du nichts tust,
zählt es als **Prokrastination**. Erkannt wird das über die
`PreventUserIdleDisplaySleep`-Assertion von macOS — genau die hält ein Player,
solange etwas abspielt.

**Einstufung**
Alles wird automatisch einsortiert. Jede App und jede Website lässt sich per
Klick in der Rangliste manuell auf *Produktiv*, *Neutral* oder
*Zeitverschwendung* setzen; „Automatisch einstufen" nimmt die Änderung zurück.

**Ziele & Hochrechnung**
Produktiv-Ziel pro Tag und maximales Prokrastinations-Budget, mit Voreinstellungen
(Einsteiger / Creator / Maschine). Die Hochrechnung zeigt, was dein heutiges
Tempo pro Woche, Monat, Jahr und Jahrzehnt bedeutet — in vollen Tagen.

**Push-Nachrichten**
Nach 10 zusammenhängenden Minuten Prokrastination kommt eine Meldung, in
wechselnden Formulierungen. Beim Erreichen des Tagesziels ebenfalls.

**Score in der Menüleiste**
Neben dem Icon stehen der aktuelle Fokus-Score und ein Pfeil, der zeigt, wohin
er gerade wandert: `↑` steigt, `↓` fällt, `→` hält sich. Der Score ist ein
gewichteter Anteil (produktiv zählt voll, neutral halb, Prokrastination gar
nicht), die laufende Tätigkeit zieht ihn also auf ihr eigenes Gewicht zu —
daraus ergibt sich die Richtung sofort. Deshalb kann dieselbe neutrale Tätigkeit
je nach Stand nach oben oder unten zeigen: bei Score 30 hebt sie, bei Score 80
senkt sie. Bist du nicht am Rechner oder ist das Tracking pausiert, steht kein
Pfeil da — dann bewegt sich nichts. Abschaltbar per Rechtsklick auf das Icon,
Punkt *Score in der Menüleiste*.

**Menüleisten-Vorschau**
Ein Klick auf das Icon in der Menüleiste klappt direkt darunter eine Vorschau
auf: Fokus-Score mit demselben Trendpfeil, Gesamtzeit am Mac, produktive Zeit, Prokrastination, Zeit
nicht am PC, der Fortschritt zum Tagesziel, die meistgenutzte App des Tages
und was gerade läuft. Dazu Schalter für Dashboard, Tracking pausieren und
Beenden. Ein Klick daneben oder `Esc` schließt sie wieder.

Rechtsklick auf das Icon öffnet zusätzlich das klassische Menü.

**Diagramme mit Tooltip**
"Letzte 7 Tage" und "Fokus-Trend" reagieren auf Hover: Der Zeiger holt exakte
Werte in einem Tooltip heran (Produktiv/Neutral/Prokrastination-Aufschlüsselung
bzw. Fokus-Score des Tages), die übrigen Balken treten dabei leicht zurück.

## Datenschutz

Alle Daten bleiben lokal in
`~/Library/Application Support/Focus Co-Pilot/data.json`.
Es gibt keinen Server und kein Konto.

Zwei Ausnahmen, beide rein kosmetisch: YouTube-Thumbnails werden von
`i.ytimg.com` geladen und Website-Favicons von `icons.duckduckgo.com`. Wer das
nicht möchte, entfernt die beiden Hosts aus der `Content-Security-Policy` in
`src/renderer/index.html` — dann bleiben die Bildflächen einfach leer.

## Entwicklung

```bash
npm test          # Kernlogik prüfen (Einstufung, Speicher, Statistik)
npm run seed /tmp/demo && npm start -- --user-data-dir=/tmp/demo
```

Der zweite Befehl füllt eine separate Datenablage mit 14 Tagen Beispieldaten,
damit man die Diagramme gefüllt sieht, ohne die echten Daten anzufassen.

### Aufbau

| Datei | Aufgabe |
| --- | --- |
| `src/main/main.js` | Fenster, Menüleiste, IPC, App-Icons |
| `src/main/tracker.js` | Der 3-Sekunden-Takt und die Inaktivitäts-Logik |
| `src/main/monitor.js` | AppleScript für aktive App/URL, Medien-Erkennung |
| `src/main/classify.js` | Automatische Einstufung von Apps und Domains |
| `src/main/store.js` | Persistenz (eine JSON-Datei, atomar geschrieben) |
| `src/main/score.js` | Fokus-Score und die Richtung, in die er gerade wandert |
| `src/main/stats.js` | Alle Kennzahlen für die Oberfläche |
| `src/renderer/` | Dashboard und Menüleisten-Vorschau (kein Framework, SVG von Hand) |

## Lizenz

MIT
