# Focus Co-Pilot

Ein eigenständiger Zeit- und Fokus-Tracker für macOS im JARVIS-Look. Die App
läuft im Hintergrund, erkennt automatisch, womit du deine Zeit verbringst,
und teilt sie in **produktiv**, **neutral** und **Zeitverschwendung**.

Nachbau der App aus dem Video *„Ich habe eine App mit Claude gebaut"*
(Dominik Lebersorger). Die Haltungs-/Kamera-Funktion ist bewusst **nicht**
enthalten — alles andere ist umgesetzt.

## Schnellstart

```bash
npm install
npm start
```

Beim ersten Start fragt macOS nach der Berechtigung **Automation → System
Events**. Die braucht die App, um den Namen der aktiven App und die URL des
aktiven Browser-Tabs zu lesen. Ohne diese Freigabe läuft die Oberfläche, aber
es werden keine Daten erfasst.

Freigeben unter: *Systemeinstellungen → Datenschutz & Sicherheit → Automation*.

### Als echte `.app` bauen

```bash
npm run icons     # Icons erzeugen (einmalig, macOS)
npm run dist      # erzeugt dist/Focus Co-Pilot-1.0.0.dmg
```

Danach die App aus dem DMG nach `/Programme` ziehen. Sie erscheint dann mit
eigenem Icon im Dock und in der Menüleiste — kein Terminal, kein Python.

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

**Menüleisten-Vorschau**
Ein Klick auf das Icon in der Menüleiste klappt direkt darunter eine Vorschau
auf: Fokus-Score, Gesamtzeit am Mac, produktive Zeit, Prokrastination, Zeit
nicht am PC, der Fortschritt zum Tagesziel, die meistgenutzte App des Tages
und was gerade läuft. Dazu Schalter für Dashboard, Tracking pausieren und
Beenden. Ein Klick daneben oder `Esc` schließt sie wieder.

Rechtsklick auf das Icon öffnet zusätzlich das klassische Menü.

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
| `src/main/stats.js` | Alle Kennzahlen für die Oberfläche |
| `src/renderer/` | Dashboard und Menüleisten-Vorschau (kein Framework, SVG von Hand) |

## Lizenz

MIT
